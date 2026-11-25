"""
The ``catalog_folder_edit`` tool — CHANGE the folders of a folder library the
way an admin does in Manage Pages → Folders: create a folder under an exact
parent, rename it / change its text, image or visibility, move it, delete it.

Actions:

    create_folder   a folder under an exact parent (parent_id / parent_path /
                    top_level). Titles repeat across a library ('2026' under
                    Weekly and under Monthly), so the parent is named by id or
                    by its path, never by a derived key. Shown (ACTIVE) unless
                    hidden=true. A sibling with the same title is refused.
    update_folder   only the fields that differ: title, subtitle, description,
                    image, tagline, button label, link, accent colour, coming
                    soon, course tag, lead campaign, and visible (show / hide).
    move_folder     into another folder or to the top level, at a position;
                    never inside itself, never past the nesting limit.
    delete_folder   the folder and everything under it (admin-core deletes the
                    subtree). The product pages hung in it and their courses are
                    NOT deleted — they are only no longer in the folder. The
                    result carries the removed items so they can be put back.

Product decision 2026-11-25: an admin asked for folders to be created, edited
and deleted from the AI app too, not only added. These are live changes, so
the tool is its own opt-in group (Website → "Change folders", risk live, off
until an admin turns it on, never with an area's Edit level) and MCP-only, and
every action is a dry run unless dry_run=false with the plan_token of a dry
run of the same call (catalog_data_edit's tokens: 10 minutes, refused when the
folders changed since). It never deletes, renames or activates a product page
and never touches a course; catalog_data_edit puts pages and courses into
folders.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from .assistant_tool_registry import ToolContext, ToolSpec, _admin_core_json
from .assistant_tools_catalog_data_edit import (
    _MAX_DEPTH,
    _MAX_LIBRARY_NODES,
    _NODE_FIELDS,
    _clean_node,
    _dry_run,
    _dry_run_result,
    _folder_trail,
    _folders_url,
    _MAX_SLUG,
    _norm_title,
    _page_ref,
    _path_segments,
    _resolve_folder,
    _secret_args,
    _str,
    _trail_text,
    check_plan_token,
    library_live_sites,
    load_library_tree,
    load_pages_light,
    slugify,
)
from .website_data import _err, _is_error

logger = logging.getLogger(__name__)

CATALOG_FOLDER_EDIT_TOOL_NAME = "catalog_folder_edit"
#: Its own opt-in settings group: off for every institute and connection until an admin turns it on.
CATALOG_FOLDER_EDIT_GROUP_KEY = "website_folder_changes"
CATALOG_FOLDER_EDIT_ACTIONS = ("create_folder", "update_folder", "move_folder", "delete_folder")
#: The ONLY admin-core writes this tool sends (pinned by a test).
WRITE_ENDPOINTS = {
    "create_folder": ("POST", "/admin-core-service/v1/folder-library/node"),
    "update_folder": ("PUT", "/admin-core-service/v1/folder-library/node"),
    "move_folder": ("POST", "/admin-core-service/v1/folder-library/node/move"),
    "delete_folder": ("DELETE", "/admin-core-service/v1/folder-library/node"),
}
#: Fields update_folder / create_folder take besides the folder's place (catalog_data_edit's folder fields).
_FIELDS = tuple(_NODE_FIELDS)
_FOLDER_REF_ARGS = {"library_id", "folder_id", "folder_path"}
_ACTION_ARGS = {
    "create_folder": {"library_id", "parent_id", "parent_path", "top_level", "hidden", "slug", *_FIELDS},
    "update_folder": _FOLDER_REF_ARGS | {"visible", *_FIELDS},
    "move_folder": _FOLDER_REF_ARGS | {"to_parent_id", "to_parent_path", "to_top_level", "position"},
    "delete_folder": _FOLDER_REF_ARGS,
}
_COMMON_ARGS = {"action", "dry_run", "plan_token", "user_id", "institute_id"}
#: Tree fields that are not the item's own data (left out of a delete's snapshot).
_NOT_SNAPSHOT = {"children", "product_page_code", "product_page_name", "product_page_status"}

_FOLDER_TEXT = ("Name the folder by folder_id (website(action='context', library_id=…) lists them) or folder_path: "
                "its titles from the top, or only the last few, e.g. ['Monthly', '2026'] or 'Current Affairs › "
                "Monthly'. An ambiguous path returns the matches to choose from.")
_FIELD_TEXT = ("Folder fields: title, subtitle, description, image_url (an institute asset: website(list_media) / "
               "website_edit(import_image)), tagline, cta (button label), link_url ('/route' or https://…), "
               "accent_color (#hex), coming_soon, course_tag, audience_id (an ACTIVE lead campaign).")

CATALOG_FOLDER_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": CATALOG_FOLDER_EDIT_TOOL_NAME,
        "description": (
            "Change the folders of a folder library (the folders a site's folder browser, stream tabs and mega "
            "menu show) like an admin in Manage Pages → Folders. LIVE: a library a published site uses changes "
            "on the site at once. Every action is a DRY RUN by default: show the admin the plan, then call again "
            "with the SAME arguments, dry_run=false and the plan_token it returned (10 minutes; refused when the "
            "folders changed since). " + _FOLDER_TEXT + "\n"
            "- create_folder (library_id, parent_id | parent_path | top_level=true, title, other fields?, slug?, "
            "hidden?): a folder under that exact parent, shown unless hidden=true; slug sets its link key. A sibling with the same title "
            "is refused. To put a product page or courses in it use catalog_data_edit(create_folder_page / "
            "add_to_folder).\n"
            "- update_folder (library_id, folder, fields to change, visible?): only what differs is sent; "
            "visible=false hides the folder and everything in it, true shows it.\n"
            "- move_folder (library_id, folder, to_parent_id | to_parent_path | to_top_level=true, position?): "
            "position is 1-based among the destination's items (default: last).\n"
            "- delete_folder (library_id, folder): deletes the folder and EVERYTHING under it (sub-folders and the "
            "product-page items). The product pages themselves and their courses are kept — they only leave the "
            "folder. Show the admin the plan's contents first; the result lists what was removed.\n"
            + _FIELD_TEXT + " Never send access tokens or other credentials."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(CATALOG_FOLDER_EDIT_ACTIONS)},
                "dry_run": {"type": "boolean", "description": "Default true: report the change without making it. false = apply (needs plan_token)."},
                "plan_token": {"type": "string", "description": "dry_run=false: the plan_token the dry run of these same arguments returned. Not a credential."},
                "library_id": {"type": "string", "description": "The library (website(data_inventory) folder_libraries)."},
                "folder_id": {"type": "string", "description": "update / move / delete: the folder."},
                "folder_path": {"type": "array", "items": {"type": "string"}, "description": "update / move / delete: the folder's titles (instead of folder_id)."},
                "parent_id": {"type": "string", "description": "create_folder: the parent folder."},
                "parent_path": {"type": "array", "items": {"type": "string"}, "description": "create_folder: the parent's titles (instead of parent_id)."},
                "top_level": {"type": "boolean", "description": "create_folder: at the top of the library."},
                "hidden": {"type": "boolean", "description": "create_folder: create it HIDDEN (default: shown)."},
                "slug": {"type": "string", "description": "create_folder: its link key ([a-z0-9-], unique in the library); default none (made from the title)."},
                "visible": {"type": "boolean", "description": "update_folder: show (true) or hide (false) the folder."},
                "to_parent_id": {"type": "string", "description": "move_folder: the destination folder."},
                "to_parent_path": {"type": "array", "items": {"type": "string"}, "description": "move_folder: the destination's titles."},
                "to_top_level": {"type": "boolean", "description": "move_folder: to the top of the library."},
                "position": {"type": "integer", "description": "move_folder: 1-based position among the destination's items (default: last)."},
                "title": {"type": "string"},
                "subtitle": {"type": "string"},
                "description": {"type": "string"},
                "image_url": {"type": "string"},
                "tagline": {"type": "string"},
                "cta": {"type": "string", "description": "Button label."},
                "link_url": {"type": "string"},
                "accent_color": {"type": "string"},
                "coming_soon": {"type": "boolean"},
                "course_tag": {"type": "string"},
                "audience_id": {"type": "string"},
            },
            "required": ["action"],
        },
    },
}


# ──────────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────────
def _is_folder(node: Optional[Dict[str, Any]]) -> bool:
    return node is not None and str(node.get("node_type") or "FOLDER").upper() == "FOLDER"


def _children(existing: List[Dict[str, Any]], parent_id: Optional[str]) -> List[Dict[str, Any]]:
    out = [n for n in existing if str(n.get("parent_id") or "") == str(parent_id or "")]
    return sorted(out, key=lambda n: (n.get("display_order") if isinstance(n.get("display_order"), int) else 0))


def _subtree(existing: List[Dict[str, Any]], root_id: str) -> List[Dict[str, Any]]:
    out, queue, seen = [], [root_id], set()
    by_id = {str(n["id"]): n for n in existing}
    while queue:
        node_id = queue.pop(0)
        if node_id in seen or node_id not in by_id:
            continue
        seen.add(node_id)
        out.append(by_id[node_id])
        queue.extend(str(c["id"]) for c in _children(existing, node_id))
    return out


def _height(existing: List[Dict[str, Any]], root_id: str) -> int:
    """Levels in the subtree under and including root (a leaf folder = 1)."""
    by_id = {str(n["id"]): n for n in existing}
    best = 0
    for n in _subtree(existing, root_id):
        depth, cur = 0, n
        while cur is not None and depth <= _MAX_DEPTH + 5:
            depth += 1
            if str(cur["id"]) == root_id:
                break
            cur = by_id.get(str(cur.get("parent_id") or ""))
        best = max(best, depth)
    return best


def _same_title_sibling(existing: List[Dict[str, Any]], parent_id: Optional[str], title: str,
                        except_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    want = _norm_title(title)
    return next((n for n in _children(existing, parent_id) if _is_folder(n) and str(n["id"]) != str(except_id or "")
                 and _norm_title(n.get("title")) == want), None)


def _resolve_parent(existing: List[Dict[str, Any]], parent_id: str, segments: List[str], top: bool,
                    what: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """``(parent folder or None for the top level, None)`` or ``(None, error)``."""
    given = sum(1 for v in (parent_id, segments, top) if v)
    if given != 1:
        return None, _err("missing_argument", needs=[f"{what}_id | {what}_path | " + (
            "top_level" if what == "parent" else "to_top_level")], message=(
            f"Name exactly one place: {what}_id, {what}_path (the folder's titles), or the top level."))
    if top:
        return None, None
    return _resolve_folder(existing, parent_id, segments)


async def _live_warning(ctx: ToolContext, library_id: str) -> Optional[str]:
    sites = await library_live_sites(ctx, library_id)
    if sites is None:
        return "Could not check whether a live site uses this library; if one does, it changes at once."
    if sites:
        return "The live site(s) " + ", ".join(s for s in sites if s) + " use this library: this changes them at once."
    return None


def _clean_fields(args: Dict[str, Any], errors: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The folder fields in args, checked by catalog_data_edit's own rules (admin-core's limits)."""
    raw = {k: args[k] for k in _FIELDS if k in args}
    cleaned = _clean_node({"key": "x", **raw}, 0, errors) or {}
    for e in errors:
        e.pop("index", None)
        e.pop("key", None)
    return {k: v for k, v in cleaned.items() if k in _FIELDS}


