"""
Generate the tool reference of the MCP docs (vacademy-docs/mcp-server/) from the code.

The MCP server is the "MCP server" product of the Vacademy docs site
(vacademy-docs/, published from the Vacademy-io/docs repo). One page per
settings area (mcp-server/tools/<area>.mdx), that product's Tools tab in docs.json and
the reference list at the end of mcp-server/tools/catalogue.mdx all come
from the same catalogue the settings page renders (adapter.tool_catalog), the
tools' own schemas, MCP_ALLOWED_WRITE_TOOLS and, where a tool module has one,
its ACTION_SPEC. Nothing here is hand-written per tool, so the docs cannot
drift from what the server exposes: tests/test_mcp_docs_in_sync.py regenerates
in memory and fails when the committed files differ.

    cd ai_service && python scripts/gen_mcp_docs.py          # write
    cd ai_service && python scripts/gen_mcp_docs.py --check  # exit 1 when stale
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "vacademy-docs"
#: Where the MCP pages live inside the site, and the product they sit under.
PREFIX = "mcp-server/"
PRODUCT = "MCP server"
sys.path.insert(0, str(ROOT / "ai_service"))

#: Areas whose pages sit under the CRM group of the Tools tab.
CRM_AREAS = ("crm_leads", "crm_calls", "crm_meetings", "crm_messages", "crm_reports")

#: The settings page's risk labels, in plain words (keep in step with settings/risk-levels.mdx).
RISK_TEXT = {
    "drafts": "Drafts only — nothing goes live until someone publishes it in the admin portal.",
    "additive": "Adds only — never changes or removes what exists.",
    "not_live": "Only touches courses that are not live yet.",
    "live_additive": "Adds to live records — what it adds is visible straight away.",
    "live": "Changes live data — the change applies straight away.",
    "outbound": "Calls or messages leads, or sends them invites — always after you confirm.",
}

CONFIRM_TEXT = {
    "none": "Saved straight away",
    "edit_token": "Preview, then your yes",
    "single_use": "Preview, then your yes (single use)",
}

GEN_START = "{/* generated:tools:start — do not edit by hand; run ai_service/scripts/gen_mcp_docs.py */}"
GEN_END = "{/* generated:tools:end */}"


def _mdx(text: Any) -> str:
    """Plain text made safe for MDX prose and table cells."""
    s = str(text or "").replace("\r", "")
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = s.replace("{", "&#123;").replace("}", "&#125;")
    return s


def _cell(text: Any) -> str:
    return _mdx(text).replace("|", "\\|").replace("\n", " ").strip()


def _slug(area: str) -> str:
    return area.replace("_", "-")


def _action_specs(spec: Any) -> Dict[str, Dict[str, Any]]:
    """The tool module's ACTION_SPEC (flat {action: meta} or {tool: {action: meta}}), else {}."""
    module = sys.modules.get(getattr(spec.executor, "__module__", "") or "")
    found = getattr(module, "ACTION_SPEC", None) if module else None
    if not isinstance(found, dict):
        return {}
    nested = found.get(spec.name)
    if isinstance(nested, dict) and all(isinstance(v, dict) for v in nested.values()):
        return nested
    return {k: v for k, v in found.items() if isinstance(v, dict)}


def _action_lines(description: str, actions: List[str]) -> Dict[str, str]:
    """Fallback per-action text: the description's '- action: …' bullet for that action."""
    out: Dict[str, str] = {}
    for line in description.splitlines():
        m = re.match(r"^\s*[-•*]\s*`?([a-z_]+)`?(?:\s*\([^)]*\))?\s*[:—-]\s*(.+)$", line)
        if m and m.group(1) in actions and m.group(1) not in out:
            out[m.group(1)] = m.group(2).strip()
    return out


def _param_type(prop: Dict[str, Any]) -> str:
    t = prop.get("type")
    if isinstance(t, list):
        t = " | ".join(str(x) for x in t)
    if t == "array":
        inner = (prop.get("items") or {}).get("type") or "any"
        return f"{inner}[]"
    return str(t or "any")


def _params(schema: Dict[str, Any]) -> List[str]:
    params = (schema.get("function") or {}).get("parameters") or {}
    props = params.get("properties") or {}
    required = set(params.get("required") or [])
    out = []
    for name, prop in props.items():
        if not isinstance(prop, dict):
            continue
        desc = _mdx(prop.get("description") or "")
        enum = prop.get("enum")
        if enum:
            desc += (" " if desc else "") + ("The action to run: " if name == "action" else "One of: ") + \
                ", ".join(f"`{e}`" for e in enum) + "."
        req = " required" if name in required else ""
        out.append(f'<ParamField path="{name}" type="{_param_type(prop)}"{req}>\n  {desc or "—"}\n</ParamField>')
    return out


