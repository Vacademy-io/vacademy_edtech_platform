"""Check every tour step against the live app: does each screen open and is
each ringed element still there? Run after a release, or nightly; a MISS means
the product changed and that tour step needs updating.

    python3 tools/check.py [--stage URL] [--product vacademy]

Exit code 1 when any step is missed.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


async def run(args, catalog):
    misses = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1500, "height": 860})
        sep = "&" if "?" in args.stage else "?"
        await page.goto(f"{args.stage}{sep}film=1")
        await page.wait_for_function(
            "document.getElementById('veil').classList.contains('off')", timeout=240000
        )
        await page.wait_for_timeout(5000)
        send = "c => window.demoStage.app.send(c, 30000)"
        for tour in catalog["tours"]:
            for i, step in enumerate(tour["steps"]):
                results = []
                if "go" in step:
                    results.append(await page.evaluate(send, {"type": "go", "to": step["go"]}))
                for kind in ("point", "spot"):
                    if kind in step:
                        cmd = {"type": kind, "target": step[kind], "timeout": 15000}
                        if kind == "point" and step.get("click"):
                            cmd["click"] = True  # the next element may only exist after it
                        results.append(await page.evaluate(send, cmd))
                ok = all(r.get("ok") for r in results)
                misses += 0 if ok else 1
                target = json.dumps(step.get("spot") or step.get("point") or step.get("go"))[:90]
                print("ok  " if ok else "MISS", tour["id"], i, target, "" if ok else results)
        await browser.close()
    return misses


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", default="http://localhost:5280/?app=http://localhost:5273")
    ap.add_argument("--product", default="vacademy")
    args = ap.parse_args()
    path = Path(__file__).resolve().parent.parent / "tours" / f"{args.product}.json"
    catalog = json.loads(path.read_text())
    misses = asyncio.run(run(args, catalog))
    total = sum(len(t["steps"]) for t in catalog["tours"])
    print(f"{total - misses} of {total} steps found")
    sys.exit(1 if misses else 0)


if __name__ == "__main__":
    main()
