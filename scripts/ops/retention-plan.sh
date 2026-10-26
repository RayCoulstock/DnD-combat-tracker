#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
load_backup
# Preview only. Never automatically delete backups or storage volumes.
restic forget --dry-run --host "$project" --tag "project:$project" --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 12
