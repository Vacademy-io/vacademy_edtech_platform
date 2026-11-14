"""
The ``course_drip_edit`` tool — drip (content release) rules for courses that
are not live yet, for the Assistant and the MCP server.

Drip lives in ONE institute-wide blob: ``COURSE_SETTING.data.dripConditions``,
read and enforced by the learner app. admin-core's save REPLACES the whole
setting, so every write here is read → change only ``dripConditions.conditions``
→ write back. Validation mirrors the dashboard's ``validateDripCondition``.

Safety (no confirm card over MCP):

* only courses that are NOT ACTIVE (no live learners) can be changed;
* the institute switches ``enabled`` and ``applyConfiguredRules`` are never
  flipped — they would wake dormant rules on other courses; the result says
  when they are off and where to turn them on.

Actions
    set_rules     add/replace the rule on one item (course, chapter or slide)
    schedule      day-wise release: chapter i (or slide i) unlocks on day start + i*interval
    remove_rules  drop the rules on the given items
"""
from __future__ import annotations

import json
import logging
import random
import string
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

DRIP_TOOL_NAME = "course_drip_edit"
DRIP_GROUP_KEY = "course_drip_edits"
DRIP_ACTIONS = ("set_rules", "schedule", "remove_rules")

LEVELS = ("package", "chapter", "slide")
BEHAVIORS = ("lock", "hide", "both")
RULE_TYPES = ("date_based", "relative_date", "completion_based", "prerequisite", "sequential")
TIME_RULES = ("date_based", "relative_date")

COURSE_SETTINGS_PATH = "/settings?selectedTab=course"


DRIP_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": DRIP_TOOL_NAME,
        "description": (
            "Set drip (content release) rules on a course that is not live yet (DRAFT / IN_REVIEW). "
            "Read courses(action='drip') first. Pick an `action`:\n"
            "- set_rules (course_id, items:[{level, id?, target?, behavior?, rules:[RULE]}]): add or replace the rule "
            "on each item. level: package (the whole course — `target` says which level its rules apply to: "
            "chapter or slide), chapter or slide (id from courses(get)). behavior: lock (visible, locked — default), "
            "hide, or both.\n"
            "- schedule (course_id, level: chapter|slide, start_day?=1, interval_days?=1, unlock_time?='00:00', "
            "anchor?: enrollment|session_start, behavior?): one chapter (or slide) per interval, counted from each "
            "learner's enrollment. Replaces earlier rules on those items.\n"
            "- remove_rules (course_id, items:[{level, id?}]).\n"
            "RULE = {type, params}:\n"
            "  date_based      {unlock_date: ISO date-time}\n"
            "  relative_date   {unlock_on_day: int ≥1 (day 1 = enrollment day), anchor?: enrollment|session_start, unlock_time?: 'HH:mm'}\n"
            "  sequential      {requires_previous: true, threshold: 0-100 (% of the previous item completed)}\n"
            "  prerequisite    {required_chapters?: [id], required_slides?: [id], threshold: 0-100}\n"
            "  completion_based {metric: average_of_last_n|average_of_all, count?: int (for last_n), threshold: 0-100}\n"
            "All rules of one item must pass. Time rules always apply; progress rules (sequential, prerequisite, "
            "completion_based) apply only when the institute enables 'apply configured rules' in course settings."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(DRIP_ACTIONS)},
                "course_id": {"type": "string"},
                "items": {"type": "array", "items": {"type": "object"},
                          "description": "set_rules / remove_rules: [{level, id?, target?, behavior?, rules?}]"},
                "level": {"type": "string", "enum": ["chapter", "slide"], "description": "schedule: what is released."},
                "start_day": {"type": "integer"},
                "interval_days": {"type": "integer"},
                "unlock_time": {"type": "string", "description": "HH:mm"},
                "anchor": {"type": "string", "enum": ["enrollment", "session_start"]},
                "behavior": {"type": "string", "enum": list(BEHAVIORS)},
            },
            "required": ["action", "course_id"],
        },
    },
}


