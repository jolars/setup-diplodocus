#!/usr/bin/env sh
set -eu

case "${RUNNER_OS}-${RUNNER_ARCH}" in
Linux-X64) target="x86_64-unknown-linux-gnu" ;;
Linux-ARM64) target="aarch64-unknown-linux-gnu" ;;
macOS-X64) target="x86_64-apple-darwin" ;;
macOS-ARM64) target="aarch64-apple-darwin" ;;
Windows-ARM64) target="aarch64-pc-windows-msvc" ;;
Windows-X64) target="x86_64-pc-windows-msvc" ;;
*)
	echo "Unsupported Diplodocus platform: ${RUNNER_OS}-${RUNNER_ARCH}" >&2
	exit 1
	;;
esac

case "$RUNNER_OS" in
Windows) asset="diplodocus-${target}.zip" ;;
*) asset="diplodocus-${target}.tar.xz" ;;
esac

version="${DIPLODOCUS_VERSION:-latest}"
if [ "$version" = latest ]; then
	# A release can exist before its platform archives have finished uploading.
	export DIPLODOCUS_ASSET="$asset"
	version="$(gh api 'repos/jolars/diplodocus/releases?per_page=100' --jq '
    [.[]
      | select((.draft or .prerelease) | not)
      | select(any(.assets[]; .name == env.DIPLODOCUS_ASSET))
      | select(any(.assets[]; .name == (env.DIPLODOCUS_ASSET + ".sha256")))
    ][0].tag_name // empty')"
	if [ -z "$version" ]; then
		echo "No stable Diplodocus release contains ${asset} and its checksum" >&2
		exit 1
	fi
fi

case "$version" in
"" | *[!0-9A-Za-z.+-]*)
	echo "Invalid Diplodocus version: ${version}" >&2
	exit 1
	;;
esac
if ! printf '%s\n' "$version" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'; then
	echo "Expected latest or an exact Diplodocus version, got: ${version}" >&2
	exit 1
fi
case "$version" in
v*) ;;
*) version="v${version}" ;;
esac

printf 'Resolved Diplodocus %s for %s\n' "$version" "$target"
{
	printf 'version=%s\n' "$version"
	printf 'target=%s\n' "$target"
	printf 'asset=%s\n' "$asset"
	printf 'install-dir=%s/setup-diplodocus/%s/%s\n' "$RUNNER_TEMP" "$version" "$target"
} >>"$GITHUB_OUTPUT"
