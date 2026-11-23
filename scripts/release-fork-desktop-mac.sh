#!/bin/zsh
set -euo pipefail

usage() {
  echo "usage: scripts/release-fork-desktop-mac.sh [--publish] [--version <version>] [--output-dir <dir>]" >&2
  exit 2
}

publish=false
version=""
output_dir=""
while (( $# > 0 )); do
  case "$1" in
    --publish) publish=true ;;
    --version) version="${2:?}"; shift ;;
    --output-dir) output_dir="${2:?}"; shift ;;
    *) usage ;;
  esac
  shift
done

repo_root="${0:A:h:h}"
cd "$repo_root"

for name in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_TEAM_ID CSC_NAME; do
  [[ -n "${(P)name:-}" ]] || { echo "$name must be set" >&2; exit 1; }
done
[[ -f "$APPLE_API_KEY" ]] || { echo "APPLE_API_KEY must be the path to the .p8 file" >&2; exit 1; }

export T3CODE_DESKTOP_SIGNED=true
export T3CODE_DESKTOP_APP_ID="${T3CODE_DESKTOP_APP_ID:-com.b4sed.code}"
export T3CODE_APP_NAME="${T3CODE_APP_NAME:-B4SED Code}"
export T3CODE_DESKTOP_DATA_NAME="${T3CODE_DESKTOP_DATA_NAME:-b4sed}"
export T3CODE_DESKTOP_ICON="${T3CODE_DESKTOP_ICON:-assets/fork/b4sed-macos-1024.png}"
export T3CODE_DESKTOP_DEFAULT_THEME="${T3CODE_DESKTOP_DEFAULT_THEME:-themes/claude-desktop/t3-code-claude-desktop.json}"
export T3CODE_CONNECT_NAME="${T3CODE_CONNECT_NAME:-B4SED Connect}"
export T3CODE_CLI_NAME="${T3CODE_CLI_NAME:-b4}"
export T3CODE_DESKTOP_UPDATE_REPOSITORY="${T3CODE_DESKTOP_UPDATE_REPOSITORY:-andrew-housebets/b4sed-code-releases}"
unset GITHUB_REPOSITORY

base_version="$(node -p 'require("./apps/desktop/package.json").version')"
version="${version:-${base_version}-b4sed.$(date -u +%Y%m%d%H%M)}"
output_dir="${output_dir:-release/$version}"
artifact_base="${T3CODE_APP_NAME// /-}-${version}-arm64"
dmg="$output_dir/$artifact_base.dmg"
zip="$output_dir/$artifact_base.zip"
manifest="$output_dir/latest-mac.yml"

echo "Building $T3CODE_APP_NAME $version into $output_dir"
T3CODE_DESKTOP_VERSION="$version" node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch arm64 --output-dir "$output_dir"

notary_credentials=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
codesign --sign "Developer ID Application: $CSC_NAME" --timestamp "$dmg"
xcrun notarytool submit "$dmg" "${notary_credentials[@]}" --wait --timeout 60m
xcrun stapler staple "$dmg"

builder_lib="$(node -p 'require("node:path").dirname(require.resolve("app-builder-lib/package.json", { paths: [require.resolve("electron-builder/package.json", { paths: ["apps/desktop"] })] }))')"
node - "$builder_lib" "$dmg" "$manifest" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const [builderLib, dmg, manifest] = process.argv.slice(2);
const { buildBlockMap } = require(path.join(builderLib, "out/targets/blockmap/blockmap"));
buildBlockMap(dmg, "gzip", `${dmg}.blockmap`).then(({ size, sha512 }) => {
  const name = path.basename(dmg);
  const lines = fs.readFileSync(manifest, "utf8").split("\n");
  const entry = lines.findIndex((line) => line.trim() === `- url: ${name}`);
  if (entry < 0 || !lines[entry + 1].trim().startsWith("sha512:") || !lines[entry + 2].trim().startsWith("size:")) {
    throw new Error(`${manifest} has no entry for ${name}`);
  }
  lines[entry + 1] = lines[entry + 1].replace(/sha512: .*/, `sha512: ${sha512}`);
  lines[entry + 2] = lines[entry + 2].replace(/size: .*/, `size: ${size}`);
  fs.writeFileSync(manifest, lines.join("\n"));
});
EOF

check_dir="$(mktemp -d)"
trap 'rm -rf "$check_dir"' EXIT
ditto -x -k "$zip" "$check_dir/zip"
app="$check_dir/zip/$T3CODE_APP_NAME.app"
codesign --verify --deep --strict "$app"
spctl -a -vv "$app"
xcrun stapler validate "$app"
spctl -a -vv -t open --context context:primary-signature "$dmg"
xcrun stapler validate "$dmg"
expected_sha="$(shasum -a 512 "$zip" | cut -d' ' -f1 | xxd -r -p | base64)"
grep -q "^sha512: $expected_sha$" "$manifest" || { echo "latest-mac.yml does not match $zip" >&2; exit 1; }

asar_package="$(node -p 'require("node:path").dirname(require.resolve("@electron/asar/package.json", { paths: [process.argv[1]] }))' "$builder_lib")"
node -e 'require(process.argv[1]).extractAll(process.argv[2], process.argv[3])' \
  "$asar_package" "$app/Contents/Resources/app.asar" "$check_dir/asar"
private_patterns=("$HOME" "$USER")
git_email="$(git config user.email || true)"
[[ -n "$git_email" ]] && private_patterns+=("$git_email")
leaks=0
for pattern in "${private_patterns[@]}"; do
  if grep -rIlaF -- "$pattern" "$app" "$check_dir/asar" >/dev/null 2>&1; then
    echo "A build path, user name or email address is inside the app bundle; not publishing." >&2
    leaks=1
  fi
done
if grep -rIlaE -- 'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-ant-[A-Za-z0-9_-]{20,}|sk_(live|test)_[A-Za-z0-9]{20,}' \
  "$app" "$check_dir/asar" >/dev/null 2>&1; then
  echo "A token or private key is inside the app bundle; not publishing." >&2
  leaks=1
fi
(( leaks == 0 )) || exit 1
echo "Verified $version: signed, notarized, stapled, manifest matches, no private data found."

if [[ "$publish" == true ]]; then
  gh release create "v$version" \
    --repo "$T3CODE_DESKTOP_UPDATE_REPOSITORY" \
    --title "$T3CODE_APP_NAME $version" \
    --notes "$T3CODE_APP_NAME $version for macOS (Apple Silicon)." \
    "$manifest" "$zip" "$zip.blockmap" "$dmg" "$dmg.blockmap"
else
  echo "Not published. Re-run with --publish, or upload $output_dir with gh release create."
fi
