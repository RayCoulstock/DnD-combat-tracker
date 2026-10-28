#!/usr/bin/env bash
# Manual existing-production upgrades only. No changes without --apply + a pinned plan.
set -euo pipefail
umask 077
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
exec python3 "$root/scripts/ops/deploy_release.py" "$@"
