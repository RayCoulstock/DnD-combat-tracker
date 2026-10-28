#!/usr/bin/env python3
"""Manual ledger-production releases; never provision, seed, prune or restore data."""
import argparse
from contextlib import contextmanager
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import uuid

REPO = 'RayCoulstock/DnD-combat-tracker'
IMAGE = 'ghcr.io/' + REPO.lower()
ORIGIN = 'https://ledger.eruditology.com'
DIGEST = r'sha256:[a-f0-9]{64}'
SHA = r'[a-f0-9]{40}'
SELECTOR = rf'(?:latest|[1-9][0-9]{{0,19}}|{SHA})'
ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path('/etc/encounter-ledger/production.env')
BACKUP = Path('/etc/encounter-ledger/backup.env')
LOCKS = Path('/var/lib/encounter-ledger/operations')
REPORTS = Path('/var/lib/encounter-ledger/deployments')
INTERRUPTED = False

def checkpoint():
    if INTERRUPTED:
        raise KeyboardInterrupt()


class Refused(Exception):
    """Messages contain only operator-safe constants, never captured tool errors."""


class IdentityRefused(Refused):
    """Fixed identity-verification diagnostics only."""


def identity_require(condition, message):
    if not condition:
        raise IdentityRefused(message)


def require(condition, message):
    if not condition:
        raise Refused(message)


def private(path, directory=False):
    info = path.lstat()
    require(not path.is_symlink() and (path.is_dir() if directory else path.is_file())
            and info.st_uid == os.getuid() and not stat.S_IMODE(info.st_mode) & 0o077,
            'Required private operator-owned file/directory is missing or unsafe.')


@contextmanager
def maintenance_lock(directory=LOCKS):
    # Installation creates this file. Plan does not create/truncate any files.
    private(directory, True)
    path = directory / 'ledger-production.lock'
    private(path)
    with open(path, 'r+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('Another deployment, backup, migration or restore is running.') from None
        yield lock.fileno()


def select_run(runs, selector):
    require(isinstance(runs, list) and runs, 'No successful main publication found.')
    if selector != 'latest':
        runs = [r for r in runs if r.get('head_sha') == selector]
    require(bool(runs), 'No successful main publication found for that commit.')
    require(all(type(r.get('run_number')) is int and r['run_number'] > 0 for r in runs), 'Malformed publication metadata.')
    # Do not silently fall back if this newest successful run has expired evidence.
    return max(runs, key=lambda r: r['run_number'])


def replace_image(raw, previous, proposed):
    require(re.fullmatch(rf'{re.escape(IMAGE)}@{DIGEST}', proposed), 'Invalid approved image.')
    lines = raw.splitlines(keepends=True)
    pattern = re.compile(rb'^[ \t]*(?:export[ \t]+)?LEDGER_IMAGE[ \t]*=[ \t]*')
    matches = [i for i, line in enumerate(lines) if pattern.match(line)]
    require(len(matches) == 1, 'Use exactly one literal LEDGER_IMAGE setting in production.env.')
    index = matches[0]
    line = lines[index]
    prefix = pattern.match(line).group()
    ending = b'\r\n' if line.endswith(b'\r\n') else b'\n' if line.endswith(b'\n') else b''
    value = line[len(prefix):len(line) - len(ending) if ending else len(line)]
    quote = value[:1] if value[:1] in (b'"', b"'") else b''
    if quote:
        end = value.find(quote, 1)
        require(end > 0, 'Invalid quoted LEDGER_IMAGE setting.')
        literal, suffix = value[1:end], value[end + 1:]
        require(re.fullmatch(rb'[ \t]*(?:#[^\r\n]*)?', suffix), 'Invalid LEDGER_IMAGE suffix.')
    else:
        main, marker, comment = value.partition(b'#')
        literal = main.rstrip(b' \t')
        suffix = main[len(literal):] + marker + comment
    require(literal == previous.encode('ascii'), 'Runtime image must be literal and match the running app.')
    lines[index] = prefix + quote + proposed.encode('ascii') + quote + suffix + ending
    return b''.join(lines)


def atomic_write(path, content, mode=0o600, gid=None):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.ledger-release-')
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), mode)
            if gid is not None:
                os.fchown(output.fileno(), -1, gid)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def execute(args, *, env, fd, input=None, timeout=120):
    try:
        result = subprocess.run(args, cwd=ROOT, env=env, pass_fds=(fd,), input=input,
                                text=True, capture_output=True, timeout=timeout, start_new_session=True)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused('A required command is unavailable or timed out.') from None
    require(result.returncode == 0, 'A required command failed; raw output is suppressed to protect credentials.')
    return result.stdout.strip()


