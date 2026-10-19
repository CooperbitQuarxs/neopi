#!/usr/bin/env bash
# Sourced by install.sh; executable commands manage the same destination lock.

npi_install_dest() {
	local requested=${NPI_DEST:-$HOME/.local/bin/npi}
	# Resolve directory aliases, but preserve the installer's replace-symlink behavior.
	printf '%s/%s\n' "$(realpath -m -- "$(dirname -- "$requested")")" "$(basename -- "$requested")"
}

npi_install_lock_open() {
	local hash
	hash=$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)
	NPI_INSTALL_LOCK_PATH="${XDG_RUNTIME_DIR:-/tmp}/npi-install-$hash.lock"
	(umask 077; set -o noclobber; : > "$NPI_INSTALL_LOCK_PATH") 2>/dev/null || true
	[[ -f $NPI_INSTALL_LOCK_PATH && ! -L $NPI_INSTALL_LOCK_PATH && -O $NPI_INSTALL_LOCK_PATH ]] || {
		printf 'install lock: unsafe lock file %s\n' "$NPI_INSTALL_LOCK_PATH" >&2
		return 1
	}
	exec {NPI_INSTALL_LOCK_FD}<> "$NPI_INSTALL_LOCK_PATH"
	# Keep this descriptor open through installation so a proof cannot start mid-copy.
	flock -n "$NPI_INSTALL_LOCK_FD" || {
		printf 'install lock: destination busy: %s\n' "$1" >&2
		return 1
	}
	NPI_INSTALL_LOCK_RECORD=()
	mapfile -t NPI_INSTALL_LOCK_RECORD < "$NPI_INSTALL_LOCK_PATH"
	NPI_INSTALL_LOCK_EXPIRY=${NPI_INSTALL_LOCK_RECORD[0]:-0}
	# Explicit release must recover interrupted or otherwise malformed records.
	[[ ${2:-} != release ]] || return 0
	[[ $NPI_INSTALL_LOCK_EXPIRY =~ ^[0-9]{1,12}$ ]] || {
		printf 'install lock: invalid expiry in %s; release it explicitly\n' "$NPI_INSTALL_LOCK_PATH" >&2
		return 1
	}
}

npi_install_lock_describe() {
	printf 'holder=%s; reason=%s; expiry=%s (%s)' \
		"${NPI_INSTALL_LOCK_RECORD[1]:-unknown}" "${NPI_INSTALL_LOCK_RECORD[2]:-unspecified}" \
		"$NPI_INSTALL_LOCK_EXPIRY" "$(date -u -d "@$NPI_INSTALL_LOCK_EXPIRY" '+%Y-%m-%dT%H:%M:%SZ')"
}

npi_install_lock_check() {
	npi_install_lock_open "$1" || return 1
	if ((10#$NPI_INSTALL_LOCK_EXPIRY > $(date +%s))); then
		if [[ ${NPI_INSTALL_FORCE:-0} == 1 ]]; then
			printf 'install.sh: NPI_INSTALL_FORCE=1 overrides proof lock: %s\n' "$(npi_install_lock_describe)" >&2
		else
			printf 'install.sh: refused by proof lock: %s; release it or set NPI_INSTALL_FORCE=1\n' "$(npi_install_lock_describe)" >&2
			return 1
		fi
	elif ((10#$NPI_INSTALL_LOCK_EXPIRY > 0)); then
		printf 'install.sh: ignoring expired proof lock: %s\n' "$(npi_install_lock_describe)" >&2
	fi
}

npi_install_lock_main() {
	local command=${1:-status} dest minutes holder reason
	dest=$(npi_install_dest)
	case "$command" in
		hold)
			[[ $# -ge 3 && $# -le 4 && $2 =~ ^[0-9]{1,2}$ ]] || {
				printf 'Usage: scripts/install-lock.sh hold <1-60 minutes> <holder> [reason]\n' >&2
				return 1
			}
			minutes=$((10#$2)); holder=$3; reason=${4:-unspecified}
			[[ $minutes -ge 1 && $minutes -le 60 && -n $holder && $holder != *$'\n'* && $reason != *$'\n'* ]] || {
				printf 'install lock: use 1-60 minutes and single-line holder/reason\n' >&2
				return 1
			}
			npi_install_lock_open "$dest" || return 1
			if ((10#$NPI_INSTALL_LOCK_EXPIRY > $(date +%s))) && [[ ${NPI_INSTALL_LOCK_RECORD[1]:-} != "$holder" ]]; then
				printf 'install lock: already held: %s\n' "$(npi_install_lock_describe)" >&2
				return 1
			fi
			NPI_INSTALL_LOCK_EXPIRY=$(($(date +%s) + minutes * 60))
			NPI_INSTALL_LOCK_RECORD=("$NPI_INSTALL_LOCK_EXPIRY" "$holder" "$reason")
			printf '%s\n' "${NPI_INSTALL_LOCK_RECORD[@]}" > "$NPI_INSTALL_LOCK_PATH"
			printf 'install lock: held for %s: %s\n' "$dest" "$(npi_install_lock_describe)"
			;;
		release|status)
			[[ $# -le 1 ]] || return 1
			npi_install_lock_open "$dest" "$command" || return 1
			if [[ $command == release ]]; then
				# Retain the inode: unlinking it would race other open flock descriptors.
				: > "$NPI_INSTALL_LOCK_PATH"
				printf 'install lock: released for %s\n' "$dest"
			elif ((10#$NPI_INSTALL_LOCK_EXPIRY > $(date +%s))); then
				printf 'install lock: active for %s: %s\n' "$dest" "$(npi_install_lock_describe)"
			elif ((10#$NPI_INSTALL_LOCK_EXPIRY > 0)); then
				printf 'install lock: expired (ignored) for %s: %s\n' "$dest" "$(npi_install_lock_describe)"
			else
				printf 'install lock: clear for %s\n' "$dest"
			fi
			;;
		*) printf 'Usage: scripts/install-lock.sh {hold <minutes> <holder> [reason]|release|status}\n' >&2; return 1 ;;
	esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
	set -euo pipefail
	cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."
	npi_install_lock_main "$@"
fi
