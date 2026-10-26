#!/usr/bin/env bash
# Pinned, checksum-verified validation tools. No curl | sh, apt upgrade or host daemon changes.
set -euo pipefail
[[ $(uname -sm) == 'Linux x86_64' ]] || { echo 'CI tool bootstrap requires Linux x86_64.' >&2; exit 1; }
base=${LEDGER_CI_TOOLS_DIR:-${RUNNER_TEMP:-/tmp}/ledger-ci-tools}
mkdir -p "$base/bin"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
fetch() {
  curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$1" -o "$work/$2"
  printf '%s  %s\n' "$3" "$work/$2" | sha256sum --check --status
}
fetch https://github.com/restic/restic/releases/download/v0.18.0/restic_0.18.0_linux_amd64.bz2 restic.bz2 98f6dd8bf5b59058d04bfd8dab58e196cc2a680666ccee90275a3b722374438e
bzip2 -dc "$work/restic.bz2" > "$base/bin/restic"
fetch https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz actionlint.tgz 023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757
tar -xzf "$work/actionlint.tgz" -C "$base/bin" actionlint
fetch https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck-v0.10.0.linux.x86_64.tar.xz shellcheck.txz 6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87
tar -xJf "$work/shellcheck.txz" -C "$work"
cp "$work/shellcheck-v0.10.0/shellcheck" "$base/bin/"
fetch https://github.com/anchore/syft/releases/download/v1.23.1/syft_1.23.1_linux_amd64.tar.gz syft.tgz 42f3e01b64f054d0caee42073cb94e3ac3e61be6f0100e7ecda96e6a2abf7e22
tar -xzf "$work/syft.tgz" -C "$base/bin" syft
fetch https://github.com/cli/cli/releases/download/v2.74.2/gh_2.74.2_linux_amd64.tar.gz gh.tgz c421091ae5800390e6aef1f50bfda59cc1d4f2ef2200bcd4e1a662c05c28c444
tar -xzf "$work/gh.tgz" -C "$work"
cp "$work/gh_2.74.2_linux_amd64/bin/gh" "$base/bin/"
# Compose is a client plugin; the workflow separately installs a pinned Docker Engine.
fetch https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-linux-x86_64 compose dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372
mkdir -p "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
cp "$work/compose" "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins/docker-compose"
chmod 755 "$base/bin/"* "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins/docker-compose"
if [[ -n ${GITHUB_PATH:-} ]]; then printf '%s\n' "$base/bin" >> "$GITHUB_PATH"; fi
printf 'Verified CI tools installed in %s\n' "$base/bin"