def _tool_section(entry: Dict[str, Any], spec: Any, write_reasons: Dict[str, str]) -> str:
    fn = spec.schema.get("function") or {}
    description = fn.get("description") or ""
    actions: List[str] = entry["actions"]
    meta = _action_specs(spec)
    fallback = _action_lines(description, actions)
    lines = [f"## `{entry['name']}`", ""]
    badges = ["Read only" if entry["mode"] == "READ" else "Makes changes"]
    if entry.get("risk"):
        badges.append(_cell(RISK_TEXT.get(entry["risk"], entry["risk"])))
    if entry.get("opt_in"):
        badges.append("Turned on separately (opt-in)")
    if entry.get("always_on"):
        badges.append("Always on")
    lines += [f"**{_cell(entry['label'])}** · " + " · ".join(badges), "", _mdx(entry["summary"]), ""]
    if entry["name"] in write_reasons:
        lines += ["<Note>", f"**What keeps it safe:** {_mdx(write_reasons[entry['name']])}", "</Note>", ""]
    if actions:
        if meta:
            lines += ["| Action | What it does | Changes data | How it applies |", "| :--- | :--- | :--- | :--- |"]
            for a in actions:
                m = meta.get(a) or {}
                summary = m.get("summary") or fallback.get(a) or ""
                if m.get("admin_only"):
                    summary = f"{summary} *(institute admins only)*".strip()
                writes = "Yes" if m.get("writes") else "No"
                how = CONFIRM_TEXT.get(str(m.get("confirm") or "none"), "") if m.get("writes") else "—"
                lines.append(f"| `{a}` | {_cell(summary)} | {writes} | {how} |")
        else:
            lines += ["| Action | What it does |", "| :--- | :--- |"]
            for a in actions:
                lines.append(f"| `{a}` | {_cell(fallback.get(a) or '')} |")
        lines.append("")
    params = _params(spec.schema)
    if params:
        lines += ["<Accordion title=\"Parameters\">", "", *params, "", "</Accordion>", ""]
    lines += ["<Accordion title=\"What your AI app is told about this tool\">", "", "```text",
              description.replace("```", "'''"), "```", "", "</Accordion>", ""]
    return "\n".join(lines)


def build() -> Dict[str, str]:
    """{relative path under vacademy-docs/: content} for every generated file."""
    from app.mcp.adapter import exposed_specs, tool_catalog
    from app.mcp.constants import MCP_ALLOWED_WRITE_TOOLS, MCP_TOOL_AREAS

    catalog = tool_catalog(include_opt_in=True)
    specs = {s.name: s for s in exposed_specs()}
    by_area: Dict[str, List[Dict[str, Any]]] = {}
    for entry in catalog:
        by_area.setdefault(entry["area"], []).append(entry)

    files: Dict[str, str] = {}
    pages: List[Tuple[str, str, str]] = []           # (area, page path, title)
    for area in sorted(by_area, key=lambda a: (list(MCP_TOOL_AREAS).index(a) if a in MCP_TOOL_AREAS else 99, a)):
        info = MCP_TOOL_AREAS.get(area) or {"label": area, "summary": ""}
        entries = sorted(by_area[area], key=lambda e: (e["level"] != "view", e["name"]))
        page = f"{PREFIX}tools/{_slug(area)}"
        title = info["label"]
        body = [
            "---",
            f"title: {json.dumps(title)}",
            f"description: {json.dumps(info['summary'] or title)}",
            "---",
            "",
            "{/* Generated by ai_service/scripts/gen_mcp_docs.py from the server's tool registry. Do not edit. */}",
            "",
            "Each tool below is one switch in **Settings → MCP Server**. Your AI app sees a tool only when it is "
            "switched on for your role; every call is checked again on the server.",
            "",
        ]
        if area in CRM_AREAS:
            body += ["<Info>",
                     "CRM tools need the CRM in your institute's plan. Each person sees only the leads their admin "
                     "portal shows them. Anything that changes a lead, calls or messages someone shows you a "
                     f"preview first and waits for your yes — see [Confirmations](/{PREFIX}usage/confirmations).",
                     "</Info>", ""]
        for entry in entries:
            spec = specs.get(entry["name"])
            if spec is not None:
                body.append(_tool_section(entry, spec, MCP_ALLOWED_WRITE_TOOLS))
        files[f"{page}.mdx"] = "\n".join(body).rstrip() + "\n"
        pages.append((area, page, title))

    # docs.json: the Tools tab of the MCP product.
    docs = json.loads((DOCS / "docs.json").read_text())
    product = next(p for p in docs["navigation"]["products"] if p.get("product") == PRODUCT)
    for tab in product["tabs"]:
        if tab.get("tab") == "Tools":
            tab["groups"] = [
                {"group": "Overview", "pages": [f"{PREFIX}tools/catalogue"]},
                {"group": "LMS", "pages": [p for a, p, _ in pages if a not in CRM_AREAS]},
                {"group": "CRM", "pages": [p for a, p, _ in pages if a in CRM_AREAS]},
            ]
    files["docs.json"] = json.dumps(docs, indent=2, ensure_ascii=False) + "\n"

    # tools/catalogue.mdx: the reference list between the markers.
    catalogue = (DOCS / f"{PREFIX}tools/catalogue.mdx").read_text()
    listing = [GEN_START, "", "| Area | Tools |", "| :--- | :--- |"]
    for area, page, title in pages:
        names = ", ".join(f"`{e['name']}`" for e in sorted(by_area[area], key=lambda e: (e["level"] != "view",
                                                                                          e["name"])))
        listing.append(f"| [{_cell(title)}](/{page}) | {names} |")
    listing += ["", GEN_END]
    block = "\n".join(listing)
    if GEN_START in catalogue and GEN_END in catalogue:
        head, rest = catalogue.split(GEN_START, 1)
        tail = rest.split(GEN_END, 1)[1]
        catalogue = head + block + tail
    else:
        catalogue = catalogue.rstrip() + "\n\n" + block + "\n"
    files[f"{PREFIX}tools/catalogue.mdx"] = catalogue
    return files


def main(argv: List[str]) -> int:
    files = build()
    stale = [p for p, text in files.items()
             if not (DOCS / p).exists() or (DOCS / p).read_text() != text]
    if "--check" in argv:
        for p in stale:
            print(f"stale: vacademy-docs/{p}")
        return 1 if stale else 0
    for p in stale:
        target = DOCS / p
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(files[p])
        print(f"wrote vacademy-docs/{p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
