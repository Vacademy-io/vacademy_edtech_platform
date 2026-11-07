"""
Scorers for the Brahm Varchas golden (tier 1): ``design_import`` plan vs the
published site fixture.

The expected side comes from what is committed: the fixture JSON and the
pattern registry, whose ``fullSource`` pointers say where each pattern sits in
the fixture (``#/pages/1/components/0/props`` → page 1, section 0). Nothing
here reads the client's design files; ``run.py`` does.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

_POINTER_RE = re.compile(r"#/pages/(\d+)/components/(\d+)/props$")
_CHROME_RE = re.compile(r"#/globalSettings/layout/(header|footer)/props$")
_SITE_RE = re.compile(r"#/globalSettings$")


def expected_from_fixture(fixture: Dict[str, Any], patterns: Sequence[Dict[str, Any]], ref: str) -> Dict[str, Any]:
    """Per fixture page: the sections in order with their pattern ids; chrome and site pattern ids."""
    pages: Dict[int, Dict[int, Set[str]]] = {}
    chrome: Set[str] = set()
    site: Set[str] = set()
    for p in patterns:
        src = str(p.get("fullSource") or "")
        if not src.startswith(ref + "#"):
            continue
        if (m := _POINTER_RE.search(src)):
            pages.setdefault(int(m.group(1)), {}).setdefault(int(m.group(2)), set()).add(p["id"])
        elif _CHROME_RE.search(src):
            chrome.add(p["id"])
        elif _SITE_RE.search(src):
            site.add(p["id"])
    out_pages: Dict[str, List[Dict[str, Any]]] = {}
    for pi, comps in pages.items():
        page = fixture["pages"][pi]
        secs = []
        for ci, comp in enumerate(page.get("components") or []):
            ids = comps.get(ci) or _closest_pattern(comp, patterns)
            secs.append({"component": comp["type"], "patterns": sorted(ids), "index": ci})
        out_pages[str(page.get("route"))] = secs
    gs = fixture.get("globalSettings") or {}
    return {
        "pages": out_pages,
        "chrome": sorted(chrome),
        "site": sorted(site),
        "palette": {k: v for k, v in ((gs.get("theme") or {}).get("palette") or {}).items() if isinstance(v, str)},
        "content_max_width": (gs.get("theme") or {}).get("contentMaxWidth"),
        "font_family": (gs.get("fonts") or {}).get("family"),
    }


def _closest_pattern(comp: Dict[str, Any], patterns: Sequence[Dict[str, Any]]) -> Set[str]:
    """A fixture section no pattern points at (a second instance): the same-block pattern whose minimal
    props share the most keys with it."""
    keys = set((comp.get("props") or {}).keys())
    best, score = None, 0.0
    for p in patterns:
        if p.get("component") != comp.get("type") or not isinstance(p.get("minimal"), dict):
            continue
        mk = set(p["minimal"].keys())
        j = len(keys & mk) / len(keys | mk) if keys | mk else 0.0
        if j > score:
            best, score = p["id"], j
    return {best} if best and score >= 0.3 else set()


def _prf(pred: Set[Tuple[str, str]], exp: Set[Tuple[str, str]]) -> Dict[str, Any]:
    tp = len(pred & exp)
    return {
        "precision": round(tp / len(pred), 3) if pred else 0.0,
        "recall": round(tp / len(exp), 3) if exp else 1.0,
        "true_positive": tp, "predicted": len(pred), "expected": len(exp),
        "missed": sorted(f"{a}:{b}" for a, b in exp - pred),
        "extra": sorted(f"{a}:{b}" for a, b in pred - exp),
    }


def _align(exp_seq: Sequence[str], pred_seq: Sequence[Optional[str]]) -> List[Tuple[int, int]]:
    """(expected index, predicted index) pairs of a longest common subsequence of block types."""
    n, m = len(exp_seq), len(pred_seq)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if exp_seq[i] == pred_seq[j] else max(dp[i + 1][j], dp[i][j + 1])
    pairs, i, j = [], 0, 0
    while i < n and j < m:
        if exp_seq[i] == pred_seq[j]:
            pairs.append((i, j))
            i, j = i + 1, j + 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


def score_sections(plan: Dict[str, Any], expected: Dict[str, Any]) -> Dict[str, Any]:
    """Per SECTION: predicted sections are aligned to the fixture's in order (by block type), and a pattern counts
    only on its own aligned section — a pattern found on the wrong section is both a miss and an extra."""
    pred_triples: Set[Tuple[str, str]] = set()
    exp_triples: Set[Tuple[str, str]] = set()
    per_page: Dict[str, Any] = {}
    order_scores: List[float] = []
    for route, exp_secs in expected["pages"].items():
        pred_secs = [s for s in plan.get("sections") or [] if s.get("page_route") == route]
        exp_seq = [s["component"] for s in exp_secs]
        pred_seq = [s.get("component") for s in pred_secs]
        pairs = _align(exp_seq, pred_seq)
        order_scores.append(len(pairs) / max(len(exp_seq), len(pred_seq), 1))
        slot_of_pred = {j: i for i, j in pairs}
        for i, s in enumerate(exp_secs):
            exp_triples.update((f"{route}#{i}", p) for p in s["patterns"])
        for j, s in enumerate(pred_secs):
            slot = slot_of_pred.get(j)
            key = f"{route}#{slot}" if slot is not None else f"{route}#extra{j}"
            pred_triples.update((key, m["id"]) for m in s.get("patterns") or [])
        sections = []
        pred_of_exp = dict(pairs)
        for i, es in enumerate(exp_secs):
            ps = pred_secs[pred_of_exp[i]] if i in pred_of_exp else None
            got = {m["id"] for m in (ps or {}).get("patterns") or []}
            want = set(es["patterns"])
            tp = len(got & want)
            f1 = 2 * tp / (len(got) + len(want)) if got or want else 1.0
            sections.append({"expected": es["component"], "predicted": (ps or {}).get("component"),
                             "f1": round(f1, 3), "missed": sorted(want - got), "extra": sorted(got - want)})
        per_page[route] = {"order": round(order_scores[-1], 3), "expected": exp_seq, "predicted": pred_seq,
                           "sections": sections}
    out = _prf(pred_triples, exp_triples)
    out["section_order"] = round(sum(order_scores) / len(order_scores), 3) if order_scores else 0.0
    out["pages"] = per_page
    missing_pages = [r for r in expected["pages"] if r not in {s.get("page_route") for s in plan.get("sections") or []}]
    if missing_pages:
        out["missing_pages"] = missing_pages
    return out


def score_chrome_and_site(plan: Dict[str, Any], expected: Dict[str, Any]) -> Dict[str, Any]:
    chrome_pred = {("chrome", m["id"]) for m in (plan.get("chrome") or {}).get("patterns") or []}
    site_pred = {("site", m["id"]) for m in plan.get("site_patterns") or []}
    return {
        "chrome": _prf(chrome_pred, {("chrome", p) for p in expected["chrome"]}),
        "site": _prf(site_pred, {("site", p) for p in expected["site"]}),
    }


def score_tokens(plan: Dict[str, Any], expected: Dict[str, Any], delta_e, tolerance_px: int = 16) -> Dict[str, Any]:
    tokens = plan.get("tokens") or {}
    got = tokens.get("palette") or {}
    roles = {}
    within = 0
    for role, want in expected["palette"].items():
        have = got.get(role)
        de = round(delta_e(have, want), 2) if have else None
        ok = de is not None and de <= 5
        within += ok
        roles[role] = {"expected": want.upper(), "got": have, "delta_e": de, "ok": ok}
    width = tokens.get("content_max_width")
    exp_width = expected.get("content_max_width")
    stack = (tokens.get("fonts") or {}).get("stack")
    return {
        "palette_roles": len(expected["palette"]),
        "palette_within_de5": within,
        "palette": roles,
        "font_family": {"expected": expected.get("font_family"), "got": stack,
                        "ok": bool(stack) and stack == expected.get("font_family")},
        "content_max_width": {"expected": exp_width, "got": width,
                              "ok": width is not None and exp_width is not None and abs(width - exp_width) <= tolerance_px},
    }


def score_data_needs(plan: Dict[str, Any], want: Dict[str, Any]) -> Dict[str, Any]:
    needs = plan.get("data_needs") or []

    def design(kind: str) -> Dict[str, Any]:
        merged: Dict[str, Any] = {}
        for n in needs:
            if n.get("kind") == kind:
                merged.update(n.get("design") or {})
        return merged

    streams = len(design("folderLibrary").get("streams") or [])
    families = sorted((design("courseTags").get("tag_families") or {}).keys())
    pp = design("productPage")
    paths = int(pp.get("at_least") or 0)
    store = bool((pp.get("store") or {}).get("needed"))
    forms = sorted({_form_kind(n.get("what") or "") for n in needs if n.get("kind") == "campaign"} - {None})
    items = {
        "streams": {"expected": want["streams"], "got": streams, "ok": streams == want["streams"]},
        "tag_families": {"expected": want["tag_families"], "got": families,
                         "ok": set(want["tag_families"]) <= set(families)},
        "paths": {"expected": want["paths"], "got": paths, "ok": paths >= want["paths"]},
        "store": {"expected": want["store"], "got": store, "ok": store == want["store"]},
        "forms": {"expected": want["forms"], "got": forms, "ok": set(want["forms"]) <= set(forms)},
    }
    items["covered"] = sum(1 for v in items.values() if isinstance(v, dict) and v["ok"])
    items["of"] = 5
    return items


def _form_kind(what: str) -> Optional[str]:
    low = what.lower()
    if "newsletter" in low:
        return "newsletter"
    if "notify" in low:
        return "notify"
    if "talk to us" in low or "contact" in low:
        return "contact"
    return None


def _strings(node: Any, out: List[str]) -> List[str]:
    if isinstance(node, dict):
        for v in node.values():
            _strings(v, out)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out)
    elif isinstance(node, str):
        out.append(node)
    return out


_SKIP_TEXT_RE = re.compile(r"^(https?://|#|/|[0-9a-f-]{20,}$)|^[a-z0-9-]+$")


def _norm(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"[^\wऀ-ॿ]+", " ", s.lower()).strip()


def score_copy(plan: Dict[str, Any], fixture: Dict[str, Any], expected: Dict[str, Any]) -> Dict[str, Any]:
    """Share of the fixture's visible copy (headings, leads, labels) the draft already carries."""
    draft = plan.get("site_json_draft") or {}
    got = {_norm(s) for s in _strings(draft, []) if s}
    total = hit = 0
    misses: List[str] = []
    for route in expected["pages"]:
        page = next((p for p in fixture["pages"] if p.get("route") == route), None)
        if page is None:
            continue
        for s in _strings(page.get("components"), []):
            if len(s) < 4 or _SKIP_TEXT_RE.match(s) or "{" in s:
                continue
            total += 1
            if _norm(s) in got:
                hit += 1
            elif len(misses) < 15:
                misses.append(s[:60])
    return {"fixture_texts": total, "in_draft": hit, "recall": round(hit / total, 3) if total else 0.0,
            "sample_missing": misses}


