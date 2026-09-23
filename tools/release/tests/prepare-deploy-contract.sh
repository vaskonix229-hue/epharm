#!/usr/bin/env bash
# Runs the real release scripts against an isolated Git checkout and fake Docker.
set -euo pipefail

source_root="$(cd "$(dirname "$0")/../../.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/epharm-release-contract.XXXXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT

mkdir -p "$test_root/tools/release" "$test_root/tools/ops" "$test_root/bin"
cp "$source_root/tools/release/"*.sh "$test_root/tools/release/"
cp "$source_root/tools/ops/lib.sh" "$test_root/tools/ops/lib.sh"
touch "$test_root/docker-compose.prod.yml"
printf '## [0.1.10] - 2026-09-23\n' > "$test_root/CHANGELOG.md"
printf 'MEDUSA_ENABLED=true\n' > "$test_root/.env.prod"
printf 'RELEASE_ID=v0.1.9\nRELEASE_COMMIT=previous-commit\n' > "$test_root/.release.env"

cat > "$test_root/tools/smoke-medusa.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'medusa\n' >> "$TEST_EVENTS"
STUB
cat > "$test_root/tools/backup-all.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
grep -Fxq 'RELEASE_ID=v0.1.9' "$TEST_WORKSPACE_ROOT/.release.env"
printf 'backup\n' >> "$TEST_EVENTS"
STUB
cat > "$test_root/tools/release/smoke.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
grep -Fxq "RELEASE_ID=$1" "$TEST_WORKSPACE_ROOT/.release.env"
printf 'smoke\n' >> "$TEST_EVENTS"
STUB
cat > "$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}:${2:-}" in
  image:inspect)
    if [[ " $* " == *' --format '* ]]; then
      printf 'sha256:fixture-image\n'
    fi
    ;;
  compose:*)
    action=''
    release_env=''
    previous=''
    for argument in "$@"; do
      if [[ "$previous" == env ]]; then
        release_env="$argument"
        previous=''
        continue
      fi
      case "$argument" in
        --env-file) previous=env ;;
        build|up) action="$argument" ;;
      esac
    done
    case "$action" in
      build)
        [[ "$release_env" != "$TEST_WORKSPACE_ROOT/.release.env" ]]
        grep -Fxq 'RELEASE_ID=v0.1.10' "$release_env"
        grep -Fxq 'RELEASE_ID=v0.1.9' "$TEST_WORKSPACE_ROOT/.release.env"
        printf 'build\n' >> "$TEST_EVENTS"
        [[ "${TEST_FAIL_BUILD:-false}" != true ]]
        ;;
      up)
        [[ "$release_env" == "$TEST_WORKSPACE_ROOT/.release.env" ]]
        grep -Fxq 'RELEASE_ID=v0.1.10' "$release_env"
        printf 'up\n' >> "$TEST_EVENTS"
        ;;
      *) echo "Unexpected Docker Compose action: $action" >&2; exit 1 ;;
    esac
    ;;
  *) echo "Unexpected Docker call: $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$test_root/tools/smoke-medusa.sh" "$test_root/tools/backup-all.sh" \
  "$test_root/tools/release/smoke.sh" "$test_root/bin/docker"

git -C "$test_root" init -q
git -C "$test_root" config user.name 'Release Contract Test'
git -C "$test_root" config user.email 'release-test@example.invalid'
git -C "$test_root" add CHANGELOG.md docker-compose.prod.yml tools
git -C "$test_root" commit -qm 'test: release fixture'
git -C "$test_root" tag v0.1.10

export TEST_WORKSPACE_ROOT="$test_root"
export TEST_EVENTS="$test_root/events"
export PATH="$test_root/bin:$PATH"

if TEST_FAIL_BUILD=true "$test_root/tools/release/prepare.sh" v0.1.10 \
  > "$test_root/failed-build.log" 2>&1; then
  echo 'Prepare accepted a failed image build' >&2
  exit 1
fi
grep -Fxq 'RELEASE_ID=v0.1.9' "$test_root/.release.env"
[[ ! -e "$test_root/releases/v0.1.10/manifest.json" ]]
if compgen -G "$test_root/.release.prepare.*" >/dev/null; then
  echo 'Candidate release env was not removed after failed prepare' >&2
  exit 1
fi

"$test_root/tools/release/prepare.sh" v0.1.10
grep -Fxq 'RELEASE_ID=v0.1.9' "$test_root/.release.env"
if compgen -G "$test_root/.release.prepare.*" >/dev/null; then
  echo 'Candidate release env was not removed after prepare' >&2
  exit 1
fi
grep -Fq '"releaseId": "v0.1.10"' "$test_root/releases/v0.1.10/manifest.json"

"$test_root/tools/release/deploy.sh" v0.1.10
grep -Fxq 'RELEASE_ID=v0.1.10' "$test_root/.release.env"
grep -Fxq 'v0.1.9' "$test_root/releases/v0.1.10/previous-release"

if "$test_root/tools/release/deploy.sh" v0.1.10 > "$test_root/repeated-deploy.log" 2>&1; then
  echo 'Deploy accepted an already-active release' >&2
  exit 1
fi
grep -Fq 'v0.1.10 is already active' "$test_root/repeated-deploy.log"
[[ "$(grep -c '^backup$' "$TEST_EVENTS")" -eq 1 ]]
[[ "$(grep -c '^up$' "$TEST_EVENTS")" -eq 1 ]]
[[ "$(grep -c '^smoke$' "$TEST_EVENTS")" -eq 1 ]]

echo 'Release prepare/deploy contract OK'
