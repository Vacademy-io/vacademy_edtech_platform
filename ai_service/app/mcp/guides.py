"""
MCP prompts and resources: the design playbook and the design patterns, for
clients that surface them (a slash-command prompt, an attachable resource).

The same content is always reachable as tool actions — website(action='playbook')
and website(action='patterns') — because many clients ignore prompts and
resources. Nothing here reads institute data; whether a caller may see it is the
`website` tool's own gate, decided by the server before these are called.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from mcp.shared.exceptions import MCPError
from mcp.types import (
    INVALID_PARAMS,
    GetPromptResult,
    Prompt,
    PromptArgument,
    PromptMessage,
    ReadResourceResult,
    Resource,
    ResourceTemplate,
    TextContent,
    TextResourceContents,
)

FIGMA_PROMPT = "figma_to_site"
PLAYBOOK_URI = "vacademy://playbook/{source}"
PATTERN_URI_PREFIX = "vacademy://patterns/"
PATTERN_URI_TEMPLATE = PATTERN_URI_PREFIX + "{id}"

_PROMPT_DESCRIPTION = (
    "Rebuild a Figma design as a draft website for this institute: the step-by-step playbook (Figma call budget, "
    "tokens, pattern matching, data questions, fidelity loop) using this server's website tools."
)


def _catalog() -> Dict[str, Any]:
    from ..services.assistant_tools_website_edit import authoring_catalog
    return authoring_catalog()


def list_prompts() -> List[Prompt]:
    return [
        Prompt(
            name=FIGMA_PROMPT,
            title="Figma design → website",
            description=_PROMPT_DESCRIPTION,
            arguments=[
                PromptArgument(
                    name="figma_url",
                    description="The figma.com link to the file or frame (optional).",
                    required=False,
                )
            ],
        )
    ]


_FIGMA_PATH_RE = re.compile(r"^/(design|file|proto|board|make)/([A-Za-z0-9]{10,64})(?:/|$)")


def _figma_link(raw: Any) -> str:
    """
    Only a figma.com https file link survives, rebuilt as
    https://www.figma.com/<kind>/<file key>[?node-id=…]. The link goes into the
    prompt verbatim, so nothing free-form survives: no other query parameter and
    no path text, not even the file-name slug (Figma opens the file without it).
    """
    from ..services.assistant_tools_website_edit import clean_design_source
    design = clean_design_source(str(raw or "").strip()[:2000]) if raw else None
    if not design or design.get("kind") != "figma" or not design.get("url"):
        return ""
    m = _FIGMA_PATH_RE.match(urlsplit(design["url"]).path or "")
    if not m:
        return ""
    link = f"https://www.figma.com/{m.group(1)}/{m.group(2)}"
    if design.get("nodeId"):
        link += "?node-id=" + design["nodeId"].replace(":", "-")
    return link


def get_prompt(name: str, arguments: Optional[Dict[str, Any]]) -> GetPromptResult:
    from ..services.website_playbook import playbook_markdown
    if name != FIGMA_PROMPT:
        raise MCPError(code=INVALID_PARAMS, message=f"Unknown prompt: {name}")
    raw_url = (arguments or {}).get("figma_url")
    link = _figma_link(raw_url)
    text = playbook_markdown("figma", _catalog(), figma_url=link)
    if raw_url and not link:
        text += "\n\n(The link given was not a figma.com design link; ask the admin for it.)"
    text += "\n\nStart now: call whoami, then website(action='playbook', source='figma') and follow it."
    return GetPromptResult(
        description=_PROMPT_DESCRIPTION,
        messages=[PromptMessage(role="user", content=TextContent(type="text", text=text))],
    )


def list_resources() -> List[Resource]:
    from ..services.website_playbook import PLAYBOOK_SOURCES
    return [
        Resource(
            name=f"playbook-{source}",
            title=f"Design playbook ({source})",
            uri=PLAYBOOK_URI.format(source=source),
            description=f"Steps to rebuild a {source} design as a draft website, with the Figma → pattern table.",
            mime_type="text/markdown",
        )
        for source in PLAYBOOK_SOURCES
    ]


def list_resource_templates() -> List[ResourceTemplate]:
    return [
        ResourceTemplate(
            name="design-pattern",
            title="Design pattern",
            uri_template=PATTERN_URI_TEMPLATE,
            description="One design pattern (e.g. catalog.hero): what it looks like, Figma cues, the data it needs, "
                        "its minimal and full JSON. Ids: website(action='patterns').",
            mime_type="application/json",
        )
    ]


def read_resource(uri: str) -> ReadResourceResult:
    from ..services.assistant_tools_website import pattern_resource
    from ..services.website_playbook import PLAYBOOK_SOURCES, playbook_markdown
    uri = str(uri)
    for source in PLAYBOOK_SOURCES:
        if uri == PLAYBOOK_URI.format(source=source):
            return ReadResourceResult(contents=[
                TextResourceContents(uri=uri, mime_type="text/markdown", text=playbook_markdown(source, _catalog()))
            ])
    if uri.startswith(PATTERN_URI_PREFIX):
        payload = pattern_resource(uri[len(PATTERN_URI_PREFIX):], _catalog())
        if payload is not None:
            return ReadResourceResult(contents=[
                TextResourceContents(uri=uri, mime_type="application/json",
                                     text=json.dumps(payload, ensure_ascii=False))
            ])
    raise MCPError(code=INVALID_PARAMS, message="Unknown resource.", data={"uri": uri[:200]})


__all__ = [
    "FIGMA_PROMPT",
    "PATTERN_URI_TEMPLATE",
    "PLAYBOOK_URI",
    "get_prompt",
    "list_prompts",
    "list_resource_templates",
    "list_resources",
    "read_resource",
]
