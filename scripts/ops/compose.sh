#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
# Low-level wrapper; operational commands can mutate services. Read the runbook first.
dc "$@"
