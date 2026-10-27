"""Offline fault tests. Every Docker/GitHub/curl command is replaced; never SSH."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('manual_release', Path(__file__).with_name('deploy_release.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NODE = shutil.which('node')
OLD = m.IMAGE + '@sha256:' + '1' * 64
NEW = m.IMAGE + '@sha256:' + '2' * 64
EVIDENCE = dict(schemaVersion=1, commit='b' * 40, imageId='sha256:' + '3' * 64,
                productionDockerfile=True, tlsBackupRestorePassed=True, image=m.IMAGE,
                digest='sha256:' + '2' * 64, runId='123')
RUN = dict(id=123, run_number=5, repository=dict(full_name=m.REPO), path='.github/workflows/publish.yml',
           event='push', head_branch='main', status='completed', conclusion='success', head_sha='b' * 40)


class Commands:
    def __init__(self, runtime):
        self.runtime, self.calls, self.fail = runtime, [], None
        self.evidence, self.run = copy.deepcopy(EVIDENCE), copy.deepcopy(RUN)
        self.actual, self.started, self.stopped = OLD, False, False

    def __call__(self, args, *, env, fd, input=None, timeout=120):
        self.calls.append(args)
        require = m.require
        if args[:2] == ['gh', 'api']:
            return json.dumps({'workflow_runs': [self.run]} if '/workflows/' in args[-1] else self.run)
        if args[:3] == ['gh', 'run', 'download']:
            if self.fail == 'evidence':
                raise m.Refused('Redacted command failure')
            (Path(args[-1]) / 'release.json').write_text(json.dumps(self.evidence))
            return ''
        if args[:3] == ['gh', 'attestation', 'verify']:
            require(self.fail != 'attestation', 'Attestation unavailable')
            return ''
        if args[:3] == ['docker', 'manifest', 'inspect']:
            require(self.fail != 'unavailable', 'Registry unavailable')
            return json.dumps(dict(config=dict(digest=self.evidence['imageId'])))
        if args[0] == 'scripts/ops/preflight.sh':
            require(self.fail != 'preflight', 'Unsafe preflight')
            require('ALLOW_DM_REGISTRATION' not in env, 'Inherited registration override')
            return ''
        if args[0] == 'scripts/ops/compose.sh':
            command = args[1:]
            if command[:2] == ['config', '--hash']:
                return command[-1] + ' ' + '6'*64
            if command[:1] == ['config']:
                image = OLD if OLD in self.runtime.read_text() else NEW
                return json.dumps(dict(services=dict(app=dict(image=image, environment=dict(APP_ORIGIN=m.ORIGIN, ALLOW_DM_REGISTRATION='false')),
                                                    postgres=dict(image='postgres:17-alpine'), caddy=dict(image='caddy:2-alpine'))))
            if command[:1] == ['ps']:
                return {'app': 'a' * 12, 'postgres': 'b' * 12, 'caddy': 'c' * 12}[command[-1]]
            if command[:1] == ['exec']:
                # Run the real existing JS release gates against fake public metadata.
                result = subprocess.run([NODE, '--input-type=module', '-e', args[-1]], input=input, text=True, capture_output=True)
                require(result.returncode == 0, 'Release gates rejected metadata')
                return ''
            if command[:1] == ['up']:
                require(self.fail != 'startup', 'Startup failure')
                self.actual, self.started, self.stopped = NEW, True, False
                return ''
            if command[:1] == ['stop']:
                self.stopped = True
                return ''
        if args[:2] == ['docker', 'inspect']:
            service = {'a' * 12: 'app', 'b' * 12: 'postgres', 'c' * 12: 'caddy'}[args[2]]
            if 'config-hash' in args[-1]:
                return ('7' if self.fail=='drift' else '6')*64
            if 'revision' in args[-1]:
                return 'b' * 40 if self.actual == NEW else 'a' * 40
            if service == 'app':
                identity = EVIDENCE['imageId'] if self.actual == NEW else 'sha256:' + '0' * 64
                return 'healthy|' + identity + '|' + self.actual
            return 'healthy|sha256:' + '4' * 64 + '|' + service
        if args[:3] == ['docker', 'image', 'inspect']:
            if args[3] in ('postgres:17-alpine', 'caddy:2-alpine'):
                return 'sha256:' + '4' * 64
            return EVIDENCE['imageId'] + '|' + EVIDENCE['commit'] + '|<no value>|linux/amd64'
        if args[:2] == ['docker', 'pull']:
            require(self.fail != 'pull', 'Pull failed')
            return ''
        if args[:2] == ['docker', 'run']:
            require(self.fail != 'beta', 'Old image does not support closed registration')
            return ''
        if args[:2] == ['git', 'rev-parse']:
            return 'd' * 40
        if args[:2] == ['git', 'diff']:
            return ''
        if args[:1] == ['bash']:
            require(self.fail != 'credentials', 'Backup repository unavailable')
            return ''
        if args[:1] == ['curl']:
            return json.dumps(dict(ok=not (self.fail == 'health' and self.started)))
        if args[:1] == ['scripts/ops/backup.sh']:
            self.stopped = True
            require(self.fail != 'backup', 'Backup failure containing private material')
            if self.fail=='interrupt':m.INTERRUPTED=True
            if self.fail=='edit':self.runtime.write_bytes(self.runtime.read_bytes()+b'# operator edit\n')
            return 'Encrypted backup snapshot: ' + '5' * 64
        if args[:1] == ['scripts/ops/migrate.sh']:
            require(self.fail != 'migration', 'SQL failure containing private material')
            return ''
        raise AssertionError('Unexpected command: ' + args[0])


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.runtime = self.directory / 'production.env'
        self.original = ('# Preserve comments and secrets\r\nSESSION_SECRET=private-material\r\nLEDGER_IMAGE="' + OLD + '" # pinned\r\nALLOW_DM_REGISTRATION=false\r\n').encode()
        self.runtime.write_bytes(self.original)
        self.runtime.chmod(0o600)
        self.reports = self.directory / 'reports'
        self.reports.mkdir(mode=0o700)
        self.commands = Commands(self.runtime)
        self.host = m.Host(3, self.runtime, self.reports, self.commands)
        self.disk = patch.object(m.shutil, 'disk_usage', return_value=type('Disk', (), dict(free=100 * 1024**3))())
        self.disk.start()
        self.expected = dict(imageId='sha256:' + '0' * 64, configurationHash=m.hashlib.sha256(self.original).hexdigest(), checkoutCommit='d' * 40, digest=EVIDENCE['digest'])

    def tearDown(self):
        m.INTERRUPTED=False
        self.disk.stop()
        self.temp.cleanup()

    def receipt(self):
        paths = list(self.reports.glob('deployment-*.json'))
        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0].stat().st_mode & 0o777, 0o600)
        return json.loads(paths[0].read_text())

    def test_latest_and_explicit_selection(self):
        self.assertEqual(m.select_run([RUN, dict(RUN, id=124, run_number=6)], 'latest')['id'], 124)
        self.assertEqual(m.select_run([RUN, dict(RUN, head_sha='a'*40, run_number=6)], RUN['head_sha'])['id'], 123)
        for selector in ('latest', '123', RUN['head_sha']):
            self.assertEqual(m.plan(self.host, selector)['release']['digest'], EVIDENCE['digest'])
        self.assertFalse(any(c[:2] == ['docker', 'pull'] for c in self.commands.calls))
        self.assertEqual(self.runtime.read_bytes(), self.original)
        self.assertEqual(list(self.reports.iterdir()), [])

    def test_malformed_metadata_rejected_by_real_shared_gates(self):
        for field, value in [('digest', 'latest'), ('image', 'ghcr.io/attacker/image'), ('runId', '999'),
                             ('commit', 'a'*40), ('imageId', 'diagnostic'), ('productionDockerfile', False), ('tlsBackupRestorePassed', False)]:
            with self.subTest(field=field):
                self.commands.evidence = dict(EVIDENCE, **{field: value})
                with self.assertRaises(m.Refused):
                    m.plan(self.host, 'latest')
        for field, value in [('head_branch', 'feature'), ('event', 'pull_request'), ('conclusion', 'failure'), ('path', '.github/workflows/other.yml')]:
            self.commands.evidence = copy.deepcopy(EVIDENCE)
            self.commands.run = dict(RUN, **{field: value})
            with self.assertRaises(m.Refused):
                m.plan(self.host, '123')
        self.assertEqual(self.runtime.read_bytes(), self.original)

    def test_unavailable_expired_or_unattested_releases_never_fall_back(self):
        for failure in ('unavailable', 'evidence', 'attestation', 'credentials'):
            self.commands.fail = failure
            with self.subTest(failure=failure), self.assertRaises(m.Refused):
                m.plan(self.host, 'latest')
        self.assertEqual(self.runtime.read_bytes(), self.original)
        self.assertFalse(self.commands.stopped)

    def test_success_sequence_preserves_secret_bytes_and_records_snapshot(self):
        result = m.deploy(self.host, '123', self.expected)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['backupSnapshot'], '5'*64)
        self.assertEqual(self.runtime.read_bytes(), self.original.replace(OLD.encode(), NEW.encode()))
        self.assertEqual(self.runtime.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.receipt()['status'], 'success')
        calls = self.commands.calls
        pull = next(i for i,c in enumerate(calls) if c[:2] == ['docker','pull'])
        backup = next(i for i,c in enumerate(calls) if c[0] == 'scripts/ops/backup.sh')
        migration = next(i for i,c in enumerate(calls) if c[0] == 'scripts/ops/migrate.sh')
        startup = next(i for i,c in enumerate(calls) if c[:2] == ['scripts/ops/compose.sh','up'])
        self.assertLess(pull, backup); self.assertLess(backup, migration); self.assertLess(migration, startup)
        self.assertEqual(calls[backup], ['scripts/ops/backup.sh','--keep-stopped'])
        self.assertIn('--no-deps', calls[startup])
        self.assertFalse(any('down' in c or 'prune' in c or 'db:seed' in c for c in calls))

    def test_pull_or_unsupported_beta_image_failure_never_stops_or_backs_up(self):
        for failure in ('pull', 'beta'):
            self.commands.fail = failure
            with self.subTest(failure=failure), self.assertRaises(m.Refused):
                m.deploy(self.host, '123', self.expected)
            self.assertFalse(self.commands.stopped)
            self.assertEqual(self.runtime.read_bytes(), self.original)
        self.assertFalse(any(c[0] == 'scripts/ops/backup.sh' for c in self.commands.calls))

    def test_backup_failure_does_not_replace_runtime_or_start(self):
        self.commands.fail = 'backup'
        with self.assertRaises(m.Refused) as error:
            m.deploy(self.host, '123', self.expected)
        self.assertNotIn('private material', str(error.exception))
        self.assertEqual(self.runtime.read_bytes(), self.original)
        self.assertTrue(self.commands.stopped)
        self.assertFalse(self.commands.started)
        self.assertEqual(self.receipt()['backupSnapshot'], None)
        self.assertFalse(any(c[0] == 'scripts/ops/migrate.sh' for c in self.commands.calls))

    def test_migration_startup_and_health_failures_keep_snapshot_and_stop_writes(self):
        for failure in ('migration', 'startup', 'health'):
            with self.subTest(failure=failure):
                for path in self.reports.iterdir():
                    path.unlink()
                self.runtime.write_bytes(self.original)
                self.commands = Commands(self.runtime); self.commands.fail = failure
                self.host = m.Host(3, self.runtime, self.reports, self.commands)
                with self.assertRaises(m.Refused) as error:
                    m.deploy(self.host, '123', self.expected)
                self.assertIn('5'*64, str(error.exception))
                self.assertNotIn('private material', str(error.exception))
                self.assertTrue(self.commands.stopped)
                self.assertEqual(self.receipt()['backupSnapshot'], '5'*64)
                self.assertEqual(self.receipt()['status'], 'failed')
                self.assertEqual(self.runtime.read_bytes(), self.original.replace(OLD.encode(), NEW.encode()))

    def test_changed_approval_refuses_before_pull(self):
        for key in self.expected:
            bad = dict(self.expected, **{key:'changed'})
            with self.subTest(key=key), self.assertRaises(m.Refused):
                m.deploy(self.host, '123', bad)
        self.assertFalse(any(c[:2] == ['docker','pull'] for c in self.commands.calls))
        self.assertEqual(list(self.reports.iterdir()), [])

    def test_noop_never_pulls_stops_or_migrates(self):
        self.runtime.write_bytes(self.original.replace(OLD.encode(), NEW.encode()))
        self.commands.actual = NEW
        expected = dict(self.expected, imageId=EVIDENCE['imageId'], configurationHash=m.hashlib.sha256(self.runtime.read_bytes()).hexdigest())
        self.assertEqual(m.deploy(self.host, '123', expected)['status'], 'unchanged')
        self.assertEqual(list(self.reports.iterdir()), [])
        self.assertFalse(any(c[:2] == ['docker','pull'] or c[0] == 'scripts/ops/backup.sh' for c in self.commands.calls))

    def test_image_replacement_keeps_quotes_crlf_comments_and_rejects_duplicates(self):
        self.assertEqual(m.replace_image(self.original, OLD, NEW), self.original.replace(OLD.encode(), NEW.encode()))
        with self.assertRaises(m.Refused):
            m.replace_image(self.original + ('LEDGER_IMAGE='+OLD+'\n').encode(), OLD, NEW)
        with self.assertRaises(m.Refused):
            m.replace_image(b'LEDGER_IMAGE=${DYNAMIC}\n', OLD, NEW)

    def test_shared_lock_excludes_other_operations_and_is_inherited(self):
        locks = self.directory/'locks';locks.mkdir(mode=0o700)
        (locks/'ledger-production.lock').touch(mode=0o600)
        with m.maintenance_lock(locks) as fd:
            with self.assertRaises(m.Refused), m.maintenance_lock(locks):
                pass
            env = dict(self.host.env, LEDGER_LOCK_DIR=str(locks), LEDGER_OPERATION_LOCK_FD=str(fd))
            result = subprocess.run(['bash','-c','source scripts/ops/common.sh; lock_operations'], env=env, pass_fds=(fd,), capture_output=True)
            self.assertEqual(result.returncode, 0, 'Existing backup/migration child must accept the actual shared lock')
        with m.maintenance_lock(locks):
            pass

    def test_configuration_drift_and_disk_headroom_fail_without_changes(self):
        self.commands.fail='drift'
        with self.assertRaises(m.Refused):m.plan(self.host,'latest')
        self.commands.fail=None
        with patch.object(m.shutil,'disk_usage',return_value=type('Disk',(),dict(free=1))()), self.assertRaises(m.Refused):
            m.plan(self.host,'latest')
        self.assertEqual(self.runtime.read_bytes(),self.original)
        self.assertEqual(list(self.reports.iterdir()),[])

    def test_runtime_edit_during_backup_is_not_overwritten(self):
        self.commands.fail='edit'
        with self.assertRaises(m.Refused):m.deploy(self.host,'123',self.expected)
        self.assertEqual(self.runtime.read_bytes(),self.original+b'# operator edit\n')
        self.assertEqual(self.receipt()['backupSnapshot'],'5'*64)
        self.assertFalse(any(c[0]=='scripts/ops/migrate.sh' for c in self.commands.calls))

    def test_interrupt_after_backup_records_receipt_before_any_migration(self):
        self.commands.fail='interrupt'
        with self.assertRaises(m.Refused):m.deploy(self.host,'123',self.expected)
        self.assertEqual(self.runtime.read_bytes(),self.original)
        self.assertEqual(self.receipt()['backupSnapshot'],'5'*64)
        self.assertFalse(any(c[0]=='scripts/ops/migrate.sh' for c in self.commands.calls))

    def test_command_failure_does_not_expose_captured_credentials(self):
        result = type('Result', (), dict(returncode=1, stdout='private-password', stderr='private-password'))()
        with patch.object(m.subprocess, 'run', return_value=result), self.assertRaises(m.Refused) as error:
            m.execute(['fake'], env={}, fd=3)
        self.assertNotIn('private-password', str(error.exception))


if __name__ == '__main__':
    unittest.main(verbosity=2)