def _wire(fields: Dict[str, Any]) -> Dict[str, Any]:
    return {_NODE_FIELDS[k]: v for k, v in fields.items()}


def _new_node_id(before: List[Dict[str, Any]], tree: Any, parent_id: Optional[str], title: str) -> Optional[str]:
    from .assistant_tools_catalog_data_edit import _flatten_tree
    known = {str(n["id"]) for n in before}
    roots = tree.get("roots") if isinstance(tree, dict) else None
    for n in _flatten_tree(roots):
        if (str(n["id"]) not in known and str(n.get("parent_id") or "") == str(parent_id or "")
                and _norm_title(n.get("title")) == _norm_title(title)):
            return str(n["id"])
    return None


def _hidden_above(node: Optional[Dict[str, Any]], by_id: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """The path of the nearest HIDDEN folder at or above ``node`` (it hides everything under it), else None."""
    if node is None:
        return None
    trail = _folder_trail(node, by_id)
    hidden = [i for i, n in enumerate(trail) if _str(n.get("status")).upper() == "HIDDEN"]
    return _trail_text(trail[:hidden[-1] + 1]) if hidden else None


def _exposed(existing: List[Dict[str, Any]], root_id: str, pages_by_id: Optional[Dict[str, Dict[str, Any]]] = None
             ) -> Dict[str, Any]:
    """What a site shows under a folder (items that are not HIDDEN themselves, under no HIDDEN folder below it)."""
    shown, queue = [], [root_id]
    while queue:
        cur = queue.pop(0)
        for child in _children(existing, cur):
            if _str(child.get("status")).upper() == "HIDDEN":
                continue
            shown.append(child)
            if _is_folder(child):
                queue.append(str(child["id"]))
    pages = [n for n in shown if not _is_folder(n)]
    out: Dict[str, Any] = {"sub_folders": sum(1 for n in shown if _is_folder(n)), "product_pages": len(pages)}
    if pages_by_id is not None:
        out["active_product_pages"] = [
            _str(pages_by_id[str(n.get("product_page_id"))].get("name")) for n in pages
            if _str(pages_by_id.get(str(n.get("product_page_id") or ""), {}).get("status")).upper() == "ACTIVE"][:30]
    return out


def _write_failed(what: str, data: Any) -> Dict[str, Any]:
    status = data.get("status") if isinstance(data, dict) else None
    return _err("write_failed", message=f"admin-core did not {what}; nothing was changed.",
                **({"status": status} if status else {}))


# ──────────────────────────────────────────────────────────────────────────
# actions
# ──────────────────────────────────────────────────────────────────────────
async def _action_create_folder(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    library_id = _str(args.get("library_id"))
    title = _str(args.get("title"))
    if not title:
        return _err("missing_argument", needs=["title"], message="Pass the new folder's title.")
    hidden = args.get("hidden", False)
    if not isinstance(hidden, bool):
        return _err("invalid_argument", field="hidden", message="hidden is true or false.")
    errors: List[Dict[str, Any]] = []
    fields = _clean_fields(args, errors)
    if errors:
        return _err("invalid_fields", errors=errors, message="Nothing was written. " + _FIELD_TEXT)
    slug = ""
    if args.get("slug") not in (None, ""):
        slug = slugify(_str(args.get("slug")), _MAX_SLUG)
        if not slug or slug != _str(args.get("slug")).lower():
            return _err("invalid_argument", field="slug", message="slug is lower-case letters, digits and hyphens.")

    library, existing, problem = await load_library_tree(ctx, library_id)
    if problem:
        return problem
    if slug and any(_str(n.get("slug")) == slug for n in existing):
        return _err("slug_taken", message=f"Another item of this library already uses the slug '{slug}'.")
    parent, problem = _resolve_parent(existing, _str(args.get("parent_id")), _path_segments(args.get("parent_path")),
                                      args.get("top_level") is True, "parent")
    if problem:
        return problem
    by_id = {str(n["id"]): n for n in existing}
    parent_id = str(parent["id"]) if parent else None
    parent_path = _trail_text(_folder_trail(parent, by_id)) if parent else "(top level)"
    same = _same_title_sibling(existing, parent_id, fields["title"])
    if same is not None:
        return _err("folder_exists", folder={"id": str(same["id"]), "path": _trail_text(_folder_trail(same, by_id))},
                    message=f"'{parent_path}' already has a folder called '{same.get('title')}'; use it "
                            "(update_folder) or choose another title.")
    if len(existing) + 1 > _MAX_LIBRARY_NODES:
        return _err("library_full", message=f"A folder library holds at most {_MAX_LIBRARY_NODES} items.")
    if parent and len(_folder_trail(parent, by_id)) + 1 > _MAX_DEPTH:
        return _err("too_deep", message=f"Folders can be nested at most {_MAX_DEPTH} levels deep.")

    plan: Dict[str, Any] = {
        "library": {"id": library_id, "name": library.get("name")},
        "create": {"parent": parent_path, **fields, **({"slug": slug} if slug else {}),
                   "status": "HIDDEN" if hidden else "ACTIVE", "position": len(_children(existing, parent_id)) + 1},
    }
    warnings = [w for w in [await _live_warning(ctx, library_id)] if w]
    hidden_parent = _hidden_above(parent, by_id)
    if hidden_parent and not hidden:
        warnings.append(f"'{hidden_parent}' is HIDDEN, so the new folder does not show on the site until it is shown.")
    if not hidden:
        warnings.append("An empty folder shows on a site only where its section shows empty folders; it appears "
                        "everywhere once a product page with courses is in it (catalog_data_edit(create_folder_page)).")
    plan["warnings"] = warnings
    if _dry_run(args):
        return _dry_run_result(ctx, "create_folder", args, plan, (
            "Nothing was written. Show the admin where the folder goes; call again with the same arguments, "
            "dry_run=false and this plan_token."))
    refusal = check_plan_token(ctx, "create_folder", args, plan)
    if refusal:
        return refusal
    body = {"node_type": "FOLDER", "status": "HIDDEN" if hidden else "ACTIVE",
            **({"parent_id": parent_id} if parent_id else {}), **({"slug": slug} if slug else {}), **_wire(fields)}
    data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/folder-library/node",
                                  params={"instituteId": ctx.principal.institute_id, "libraryId": library_id},
                                  body=body, timeout=30.0)
    if _is_error(data):
        return _write_failed("create the folder", data)
    new_id = _new_node_id(existing, data, parent_id, fields["title"])
    return {"dry_run": False, "library": plan["library"],
            "folder": {"id": new_id, "path": (parent_path + " › " if parent else "") + fields["title"],
                       "status": body["status"]},
            "dashboard_url": _folders_url(ctx), "warnings": warnings,
            "next": ("Put a product page with courses in it with catalog_data_edit(create_folder_page, folder_id) "
                     "or add_to_folder.")}


async def _action_update_folder(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    library_id = _str(args.get("library_id"))
    visible = args.get("visible")
    if visible is not None and not isinstance(visible, bool):
        return _err("invalid_argument", field="visible", message="visible is true (show) or false (hide).")
    errors: List[Dict[str, Any]] = []
    fields = _clean_fields(args, errors)
    if errors:
        return _err("invalid_fields", errors=errors, message="Nothing was written. " + _FIELD_TEXT)
    if not fields and visible is None:
        return _err("missing_argument", needs=["a field to change"], message="Pass what to change. " + _FIELD_TEXT)

    library, existing, problem = await load_library_tree(ctx, library_id)
    if problem:
        return problem
    folder, problem = _resolve_folder(existing, _str(args.get("folder_id")), _path_segments(args.get("folder_path")))
    if problem:
        return problem
    by_id = {str(n["id"]): n for n in existing}
    path = _trail_text(_folder_trail(folder, by_id))
    changes: Dict[str, Dict[str, Any]] = {}
    for field, value in fields.items():
        before = folder.get(_NODE_FIELDS[field])
        if field == "coming_soon":
            before = bool(before)
        if before == value or (field == "course_tag" and isinstance(before, str) and before.lower() == value):
            continue
        changes[field] = {"before": before, "after": value}
    status_now = _str(folder.get("status")).upper() or "ACTIVE"
    if visible is not None and (status_now != "HIDDEN") != visible:
        changes["visible"] = {"before": status_now != "HIDDEN", "after": visible}
    if "title" in changes:
        same = _same_title_sibling(existing, folder.get("parent_id"), changes["title"]["after"], folder["id"])
        if same is not None:
            return _err("folder_exists", message=f"The same parent already has a folder called '{same.get('title')}'.",
                        folder={"id": str(same["id"]), "path": _trail_text(_folder_trail(same, by_id))})
    if not changes:
        return {"dry_run": _dry_run(args), "folder": {"id": str(folder["id"]), "path": path}, "nothing_to_do": True,
                "message": "The folder already has these values; nothing to change."}
    warnings = [w for w in [await _live_warning(ctx, library_id)] if w]
    no_slug = not _str(folder.get("slug"))
    key_from_subtitle = bool(_str(folder.get("subtitle")))
    if no_slug and ("subtitle" in changes or ("title" in changes and not key_from_subtitle)):
        warnings.append("This folder has no slug, so its link key (?stream=…) is made from its "
                        + ("subtitle" if key_from_subtitle or "subtitle" in changes else "title")
                        + ": links and tabs that use the old key stop matching it.")
        if not _str(folder.get("course_tag")) and "course_tag" not in changes:
            warnings.append("It has no course_tag either, so the course tag it filters by changes too: courses tagged "
                            "with the old key leave its tab (set course_tag to keep them).")
    if changes.get("visible", {}).get("after") is False:
        warnings.append("Hiding a folder hides everything in it (sub-folders and their product pages) on the site.")
    if changes.get("visible", {}).get("after") is True:
        listed = await load_pages_light(ctx)
        pages_by_id = {str(p.get("id")): p for p in listed or [] if p.get("id")} if listed is not None else None
        plan_exposes = _exposed(existing, str(folder["id"]), pages_by_id)
        above = _hidden_above(by_id.get(str(folder.get("parent_id") or "")), by_id)
        warnings.append("Showing it shows what it holds: {sub_folders} sub-folder(s) and {product_pages} product "
                        "page item(s)".format(**plan_exposes)
                        + (", of which ACTIVE pages on sale: " + ", ".join(plan_exposes["active_product_pages"])
                           if plan_exposes.get("active_product_pages") else "") + "."
                        + (" (Could not read which of them are on sale.)" if pages_by_id is None else "")
                        + (f" It stays off the site while '{above}' is HIDDEN." if above else ""))
    plan = {"library": {"id": library_id, "name": library.get("name")},
            "folder": {"id": str(folder["id"]), "path": path}, "changes": changes, "warnings": warnings}
    if _dry_run(args):
        return _dry_run_result(ctx, "update_folder", args, plan, (
            "Nothing was written. Show the admin the before / after; call again with the same arguments, "
            "dry_run=false and this plan_token."))
    refusal = check_plan_token(ctx, "update_folder", args, plan)
    if refusal:
        return refusal
    body = _wire({k: c["after"] for k, c in changes.items() if k != "visible"})
    if "visible" in changes:
        body["status"] = "ACTIVE" if changes["visible"]["after"] else "HIDDEN"
    data = await _admin_core_json(ctx, "PUT", "/admin-core-service/v1/folder-library/node",
                                  params={"instituteId": ctx.principal.institute_id, "nodeId": str(folder["id"])},
                                  body=body, timeout=30.0)
    if _is_error(data):
        return _write_failed("change the folder", data)
    return {"dry_run": False, "folder": plan["folder"], "changed": sorted(changes), "warnings": warnings,
            "dashboard_url": _folders_url(ctx)}


async def _action_move_folder(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    library_id = _str(args.get("library_id"))
    position = args.get("position")
    if position is not None and (not isinstance(position, int) or isinstance(position, bool) or position < 1):
        return _err("invalid_argument", field="position", message="position is 1 or more (1 = first).")
    library, existing, problem = await load_library_tree(ctx, library_id)
    if problem:
        return problem
    folder, problem = _resolve_folder(existing, _str(args.get("folder_id")), _path_segments(args.get("folder_path")))
    if problem:
        return problem
    dest, problem = _resolve_parent(existing, _str(args.get("to_parent_id")), _path_segments(args.get("to_parent_path")),
                                    args.get("to_top_level") is True, "to_parent")
    if problem:
        return problem
    by_id = {str(n["id"]): n for n in existing}
    dest_id = str(dest["id"]) if dest else None
    if dest is not None and any(str(n["id"]) == str(folder["id"]) for n in _folder_trail(dest, by_id)):
        return _err("invalid_move", message="A folder cannot be moved inside itself.")
    if dest is not None and len(_folder_trail(dest, by_id)) + _height(existing, str(folder["id"])) > _MAX_DEPTH:
        return _err("too_deep", message=f"Folders can be nested at most {_MAX_DEPTH} levels deep.")
    same = _same_title_sibling(existing, dest_id, _str(folder.get("title")), folder["id"])
    if same is not None:
        return _err("folder_exists", message=f"The destination already has a folder called '{same.get('title')}'.",
                    folder={"id": str(same["id"]), "path": _trail_text(_folder_trail(same, by_id))})
    siblings = [n for n in _children(existing, dest_id) if str(n["id"]) != str(folder["id"])]
    index = len(siblings) if position is None else min(position - 1, len(siblings))
    current = [str(n["id"]) for n in _children(existing, folder.get("parent_id"))]
    same_place = (str(folder.get("parent_id") or "") == str(dest_id or "")
                  and current.index(str(folder["id"])) == index)
    path = _trail_text(_folder_trail(folder, by_id))
    to_path = _trail_text(_folder_trail(dest, by_id)) if dest else "(top level)"
    if same_place:
        return {"dry_run": _dry_run(args), "folder": {"id": str(folder["id"]), "path": path}, "nothing_to_do": True,
                "message": "The folder is already there."}
    warnings = [w for w in [await _live_warning(ctx, library_id)] if w]
    was_hidden = _hidden_above(by_id.get(str(folder.get("parent_id") or "")), by_id)
    now_hidden = _hidden_above(dest, by_id)
    if _str(folder.get("status")).upper() != "HIDDEN":
        if was_hidden and not now_hidden:
            exposes = _exposed(existing, str(folder["id"]))
            warnings.append(f"It leaves the HIDDEN '{was_hidden}', so it and what it holds ({exposes['sub_folders']} "
                            f"sub-folder(s), {exposes['product_pages']} product page item(s)) show on the site.")
        if now_hidden and not was_hidden:
            warnings.append(f"'{now_hidden}' is HIDDEN, so the folder and everything in it leave the site.")
    if (folder.get("parent_id") is None) != (dest is None):
        warnings.append("It becomes a top-level folder (a stream tab where a section shows the top level)."
                        if dest is None else
                        "It stops being a top-level folder (it leaves the stream tabs that show the top level).")
    plan = {"library": {"id": library_id, "name": library.get("name")},
            "folder": {"id": str(folder["id"]), "path": path},
            "move_to": {"parent": to_path, "position": index + 1}, "warnings": warnings}
    if _dry_run(args):
        return _dry_run_result(ctx, "move_folder", args, plan, (
            "Nothing was written. Show the admin where it moves; call again with the same arguments, dry_run=false "
            "and this plan_token."))
    refusal = check_plan_token(ctx, "move_folder", args, plan)
    if refusal:
        return refusal
    data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/folder-library/node/move",
                                  params={"instituteId": ctx.principal.institute_id, "nodeId": str(folder["id"])},
                                  body={"parent_id": dest_id, "index": index}, timeout=30.0)
    if _is_error(data):
        return _write_failed("move the folder", data)
    return {"dry_run": False, "folder": plan["folder"], "moved_to": plan["move_to"], "warnings": warnings,
            "dashboard_url": _folders_url(ctx)}


async def _action_delete_folder(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    library_id = _str(args.get("library_id"))
    library, existing, problem = await load_library_tree(ctx, library_id)
    if problem:
        return problem
    folder, problem = _resolve_folder(existing, _str(args.get("folder_id")), _path_segments(args.get("folder_path")))
    if problem:
        return problem
    pages = await load_pages_light(ctx)
    if pages is None:
        return _err("fetch_failed", message="Could not read this institute's product pages; nothing was changed.")
    pages_by_id = {str(p.get("id")): p for p in pages if p.get("id")}
    by_id = {str(n["id"]): n for n in existing}
    doomed = _subtree(existing, str(folder["id"]))
    sub_folders = [_trail_text(_folder_trail(n, by_id)) for n in doomed[1:] if _is_folder(n)]
    page_items = []
    for n in doomed:
        if _is_folder(n):
            continue
        page = pages_by_id.get(str(n.get("product_page_id") or ""), {})
        courses = page.get("mapping_count") if isinstance(page.get("mapping_count"), int) else None
        page_items.append({**_page_ref(page), "courses": courses,
                           "in": _trail_text(_folder_trail(by_id.get(str(n.get("parent_id") or "")) or folder, by_id))})
    path = _trail_text(_folder_trail(folder, by_id))
    warnings = [w for w in [await _live_warning(ctx, library_id)] if w]
    if page_items:
        warnings.append(f"{len(page_items)} product page(s) leave the folder, so their courses no longer show "
                        "under it on the site. The pages and courses themselves are NOT deleted (still in Manage "
                        "Pages → Product pages) and can be hung in a folder again (catalog_data_edit"
                        "(create_folder_page, product_page_code)).")
    plan = {"library": {"id": library_id, "name": library.get("name")},
            "delete": {"folder": {"id": str(folder["id"]), "path": path}, "items_removed": len(doomed),
                       "sub_folders": sub_folders[:100], "product_pages_unhung": page_items[:100]},
            "keeps": "Product pages and courses are kept; only the folder and the items in it are removed.",
            "warnings": warnings}
    if _dry_run(args):
        return _dry_run_result(ctx, "delete_folder", args, plan, (
            "Nothing was written. Show the admin EVERYTHING this removes (sub_folders, product_pages_unhung) and get "
            "a clear yes; then call again with the same arguments, dry_run=false and this plan_token."))
    refusal = check_plan_token(ctx, "delete_folder", args, plan)
    if refusal:
        return refusal
    data = await _admin_core_json(ctx, "DELETE", "/admin-core-service/v1/folder-library/node",
                                  params={"instituteId": ctx.principal.institute_id, "nodeId": str(folder["id"])},
                                  timeout=30.0)
    if _is_error(data):
        return _write_failed("delete the folder", data)
    removed = [{k: v for k, v in n.items() if k not in _NOT_SNAPSHOT and v not in (None, "", {}, [])} for n in doomed]
    return {"dry_run": False, "deleted": {"folder": plan["delete"]["folder"],
                                          "items_removed": data.get("deleted") if isinstance(data, dict) and
                                          isinstance(data.get("deleted"), int) else len(doomed)},
            "removed_items": removed[:300],
            "undo": ("removed_items holds every removed item as it was. To put it back, recreate the folders with "
                     "create_folder (parents first; title, slug and the other fields from removed_items — the stored "
                     "cta_label is create_folder's cta) and hang "
                     "each product page again with catalog_data_edit(create_folder_page, product_page_code). A "
                     "folder's display settings (view) are set again in Manage Pages → Folders."),
            "warnings": warnings, "dashboard_url": _folders_url(ctx)}


# ──────────────────────────────────────────────────────────────────────────
# Dispatch + registration
# ──────────────────────────────────────────────────────────────────────────
_ACTIONS = {
    "create_folder": _action_create_folder,
    "update_folder": _action_update_folder,
    "move_folder": _action_move_folder,
    "delete_folder": _action_delete_folder,
}


async def execute_catalog_folder_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    args = args or {}
    secrets = _secret_args({k: v for k, v in args.items() if k not in ("user_id", "institute_id", "plan_token")})
    if secrets:
        return json.dumps(_err("secret_not_accepted", fields=sorted(secrets), message=(
            "Never send access tokens or other credentials to this tool; it acts as the connected admin.")))
    action = _str(args.get("action"))
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(CATALOG_FOLDER_EDIT_ACTIONS), message=(
            "Not an action of this tool. Product pages and courses go into folders with catalog_data_edit."
            if action else "Pass action.")))
    accepted = _ACTION_ARGS[action]
    unknown = sorted(str(k) for k in args if k not in accepted and k not in _COMMON_ARGS)
    if unknown:
        result: Dict[str, Any] = _err("unknown_argument", fields=unknown,
                                      accepted=sorted(accepted | {"dry_run", "plan_token"}),
                                      message=f"{action} does not take " + ", ".join(unknown) + "; nothing was changed.")
    else:
        result = await handler(args, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


CATALOG_FOLDER_EDIT_TOOLS: Dict[str, ToolSpec] = {
    CATALOG_FOLDER_EDIT_TOOL_NAME: ToolSpec(
        name=CATALOG_FOLDER_EDIT_TOOL_NAME,
        schema=CATALOG_FOLDER_EDIT_SCHEMA,
        executor=execute_catalog_folder_edit,
        required_permission=None,
        setting_key=CATALOG_FOLDER_EDIT_GROUP_KEY,
        # Live changes (rename / hide / move / delete): never default-on.
        default_enabled=False,
        default_roles=None,
        # The dashboard's Folders screen does this for the in-product assistant's users.
        mcp_only=True,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    """Self-register into the shared registry (see assistant_tool_registry._load_feature_tools)."""
    from .assistant_tool_registry import ASSISTANT_TOOLS
    ASSISTANT_TOOLS.update(CATALOG_FOLDER_EDIT_TOOLS)


_register()

__all__ = [
    "CATALOG_FOLDER_EDIT_TOOLS", "CATALOG_FOLDER_EDIT_TOOL_NAME", "CATALOG_FOLDER_EDIT_GROUP_KEY",
    "CATALOG_FOLDER_EDIT_ACTIONS", "CATALOG_FOLDER_EDIT_SCHEMA", "WRITE_ENDPOINTS", "execute_catalog_folder_edit",
]
