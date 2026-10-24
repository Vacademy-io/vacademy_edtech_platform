"""Where a learner is in a companion, as pure functions over rows.

A learner learns LEAVES of the KB topic tree: a subtopic, or a topic that has
no subtopics. Topics with subtopics are groups on the topic map. The companion's
scope (ids chosen with the admin TopicPicker) narrows the leaves: a selected
topic implies all its subtopics, the same rule as course grounding and papers.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Set


def scoped_map(topics: Sequence[Dict[str, Any]], scope_node_ids: Iterable[str]) -> List[Dict[str, Any]]:
    """The topic tree cut to the companion's scope, each topic carrying the
    leaves the learner can open (`leaves`, in order)."""
    scope: Set[str] = {s for s in (scope_node_ids or []) if s}
    out: List[Dict[str, Any]] = []
    for t in topics:
        subs = t.get("subtopics") or []
        if not scope or t["id"] in scope:
            leaves = subs if subs else [t]
        else:
            leaves = [s for s in subs if s["id"] in scope]
        if not leaves:
            continue
        out.append({
            "id": t["id"], "title": t.get("title"), "summary": t.get("summary"),
            "page_start": t.get("page_start"), "page_end": t.get("page_end"),
            "leaves": [
                {"id": s["id"], "title": s.get("title"), "summary": s.get("summary"),
                 "page_start": s.get("page_start"), "page_end": s.get("page_end"),
                 "is_topic": s["id"] == t["id"]}
                for s in leaves
            ],
        })
    return out


def leaf_ids(scoped: Sequence[Dict[str, Any]]) -> List[str]:
    return [leaf["id"] for t in scoped for leaf in t["leaves"]]


def mastery_of(*, cards_total: int, max_card_seen: int, completed: bool, checks_correct: int,
               checks_total: int, practice_correct: int, practice_total: int) -> int:
    """0-100. Reading the lesson earns up to 40; answering correctly earns the
    rest. With no questions answered yet, reading alone tops out at 50 — a
    learner who only scrolled has not shown they know it."""
    if completed:
        coverage = 1.0
    elif cards_total > 0:
        coverage = min(1.0, (max_card_seen + 1) / cards_total)
    else:
        coverage = 0.0
    answered = checks_total + practice_total
    if answered <= 0:
        return round(100 * 0.5 * coverage)
    accuracy = (checks_correct + practice_correct) / answered
    return round(100 * (0.4 * coverage + 0.6 * accuracy))


def apply_update(existing: Optional[Dict[str, Any]], update: Dict[str, Any]) -> Dict[str, Any]:
    """Merge one progress report from the learner app into the stored row.

    - card position moves freely (back and forth); the furthest card seen only grows;
    - a check card is scored once, however often it is answered;
    - a practice attempt replaces the previous one;
    - COMPLETED is sticky.
    """
    row = dict(existing or {})
    cards_total = int(update.get("cards_total") or row.get("cards_total") or 0)
    card_index = max(0, int(update.get("card_index", row.get("card_index", 0)) or 0))
    if cards_total:
        card_index = min(card_index, cards_total - 1)
    max_seen = max(int(row.get("max_card_seen") or 0), card_index)
    answered: List[str] = list(row.get("answered_card_ids") or [])
    cc = int(row.get("checks_correct") or 0)
    ct = int(row.get("checks_total") or 0)
    check = update.get("check")
    if check and check.get("card_id") and check["card_id"] not in answered:
        answered.append(str(check["card_id"]))
        ct += 1
        cc += 1 if check.get("correct") else 0
    pc = int(row.get("practice_correct") or 0)
    pt = int(row.get("practice_total") or 0)
    practice = update.get("practice")
    if practice and int(practice.get("total") or 0) > 0:
        pt = int(practice["total"])
        pc = max(0, min(pt, int(practice.get("correct") or 0)))
    was_completed = row.get("status") == "COMPLETED"
    completed = was_completed or bool(update.get("completed"))
    return {
        "status": "COMPLETED" if completed else "IN_PROGRESS",
        "card_index": card_index,
        "cards_total": cards_total,
        "max_card_seen": max_seen,
        "checks_correct": cc,
        "checks_total": ct,
        "answered_card_ids": answered,
        "practice_correct": pc,
        "practice_total": pt,
        "mastery": mastery_of(cards_total=cards_total, max_card_seen=max_seen, completed=completed,
                              checks_correct=cc, checks_total=ct, practice_correct=pc, practice_total=pt),
        # The caller stamps the time for a fresh completion (True); an earlier
        # completion keeps its original timestamp.
        "completed_at": row.get("completed_at") if was_completed else (True if completed else None),
    }


def resume_point(leaves: Sequence[str], progress: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Where "Continue" goes: the most recently touched unfinished leaf at its
    card, else the first leaf never opened, else None (all done)."""
    in_scope = set(leaves)
    by_node = {p["node_id"]: p for p in progress if p["node_id"] in in_scope}
    open_rows = [p for p in by_node.values() if p.get("status") != "COMPLETED"]
    if open_rows:
        latest = max(open_rows, key=lambda p: p.get("last_activity_at") or "")
        return {"node_id": latest["node_id"], "card_index": int(latest.get("card_index") or 0), "reason": "continue"}
    for leaf in leaves:
        if leaf not in by_node:
            return {"node_id": leaf, "card_index": 0, "reason": "next"}
    return None


def summary(leaves: Sequence[str], progress: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    in_scope = set(leaves)
    rows = [p for p in progress if p["node_id"] in in_scope]
    completed = sum(1 for p in rows if p.get("status") == "COMPLETED")
    total = len(leaves)
    # Untouched leaves count as 0: "70% mastery" over two of forty topics is not 70%.
    mastery = round(sum(int(p.get("mastery") or 0) for p in rows) / total) if total else 0
    return {"leaves_total": total, "started": len(rows), "completed": completed, "mastery": mastery}


def learner_memo(scoped: Sequence[Dict[str, Any]], progress: Sequence[Dict[str, Any]],
                 current_node_id: Optional[str] = None) -> str:
    """A short, exact note about the learner for the Ask prompt. No model call:
    it cannot drift and costs nothing."""
    titles = {leaf["id"]: leaf.get("title") or "" for t in scoped for leaf in t["leaves"]}
    by_node = {p["node_id"]: p for p in progress if p["node_id"] in titles}
    done = [titles[n] for n, p in by_node.items() if p.get("status") == "COMPLETED"]
    weak = [
        titles[n] for n, p in by_node.items()
        if (p.get("checks_total") or 0) + (p.get("practice_total") or 0) >= 2 and int(p.get("mastery") or 0) < 50
    ]
    parts = []
    if current_node_id and current_node_id in titles:
        parts.append(f"Currently learning: {titles[current_node_id]}.")
    if done:
        parts.append("Finished: " + "; ".join(done[:8]) + ".")
    if weak:
        parts.append("Found hard (low scores): " + "; ".join(weak[:5]) + ".")
    return " ".join(parts) or "New learner — has not finished any topic yet."
