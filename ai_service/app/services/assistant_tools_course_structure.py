"""
The ``course_structure_edit`` tool — change a course's depth (2-5) or regroup its
content, for the Assistant and the MCP server.

Depth is how many levels the admin sees: 5 = subjects → modules → chapters →
slides, 4 = modules → chapters → slides, 3 = chapters → slides, 2 = slides only.
Hidden levels are real containers named DEFAULT. Going DOWN a level is mechanical
(the tool merges the level being hidden, in its current order). Going UP needs a
grouping: the connected LLM proposes one from the course's content (chapter and
slide titles), shows it to the admin, adjusts it to their wishes, and passes it
as ``outline``.

admin-core does the work in ONE transaction for every batch
(``POST /course/v1/restructure/{instituteId}/{courseId}``): it re-points the
existing rows (no copies — slides and kept containers keep their ids, so learner
progress survives), creates the new containers, removes the emptied ones, sets
the depth, re-points drip rules on the rows and recomputes learner percentages.
This tool then re-points the institute's COURSE_SETTING drip conditions (what the
dashboard's drip editor shows) the same way.

Safety (MCP has no confirm card): LIVE courses are allowed (product decision
2026-10-12), so every change is two calls — ``preview`` runs admin-core's dry run
and returns a confirm_token signed over the exact request; ``apply`` refuses
without it. admin-core itself refuses content shared with another course, trees
that drop or duplicate a slide, and batches whose content differs.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from . import course_builder_data as cbd
from . import learner_data as ld
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

STRUCTURE_TOOL_NAME = "course_structure_edit"
STRUCTURE_GROUP_KEY = "course_structure_edits"
STRUCTURE_ACTIONS = ("preview", "apply")
DEFAULT = "DEFAULT"
LEVELS = {5: "subjects → modules → chapters → slides", 4: "modules → chapters → slides",
          3: "chapters → slides", 2: "slides only (one hidden chapter)"}

STRUCTURE_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": STRUCTURE_TOOL_NAME,
        "description": (
            "Change how many levels a course has, or regroup its content. Depth 5 = subjects → modules → chapters → "
            "slides, 4 = modules → chapters → slides, 3 = chapters → slides, 2 = slides only. Nothing is copied or "
            "deleted: slides keep their ids (learner progress survives); only the grouping changes, for every batch. "
            "Read courses(action='get') first for the current tree and ids. Pick an `action`:\n"
            "- preview (course_id, target_depth, outline?): checks the change and shows the result — the new tree, "
            "what is created / renamed / removed, slides moved, release (drip) rules re-pointed or dropped, and how "
            "many learners see it at once on a live course. Nothing is saved. Returns a confirm_token (15 min).\n"
            "- apply (same arguments + confirm_token): does it, after the admin said yes to the preview.\n"
            "Going DOWN a level needs no outline: the level being hidden is merged in its current order (e.g. 3→2 "
            "puts every chapter's slides into one list; 4→3 lists every module's chapters). Going UP needs one: "
            "propose a grouping from the content (chapter / slide titles), show it to the admin, change it as they "
            "ask, then preview it. You may also pass an outline at the same depth to regroup or rename.\n"
            "outline, by target depth (existing items by id — keep their id when keeping or renaming them; new "
            "containers have only a name; slides always by id, each exactly once):\n"
            "  5: {subjects: [{id?, name, modules: [{id?, name, chapters: [{id?, name, slide_ids: [..]}]}]}]}\n"
            "  4: {modules: [{id?, name, chapters: [{id?, name, slide_ids}]}]}\n"
            "  3: {chapters: [{id?, name, slide_ids}]}\n"
            "  2: {slide_ids: [..]} (the order learners see)\n"
            "Content shared with another course cannot be regrouped here."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(STRUCTURE_ACTIONS)},
                "course_id": {"type": "string"},
                "target_depth": {"type": "integer", "enum": [2, 3, 4, 5]},
                "outline": {"type": "object", "description": "The new grouping (see description)."},
                "confirm_token": {"type": "string", "description": "apply: the token preview returned."},
            },
            "required": ["action", "course_id", "target_depth"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _is_default(name: Any) -> bool:
    return str(name or "").strip().upper() == DEFAULT


# ── current tree ─────────────────────────────────────────────────────────

def _flat(tree: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    modules = [m for s in tree for m in s.get("modules") or []]
    chapters = [c for m in modules for c in m.get("chapters") or []]
    slides = [sl for c in chapters for sl in c.get("slides") or []]
    return modules, chapters, slides


def _content_listing(tree: List[Dict[str, Any]], depth: int) -> Dict[str, Any]:
    """What the LLM groups from when going up: every chapter (or slide) with its id and title, in order."""
    modules, chapters, slides = _flat(tree)
    if depth <= 2:
        return {"slides": [{"id": s["id"], "title": s.get("title")} for s in slides]}
    out = {"chapters": [{"id": c["id"], "name": c["name"],
                         "slides": [{"id": s["id"], "title": s.get("title")} for s in c.get("slides") or []]}
                        for c in chapters]}
    if depth >= 4:
        out["modules"] = [{"id": m["id"], "name": m["name"], "chapter_ids": [c["id"] for c in m.get("chapters") or []]}
                          for m in modules]
    return out


def _auto_outline(tree: List[Dict[str, Any]], target: int) -> Dict[str, Any]:
    """Going down: merge the levels being hidden, keeping everything in its current order."""
    modules, chapters, slides = _flat(tree)
    chap = lambda c: {"id": c["id"], "name": c["name"], "slide_ids": [s["id"] for s in c.get("slides") or []]}  # noqa: E731
    if target == 4:
        return {"modules": [{"id": m["id"], "name": m["name"], "chapters": [chap(c) for c in m.get("chapters") or []]}
                            for m in modules]}
    if target == 3:
        return {"chapters": [chap(c) for c in chapters]}
    return {"slide_ids": [s["id"] for s in slides]}


# ── outline → admin-core request ─────────────────────────────────────────

def _wrap(outline: Dict[str, Any], target: int) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """The outline as a full subject → module → chapter tree, hidden levels as DEFAULT containers."""
    def chapters(items: Any) -> List[Dict[str, Any]]:
        return [{"id": c.get("id"), "name": c.get("name"), "slide_ids": [str(x) for x in c.get("slide_ids") or []]}
                for c in items or [] if isinstance(c, dict)]

    def modules(items: Any) -> List[Dict[str, Any]]:
        return [{"id": m.get("id"), "name": m.get("name"), "chapters": chapters(m.get("chapters"))}
                for m in items or [] if isinstance(m, dict)]

    if target == 5:
        subjects = [{"id": s.get("id"), "name": s.get("name"), "modules": modules(s.get("modules"))}
                    for s in outline.get("subjects") or [] if isinstance(s, dict)]
        return (subjects or None), (None if subjects else "outline.subjects is empty")
    if target == 4:
        mods = modules(outline.get("modules"))
        return ([{"id": None, "name": DEFAULT, "modules": mods}] if mods else None), \
            (None if mods else "outline.modules is empty")
    if target == 3:
        chs = chapters(outline.get("chapters"))
        return ([{"id": None, "name": DEFAULT, "modules": [{"id": None, "name": DEFAULT, "chapters": chs}]}]
                if chs else None), (None if chs else "outline.chapters is empty")
    ids = [str(x) for x in outline.get("slide_ids") or []]
    return [{"id": None, "name": DEFAULT, "modules": [{"id": None, "name": DEFAULT, "chapters": [
        {"id": None, "name": DEFAULT, "slide_ids": ids}]}]}], None


def _assign_ids(subjects: List[Dict[str, Any]], tree: List[Dict[str, Any]]) -> None:
    """
    Keep existing containers wherever the outline does not name one: a hidden level takes over a current
    container of that level (a DEFAULT one first), and the first NEW visible container takes over the current
    hidden one (e.g. 3→4: the DEFAULT module becomes the first real module) — fewer rows churn, ids survive.
    """
    modules, chapters, _ = _flat(tree)
    current = {"subject": tree, "module": modules, "chapter": chapters}
    nodes = {"subject": subjects,
             "module": [m for s in subjects for m in s["modules"]],
             "chapter": [c for s in subjects for m in s["modules"] for c in m["chapters"]]}
    for level in ("subject", "module", "chapter"):
        used: Set[str] = {n["id"] for n in nodes[level] if n.get("id")}
        free = [c for c in current[level] if c["id"] not in used]
        free.sort(key=lambda c: 0 if _is_default(c.get("name")) else 1)
        for node in nodes[level]:
            if node.get("id") or not free:
                continue
            # Hidden containers always reuse; a new visible one only takes over a current HIDDEN container.
            if _is_default(node["name"]) or _is_default(free[0].get("name")):
                node["id"] = free.pop(0)["id"]


def _check_outline(subjects: List[Dict[str, Any]], tree: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Every slide exactly once, ids from this course — said in the admin's words (titles) before admin-core."""
    modules, chapters, slides = _flat(tree)
    titles = {s["id"]: s.get("title") for s in slides}
    known = {"subject": {s["id"] for s in tree}, "module": {m["id"] for m in modules},
             "chapter": {c["id"] for c in chapters}}
    problems, seen = [], []
    for s in subjects:
        for m in s["modules"]:
            for c in m["chapters"]:
                seen += c["slide_ids"]
    for level, items in (("subject", subjects), ("module", [m for s in subjects for m in s["modules"]]),
                         ("chapter", [c for s in subjects for m in s["modules"] for c in m["chapters"]])):
        for n in items:
            if n.get("id") and n["id"] not in known[level]:
                problems.append(f"{level} id {n['id']} is not part of this course")
            if not str(n.get("name") or "").strip():
                problems.append(f"a {level} has no name")
    unknown = [x for x in seen if x not in titles]
    if unknown:
        problems.append(f"slide ids not in this course: {', '.join(unknown[:20])}")
    twice = sorted({x for x in seen if seen.count(x) > 1})
    if twice:
        problems.append("listed twice: " + ", ".join(f"'{titles.get(x, x)}'" for x in twice[:20]))
    missing = [x for x in titles if x not in seen]
    if missing:
        problems.append(f"{len(missing)} slide(s) not placed: " + ", ".join(f"'{titles[x]}' ({x})" for x in missing[:20]))
    return _err("invalid_outline", problems=problems,
                message="Every slide of the course must be placed exactly once.") if problems else None


