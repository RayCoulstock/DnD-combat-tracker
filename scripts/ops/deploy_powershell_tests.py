"""Run real PowerShell against a fake SSH executable. Never contacts a host."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
PWSH = os.environ['LEDGER_TEST_PWSH']
PLAN = dict(schemaVersion=1, origin='https://ledger.eruditology.com', deploymentRequired=True,
            current=dict(image='ghcr.io/raycoulstock/dnd-combat-tracker@sha256:'+'1'*64,
                         imageId='sha256:'+'0'*64, commit='a'*40, configurationHash='c'*64, checkoutCommit='d'*40),
            release=dict(image='ghcr.io/raycoulstock/dnd-combat-tracker', digest='sha256:'+'2'*64, commit='b'*40, runId='123'))


class PowerShellTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.plan = self.root/'plan.json'
        self.log = self.root/'calls.jsonl'
        self.plan.write_text(json.dumps(PLAN))
        ssh = self.root/'ssh'
        ssh.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
with open(os.environ['MOCK_SSH_LOG'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
args=sys.argv[-1]
if os.environ.get('MOCK_SSH_FAILURE')=='1':
 print('Remote release refused.',flush=True);sys.exit(1)
if '--plan ' in args:print(Path(os.environ['MOCK_PLAN']).read_text())
else:
 print('Deployment stage: backup (running)',flush=True)
 print(json.dumps(dict(status='success',release=json.loads(Path(os.environ['MOCK_PLAN']).read_text())['release'],backupSnapshot='5'*64,report='/private/safe-report.json')))
''')
        ssh.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.root)+os.pathsep+os.environ['PATH'], MOCK_PLAN=str(self.plan), MOCK_SSH_LOG=str(self.log),
                        XDG_CACHE_HOME=str(self.root/'cache'), XDG_CONFIG_HOME=str(self.root/'config'), XDG_DATA_HOME=str(self.root/'data'))

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, args=(), answer=''):
        return subprocess.run([PWSH,'-NoProfile','-File',str(ROOT/'scripts/ops/deploy.ps1'),'-SshHost','ledger-test.invalid',*args],
                              input=answer,text=True,capture_output=True,env=self.env,timeout=30)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_plan_never_applies_and_uses_strict_host_keys(self):
        result = self.run_script(['-Plan'])
        self.assertEqual(result.returncode,0,result.stderr)
        calls = self.calls();self.assertEqual(len(calls),1)
        self.assertIn('StrictHostKeyChecking=yes',calls[0]);self.assertIn('BatchMode=yes',calls[0])
        self.assertIn('--plan --release latest',calls[0][-1]);self.assertNotIn('--apply',calls[0][-1])
        self.assertIn('GitHub commit:',result.stdout)

    def test_confirmation_pins_exact_release_and_current_state(self):
        result=self.run_script(answer='DEPLOY 123\n')
        self.assertEqual(result.returncode,0,result.stderr)
        calls=self.calls();self.assertEqual(len(calls),2)
        self.assertIn('--apply --release 123',calls[1][-1]);self.assertIn('--expected-digest sha256:'+'2'*64,calls[1][-1])
        self.assertIn('--expected-current sha256:'+'0'*64,calls[1][-1]);self.assertIn('Deployment result: success',result.stdout)
        self.assertIn('Deployment stage: backup',result.stdout)

    def test_cancel_and_noop_do_not_apply(self):
        self.assertEqual(self.run_script(answer='no\n').returncode,0)
        self.assertEqual(len(self.calls()),1)
        self.log.unlink()
        proposal=dict(PLAN,deploymentRequired=False);self.plan.write_text(json.dumps(proposal))
        self.assertEqual(self.run_script().returncode,0)
        self.assertEqual(len(self.calls()),1)

    def test_bad_metadata_and_remote_failure_fail_closed(self):
        proposal=dict(PLAN,release=dict(PLAN['release'],digest='latest'))
        self.plan.write_text(json.dumps(proposal))
        self.assertNotEqual(self.run_script(answer='DEPLOY 123\n').returncode,0)
        self.assertEqual(len(self.calls()),1)
        self.log.unlink();self.env['MOCK_SSH_FAILURE']='1'
        self.assertNotEqual(self.run_script().returncode,0)
        self.assertEqual(len(self.calls()),1)

    def test_identity_paths_with_spaces_remain_single_native_arguments(self):
        key=self.root/'operator key';key.write_text('test fixture only')
        result=self.run_script(['-Plan','-IdentityFile',str(key)])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn(str(key),self.calls()[0]);self.assertIn('IdentitiesOnly=yes',self.calls()[0])

    def test_explicit_release_and_injection_rejection(self):
        self.assertEqual(self.run_script(['-Plan','-Release','123']).returncode,0)
        self.assertIn('--release 123',self.calls()[0][-1]);self.log.unlink()
        self.assertNotEqual(self.run_script(['-Plan','-Release','latest; whoami']).returncode,0)
        self.assertEqual(self.calls(),[])


if __name__ == '__main__':
    unittest.main(verbosity=2)
