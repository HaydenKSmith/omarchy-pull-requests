#!/usr/bin/env bash
#
# Runs qmllint over the plugin's QML.
#
# Quickshell exposes the Omarchy shell's own modules under the `qs` namespace
# (qs.Ui, qs.Commons) by mapping its config root onto that prefix at runtime.
# There is no `qs` directory on disk, so qmllint cannot resolve those imports
# on its own. We synthesize one in a temp dir — a single symlink named `qs`
# pointing at the shell root — and hand qmllint that directory as an import
# path.
#
# Exits 0 with a skip message when qmllint or the Omarchy shell is unavailable,
# so CI runners without Qt do not fail the build.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

shell_root="${OMARCHY_PATH:-/usr/share/omarchy}/shell"

qmllint=""
for candidate in qmllint qmllint-qt6 /usr/lib/qt6/bin/qmllint /usr/lib/qt6/bin/qmllint-qt6; do
  if command -v "$candidate" >/dev/null 2>&1; then
    qmllint="$(command -v "$candidate")"
    break
  fi
done

if [[ -z $qmllint ]]; then
  echo "lint:qml: skipped — qmllint not found (install qt6-declarative)"
  exit 0
fi

if [[ ! -d $shell_root/Ui ]]; then
  echo "lint:qml: skipped — Omarchy shell not found at $shell_root"
  exit 0
fi

import_root="$(mktemp -d)"
trap 'rm -rf "$import_root"' EXIT
ln -s "$shell_root" "$import_root/qs"

echo "lint:qml: $qmllint (shell root: $shell_root)"
"$qmllint" -I "$import_root" Panel.qml Service.qml
echo "lint:qml: OK"