async def _build(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]:
    """(the admin-core request without dry_run, report context, problem)."""
    course = cbd.course_row(ctx, str(args.get("course_id") or ""))
    if not course:
        return None, {}, _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    try:
        target = int(args.get("target_depth"))
    except (TypeError, ValueError):
        target = 0
    if target not in LEVELS:
        return None, {}, _err("invalid_depth", message="target_depth is 2, 3, 4 or 5.", levels=LEVELS)
    current = int(course.get("depth") or 5)
    batch = cbd.active_batch_id(ctx, course["id"])
    if not batch:
        return None, {}, _err("no_batch", message="This course has no active batch.")
    tree = cbd.course_tree(ctx, course["id"], batch)
    outline = args.get("outline") if isinstance(args.get("outline"), dict) else None
    if outline is None:
        if target > current:
            return None, {}, _err(
                "outline_needed", current_depth=current, target_depth=target, content=_content_listing(tree, current),
                message=f"Going from depth {current} to {target} adds a level ({LEVELS[target]}), so the content "
                        "needs grouping. Propose groups from the titles below (sensible names, every item placed "
                        "once, in a learning order), show them to the admin, adjust to what they say, then preview "
                        "with that outline.")
        if target == current:
            return None, {}, _err("nothing_to_change", message=f"The course is already depth {current}. Pass an "
                                                               "outline to regroup or rename at this depth.")
        outline = _auto_outline(tree, target)
    subjects, problem = _wrap(outline, target)
    if problem:
        return None, {}, _err("invalid_outline", message=problem)
    _assign_ids(subjects, tree)
    problem = _check_outline(subjects, tree)
    if problem:
        return None, {}, problem
    body = {"target_depth": target, "subjects": subjects}
    return body, {"course": course, "current_depth": current, "tree": tree}, None


