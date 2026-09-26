"""Isolated alert-delivery checks; no systemd, Hermes, or network calls."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('kb-notify.sh')
HERMES_PY = '/home/ubuntu/.hermes/hermes-agent/venv/bin/python'


class KBNotifyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()

        def command(name, body):
            path = bin_dir / name
            path.write_text(body, encoding='utf-8')
            path.chmod(0o700)
            return path

        sender = command('sender', '''#!/usr/bin/env python3
import json, os, sys
channel = 'weixin' if '-m' in sys.argv else 'feishu'
with open(os.environ['MOCK_SEND_LOG'], 'a', encoding='utf-8') as out:
    out.write(json.dumps({'channel': channel, 'message': sys.stdin.read()}) + '\\n')
print('provider secret in stderr', file=sys.stderr)
sys.exit(int(os.environ['MOCK_WEIXIN_RC'] if channel == 'weixin' else os.environ['MOCK_FEISHU_RC']))
''')
        command('timeout', '''#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_TIMEOUT_LOG"
shift 2
exec "$@"
''')
        command('systemctl', '''#!/bin/sh
printf '%s\\n' "$MOCK_STATUS"
''')
        command('journalctl', '''#!/bin/sh
touch "$MOCK_JOURNAL_CALLED"
printf '%s\\n' 'journal secret that must not leave this machine'
''')
        command('systemd-cat', '''#!/bin/sh
cat > "$MOCK_FALLBACK_LOG"
''')
        text = SCRIPT.read_text(encoding='utf-8').replace(HERMES_PY, str(sender))
        self.script = self.root / 'kb-notify.sh'
        self.script.write_text(text, encoding='utf-8')
        self.env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                    'MOCK_SEND_LOG': str(self.root / 'sent.jsonl'),
                    'MOCK_TIMEOUT_LOG': str(self.root / 'timeouts.txt'),
                    'MOCK_JOURNAL_CALLED': str(self.root / 'journal-called'),
                    'MOCK_FALLBACK_LOG': str(self.root / 'fallback.txt'),
                    'MOCK_STATUS': 'failed', 'MOCK_WEIXIN_RC': '0', 'MOCK_FEISHU_RC': '0'}

    def tearDown(self):
        self.temp.cleanup()

    def run_alert(self, unit='caddy.service', **overrides):
        return subprocess.run(['bash', str(self.script), unit], env={**self.env, **overrides},
                              text=True, capture_output=True, timeout=10)

    def sent(self):
        path = self.root / 'sent.jsonl'
        return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()] if path.exists() else []

    def test_primary_message_contains_only_allowlisted_metadata(self):
        result = self.run_alert()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.sent()), 1)
        self.assertEqual(self.sent()[0]['channel'], 'weixin')
        message = self.sent()[0]['message']
        self.assertIn('unit=caddy.service status=failed', message)
        self.assertRegex(message, r'at=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ')
        self.assertIn('sudo journalctl -u caddy.service', message)
        self.assertNotIn('journal secret', message)
        self.assertFalse((self.root / 'journal-called').exists())
        self.assertNotIn('provider secret', result.stdout + result.stderr)
        self.assertEqual(len((self.root / 'timeouts.txt').read_text().splitlines()), 2)

    def test_weixin_failure_falls_back_to_feishu_without_error_text(self):
        result = self.run_alert(MOCK_WEIXIN_RC='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([item['channel'] for item in self.sent()], ['weixin', 'feishu'])
        self.assertNotIn('provider secret', result.stdout + result.stderr)

    def test_both_failures_leave_only_generic_local_trace(self):
        result = self.run_alert(MOCK_WEIXIN_RC='1', MOCK_FEISHU_RC='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('ALL channels failed', (self.root / 'fallback.txt').read_text())
        self.assertNotIn('provider secret', result.stdout + result.stderr)

    def test_unexpected_unit_does_not_send(self):
        result = self.run_alert('attacker.service')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.sent(), [])

    def test_untrusted_status_is_replaced(self):
        result = self.run_alert(MOCK_STATUS='failed\nprovider secret')
        self.assertEqual(result.returncode, 0)
        self.assertIn('status=unknown', self.sent()[0]['message'])
        self.assertNotIn('provider secret', self.sent()[0]['message'])


if __name__ == '__main__':
    unittest.main()
