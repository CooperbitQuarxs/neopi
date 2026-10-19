#!/usr/bin/env bash
# Exercise the real installer only up to its version query: never copy a binary.
set -euo pipefail
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.."
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/runtime" "$work/tools" "$work/target"
export XDG_RUNTIME_DIR="$work/runtime"
export NPI_DEST="$work/target/bin/npi" PI_CODING_AGENT_DIR="$work/agent"
unset NPI_INSTALL_FORCE
cat > "$work/tools/bun" <<'STUB'
#!/usr/bin/env bash
printf 'install-lock-test: reached version query before copy\n' >&2
exit 73
STUB
chmod +x "$work/tools/bun"
export PATH="$work/tools:$PATH"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
contains() { [[ $output == *"$1"* ]] || fail "missing '$1': $output"; }
run_install() {
	local expected=$1 rc=0
	shift
	output=$(env "$@" bash ./install.sh 2>&1) || rc=$?
	[[ $rc == "$expected" ]] || fail "expected installer exit $expected, got $rc: $output"
	[[ ! -d $work/target/bin ]] || fail 'installer staged files instead of stopping before copy'
}

scripts/install-lock.sh hold 5 proof-session 'worker smoke proof'
run_install 1
contains 'refused by proof lock'
contains 'holder=proof-session; reason=worker smoke proof; expiry='
[[ $output != *'reached version query'* ]] || fail 'active hold passed the guard'
printf 'PASS: hold -> install refused with holder/reason/expiry\n'

output=$(scripts/install-lock.sh status)
contains 'active'
scripts/install-lock.sh hold 10 proof-session 'explicit renewal'
if scripts/install-lock.sh hold 5 other-session >/dev/null 2>&1; then fail 'another holder replaced an active proof'; fi
for minutes in 0 61 -1 100 abc; do
	if scripts/install-lock.sh hold "$minutes" proof-session >/dev/null 2>&1; then fail "accepted invalid duration $minutes"; fi
done
printf 'PASS: status, explicit renewal, holder exclusion, 1-60 minute bound\n'

run_install 73 NPI_INSTALL_FORCE=1
contains 'NPI_INSTALL_FORCE=1 overrides proof lock'
contains 'reached version query before copy'
printf 'PASS: force -> allowed through guard, stopped before copy\n'

locks=("$XDG_RUNTIME_DIR"/npi-install-*.lock)
[[ ${#locks[@]} == 1 ]] || fail 'unexpected destination lock count'
printf '1\nproof-session\nexpired proof\n' > "${locks[0]}"
output=$(scripts/install-lock.sh status)
contains 'expired (ignored)'
run_install 73
contains 'ignoring expired proof lock'
contains 'reached version query before copy'
printf 'PASS: expire -> allowed through guard, stopped before copy\n'

scripts/install-lock.sh hold 1 proof-session 'release check'
scripts/install-lock.sh release
run_install 73
contains 'reached version query before copy'
printf 'PASS: release -> allowed through guard\n'

scripts/install-lock.sh hold 1 proof-session 'alias check'
ln -s "$work/target" "$work/alias"
run_install 1 NPI_DEST="$work/alias/bin/npi"
contains 'refused by proof lock'
run_install 73 NPI_DEST="$work/other/bin/npi"
contains 'reached version query before copy'
printf 'PASS: directory aliases share a lock; destinations remain independent\n'

scripts/install-lock.sh release
(
	source scripts/install-lock.sh
	npi_install_lock_check "$(npi_install_dest)"
	if output=$(scripts/install-lock.sh hold 1 competing-session 2>&1); then fail 'proof started during an installer operation'; fi
	contains 'destination busy'
)
printf 'PASS: in-flight installer excludes a new proof hold\n'
