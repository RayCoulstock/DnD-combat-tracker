#!/usr/bin/env python3
"""Install reviewed copy as /usr/local/sbin/ledger-release; no first-install bypass."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_target(config, environment, target, machine, now):
    require(config['enabled'] is True, 'Host release approval is disabled.')
    require(config['environment'] == environment and config['target_id'] == target, 'Target identity mismatch.')
    require(config['machine_id'] == machine, 'Unexpected host machine identity.')
    require(config['project'] == 'ledger-' + environment, 'Environment/project mismatch.')
    require(config['image'] == 'ghcr.io/raycoulstock/dnd-combat-tracker', 'Unexpected registry repository.')
    require(re.fullmatch(r'[a-f0-9]{40}', config['infrastructure_commit']), 'Pin the reviewed infrastructure commit.')
    checked = datetime.datetime.fromisoformat(config['restore_verified_at'].replace('Z', '+00:00'))
    require(datetime.timedelta(0) <= now - checked <= datetime.timedelta(days=30), 'A restore rehearsal within 30 days is required.')
    require(config['origin'].startswith('https://') and config['origin'].rstrip('/') == config['origin'], 'Exact HTTPS origin required.')


def private_file(path):
    p = Path(path)
    info = p.lstat()
    require(p.is_file() and not p.is_symlink() and info.st_uid == os.getuid() and not stat.S_IMODE(info.st_mode) & 0o077, 'Operator-owned 0600 secret file required.')
    return p


def main():
    require(len(sys.argv) == 6, 'Usage: ledger-release ENV TARGET DIGEST COMMIT RUN_ID')
    environment, target, digest, commit, run_id = sys.argv[1:]
    require(environment in ('staging', 'production'), 'Unknown environment.')
    require(re.fullmatch(r'[A-Za-z0-9_-]{16,80}', target), 'Invalid target identifier.')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', digest) and re.fullmatch(r'[a-f0-9]{40}', commit) and re.fullmatch(r'[1-9][0-9]{0,19}', run_id), 'Invalid release identity.')
    path = Path('/etc/encounter-ledger-releases/' + environment + '.json')
    for parent in path.parents:
        info = parent.stat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'Release configuration parent must be root-controlled.')
    info = path.lstat()
    require(not path.is_symlink() and info.st_uid == 0 and not info.st_mode & 0o022, 'Release config must be root-owned and not writable by the deploy account.')
    config = json.loads(path.read_text())
    validate_target(config, environment, target, Path('/etc/machine-id').read_text().strip(), datetime.datetime.now(datetime.timezone.utc))
    checkout = Path(config['checkout']).resolve()
    require(checkout.is_absolute() and checkout.is_dir(), 'Approved checkout missing.')
    for parent in (checkout, *checkout.parents):
        info = parent.stat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'Infrastructure parent directory is writable by an untrusted account.')
    # Trusted deployment code cannot be rewritten by an SSH compromise of this account.
    for base, directories, files in os.walk(checkout):
        for name in directories + files:
            p = Path(base) / name
            s = p.lstat()
            require(not p.is_symlink() and s.st_uid == 0 and not s.st_mode & 0o022, 'Infrastructure checkout must be root-owned and immutable to deploy account.')
    require(checkout.stat().st_uid == 0 and not checkout.stat().st_mode & 0o022, 'Untrusted checkout.')
    head = subprocess.check_output(['git', '-c', 'safe.directory=' + str(checkout), '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    require(head == config['infrastructure_commit'], 'Infrastructure checkout differs from approved commit.')
    os.chdir(checkout)
    env = os.environ.copy()
    env['PATH'] = '/usr/local/bin:/usr/bin:/bin'
    for key in list(env):
        if key.startswith(('LEDGER_', 'RESTIC_', 'COMPOSE_', 'DOCKER_')) or key in ('DATABASE_URL', 'SESSION_SECRET', 'APP_ORIGIN', 'ALLOW_DM_REGISTRATION', 'POSTGRES_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DB'):
            del env[key]
    env.update(DOCKER_HOST='unix:///var/run/docker.sock', DOCKER_CONTEXT='default')
    runtime = private_file('/etc/encounter-ledger/' + environment + '.env')
    checks = private_file('/etc/encounter-ledger/' + environment + '-check.json')
    check = json.loads(checks.read_text())
    require(check['origin'] == config['origin'] and all(check.get(k) for k in ('email', 'password', 'playerCookie', 'campaignId')), 'Pre-provisioned synthetic identities are required.')
    env.update(LEDGER_PROJECT_NAME=config['project'], LEDGER_ENV_FILE=str(runtime), LEDGER_BACKUP_ENV_FILE='/etc/encounter-ledger/' + environment + '-backup.env', LEDGER_LOCK_DIR='/var/lib/encounter-ledger/operations')
    lock_dir = Path(env['LEDGER_LOCK_DIR'])
    require(lock_dir.is_dir() and lock_dir.stat().st_uid == os.getuid() and not lock_dir.stat().st_mode & 0o077, 'Private maintenance lock directory required.')
    lock = open(lock_dir / (config['project'] + '.lock'), 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    env['LEDGER_OPERATION_LOCK_FD'] = str(lock.fileno())

    def run(args, *, capture=False, input=None):
        result = subprocess.run(args, env=env, pass_fds=(lock.fileno(),), input=input, text=True, stdout=subprocess.PIPE if capture else None, check=True)
        return result.stdout.strip() if capture else ''

    compose = ['scripts/ops/compose.sh']
    run(['scripts/ops/preflight.sh'])
    rendered = json.loads(run(compose + ['config', '--format', 'json'], capture=True))
    require(rendered['services']['app']['environment']['APP_ORIGIN'] == config['origin'], 'Runtime origin mismatch.')
    for service in ('app', 'postgres', 'caddy'):
        container = run(compose + ['ps', '-q', service], capture=True)
        require(container and '\n' not in container, 'An existing single-instance installation is required.')
        require(run(['docker', 'inspect', container, '--format', '{{.State.Health.Status}}'], capture=True) == 'healthy', 'Existing infrastructure is not healthy.')
    minimum = config['minimum_free_bytes']
    require(isinstance(minimum, int) and minimum >= 10 * 1024**3, 'Review disk staging/headroom budget (minimum 10 GiB).')
    for directory in ('/var/lib/docker', '/var/backups/encounter-ledger'):
        require(shutil.disk_usage(directory).free >= minimum, 'Insufficient disk headroom.')
    image = config['image'] + '@' + digest
    # Defence in depth: a scoped SSH key cannot substitute an arbitrary registry image.
    # Host gh uses independently configured read-only repository/package access.
    trusted_run = json.loads(run(['gh', 'api', 'repos/RayCoulstock/DnD-combat-tracker/actions/runs/' + run_id], capture=True))
    require(trusted_run['repository']['full_name'] == 'RayCoulstock/DnD-combat-tracker'
            and trusted_run['path'] == '.github/workflows/publish.yml'
            and trusted_run['event'] == 'push' and trusted_run['head_branch'] == 'main'
            and trusted_run['head_sha'] == commit and trusted_run['conclusion'] == 'success'
            and trusted_run['status'] == 'completed', 'Host cannot verify successful main publication.')
    run(['gh', 'attestation', 'verify', 'oci://' + image, '--repo', 'RayCoulstock/DnD-combat-tracker',
         '--signer-workflow', 'RayCoulstock/DnD-combat-tracker/.github/workflows/publish.yml',
         '--source-ref', 'refs/heads/main', '--source-digest', commit, '--deny-self-hosted-runners'], capture=True)
    run(['docker', 'pull', image])
    require(run(['docker', 'image', 'inspect', image, '--format', '{{ index .Config.Labels "org.opencontainers.image.revision" }}'], capture=True) == commit, 'Image commit differs from approved release.')
    require(run(['docker', 'image', 'inspect', image, '--format', '{{ index .Config.Labels "org.encounter-ledger.validation-only" }}'], capture=True) != 'true', 'Diagnostic image refused.')
    print('Verified existing target, private configuration, health, capacity and approved image.', flush=True)
    # From this point failures leave app writes stopped for operator-owned recovery.
    try:
        backup = run(['scripts/ops/backup.sh', '--keep-stopped'], capture=True)
        snapshot = re.search(r'Encrypted backup snapshot: ([a-f0-9]{8,64})', backup)
        require(snapshot, 'No successful matched encrypted backup receipt.')
        print('Matched encrypted backup snapshot: ' + snapshot[1], flush=True)
        lines = runtime.read_text().splitlines()
        require(sum(line.startswith('LEDGER_IMAGE=') for line in lines) == 1, 'Runtime requires exactly one explicit LEDGER_IMAGE.')
        replacement = '\n'.join('LEDGER_IMAGE=' + image if line.startswith('LEDGER_IMAGE=') else line for line in lines) + '\n'
        fd, temp = tempfile.mkstemp(dir=runtime.parent, prefix='.release-')
        try:
            with os.fdopen(fd, 'w') as output:
                output.write(replacement)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp, runtime)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        run(['scripts/ops/preflight.sh'])
        run(['scripts/ops/migrate.sh', '--approve-migrations'])
        run(compose + ['up', '-d', '--wait', '--wait-timeout', '180', 'app', 'caddy'])
        # Isolated read-only health client: no runtime/backup secrets in container env.
        script = (checkout / 'scripts/ci/verify-live.mjs').read_text()
        run(['docker', 'run', '--rm', '-i', '--network', 'bridge', '--entrypoint', 'node', image, '--input-type=module', '-e', script], input=json.dumps(check))
        print('Release SUCCESS: environment=' + environment + ' commit=' + commit + ' digest=' + digest + ' publication_run=' + run_id, flush=True)
    except Exception:
        subprocess.run(compose + ['stop', '-t', '35', 'app'], env=env, pass_fds=(lock.fileno(),), stdout=subprocess.DEVNULL)
        print('Release FAILED: app writes remain stopped. No database rollback/restore was attempted. Operator must inspect the matched snapshot and migration state.', file=sys.stderr)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not print exceptions containing Compose values, credentials or login bodies.
        print('Release refused or failed. Inspect protected operator diagnostics; do not reset data.', file=sys.stderr)
        sys.exit(1)
