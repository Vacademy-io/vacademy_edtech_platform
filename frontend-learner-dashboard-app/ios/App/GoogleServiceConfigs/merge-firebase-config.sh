#!/usr/bin/env bash
# Merge a raw Firebase GoogleService-Info.plist into a brand's combined config.
#
# Each brand target uses ONE file as both its INFOPLIST_FILE and a bundled
# resource, so the Firebase keys and the Info.plist keys live together. Pasting
# the raw Firebase download over it would delete the Info.plist half. This
# script copies only the Firebase keys across and leaves everything else alone.
#
#   usage: ./GoogleServiceConfigs/merge-firebase-config.sh <Brand>
#   e.g.   ./GoogleServiceConfigs/merge-firebase-config.sh Agilore
#
# Reads  GoogleServiceConfigs/<Brand>/GoogleService-Info.firebase.plist
# Writes GoogleServiceConfigs/<Brand>/GoogleService-Info.plist
set -euo pipefail

brand="${1:?usage: merge-firebase-config.sh <Brand>}"
dir="$(cd "$(dirname "$0")" && pwd)/$brand"
src="$dir/GoogleService-Info.firebase.plist"
dst="$dir/GoogleService-Info.plist"

[ -f "$src" ] || { echo "error: no raw Firebase file at $src" >&2; exit 1; }
[ -f "$dst" ] || { echo "error: no combined config at $dst" >&2; exit 1; }

python3 - "$src" "$dst" <<'PY'
import plistlib, re, sys

src, dst = sys.argv[1], sys.argv[2]
with open(src, "rb") as fh:
    fb = plistlib.load(fh)

text = open(dst, encoding="utf-8").read()

# String-valued Firebase keys copied verbatim. Edited in place with a targeted
# substitution rather than a plistlib round-trip so the file's comments and
# key order survive.
KEYS = ["API_KEY", "GCM_SENDER_ID", "BUNDLE_ID", "PROJECT_ID",
        "STORAGE_BUCKET", "GOOGLE_APP_ID", "CLIENT_ID", "REVERSED_CLIENT_ID"]

changed, missing, added = [], [], []
for key in KEYS:
    if key not in fb:
        missing.append(key)
        continue
    val = str(fb[key])
    pat = re.compile(r"(<key>%s</key>\s*<string>)(.*?)(</string>)" % re.escape(key), re.S)
    m = pat.search(text)
    if m:
        if m.group(2) != val:
            text = text[:m.start()] + m.group(1) + val + m.group(3) + text[m.end():]
            changed.append(key)
    else:
        # Key absent from the template (CLIENT_ID etc) -- insert before the marker.
        marker = "\t<!-- App Info.plist keys -->"
        block = "\t<key>%s</key>\n\t<string>%s</string>\n" % (key, val)
        if marker in text:
            text = text.replace(marker, block + marker, 1)
            added.append(key)
        else:
            missing.append(key)

open(dst, "w", encoding="utf-8").write(text)

print("updated: " + (", ".join(changed) or "nothing (already current)"))
if added:
    print("added:   " + ", ".join(added))
if missing:
    print("not in the Firebase file (left as-is): " + ", ".join(missing))

left = re.findall(r"<key>(\w+)</key>\s*<string>(REPLACE_WITH_\w+)</string>", text)
if left:
    sys.exit("STILL PLACEHOLDER: %s -- the app will crash on launch"
             % ", ".join(k for k, _ in left))
PY

plutil -lint "$dst"
