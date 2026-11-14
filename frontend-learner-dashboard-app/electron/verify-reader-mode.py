#!/usr/bin/env python3
"""
Verify that a built web bundle has App Store reader mode compiled ON.

Guideline 3.1.1 applies to the Mac App Store, so the bundle inside the .pkg must
hide every commerce surface. The switch is a Vite `define` (__MAC_APP_STORE__)
that fails SILENTLY: forget VITE_MAC_APP_STORE=true and you get a bundle that
looks fine, builds fine, and ships payments to review. So never trust the build
command — read the compiled JS back.

What it checks, in the minified output:

    beforeLoad:async()=>{if(<gate>())throw ...     <- the reader-blocked routes
    <gate> = ()=>A()||B()                          <- shouldHidePaidPurchaseUI
    B = ()=>!0                                     <- isMacAppStoreBuild, folded

Reader ON means one arm of the gate folded to a constant true, because
`__MAC_APP_STORE__ || isMacAppStoreShell()` collapses to `!0` when the define is
true. Reader OFF leaves both arms as real runtime tests (a platform check and a
window lookup), which is correct for the DMG but must never reach the store.

Usage: verify-reader-mode.py <dist-dir>   (exit 0 = ON, 1 = OFF / undetermined)
"""
from __future__ import annotations

import glob
import os
import re
import sys

# `()=>!0`, `()=>!0||x()`, `()=>x()||!0` — any arm folding to a literal true.
TRUE_ARM = re.compile(r'(^|\|\|)\s*(!0|true)\s*($|\|\|)')


def resolve(src: str, name: str) -> str | None:
    """Find the arrow-function body assigned to `name` in the minified bundle."""
    m = re.search(re.escape(name) + r'\s*=\s*\(\)\s*=>\s*([^,;}]{0,160})', src)
    return m.group(1).strip() if m else None


def main() -> int:
    dist = sys.argv[1] if len(sys.argv) > 1 else 'dist'
    files = glob.glob(os.path.join(dist, 'assets', '*.js'))
    if not files:
        print(f'   no JS found under {dist}/assets — nothing to verify')
        return 1

    checked = 0
    for path in files:
        with open(path, encoding='utf-8', errors='replace') as fh:
            src = fh.read()

        for m in re.finditer(r'beforeLoad:async\(\)=>\{if\((\w+)\(\)\)throw', src):
            gate = m.group(1)
            body = resolve(src, gate)
            if body is None:
                continue
            checked += 1
            print(f'   gate {gate} = {body}')

            if TRUE_ARM.search(body):
                print('   reader mode is ON (gate folded to a constant true)')
                return 0

            # Not folded here — follow each called identifier one hop.
            for callee in re.findall(r'(\w+)\(\)', body):
                inner = resolve(src, callee)
                if inner is None:
                    continue
                print(f'      {callee} = {inner}')
                if TRUE_ARM.search(inner):
                    print('   reader mode is ON (gate folded to a constant true)')
                    return 0

    if not checked:
        print('   could not locate the reader gate — inspect the bundle by hand')
        return 1

    print('   reader mode is OFF — VITE_MAC_APP_STORE did not take effect.')
    print('   This bundle still exposes commerce and will fail Guideline 3.1.1.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