class Host:
    def __init__(self, fd, runtime=RUNTIME, reports=REPORTS, runner=execute):
        self.fd, self.runtime, self.reports, self.runner = fd, runtime, reports, runner
        self.env = {k: v for k, v in os.environ.items() if k in
                    ('HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN')}
        self.env.update(PATH='/usr/local/bin:/usr/bin:/bin', GH_HOST='github.com',
                        DOCKER_HOST='unix:///var/run/docker.sock', DOCKER_CONTEXT='default',
                        LEDGER_ENV_FILE=str(runtime), LEDGER_BACKUP_ENV_FILE=str(BACKUP),
                        LEDGER_PROJECT_NAME='ledger-production', LEDGER_LOCK_DIR=str(LOCKS),
                        LEDGER_OPERATION_LOCK_FD=str(fd))

    def run(self, args, input=None, timeout=120):
        return self.runner(args, env=self.env, fd=self.fd, input=input, timeout=timeout)

    def compose(self, *args):
        return self.run(['scripts/ops/compose.sh', *args])

    def api(self, path):
        try:
            return json.loads(self.run(['gh', 'api', 'repos/' + REPO + path]))
        except Refused:
            raise Refused('Cannot read GitHub publications; check gh read-only authentication and connectivity.') from None
        except (ValueError, KeyError, TypeError):
            raise Refused('Malformed GitHub response.') from None

    def gates(self, run, release=None):
        # Reuse the exact CI gates; Node is already present in the healthy app.
        source = (ROOT / 'scripts/ci/release-gates.mjs').read_text() + '''
import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync(0,'utf8'));
validateRun(data.run,data.repository);
if(data.release)validateRelease(data.release,data.run,data.release.digest,data.repository);
'''
        try:
            self.run(['scripts/ops/compose.sh', 'exec', '-T', 'app', 'node', '--max-old-space-size=64',
                      '--input-type=module', '-e', source], input=json.dumps(dict(run=run, release=release, repository=REPO)))
        except Refused:
            raise Refused('Publication failed the existing trusted-main/image-validation release gates.') from None

    def release(self, selector):
        require(re.fullmatch(SELECTOR, selector), 'Select latest, a publication run ID or a full commit SHA.')
        if selector.isdigit():
            run_id = selector
        else:
            query = '/actions/workflows/publish.yml/runs?branch=main&event=push&status=success&per_page=100'
            if selector != 'latest':
                query += '&head_sha=' + selector
            run_id = str(select_run(self.api(query).get('workflow_runs'), selector)['id'])
        require(re.fullmatch(r'[1-9][0-9]{0,19}', run_id), 'Malformed publication run ID.')
        run = self.api('/actions/runs/' + run_id)
        require(str(run.get('id')) == run_id, 'GitHub run identity mismatch.')
        self.gates(run)
        try:
            with tempfile.TemporaryDirectory(prefix='ledger-release-') as directory:
                os.chmod(directory, 0o700)
                self.run(['gh', 'run', 'download', run_id, '--repo', REPO, '--name', 'release-' + run['head_sha'], '--dir', directory])
                path = Path(directory) / 'release.json'
                require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 65536, 'Missing or oversized release metadata.')
                release = json.loads(path.read_text())
        except Refused:
            raise Refused('Release evidence is unavailable/expired. No older release was selected automatically.') from None
        except (OSError, ValueError, KeyError, TypeError):
            raise Refused('Malformed release metadata.') from None
        self.gates(run, release)
        reference = release['image'] + '@' + release['digest']
        self.run(['gh', 'attestation', 'verify', 'oci://' + reference, '--repo', REPO,
                  '--signer-workflow', REPO + '/.github/workflows/publish.yml', '--source-ref', 'refs/heads/main',
                  '--source-digest', run['head_sha'], '--deny-self-hosted-runners'])
        self.manifest_config(reference, release['imageId'])
        return {key: release[key] for key in ('schemaVersion', 'commit', 'imageId', 'productionDockerfile', 'tlsBackupRestorePassed', 'image', 'digest', 'runId')}

    def manifest_config(self, reference, expected=None):
        identity_require(re.fullmatch(rf'{re.escape(IMAGE)}@{DIGEST}', reference),
                         'Application image reference is not the approved repository pinned by digest.')
        try:
            manifest = json.loads(self.run(['docker', 'manifest', 'inspect', reference]))
        except (Refused, ValueError):
            raise IdentityRefused('Registry manifest retrieval failed; check registry access.') from None
        identity_require(isinstance(manifest, dict) and isinstance(manifest.get('config'), dict)
                and re.fullmatch(DIGEST, str(manifest['config'].get('digest', ''))),
                'Registry manifest configuration descriptor is missing or invalid.')
        configuration = manifest['config']['digest']
        identity_require(expected is None or configuration == expected,
                'Registry manifest configuration digest differs from attested release imageId.')
        return configuration

    def local_image(self, reference, configuration, commit=None):
        # RepoDigests binds the inspected local object to the immutable registry
        # reference. Docker's Id is a config digest (classic) or manifest digest
        # (containerd); neither is a substitute for the registry/config binding.
        try:
            info = json.loads(self.run(['docker', 'image', 'inspect', reference, '--format',
                                       '{{json .}}']))
        except (Refused, ValueError):
            raise IdentityRefused('Local image inspection failed.') from None
        identity_require(isinstance(info, dict), 'Local image inspection returned invalid metadata.')
        identity_require(isinstance(info.get('RepoDigests'), list) and reference in info['RepoDigests'],
                'Local image registry association does not match the approved reference.')
        registry = reference.rsplit('@', 1)[-1]
        identity_require(info.get('Id') in (configuration, registry),
                'Local Docker image ID matches neither approved manifest nor configuration digest.')
        config = info.get('Config') or {}
        identity_require(isinstance(config, dict), 'Local image configuration is invalid.')
        labels = config.get('Labels') or {}
        identity_require(isinstance(labels, dict), 'Local image labels are invalid.')
        if commit is not None:
            identity_require(labels.get('org.opencontainers.image.revision') == commit,
                    'Local image revision label differs from the approved release commit.')
        identity_require(labels.get('org.encounter-ledger.validation-only') != 'true',
                'Local image is validation-only; production deployment refused.')
        identity_require(info.get('Os') == 'linux' and info.get('Architecture') == 'amd64',
                'Local image platform is not linux/amd64.')
        return info['Id']

    def current(self):
        self.run(['scripts/ops/preflight.sh'])
        data = json.loads(self.compose('config', '--format', 'json'))
        app = data['services']['app']
        require(app['environment']['APP_ORIGIN'] == ORIGIN, 'Unexpected production origin.')
        require(app['environment']['ALLOW_DM_REGISTRATION'] == 'false', 'DM registration must remain disabled.')
        current = None
        for service in ('app', 'postgres', 'caddy'):
            container = self.compose('ps', '-q', service)
            require(re.fullmatch(r'[a-f0-9]{12,64}', container), 'An existing single healthy installation is required.')
            # Query only safe selected fields, never dump a container environment.
            fields = self.run(['docker', 'inspect', container, '--format', '{{.State.Health.Status}}|{{.Image}}|{{.Config.Image}}']).split('|')
            require(len(fields) == 3 and fields[0] == 'healthy', 'Existing production containers must be healthy.')
            expected_hash = self.compose('config', '--hash', service).split()
            require(len(expected_hash) == 2 and expected_hash[0] == service and re.fullmatch(r'[a-f0-9]{64}', expected_hash[1]), 'Cannot verify current Compose configuration hash.')
            actual_hash = self.run(['docker', 'inspect', container, '--format', '{{ index .Config.Labels "com.docker.compose.config-hash" }}'])
            require(actual_hash == expected_hash[1], 'Running service configuration differs from production.env/Compose; review drift before deployment.')
            if service == 'app':
                require(fields[2] == app['image'] and re.fullmatch(DIGEST, fields[1]), 'Running app and runtime image differ; resolve drift before deployment.')
                configuration = self.manifest_config(fields[2])
                local_id = self.local_image(fields[2], configuration)
                identity_require(fields[1] in (local_id, configuration),
                        'Running app image identity differs from the pinned local image.')
                current = dict(image=fields[2], imageId=fields[1], configurationDigest=configuration, localImageId=local_id)
                revision = self.run(['docker', 'inspect', container, '--format', '{{ index .Config.Labels "org.opencontainers.image.revision" }}'])
                current['commit'] = revision if re.fullmatch(SHA, revision) else None
            else:
                local_id = self.run(['docker', 'image', 'inspect', data['services'][service]['image'], '--format', '{{.Id}}'])
                require(local_id == fields[1], 'PostgreSQL/Caddy image drift requires separate review; this command upgrades only the app.')
        current['configurationHash'] = hashlib.sha256(self.runtime.read_bytes()).hexdigest()
        current['checkoutCommit'] = self.run(['git', 'rev-parse', 'HEAD'])
        require(re.fullmatch(SHA, current['checkoutCommit']), 'Invalid infrastructure checkout commit.')
        self.run(['git', 'diff', '--exit-code', 'HEAD', '--', '.'])
        return current

    def prerequisites(self):
        private(self.reports, True)
        for path in (Path('/var/lib/docker'), Path('/var/backups/encounter-ledger')):
            require(shutil.disk_usage(path).free >= 10 * 1024**3, 'At least 10 GiB free disk headroom is required for Docker and backup staging.')
        try:
            self.run(['bash', '-c', 'source scripts/ops/common.sh; load_backup'])
        except Refused:
            raise Refused('Encrypted backup repository/credentials unavailable; no application changes made.') from None
        self.public_health()

    def public_health(self):
        try:
            value = json.loads(self.run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*',
                                        '--proto', '=https', '--tlsv1.2', '--connect-timeout', '10', '--max-time', '20', ORIGIN + '/api/health']))
            require(value.get('ok') is True, 'Public HTTPS readiness failed.')
        except (Refused, ValueError, AttributeError):
            raise Refused('Public HTTPS readiness failed; TLS verification is required.') from None

    def pull(self, release):
        image = release['image'] + '@' + release['digest']
        try:
            self.run(['docker', 'pull', image], timeout=600)
        except Refused:
            raise IdentityRefused('Approved image download failed; check registry access and disk capacity.') from None
        self.manifest_config(image, release['imageId'])
        self.local_image(image, release['imageId'], release['commit'])
        # Old pre-beta images must not silently reopen registration on rollback.
        probe = '''import {runtimeConfig} from './dist-server/server/runtime-config.js';
const base={NODE_ENV:'production',DATABASE_URL:'postgresql://localhost/probe',SESSION_SECRET:'x'.repeat(64),APP_ORIGIN:'https://ledger.eruditology.com',ASSET_STORAGE_DIR:'/tmp/probe'};
if(runtimeConfig(base).allowDMRegistration!==false||runtimeConfig({...base,ALLOW_DM_REGISTRATION:'false'}).allowDMRegistration!==false)process.exit(1);'''
        try:
            self.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '1000:1000', '--memory', '128m', '--pids-limit', '64',
                      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--entrypoint', 'node', image,
                      '--max-old-space-size=64', '--input-type=module', '-e', probe])
        except Refused:
            raise IdentityRefused('Pulled image failed the isolated private-beta registration-security probe.') from None

    def backup(self):
        text = self.run(['scripts/ops/backup.sh', '--keep-stopped'], timeout=None)
        snapshots = re.findall(r'^Encrypted backup snapshot: ([a-f0-9]{64})$', text, re.MULTILINE)
        require(len(snapshots) == 1, 'No unambiguous successful encrypted backup receipt.')
        return snapshots[0]

    def migrate(self):
        self.run(['scripts/ops/migrate.sh', '--approve-migrations'], timeout=None)

    def start(self):
        self.run(['scripts/ops/compose.sh', 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'app', 'caddy'], timeout=None)

    def stop(self):
        self.compose('stop', '-t', '35', 'app')

    def report(self, path, data):
        atomic_write(path, (json.dumps(data, indent=2) + '\n').encode())