def scorecard(plan: Dict[str, Any], fixture: Dict[str, Any], patterns: Sequence[Dict[str, Any]], spec: Dict[str, Any],
              delta_e) -> Dict[str, Any]:
    expected = expected_from_fixture(fixture, patterns, spec["fixture_ref"])
    th = spec["thresholds"]
    sections = score_sections(plan, expected)
    tokens = score_tokens(plan, expected, delta_e, th["content_width_tolerance_px"])
    data = score_data_needs(plan, spec["data_needs"])
    checks = {
        "pattern_recall": sections["recall"] >= th["pattern_recall"],
        "pattern_precision": sections["precision"] >= th["pattern_precision"],
        "section_order": sections["section_order"] >= th["section_order"],
        "palette": tokens["palette_within_de5"] >= th["palette_roles_within_de5"],
        "font_family": tokens["font_family"]["ok"],
        "content_max_width": tokens["content_max_width"]["ok"],
        "data_needs": data["covered"] == data["of"],
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "sections": sections,
        **score_chrome_and_site(plan, expected),
        "tokens": tokens,
        "data_needs": data,
        "copy": score_copy(plan, fixture, expected),
    }


def summary_line(card: Dict[str, Any]) -> str:
    s, t, d = card["sections"], card["tokens"], card["data_needs"]
    return (f"patterns P={s['precision']:.2f} R={s['recall']:.2f} order={s['section_order']:.2f} | "
            f"palette {t['palette_within_de5']}/{t['palette_roles']} ΔE≤5 | font {'ok' if t['font_family']['ok'] else 'MISS'} | "
            f"width {t['content_max_width']['got']} ({'ok' if t['content_max_width']['ok'] else 'MISS'}) | "
            f"data needs {d['covered']}/{d['of']} | chrome R={card['chrome']['recall']:.2f} site R={card['site']['recall']:.2f} | "
            f"copy {card['copy']['recall']:.2f} | {'PASS' if card['passed'] else 'FAIL'}")


__all__: Iterable[str] = ("expected_from_fixture", "score_sections", "score_tokens", "score_data_needs", "scorecard",
                          "summary_line")
