"""Real end-to-end dry run of the Lead Agent WITHOUT delivery (not a pytest test).

plan (LLM) -> discover (Serper + Parallel + LLM selection, capped) -> server fetch
(robots.txt, safe_fetch, engine.pagefetch) -> research (LLM extraction, build_lead,
fingerprint, score, decision-maker lookup) -> gate, on a scratch Postgres
(pgserver) with the real V612 schema. admin_core is never called; nothing is
charged. Prints each candidate's organisation, decision, score parts, flags and
best contact, plus total cost_usd and wall time.

Keys (SERPER_API_KEYS, PARALLEL_API_KEY, OPENROUTER_API_KEY) come from the
environment or --env-file (loaded into this process only, never printed).

    python scripts/lead_agent_dry_run.py --env-file /path/lead_agent.env --max 8
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests" / "lead_agent"))

BRIEF = {
    "products": ["complete_vacademy"],
    "description": ("Complete Vacademy: an LMS with live classes, test series and a mobile app, plus a CRM for "
                    "admission enquiries and AI calling, for online coaching institutes."),
    "industries": [{"name": "Online coaching institutes", "search_term": "online coaching institute"},
                   {"name": "JEE / NEET coaching institutes", "search_term": "JEE NEET coaching institute"}],
    "buyer_roles": ["founder", "director", "owner"],
    "hiring_roles": ["telecaller", "admission counsellor"],
    "keywords": ["looking for LMS for coaching", "need app for coaching institute"],
    "must_have": ["offers online classes or courses"],
    "deal_breakers": ["schools", "government institutions"],
    "exclude": ["Schools & playschools"],
    "sources": ["organisation_search", "maps", "hiring"],
    "find_contacts": True,
}
MARKETS = [{"country": "India", "state": "Madhya Pradesh", "city": "Indore"}]


def load_env(path: str) -> None:
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


async def main(args) -> int:
    brief, markets = BRIEF, MARKETS
    if args.brief_file:
        given = json.loads(Path(args.brief_file).read_text())
        brief, markets = given["brief"], given.get("markets") or MARKETS
    from sqlalchemy import text

    from la_pg import pg_session_factory

    from app.services.lead_agent import db as ladb
    from app.services.lead_agent import discovery, fetcher, flags, planner, research, store

    factory = pg_session_factory()
    ladb.use_sessionmaker(factory)
    flags.platform_enabled = lambda: True
    flags.allowed_institutes = lambda: flags.ALL_INSTITUTES
    flags.available = lambda i: True
    started = time.monotonic()
    try:
        with factory() as db:
            db.execute(text("INSERT INTO institutes (id, name) VALUES ('dry-inst', 'Vacademy (dry run)')"))
            db.execute(text("INSERT INTO audience (id, institute_id, campaign_name) "
                            "VALUES ('dry-aud', 'dry-inst', 'Dry run list')"))
            agent = store.insert_agent(db, institute_id="dry-inst", audience_id="dry-aud", name="Dry run",
                                       brief=brief, markets=markets, daily_quota=max(1, args.max // 3),
                                       monthly_credit_cap=None, mode="REMOTE", gate=None, window=None,
                                       created_by="dry-run")
            agent = store.update_agent(db, agent["id"], "dry-inst", {"status": "ACTIVE"})
            db.commit()

        t = time.monotonic()
        plan = await planner.ensure_plan(agent)
        print(f"plan ({time.monotonic() - t:.0f}s): {len(plan['search_queries'])} searches, "
              f"hiring roles {plan.get('hiring_roles')}, places {plan.get('places')}")
        for q in plan["search_queries"][:6]:
            print(f"   - {q}")

        t = time.monotonic()
        out = await discovery.run_round(agent, plan, args.max)
        print(f"discovery ({time.monotonic() - t:.0f}s): {out.get('created')} candidates; notes {out.get('notes')}")

        t = time.monotonic()
        deadline = time.monotonic() + args.fetch_minutes * 60
        while time.monotonic() < deadline:
            n = await fetcher.run_server_batch(6, None)
            with factory() as db:
                fetcher.finalize_fetching(db)
                db.commit()
                fetching = db.execute(text("SELECT count(*) FROM lead_candidate WHERE status = 'FETCHING'")).scalar()
            if not fetching:
                break
            if not n:
                await asyncio.sleep(2)
        with factory() as db:
            pages = db.execute(text("SELECT access, count(*) FROM lead_org_page GROUP BY access")).fetchall()
        print(f"fetch ({time.monotonic() - t:.0f}s): pages {dict(pages)}")

        t = time.monotonic()
        while True:
            with factory() as db:
                claimed = store.claim_ready(db, 3)
                db.commit()
            if not claimed:
                break
            await asyncio.gather(*(research.research_candidate(c["id"]) for c in claimed), return_exceptions=True)
        print(f"research ({time.monotonic() - t:.0f}s)")

        with factory() as db:
            rows = [store.get_candidate(db, r[0]) for r in db.execute(text(
                "SELECT id FROM lead_candidate ORDER BY score DESC NULLS LAST")).fetchall()]
            day = store.get_day(db, agent["id"], __import__("app.services.lead_agent.pacing",
                                                            fromlist=["x"]).agent_day(agent["window_json"]))
        total = sum(float(r["cost_usd"] or 0) for r in rows)
        print(f"\n{len(rows)} candidates")
        for r in rows:
            lead, score = r.get("lead_json") or {}, r.get("score_json") or {}
            best = next((c for c in lead.get("contacts") or []
                         if c.get("kind") != "contact_form" and c.get("quality") != "avoid"), None)
            parts = {k: score.get(k) for k in ("fit", "intent", "reach", "risk")}
            print(f"- {(lead.get('organisation') or {}).get('name') or r['org_name']} <{r['org_domain']}> "
                  f"[{r['source']}] -> {r['status']}/{r['decision']} score={r['score']} parts={parts}")
            print(f"    flags={score.get('flags')}  stage={r.get('stage')}")
            if best:
                print(f"    best contact: {best.get('kind')} {best.get('value')} ({best.get('quality')}: "
                      f"{(lead.get('contact_quality') or {}).get('label')})")
            reason = (score.get("gate_reasons") or [r.get("reject_reason") or r.get("last_error")])[0]
            print(f"    why: {reason}   cost ${float(r['cost_usd'] or 0):.4f}")
        print(f"\nsearch + LLM cost (lead_agent_day): ${float(day['cost_usd'] or 0):.4f}; "
              f"LLM cost on candidates: ${total:.4f}; searches {day['searches']}; pages {day['pages']}")
        print(f"wall time {time.monotonic() - started:.0f}s")
        if args.dump:
            Path(args.dump).write_text(json.dumps(rows, default=str, indent=1))
    finally:
        ladb.use_sessionmaker(None)
        factory.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file")
    ap.add_argument("--max", type=int, default=8)
    ap.add_argument("--brief-file", help='JSON {"brief": {...}, "markets": [...]} instead of the Vacademy brief above')
    ap.add_argument("--fetch-minutes", type=float, default=6)
    ap.add_argument("--dump", help="write the candidate rows as JSON here")
    a = ap.parse_args()
    if a.env_file:
        load_env(a.env_file)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    sys.exit(asyncio.run(main(a)))