async def _call(ctx: ToolContext, course_id: str, body: Dict[str, Any], dry_run: bool) -> Any:
    return await cbd.admin_core(
        ctx, "POST", f"/admin-core-service/course/v1/restructure/{ctx.principal.institute_id}/{course_id}",
        body={**body, "dry_run": dry_run}, timeout=120.0)


# ── report ───────────────────────────────────────────────────────────────

def _after_view(result_tree: List[Dict[str, Any]], depth: int, titles: Dict[str, str]) -> Any:
    """The new tree as the admin will see it (hidden levels folded), with slide titles."""
    def chapter(c):
        return {"name": c.get("name"), "slides": [titles.get(x, x) for x in c.get("slide_ids") or []]}
    modules = [m for s in result_tree for m in s.get("modules") or []]
    if depth == 5:
        return {"subjects": [{"name": s.get("name"), "modules": [
            {"name": m.get("name"), "chapters": [chapter(c) for c in m.get("chapters") or []]}
            for m in s.get("modules") or []]} for s in result_tree]}
    if depth == 4:
        return {"modules": [{"name": m.get("name"), "chapters": [chapter(c) for c in m.get("chapters") or []]}
                            for m in modules]}
    chapters = [c for m in modules for c in m.get("chapters") or []]
    if depth == 3:
        return {"chapters": [chapter(c) for c in chapters]}
    return {"slides": [t for c in chapters for t in chapter(c)["slides"]]}


