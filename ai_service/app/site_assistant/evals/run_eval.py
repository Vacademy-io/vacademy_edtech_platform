"""Run a Site Assistant eval set against a live deployment (manual; not CI).

Each case gets its own PREVIEW session (staff JWT + clientId), so the done
event carries the tools that were called. Costs 1 credit per answered case.

    python -m app.site_assistant.evals.run_eval \\
        --base-url https://backend-stage.vacademy.io --site-tag <tag> \\
        --client-id <institute id> --token <staff JWT> [--only detail-price,live-free] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import httpx

HERE = Path(__file__).resolve().parent


def load_cases(path: Path) -> List[Dict[str, Any]]:
    try:
        import yaml
    except ImportError:  # pragma: no cover
        sys.exit("pip install pyyaml to run the eval")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return list(data.get("cases") or [])


def parse_sse(body: str) -> List[Tuple[str, Dict[str, Any]]]:
    events = []
    for block in body.strip().split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name:
            events.append((name, data or {}))
    return events


def check(case: Dict[str, Any], events: List[Tuple[str, Dict[str, Any]]], site_host: Optional[str]) -> List[str]:
    problems: List[str] = []
    text = "".join(d.get("text", "") for n, d in events if n == "token")
    cards = [d for n, d in events if n == "card"]
    done = next((d for n, d in events if n == "done"), None)
    error = next((d for n, d in events if n == "error"), None)
    if case.get("error"):
        if not error or error.get("code") != case["error"]:
            problems.append(f"expected error {case['error']}, got {error}")
        return problems
    if error or not done:
        return [f"no answer: {error}"]
    used = done.get("tools") or []
    if case.get("tools") and not set(case["tools"]) & set(used):
        problems.append(f"expected one of tools {case['tools']}, used {used}")
    if case.get("no_tools") and used:
        problems.append(f"expected no tools, used {used}")
    for kind in case.get("cards") or []:
        if not any(c.get("type") == kind for c in cards):
            problems.append(f"missing card {kind} (got {[c.get('type') for c in cards]})")
    for rx in case.get("must") or []:
        if not re.search(rx, text, re.I):
            problems.append(f"answer lacks /{rx}/")
    for rx in case.get("must_not") or []:
        if re.search(rx, text, re.I):
            problems.append(f"answer has forbidden /{rx}/")
    for key in ("answered", "billed"):
        if key in case and done.get(key) is not case[key]:
            problems.append(f"{key}={done.get(key)} (expected {case[key]})")
    card_blob = json.dumps(cards)
    for url in re.findall(r"https://[^\s)\]>\"']+", text):
        host = urlsplit(url).hostname or ""
        if url.rstrip(".,") not in card_blob and host != site_host:
            problems.append(f"link not from a card or the site: {url}")
    if len(text.split()) > 160:
        problems.append(f"answer too long ({len(text.split())} words)")
    return problems


def run(args: argparse.Namespace) -> int:
    cases = load_cases(Path(args.cases))
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    base = args.base_url.rstrip("/") + "/ai-service/site-assistant/v1"
    staff = {"Authorization": f"Bearer {args.token}", "clientId": args.client_id}
    results = []
    with httpx.Client(timeout=90) as client:
        for case in cases:
            s = client.post(f"{base}/sessions", headers=staff,
                            json={"site_tag": args.site_tag, "preview": True,
                                  "page": {"url": f"/{args.site_tag}", "route": "/", "title": "Eval"}})
            s.raise_for_status()
            session = s.json()
            started = time.monotonic()
            first_token = None
            body = ""
            with client.stream("POST", f"{base}/sessions/{session['session_id']}/messages",
                               headers={"Authorization": f"Bearer {session['token']}"},
                               json={"text": case["q"], "client_msg_id": uuid.uuid4().hex,
                                     "page": {"url": f"/{args.site_tag}", "route": "/", "title": "Eval"}}) as resp:
                for chunk in resp.iter_text():
                    if first_token is None and "event: token" in chunk:
                        first_token = time.monotonic() - started
                    body += chunk
            events = parse_sse(body)
            problems = check(case, events, args.site_host)
            results.append({"id": case["id"], "q": case["q"], "ok": not problems, "problems": problems,
                            "first_token_s": round(first_token, 2) if first_token else None,
                            "answer": "".join(d.get("text", "") for n, d in events if n == "token"),
                            "done": next((d for n, d in events if n == "done"), None)})
            mark = "PASS" if not problems else "FAIL"
            print(f"[{mark}] {case['id']}: {'; '.join(problems) or 'ok'}"
                  + (f"  (first token {first_token:.2f}s)" if first_token else ""))
    passed = sum(r["ok"] for r in results)
    ft = sorted(r["first_token_s"] for r in results if r["first_token_s"])
    p50 = ft[len(ft) // 2] if ft else None
    print(f"\n{passed}/{len(results)} passed; first-token p50 = {p50}s")
    if args.json:
        Path(args.json).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if passed == len(results) else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", required=True)
    p.add_argument("--site-tag", required=True)
    p.add_argument("--client-id", required=True, help="institute id (staff JWT must be staff there)")
    p.add_argument("--token", required=True, help="staff JWT")
    p.add_argument("--site-host", default=None, help="the site's host; links on it are allowed")
    p.add_argument("--cases", default=str(HERE / "bv.yaml"))
    p.add_argument("--only", default=None)
    p.add_argument("--json", default=None)
    sys.exit(run(p.parse_args()))


if __name__ == "__main__":
    main()
