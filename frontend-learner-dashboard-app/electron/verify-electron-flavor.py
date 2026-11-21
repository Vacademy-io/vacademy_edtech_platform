#!/usr/bin/env python3
"""
Verify that a built web bundle carries the Electron flavor's appId.

Desktop white-labelling hangs on one string. @capacitor/app has no Electron
implementation — getInfo() throws — so the renderer's ONLY source for "which
flavor am I" is the Vite define __ELECTRON_APP_ID__. Miss it and the lookup
falls through to "io.vacademy.student.app": the app resolves SSDC Horizon's
domain and comes up wearing SSDC's name, logo and course catalogue, while still
building, signing and installing perfectly.

Reading the env var back from the shell proves nothing — the whole failure mode
is that the value never reaches the compiled JS. So read the compiled JS.

The signal, taken from real bundles rather than guessed:

  flavor.config.ts lists every appId, so the expected id is ALWAYS present once
  as a map key — a bare substring match passes even on a build that never got
  the id. A build that DID get it folds the constant into the use site as well:

      catch{const i="com.zoeedtech.app";s=i,a=DF[i]||null}     <- id landed
      catch{const i=X.VITE_ELECTRON_APP_ID||"io.vacademy.student.app";...}
                                                              <- id missing

  so the id appears at least twice. (Do not flag the name VITE_ELECTRON_APP_ID
  appearing in the output: Vite inlines VITE_-prefixed process.env vars into the
  import.meta.env object literal, so when the build IS correct the name shows up
  there carrying the right value.)

Usage: verify-electron-flavor.py <dist-dir> <expected-app-id>
       exit 0 = compiled in, 1 = missing / wrong
"""
from __future__ import annotations

import glob
import os
import sys

GREEN, RED, YELLOW, NC = '\033[0;32m', '\033[0;31m', '\033[1;33m', '\033[0m'
DEFAULT_APP_ID = 'io.vacademy.student.app'


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: verify-electron-flavor.py <dist-dir> <expected-app-id>', file=sys.stderr)
        return 2

    dist, expected = sys.argv[1], sys.argv[2]
    if not os.path.isdir(dist):
        print(f'{RED}   ✖ no dist directory at {dist}{NC}', file=sys.stderr)
        return 2

    files = glob.glob(os.path.join(dist, 'assets', '*.js'))
    if not files:
        print(f'{RED}   ✖ no JS bundles under {dist}/assets{NC}', file=sys.stderr)
        return 2

    hits = 0
    for path in files:
        with open(path, 'r', encoding='utf-8', errors='ignore') as handle:
            src = handle.read()
        hits += src.count(f'"{expected}"') + src.count(f"'{expected}'")

    # 1 = the flavor.config.ts map key alone, i.e. the define never landed.
    if hits < 2:
        print(f'{RED}   ✖ "{expected}" appears {hits}x — only as a flavor.config map key.{NC}', file=sys.stderr)
        print(f'{YELLOW}     The define did not land; this build would resolve "{DEFAULT_APP_ID}"{NC}', file=sys.stderr)
        print(f'{YELLOW}     and show SSDC Horizon. Build with VITE_ELECTRON_APP_ID={expected}.{NC}', file=sys.stderr)
        return 1

    print(f'{GREEN}   ✅ appId "{expected}" compiled into the bundle ({hits} occurrences){NC}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
