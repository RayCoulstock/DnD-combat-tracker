#!/usr/bin/env python3
"""Root-installed forced-command wrapper; environment and target are bound to each key."""
import os
import re
import sys


def parse_command(command, environment, target):
    pattern = r'/usr/local/sbin/ledger-release (staging|production) ([A-Za-z0-9_-]{16,80}) (sha256:[a-f0-9]{64}) ([a-f0-9]{40}) ([1-9][0-9]{0,19})'
    match = re.fullmatch(pattern, command)
    if not match or match[1] != environment or match[2] != target:
        raise ValueError('SSH release command refused.')
    return ['/usr/local/sbin/ledger-release', *match.groups()]


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError()
        args = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''), sys.argv[1], sys.argv[2])
        os.execv(args[0], args)
    except Exception:
        print('SSH command refused; only this key\'s exact approved release command is permitted.', file=sys.stderr)
        sys.exit(1)