# ── pure helpers (also used by the read tool) ────────────────────────────

def drip_block(settings: Dict[str, Any]) -> Dict[str, Any]:
    block = settings.get("dripConditions") if isinstance(settings, dict) else None
    return block if isinstance(block, dict) else {}


def _new_condition_id() -> str:
    tail = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    return f"drip-{int(time.time() * 1000)}-{tail}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def validate_rule(rule: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """A normalised rule, or (None, problem). Mirrors the dashboard's validateDripCondition."""
    if not isinstance(rule, dict):
        return None, "each rule must be an object {type, params}"
    rtype = str(rule.get("type") or "").strip()
    params = rule.get("params") if isinstance(rule.get("params"), dict) else {
        k: v for k, v in rule.items() if k != "type"}
    if rtype not in RULE_TYPES:
        return None, f"rule type must be one of {', '.join(RULE_TYPES)}"

    def threshold() -> Optional[int]:
        try:
            t = int(params.get("threshold", 100))
        except (TypeError, ValueError):
            return None
        return t if 0 <= t <= 100 else None

    if rtype == "date_based":
        raw = str(params.get("unlock_date") or "").strip()
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None, "date_based needs unlock_date as an ISO date-time"
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return {"type": rtype, "params": {"unlock_date": dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}}, None
    if rtype == "relative_date":
        try:
            day = int(params.get("unlock_on_day"))
        except (TypeError, ValueError):
            return None, "relative_date needs unlock_on_day (integer ≥ 1)"
        if day < 1:
            return None, "unlock_on_day must be ≥ 1 (day 1 = the enrollment day)"
        out: Dict[str, Any] = {"unlock_on_day": day}
        anchor = params.get("anchor") or "enrollment"
        if anchor not in ("enrollment", "session_start"):
            return None, "anchor must be enrollment or session_start"
        out["anchor"] = anchor
        utime = str(params.get("unlock_time") or "00:00")
        if not (len(utime) == 5 and utime[2] == ":" and utime[:2].isdigit() and utime[3:].isdigit()
                and int(utime[:2]) < 24 and int(utime[3:]) < 60):
            return None, "unlock_time must be HH:mm"
        out["unlock_time"] = utime
        return {"type": rtype, "params": out}, None
    t = threshold()
    if t is None:
        return None, "threshold must be an integer 0-100"
    if rtype == "sequential":
        return {"type": rtype, "params": {"requires_previous": True, "threshold": t}}, None
    if rtype == "prerequisite":
        chapters = [str(x) for x in (params.get("required_chapters") or []) if x]
        slides = [str(x) for x in (params.get("required_slides") or []) if x]
        if not chapters and not slides:
            return None, "prerequisite needs required_chapters and/or required_slides"
        out = {"threshold": t}
        if chapters:
            out["required_chapters"] = chapters
        if slides:
            out["required_slides"] = slides
        return {"type": rtype, "params": out}, None
    metric = params.get("metric")
    if metric not in ("average_of_last_n", "average_of_all"):
        return None, "completion_based metric must be average_of_last_n or average_of_all"
    out = {"metric": metric, "threshold": t}
    if metric == "average_of_last_n":
        try:
            count = int(params.get("count"))
        except (TypeError, ValueError):
            return None, "average_of_last_n needs count ≥ 1"
        if count < 1:
            return None, "average_of_last_n needs count ≥ 1"
        out["count"] = count
    return {"type": rtype, "params": out}, None


