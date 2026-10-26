#!/usr/bin/env bash
# Runner side only. Secrets are environment-scoped, never arguments or artifacts.
set -euo pipefail
umask 077
: "${SSH_HOST:?}" "${SSH_USER:?}" "${SSH_PORT:?}" "${SSH_PRIVATE_KEY:?}" "${SSH_KNOWN_HOSTS:?}" "${TARGET_ID:?}" "${RELEASE_DIGEST:?}" "${RELEASE_COMMIT:?}" "${RELEASE_RUN_ID:?}" "${DEPLOY_ENVIRONMENT:?}"
[[ $DEPLOY_ENVIRONMENT == staging || $DEPLOY_ENVIRONMENT == production ]]
[[ $SSH_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ && $SSH_USER =~ ^[a-z_][a-z0-9_-]*$ && $SSH_PORT =~ ^[0-9]{1,5}$ ]]
(( 10#$SSH_PORT >= 1 && 10#$SSH_PORT <= 65535 ))
[[ $TARGET_ID =~ ^[a-zA-Z0-9_-]{16,80}$ && $RELEASE_DIGEST =~ ^sha256:[a-f0-9]{64}$ && $RELEASE_COMMIT =~ ^[a-f0-9]{40}$ && $RELEASE_RUN_ID =~ ^[0-9]+$ ]]
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$work/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$work/known_hosts"
# No accept-new, ssh-keyscan, agent forwarding, password login or broad remote shell upload.
ssh -F /dev/null -p "$SSH_PORT" -i "$work/key" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  "$SSH_USER@$SSH_HOST" "/usr/local/sbin/ledger-release $DEPLOY_ENVIRONMENT $TARGET_ID $RELEASE_DIGEST $RELEASE_COMMIT $RELEASE_RUN_ID"
