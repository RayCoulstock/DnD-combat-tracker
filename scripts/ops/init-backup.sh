#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} == --approve-repository-init && $# == 1 ]] || { echo 'Repository initialisation is not approved. No changes made.' >&2; exit 2; }
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
lock_operations
load_backup --initialising
# Operator explicitly approves this write. Restic refuses an existing repository.
# The private bucket/credential policy must have been reviewed separately.
restic init