def _settings_drip_changes(settings: Dict[str, Any], chapter_map: Dict[str, str],
                           removed: Set[str]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """COURSE_SETTING drip conditions with removed chapters re-pointed like admin-core did on the rows."""
    block = settings.get("dripConditions") if isinstance(settings.get("dripConditions"), dict) else {}
    conditions = [dict(c) for c in block.get("conditions") or [] if isinstance(c, dict)]
    notes: List[str] = []
    taken = {(c.get("level"), c.get("level_id")) for c in conditions}
    out = []
    for c in conditions:
        if c.get("level") == "chapter" and c.get("level_id") in removed:
            to = chapter_map.get(c["level_id"])
            if to and ("chapter", to) not in taken:
                c["level_id"] = to
                taken.add(("chapter", to))
                notes.append("A release rule in the drip settings moved with its slides to their new chapter.")
            else:
                notes.append("A release rule in the drip settings was removed with its chapter.")
                continue
        for group in c.get("drip_condition") or []:
            for rule in (group or {}).get("rules") or []:
                params = (rule or {}).get("params") or {}
                req = params.get("required_chapters")
                if rule.get("type") == "prerequisite" and isinstance(req, list) and any(x in removed for x in req):
                    params["required_chapters"] = list(dict.fromkeys(
                        chapter_map[x] if x in removed else x for x in req if x not in removed or chapter_map.get(x)))
                    notes.append("A prerequisite in the drip settings now points at the chapter that holds the "
                                 "merged slides.")
        out.append(c)
    return out, notes


# ── actions ──────────────────────────────────────────────────────────────

async def _action_preview(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    body, context, problem = await _build(ctx, args)
    if problem:
        return problem
    course = context["course"]
    result = await _call(ctx, course["id"], body, dry_run=True)
    if cbd.is_error(result) or not isinstance(result, dict):
        return _err("refused", message=(result or {}).get("message") if isinstance(result, dict) else
                    "The change could not be checked.")
    titles = {s["id"]: s.get("title") for s in _flat(context["tree"])[2]}
    removed = {r["id"] for r in result.get("removed") or [] if r.get("level") == "chapter"}
    settings = await cbd.load_course_settings(ctx)
    _, settings_notes = _settings_drip_changes(settings if isinstance(settings, dict) else {},
                                               result.get("chapter_id_map") or {}, removed)
    live = course.get("status") == cbd.STATUS_ACTIVE
    out = {
        "course": course.get("name"),
        "depth": {"from": context["current_depth"], "to": body["target_depth"],
                  "levels_after": LEVELS[body["target_depth"]]},
        "after": _after_view(result.get("tree") or [], body["target_depth"], titles),
        "created": [{"level": r["level"], "name": r["name"]} for r in result.get("created") or []],
        "renamed": [{"level": r["level"], "from": r.get("previous_name"), "to": r["name"]}
                    for r in result.get("renamed") or []],
        "removed": [{"level": r["level"], "name": r["name"]} for r in result.get("removed") or []],
        "slides_moved": result.get("slides_moved"),
        "batches": result.get("batches"),
        "drip_changes": (result.get("drip_changes") or []) + settings_notes or None,
        "warnings": result.get("warnings") or None,
        "confirm_token": ld.issue_token(ctx, STRUCTURE_TOOL_NAME, {"course_id": course["id"], "body": body}),
        "next": "Show the admin this new structure (and any drip changes) and ask them to confirm. On a clear yes "
                "call course_structure_edit(action='apply') with the SAME arguments and this confirm_token.",
    }
    if live:
        out["live_course"] = (f"This course is live: {result.get('learners_affected', 0)} learner(s) will see the new "
                              "structure immediately. Their slide progress is kept; chapter / module / course "
                              "percentages are recalculated.")
    return {k: v for k, v in out.items() if v is not None}


async def _action_apply(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    body, context, problem = await _build(ctx, args)
    if problem:
        return problem
    course = context["course"]
    reason = ld.check_token(ctx, STRUCTURE_TOOL_NAME, {"course_id": course["id"], "body": body},
                            args.get("confirm_token"))
    if reason:
        return ld.token_error(reason, STRUCTURE_TOOL_NAME)
    result = await _call(ctx, course["id"], body, dry_run=False)
    if cbd.is_error(result) or not isinstance(result, dict):
        return _err("refused", message=(result or {}).get("message") if isinstance(result, dict) else
                    "admin-core did not apply the change. Nothing was changed (it runs in one transaction).")
    out: Dict[str, Any] = {"done": True, "depth": result.get("depth_to"),
                           "slides_moved": result.get("slides_moved"),
                           "created": len(result.get("created") or []), "removed": len(result.get("removed") or []),
                           "drip_changes": result.get("drip_changes") or None,
                           "editor_url": cbd.course_editor_url(ctx, course["id"])}
    removed = {r["id"] for r in result.get("removed") or [] if r.get("level") == "chapter"}
    if removed:
        settings = await cbd.load_course_settings(ctx)
        if isinstance(settings, dict) and not cbd.is_error(settings):
            conditions, notes = _settings_drip_changes(settings, result.get("chapter_id_map") or {}, removed)
            if notes:
                block = dict(settings.get("dripConditions") or {})
                block["conditions"] = conditions
                saved = await cbd.save_course_settings(ctx, {**settings, "dripConditions": block})
                if cbd.is_error(saved):
                    out["warning"] = ("The structure changed, but the drip settings could not be updated — check "
                                      "the course's release rules in the dashboard.")
                else:
                    out["drip_changes"] = (out.get("drip_changes") or []) + notes
    return {k: v for k, v in out.items() if v is not None}


_ACTIONS = {"preview": _action_preview, "apply": _action_apply}


async def execute_course_structure_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(STRUCTURE_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


STRUCTURE_TOOLS: Dict[str, ToolSpec] = {
    STRUCTURE_TOOL_NAME: ToolSpec(
        name=STRUCTURE_TOOL_NAME,
        schema=STRUCTURE_SCHEMA,
        executor=execute_course_structure_edit,
        required_permission=None,
        setting_key=STRUCTURE_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(STRUCTURE_TOOLS)
    GROUP_LABELS.update({STRUCTURE_GROUP_KEY: "Courses: change structure / depth"})


_register()

__all__ = ["STRUCTURE_TOOLS", "STRUCTURE_TOOL_NAME", "STRUCTURE_GROUP_KEY", "STRUCTURE_ACTIONS",
           "STRUCTURE_SCHEMA", "execute_course_structure_edit"]