def plan(host, selector):
    current = host.current()
    host.prerequisites()
    release = host.release(selector)
    reference = release['image'] + '@' + release['digest']
    # Validate literal replacement before taking the application offline.
    replace_image(host.runtime.read_bytes(), current['image'], reference)
    return dict(schemaVersion=1, origin=ORIGIN, current=current, release=release,
                deploymentRequired=current['image'] != reference or current['configurationDigest'] != release['imageId']
                or current['commit'] != release['commit'])


def deploy(host, selected, expected):
    proposal = plan(host, selected)
    require(all(proposal['current'][k] == expected[k] for k in ('imageId', 'configurationHash', 'checkoutCommit'))
            and proposal['release']['digest'] == expected['digest'], 'The approved plan changed. Run plan and confirm again.')
    checkpoint()
    if not proposal['deploymentRequired']:
        return dict(status='unchanged', **proposal)
    release, current = proposal['release'], proposal['current']
    raw = host.runtime.read_bytes()
    metadata = host.runtime.stat()
    report_path = host.reports / ('deployment-' + uuid.uuid4().hex + '.json')
    record = dict(status='running', stage='pull', release=release, previous=current, backupSnapshot=None,
                  report=str(report_path), updatedAt=None)

    def save(stage, status='running'):
        record.update(stage=stage, status=status, updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        host.report(report_path, record)
        print('Deployment stage: ' + stage + ' (' + status + ')', file=sys.stderr, flush=True)

    save('pull')
    try:
        print('Deployment report: ' + str(report_path), file=sys.stderr, flush=True)
        checkpoint()
        host.pull(release)
        checkpoint()
        save('backup')
        record['backupSnapshot'] = host.backup()
        # Persist the recovery point before any config or SQL change.
        save('configuration')
        print('Backup snapshot: ' + record['backupSnapshot'], file=sys.stderr, flush=True)
        checkpoint()
        require(host.runtime.read_bytes() == raw, 'Runtime settings changed during backup; no image replacement was attempted.')
        reference = release['image'] + '@' + release['digest']
        atomic_write(host.runtime, replace_image(raw, current['image'], reference), stat.S_IMODE(metadata.st_mode), metadata.st_gid)
        save('migration')
        checkpoint()
        host.migrate()
        checkpoint()
        save('startup')
        checkpoint()
        host.start()
        checkpoint()
        save('health')
        actual = host.current()
        identity_require(actual['image'] == reference and actual['configurationDigest'] == release['imageId']
                and actual['commit'] == release['commit'], 'New container image identity does not match the approved release.')
        host.public_health()
        checkpoint()
        save('complete', 'success')
        return record
    except (Exception, KeyboardInterrupt) as error:
        stage = record['stage']
        state = 'left unchanged' if stage == 'pull' else 'not restarted; backup may have stopped the old app'
        if stage in ('migration', 'startup', 'health'):
            try:
                host.stop()
                state = 'stopped'
            except Exception:
                state = 'unknown; inspect the app immediately'
        reasons = dict(pull='Approved image pull/identity/private-beta compatibility check failed before interruption.',
                       backup='Matched encrypted backup did not complete; runtime image was not replaced.',
                       configuration='Recovery-point persistence or unchanged runtime update failed; inspect the report before resuming.',
                       migration='Migration failed or was interrupted; inspect SQL state before recovery.',
                       startup='New release did not reach container readiness.',
                       health='New release failed container identity or public HTTPS readiness.')
        record['error'] = reasons.get(stage, 'Operation failed or was interrupted.')
        if isinstance(error, IdentityRefused):
            record['verificationDetail'] = str(error)
        record.update(applicationState=state, recovery='No database rollback/restore performed. Inspect this report, snapshot and migration state before manual recovery.')
        try:
            save(stage, 'failed')
        except Exception:
            pass
        # Return safe durable context, not exception/command strings with secrets.
        raise Refused('Deployment failed at ' + stage + '. ' + record['error'] + ' Snapshot: ' + (record['backupSnapshot'] or 'none')
                      + '. Verification: ' + record.get('verificationDetail', 'Interrupted or unexpected failure; raw details suppressed') + '. App: ' + state + '. Report: ' + str(report_path) + '. No automatic rollback.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--release', default='latest')
    parser.add_argument('--expected-current')
    parser.add_argument('--expected-configuration')
    parser.add_argument('--expected-checkout')
    parser.add_argument('--expected-digest')
    args = parser.parse_args()
    require(re.fullmatch(SELECTOR, args.release), 'Invalid release selector.')
    require(os.geteuid() != 0 and pwd.getpwuid(os.geteuid()).pw_name == 'ledgerdeploy', 'Run as the existing non-root ledgerdeploy operator.')
    require(ROOT == Path('/opt/encounter-ledger/current').resolve(), 'Install reviewed scripts in the existing production checkout first.')
    private(RUNTIME)
    if args.apply:
        require(args.release.isdigit() and re.fullmatch(DIGEST, args.expected_current or '')
                and re.fullmatch(r'[a-f0-9]{64}', args.expected_configuration or '')
                and re.fullmatch(SHA, args.expected_checkout or '') and re.fullmatch(DIGEST, args.expected_digest or ''),
                'Apply requires a fixed publication run and the exact confirmed plan.')
    os.umask(0o077)
    def interrupted(_signal, _frame):
        # Let an already running backup/migration finish under the inherited lock.
        global INTERRUPTED
        INTERRUPTED = True
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    with maintenance_lock() as fd:
        host = Host(fd)
        value = plan(host, args.release) if args.plan else deploy(host, args.release, dict(
            imageId=args.expected_current, configurationHash=args.expected_configuration,
            checkoutCommit=args.expected_checkout, digest=args.expected_digest))
        print(json.dumps(value))


if __name__ == '__main__':
    try:
        main()
    except Refused as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        print('Release refused or interrupted. Inspect protected deployment reports; no automatic rollback or retry.', file=sys.stderr)
        sys.exit(1)