def build_condition(level: str, level_id: str, target: str, behavior: str,
                    rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    now = _now_iso()
    return {
        "id": _new_condition_id(),
        "level": level,
        "level_id": level_id,
        "enabled": True,
        "created_at": now,
        "updated_at": now,
        "drip_condition": [{"target": target, "behavior": behavior, "is_enabled": True, "rules": rules}],
    }


def upsert_conditions(conditions: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Replace any condition on the same (level, level_id) — two would both apply, first wins."""
    keys = {(c["level"], c["level_id"]) for c in new}
    kept = [c for c in conditions if isinstance(c, dict) and (c.get("level"), c.get("level_id")) not in keys]
    return kept + new


def describe_rule(rule: Dict[str, Any], names: Dict[str, str]) -> str:
    p = rule.get("params") or {}
    t = rule.get("type")
    if t == "date_based":
        return f"unlocks on {p.get('unlock_date')}"
    if t == "relative_date":
        anchor = "enrollment" if p.get("anchor", "enrollment") == "enrollment" else "session start"
        return f"unlocks on day {p.get('unlock_on_day')} after {anchor} at {p.get('unlock_time', '00:00')}"
    if t == "sequential":
        return f"after {p.get('threshold', 100)}% of the previous item"
    if t == "prerequisite":
        req = [names.get(x, x) for x in (p.get("required_chapters") or []) + (p.get("required_slides") or [])]
        return f"after {p.get('threshold', 100)}% of {', '.join(req)}"
    if t == "completion_based":
        scope = f"last {p.get('count')} items" if p.get("metric") == "average_of_last_n" else "all previous items"
        return f"after an average of {p.get('threshold')}% on {scope}"
    return str(t)


def summarize_course_drip(settings: Dict[str, Any], course_id: str, chapter_ids: List[str],
                          slide_ids: List[str], names: Dict[str, str]) -> Dict[str, Any]:
    """The rules touching one course, in plain language, plus the institute switches."""
    block = drip_block(settings)
    ids = {("package", course_id)} | {("chapter", c) for c in chapter_ids} | {("slide", s) for s in slide_ids}
    rules = []
    for c in block.get("conditions") or []:
        if not isinstance(c, dict) or (c.get("level"), c.get("level_id")) not in ids:
            continue
        for cfg in c.get("drip_condition") or []:
            if not isinstance(cfg, dict):
                continue
            rules.append({
                "level": c.get("level"),
                "id": c.get("level_id"),
                "name": names.get(c.get("level_id"), "the whole course" if c.get("level") == "package" else None),
                "applies_to": cfg.get("target"),
                "behavior": cfg.get("behavior"),
                "enabled": bool(c.get("enabled", True)) and bool(cfg.get("is_enabled", True)),
                "rules": [describe_rule(r, names) for r in cfg.get("rules") or [] if isinstance(r, dict)],
            })
    return {
        "institute_drip_enabled": bool(block.get("enabled")),
        "progress_rules_enforced": block.get("applyConfiguredRules") is True,
        "rules": rules,
    }


def switch_notes(block: Dict[str, Any], used_types: List[str]) -> List[str]:
    notes = []
    if not block.get("enabled"):
        notes.append(
            "Drip is switched OFF for this institute, so these rules are saved but not enforced. An admin can "
            f"turn it on under Settings → Course → Drip conditions ({COURSE_SETTINGS_PATH}). It is institute-wide, "
            "so this tool never switches it.")
    if any(t not in TIME_RULES for t in used_types) and block.get("applyConfiguredRules") is not True:
        notes.append(
            "Progress rules (sequential / prerequisite / completion) are saved but only time rules are enforced "
            "until 'Apply configured rules' is turned on in Settings → Course. That switch is institute-wide and "
            "never changed from here.")
    return notes


# ── tool plumbing ────────────────────────────────────────────────────────

def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return cbd.err(code, **extra)


async def _load_course(ctx: ToolContext, course_id: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """(course with tree, None) or (None, error)."""
    course = cbd.course_row(ctx, str(course_id or ""))
    if not course:
        return None, _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    if course["status"] == cbd.STATUS_ACTIVE:
        return None, _err(
            "course_is_live",
            message="This course is live (ACTIVE), so its drip rules can only be changed in the dashboard — "
                    "learners may already depend on them.",
            editor_url=cbd.course_editor_url(ctx, course["id"]),
        )
    batch = cbd.active_batch_id(ctx, course["id"])
    tree = cbd.course_tree(ctx, course["id"], batch) if batch else []
    chapters = cbd.flatten_chapters(tree)
    course["chapters"] = chapters
    course["chapter_ids"] = [c["id"] for c in chapters]
    course["slide_ids"] = [s["id"] for c in chapters for s in c.get("slides") or []]
    return course, None


def _resolve_item(course: Dict[str, Any], item: Dict[str, Any]) -> Tuple[Optional[Tuple[str, str]], Optional[str]]:
    level = str(item.get("level") or "").lower()
    if level in ("course", "package"):
        return ("package", course["id"]), None
    if level not in ("chapter", "slide"):
        return None, "level must be package (the course), chapter or slide"
    item_id = str(item.get("id") or "")
    pool = course["chapter_ids"] if level == "chapter" else course["slide_ids"]
    if item_id not in pool:
        return None, f"{level} '{item_id}' is not part of this course (ids come from courses(action='get'))"
    return (level, item_id), None


async def _save(ctx: ToolContext, settings: Dict[str, Any], conditions: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    block = dict(drip_block(settings))
    block["conditions"] = conditions  # `enabled` / `applyConfiguredRules` pass through untouched
    saved = await cbd.save_course_settings(ctx, {**settings, "dripConditions": block})
    if cbd.is_error(saved):
        return _err("save_failed", message="The drip rules could not be saved.", detail=saved.get("message"))
    return None


async def _action_set_rules(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    items = args.get("items")
    if not isinstance(items, list) or not items:
        return _err("missing_argument", action="set_rules", needs=["items"])
    course, error = await _load_course(ctx, args.get("course_id"))
    if error:
        return error
    new, used_types, problems = [], [], []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            problems.append(f"item {i + 1}: must be an object")
            continue
        key, problem = _resolve_item(course, item)
        if problem:
            problems.append(f"item {i + 1}: {problem}")
            continue
        level, level_id = key
        target = str(item.get("target") or ("chapter" if level == "package" else level)).lower()
        if target not in ("chapter", "slide"):
            problems.append(f"item {i + 1}: target must be chapter or slide")
            continue
        behavior = str(item.get("behavior") or "lock").lower()
        if behavior not in BEHAVIORS:
            problems.append(f"item {i + 1}: behavior must be lock, hide or both")
            continue
        raw_rules = item.get("rules")
        if not isinstance(raw_rules, list) or not raw_rules:
            problems.append(f"item {i + 1}: needs at least one rule")
            continue
        rules = []
        for r in raw_rules:
            norm, problem = validate_rule(r)
            if problem:
                problems.append(f"item {i + 1}: {problem}")
                break
            rules.append(norm)
            used_types.append(norm["type"])
        else:
            new.append(build_condition(level, level_id, target, behavior, rules))
    if problems:
        return _err("invalid_rules", problems=problems, message="Nothing was saved. Fix these and resend.")
    settings = await cbd.load_course_settings(ctx)
    if cbd.is_error(settings):
        return _err("settings_unavailable", message="The institute's course settings could not be read; nothing was saved.")
    conditions = upsert_conditions(list(drip_block(settings).get("conditions") or []), new)
    if (failure := await _save(ctx, settings, conditions)):
        return failure
    names = _names(course)
    return {
        "course": {"id": course["id"], "name": course["name"]},
        "saved": [{"level": c["level"], "name": names.get(c["level_id"], "the whole course"),
                   "rules": [describe_rule(r, names) for r in c["drip_condition"][0]["rules"]]} for c in new],
        "notes": switch_notes(drip_block(settings), used_types),
        "editor_url": cbd.course_editor_url(ctx, course["id"]),
    }


async def _action_schedule(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, error = await _load_course(ctx, args.get("course_id"))
    if error:
        return error
    level = str(args.get("level") or "chapter").lower()
    if level not in ("chapter", "slide"):
        return _err("bad_request", message="level must be chapter or slide")
    try:
        start = int(args.get("start_day") or 1)
        interval = int(args.get("interval_days") or 1)
    except (TypeError, ValueError):
        return _err("bad_request", message="start_day and interval_days must be integers")
    if start < 1 or interval < 0:
        return _err("bad_request", message="start_day must be ≥ 1 and interval_days ≥ 0")
    behavior = str(args.get("behavior") or "lock").lower()
    if behavior not in BEHAVIORS:
        return _err("bad_request", message="behavior must be lock, hide or both")
    targets = course["chapter_ids"] if level == "chapter" else course["slide_ids"]
    if not targets:
        return _err("nothing_to_schedule", message=f"This course has no {level}s yet.")
    new = []
    names = _names(course)
    plan = []
    for i, item_id in enumerate(targets):
        rule, problem = validate_rule({"type": "relative_date", "params": {
            "unlock_on_day": start + i * interval,
            "anchor": args.get("anchor") or "enrollment",
            "unlock_time": args.get("unlock_time") or "00:00",
        }})
        if problem:
            return _err("bad_request", message=problem)
        new.append(build_condition(level, item_id, level, behavior, [rule]))
        plan.append({"name": names.get(item_id), "day": start + i * interval})
    settings = await cbd.load_course_settings(ctx)
    if cbd.is_error(settings):
        return _err("settings_unavailable", message="The institute's course settings could not be read; nothing was saved.")
    conditions = upsert_conditions(list(drip_block(settings).get("conditions") or []), new)
    if (failure := await _save(ctx, settings, conditions)):
        return failure
    return {
        "course": {"id": course["id"], "name": course["name"]},
        "schedule": plan,
        "notes": switch_notes(drip_block(settings), ["relative_date"]),
        "editor_url": cbd.course_editor_url(ctx, course["id"]),
    }


async def _action_remove_rules(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    items = args.get("items")
    if not isinstance(items, list) or not items:
        return _err("missing_argument", action="remove_rules", needs=["items"])
    course, error = await _load_course(ctx, args.get("course_id"))
    if error:
        return error
    keys, problems = set(), []
    for i, item in enumerate(items):
        key, problem = _resolve_item(course, item if isinstance(item, dict) else {})
        if problem:
            problems.append(f"item {i + 1}: {problem}")
        else:
            keys.add(key)
    if problems:
        return _err("invalid_items", problems=problems, message="Nothing was removed.")
    settings = await cbd.load_course_settings(ctx)
    if cbd.is_error(settings):
        return _err("settings_unavailable", message="The institute's course settings could not be read; nothing was removed.")
    existing = list(drip_block(settings).get("conditions") or [])
    kept = [c for c in existing if not (isinstance(c, dict) and (c.get("level"), c.get("level_id")) in keys)]
    removed = len(existing) - len(kept)
    if removed and (failure := await _save(ctx, settings, kept)):
        return failure
    return {"course": {"id": course["id"], "name": course["name"]}, "removed": removed}


def _names(course: Dict[str, Any]) -> Dict[str, str]:
    names = {course["id"]: course["name"]}
    for c in course.get("chapters") or []:
        names[c["id"]] = c["name"]
        for s in c.get("slides") or []:
            names[s["id"]] = s["title"]
    return names


_ACTIONS = {"set_rules": _action_set_rules, "schedule": _action_schedule, "remove_rules": _action_remove_rules}


async def execute_course_drip_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(DRIP_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


DRIP_TOOLS: Dict[str, ToolSpec] = {
    DRIP_TOOL_NAME: ToolSpec(
        name=DRIP_TOOL_NAME,
        schema=DRIP_EDIT_SCHEMA,
        executor=execute_course_drip_edit,
        required_permission=None,
        setting_key=DRIP_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(DRIP_TOOLS)
    GROUP_LABELS.update({DRIP_GROUP_KEY: "Courses: drip rules"})


_register()

__all__ = [
    "DRIP_TOOLS", "DRIP_TOOL_NAME", "DRIP_GROUP_KEY", "DRIP_ACTIONS", "DRIP_EDIT_SCHEMA",
    "execute_course_drip_edit", "validate_rule", "build_condition", "upsert_conditions",
    "summarize_course_drip", "describe_rule", "drip_block", "switch_notes",
]
