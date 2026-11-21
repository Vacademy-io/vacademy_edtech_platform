"""OpenAI/OpenRouter chat payload <-> Anthropic Messages API, as pure functions.

Our call sites build OpenRouter-shaped chat payloads (system/user/assistant/
tool messages, `image_url` parts, `tools`, `response_format`, `reasoning`).
When a model is routed to Anthropic directly, the router sends

    POST {base}/v1/messages   body = to_messages_request(payload, wire_model)

and hands the reply back to the call site as OpenAI JSON:

    from_messages_response(body, registry_model)      non-streaming
    StreamTranslator(registry_model).feed(event, data) streaming (SSE events)
    error_to_openai(status, body_text)                 non-2xx replies

so nothing downstream (parsers, billing, model health) can tell which gateway
answered. `model` in every translated reply is the REGISTRY id
(`anthropic/claude-sonnet-4.5`), never the wire id.

What the translation must get right, because the Messages API 400s otherwise:
  * system/developer turns are top-level `system`, not messages;
  * turns alternate user/assistant and the first one is a user turn;
  * every `tool_use` is answered by a `tool_result` in the very next user turn
    (all results of one assistant turn in ONE user turn, results first);
  * `max_tokens` is required;
  * sampling parameters (`temperature`/`top_p`/`top_k`) are refused on the
    newer models, and only one of temperature/top_p is allowed on Claude 4.x;
  * forced tool use (`any`/named tool) is refused on Claude Opus 5.5,
    Sonnet 5.5 and Fable 5.1 / Mythos 5.1;
  * a trailing assistant turn (prefill) is refused from the 4.6 models on.

Extended thinking is never switched on unless the caller explicitly asked for
high effort (`reasoning: {enabled: true, effort: high|xhigh|max}`): thinking is
billed as output. `reasoning: {enabled: false}` turns it off (or as low as the
model allows) on the models that think by default.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

ANTHROPIC_VERSION = "2023-06-01"

# max_tokens when the caller sends none. Anthropic requires one; OpenRouter (the
# path these callers use today) imposes no 4096 cap, so a JSON report that runs
# long must not be cut short here: up to the model's output cap, at most this.
DEFAULT_MAX_TOKENS = 64_000
# ...and for a model whose output cap we do not know.
UNKNOWN_MODEL_DEFAULT_MAX_TOKENS = 32_000
MAX_CACHE_BREAKPOINTS = 4
_MIN_THINKING_BUDGET = 1024

_IMAGE_MEDIA_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp")
_HIGH_EFFORTS = ("high", "xhigh", "max")

# Anthropic stop_reason -> OpenAI finish_reason.
_FINISH_REASONS = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "pause_turn": "stop",
    "max_tokens": "length",
    "model_context_window_exceeded": "length",
    "tool_use": "tool_calls",
    "refusal": "content_filter",
}

# Anthropic error type <-> HTTP status (for stream `error` events, which carry
# no status, and for non-JSON error bodies, which carry no type).
_ERROR_STATUS = {
    "invalid_request_error": 400,
    "authentication_error": 401,
    "billing_error": 402,
    "permission_error": 403,
    "not_found_error": 404,
    "request_too_large": 413,
    "rate_limit_error": 429,
    "api_error": 500,
    "timeout_error": 504,
    "overloaded_error": 529,
}
_STATUS_ERROR = {v: k for k, v in _ERROR_STATUS.items()}

_JSON_INSTRUCTION = (
    "Respond with only a single valid JSON value. Do not wrap it in markdown code "
    "fences and do not add any text before or after it."
)

_FENCE_RE = re.compile(r"^\s*```[A-Za-z0-9_-]*[ \t]*\r?\n?(.*?)\r?\n?[ \t]*```\s*$", re.DOTALL)
_TOOL_ID_BAD_CHARS = re.compile(r"[^A-Za-z0-9_-]")
_DATA_URI_RE = re.compile(r"^data:([^;,]+)?((?:;[^;,]*)*?);base64,(.*)$", re.DOTALL | re.IGNORECASE)
_SERVER_TOOL_TYPE_RE = re.compile(r"_\d{8}$")


# ── Model capabilities ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class ModelCaps:
    """What one Claude model accepts. Keyed by family + version (see caps_for)."""

    sampling: str = "none"          # "both" | "one" (temperature OR top_p) | "none"
    thinking: str = "none"          # "none" | "budget" | "adaptive"
    thinking_default_on: bool = False
    # How to turn thinking off on a model that thinks by default:
    #   "disabled" -> thinking {type: disabled}; "between_tools" -> {type: between_tools};
    #   "effort_low" -> can't be disabled, run at output_config.effort=low.
    thinking_off: str = "disabled"
    efforts: Tuple[str, ...] = ()   # accepted output_config.effort values; () = don't send
    forced_tool_choice: bool = True  # tool_choice any / named tool accepted
    prefill: bool = True             # a trailing assistant turn accepted
    max_output: Optional[int] = None  # None = unknown, don't clamp


_EFFORTS_4_6 = ("low", "medium", "high", "max")
_EFFORTS_ALL = ("low", "medium", "high", "xhigh", "max")

# The conservative default for a model we can't place: no sampling parameters,
# no thinking parameters, no forced tool choice, no prefill.
_UNKNOWN_CAPS = ModelCaps(sampling="none", thinking="none", forced_tool_choice=False, prefill=False)


def _caps_new(major: int, minor: int, family: str) -> ModelCaps:
    """Claude 4.x and later."""
    v = (major, minor)
    if family in ("fable", "mythos"):
        # Thinking always on; can't be disabled. 5.1 refuses forced tool use.
        return ModelCaps(sampling="none", thinking="adaptive", thinking_default_on=True,
                         thinking_off="effort_low", efforts=_EFFORTS_ALL,
                         forced_tool_choice=v < (5, 1), prefill=False, max_output=128_000)
    if major == 4:
        if family == "opus" and minor in (0, 1):
            return ModelCaps(sampling="one", thinking="budget", max_output=32_000)
        if minor <= 5:  # Sonnet 4 / 4.5, Opus 4.5, Haiku 4.5
            return ModelCaps(sampling="one", thinking="budget", max_output=64_000)
        if minor == 6:  # Opus 4.6 / Sonnet 4.6: adaptive, off unless asked
            return ModelCaps(sampling="one", thinking="adaptive", efforts=_EFFORTS_4_6,
                             prefill=False, max_output=128_000)
        # Opus 4.7 / 4.8: no sampling, adaptive off unless asked
        return ModelCaps(sampling="none", thinking="adaptive", efforts=_EFFORTS_ALL,
                         prefill=False, max_output=128_000)
    if major == 5 and minor == 0:  # Opus 5 / Sonnet 5: thinking on by default, can be disabled
        return ModelCaps(sampling="none", thinking="adaptive", thinking_default_on=True,
                         thinking_off="disabled", efforts=_EFFORTS_ALL, prefill=False,
                         max_output=128_000)
    if v == (5, 5) and family == "haiku":
        return ModelCaps(sampling="none", thinking="adaptive", thinking_default_on=True,
                         thinking_off="disabled", efforts=_EFFORTS_ALL, prefill=False,
                         max_output=128_000)
    if v == (5, 5) and family == "sonnet":
        return ModelCaps(sampling="none", thinking="adaptive", thinking_default_on=True,
                         thinking_off="between_tools", efforts=_EFFORTS_ALL,
                         forced_tool_choice=False, prefill=False, max_output=128_000)
    # Opus 5.5 and anything newer we don't know yet: thinking can't be disabled,
    # forced tool use refused (the direction every release since 5.5 has gone).
    return ModelCaps(sampling="none", thinking="adaptive", thinking_default_on=True,
                     thinking_off="effort_low", efforts=_EFFORTS_ALL,
                     forced_tool_choice=False, prefill=False,
                     max_output=128_000 if v == (5, 5) else None)


def _caps_3x(major: int, minor: int, family: str) -> ModelCaps:
    if (major, minor) == (3, 7) and family == "sonnet":
        return ModelCaps(sampling="both", thinking="budget", max_output=64_000)
    if minor == 5:
        return ModelCaps(sampling="both", max_output=8192)
    return ModelCaps(sampling="both", max_output=4096)


_NEW_NAME_RE = re.compile(r"^claude-(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:[-.](\d{1,2}))?(?:-\d{8})?$")
_OLD_NAME_RE = re.compile(r"^claude-(\d)(?:[-.](\d))?-(opus|sonnet|haiku)(?:-\d{8}|-latest)?$")


def _bare_model(model: str) -> str:
    m = (model or "").strip().lower()
    if m.startswith("anthropic/"):
        m = m[len("anthropic/"):]
    m = m.split(":", 1)[0]  # OpenRouter variants: ":beta", ":thinking"
    m = m.split("@", 1)[0]  # Vertex-style "@20251001" snapshots
    return m


def caps_for(model: str) -> ModelCaps:
    """Capabilities of a Claude model, from its wire or registry id."""
    m = _bare_model(model)
    hit = _NEW_NAME_RE.match(m)
    if hit:
        family, major, minor = hit.group(1), int(hit.group(2)), int(hit.group(3) or 0)
        if major >= 4:
            return _caps_new(major, minor, family)
        return _UNKNOWN_CAPS
    hit = _OLD_NAME_RE.match(m)
    if hit:
        return _caps_3x(int(hit.group(1)), int(hit.group(2) or 0), hit.group(3))
    return _UNKNOWN_CAPS


_BARE_4_RE = re.compile(r"^claude-(opus|sonnet|haiku)-4$")


def derive_wire_model(registry_model: str) -> str:
    """Route-map default ([C3]): `anthropic/claude-sonnet-4.5` -> `claude-sonnet-4-5`.
    A Claude 4 id with no minor version (Opus 4, Sonnet 4) takes the `-0` alias
    on the Messages API; the bare form would 404."""
    m = (registry_model or "").strip()
    if m.startswith("anthropic/"):
        m = m[len("anthropic/"):]
    m = m.split(":", 1)[0].replace(".", "-")
    if _BARE_4_RE.match(m):
        m += "-0"
    return m


# ── Request: content parts ──────────────────────────────────────────────────


def _with_cache(block: Dict[str, Any], part: Dict[str, Any]) -> Dict[str, Any]:
    cc = part.get("cache_control")
    if isinstance(cc, dict):
        block["cache_control"] = dict(cc)
    return block


def _text_block(text: Any, part: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if text is None:
        return None
    text = str(text)
    if not text.strip():
        return None  # the Messages API refuses empty / whitespace-only text blocks
    return _with_cache({"type": "text", "text": text}, part or {})


def _image_block(url: str, part: Dict[str, Any]) -> Dict[str, Any]:
    url = (url or "").strip()
    if url.lower().startswith("data:"):
        hit = _DATA_URI_RE.match(url)
        if not hit:
            return {"type": "text", "text": "[image omitted: unreadable data URI]"}
        media_type = (hit.group(1) or "").strip().lower()
        if media_type == "image/jpg":
            media_type = "image/jpeg"
        if media_type not in _IMAGE_MEDIA_TYPES:
            return {"type": "text", "text": f"[image omitted: unsupported type {media_type or 'unknown'}]"}
        data = re.sub(r"\s+", "", hit.group(3))
        return _with_cache({"type": "image", "source": {"type": "base64", "media_type": media_type,
                                                         "data": data}}, part)
    if url.lower().startswith(("http://", "https://")):
        return _with_cache({"type": "image", "source": {"type": "url", "url": url}}, part)
    return {"type": "text", "text": "[image omitted: unsupported URL]"}


def _file_block(part: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """OpenRouter `file` parts (PDFs) -> Anthropic document blocks."""
    f = part.get("file") or {}
    data = str(f.get("file_data") or f.get("url") or "").strip()
    if data.lower().startswith("data:"):
        hit = _DATA_URI_RE.match(data)
        if hit and (hit.group(1) or "").strip().lower() == "application/pdf":
            return _with_cache({"type": "document", "source": {
                "type": "base64", "media_type": "application/pdf",
                "data": re.sub(r"\s+", "", hit.group(3))}}, part)
        return {"type": "text", "text": "[file omitted: only PDF files are supported]"}
    if data.lower().startswith(("http://", "https://")):
        return _with_cache({"type": "document", "source": {"type": "url", "url": data}}, part)
    return None


def _content_blocks(content: Any, role: str) -> List[Dict[str, Any]]:
    """OpenAI message content (string or parts) -> Anthropic content blocks.
    Assistant turns keep text only (images/documents are user-side inputs)."""
    if content is None:
        return []
    if isinstance(content, str):
        b = _text_block(content)
        return [b] if b else []
    if isinstance(content, dict):
        content = [content]
    if not isinstance(content, list):
        b = _text_block(content)
        return [b] if b else []
    out: List[Dict[str, Any]] = []
    for part in content:
        if isinstance(part, str):
            b = _text_block(part)
        elif not isinstance(part, dict):
            continue
        else:
            ptype = part.get("type")
            if ptype in ("text", "input_text"):
                b = _text_block(part.get("text"), part)
            elif role != "user":
                b = None
            elif ptype == "image_url":
                iu = part.get("image_url")
                b = _image_block(iu.get("url") if isinstance(iu, dict) else str(iu or ""), part)
            elif ptype == "file":
                b = _file_block(part)
            elif ptype in ("image", "document"):
                b = dict(part)  # already Anthropic-shaped
            else:
                b = None
        if b:
            out.append(b)
    return out


def _as_text(blocks: Any) -> str:
    if isinstance(blocks, str):
        return blocks
    parts = []
    for b in blocks or []:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(str(b.get("text") or ""))
        elif isinstance(b, dict):
            parts.append(f"[{b.get('type', 'content')}]")
    return "\n".join(p for p in parts if p)


# ── Request: tools ──────────────────────────────────────────────────────────


def _tool_id(raw: Any, fallback_seq: int) -> str:
    tid = _TOOL_ID_BAD_CHARS.sub("_", str(raw or ""))
    return tid or f"toolu_gen_{fallback_seq}"


def _tool_input(arguments: Any) -> Dict[str, Any]:
    if isinstance(arguments, dict):
        return arguments
    text = "" if arguments is None else str(arguments)
    if not text.strip():
        return {}
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return {"_raw": text}
    return value if isinstance(value, dict) else {"_raw": text}


def _convert_tools(tools: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for t in tools or []:
        if not isinstance(t, dict):
            continue
        fn = t.get("function") if t.get("type", "function") == "function" else None
        if isinstance(fn, dict) and fn.get("name"):
            schema = fn.get("parameters")
            schema = dict(schema) if isinstance(schema, dict) else {}
            schema.setdefault("type", "object")
            if schema.get("type") == "object":
                schema.setdefault("properties", {})
            tool: Dict[str, Any] = {"name": str(fn["name"]), "input_schema": schema}
            if fn.get("description"):
                tool["description"] = str(fn["description"])
            out.append(_with_cache(tool, t))
        elif isinstance(t.get("type"), str) and _SERVER_TOOL_TYPE_RE.search(t["type"]):
            out.append(dict(t))  # an Anthropic server tool (web_search_20250305 …) as-is
    return out


def _convert_tool_choice(choice: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """(anthropic tool_choice, forced tool name or "*" for any tool)."""
    if choice is None:
        return None, None
    if isinstance(choice, str):
        c = choice.lower()
        if c == "auto":
            return {"type": "auto"}, None
        if c == "none":
            return {"type": "none"}, None
        if c in ("required", "any"):
            return {"type": "any"}, "*"
        return None, None
    if isinstance(choice, dict):
        name = (choice.get("function") or {}).get("name") or choice.get("name")
        if choice.get("type") in ("function", "tool") and name:
            return {"type": "tool", "name": str(name)}, str(name)
        if choice.get("type") in ("auto", "none", "any"):
            return {"type": choice["type"]}, "*" if choice["type"] == "any" else None
    return None, None


# ── Request: turns ──────────────────────────────────────────────────────────


def _append(turns: List[Dict[str, Any]], role: str, blocks: List[Dict[str, Any]]) -> None:
    if not blocks:
        return
    if turns and turns[-1]["role"] == role:
        turns[-1]["content"].extend(blocks)
    else:
        turns.append({"role": role, "content": list(blocks)})


def _flatten_tool_blocks(turns: List[Dict[str, Any]]) -> None:
    """A request without `tools` may not carry tool_use/tool_result blocks:
    keep the history readable as plain text instead."""
    for turn in turns:
        new: List[Dict[str, Any]] = []
        for b in turn["content"]:
            if b.get("type") == "tool_use":
                new.append({"type": "text", "text": f"[called tool {b.get('name')} with "
                                                    f"{json.dumps(b.get('input') or {}, ensure_ascii=False)}]"})
            elif b.get("type") == "tool_result":
                new.append({"type": "text", "text": f"[result of tool call {b.get('tool_use_id')}]: "
                                                    f"{_as_text(b.get('content')) or '(empty)'}"})
            else:
                new.append(b)
        turn["content"] = new


def _pair_tool_results(turns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Every tool_use must be answered in the next user turn, results first;
    a tool_result with no matching tool_use becomes text."""
    out: List[Dict[str, Any]] = []
    for i, turn in enumerate(turns):
        if turn["role"] == "assistant":
            out.append(turn)
            ids = [b["id"] for b in turn["content"] if b.get("type") == "tool_use"]
            nxt = turns[i + 1] if i + 1 < len(turns) else None
            if ids and (nxt is None or nxt["role"] != "user"):
                out.append({"role": "user", "content": []})
                _fix_user_turn(out[-1], ids)
            continue
        prev = out[-1] if out else None
        ids = [b["id"] for b in prev["content"] if b.get("type") == "tool_use"] \
            if prev and prev["role"] == "assistant" else []
        _fix_user_turn(turn, ids)
        out.append(turn)
    return out


def _fix_user_turn(turn: Dict[str, Any], tool_use_ids: List[str]) -> None:
    results: List[Dict[str, Any]] = []
    others: List[Dict[str, Any]] = []
    seen = set()
    for b in turn["content"]:
        if b.get("type") == "tool_result":
            tid = b.get("tool_use_id")
            if tid in tool_use_ids and tid not in seen:
                seen.add(tid)
                results.append(b)
            else:
                others.append({"type": "text", "text": f"[result of tool call {tid}]: "
                                                       f"{_as_text(b.get('content')) or '(empty)'}"})
        else:
            others.append(b)
    for tid in tool_use_ids:
        if tid not in seen:
            results.append({"type": "tool_result", "tool_use_id": tid,
                            "content": "No result was returned for this tool call.", "is_error": True})
    # Results in the order the assistant asked for them, then everything else.
    order = {tid: n for n, tid in enumerate(tool_use_ids)}
    results.sort(key=lambda b: order.get(b.get("tool_use_id"), len(order)))
    turn["content"] = results + others


def _limit_cache_breakpoints(body: Dict[str, Any]) -> None:
    """The API allows at most 4 cache_control breakpoints; drop the earliest
    extras (later breakpoints already cover the prefix before them)."""
    found: List[Dict[str, Any]] = []
    if isinstance(body.get("cache_control"), dict):
        found.append(body)
    for t in body.get("tools") or []:
        if "cache_control" in t:
            found.append(t)
    if isinstance(body.get("system"), list):
        found.extend(b for b in body["system"] if "cache_control" in b)
    for turn in body.get("messages") or []:
        for b in turn["content"]:
            if "cache_control" in b:
                found.append(b)
    excess = len(found) - MAX_CACHE_BREAKPOINTS
    for holder in found[:max(excess, 0)]:
        holder.pop("cache_control", None)


def wants_json(openai_payload: Dict[str, Any]) -> bool:
    """True when the caller asked for JSON (`response_format` json_object /
    json_schema) — pass it to from_messages_response(json_mode=...) so a
    fenced reply is unwrapped."""
    rf = (openai_payload or {}).get("response_format")
    return isinstance(rf, dict) and rf.get("type") in ("json_object", "json_schema")


def _json_instruction(rf: Dict[str, Any]) -> str:
    if rf.get("type") != "json_schema":
        return _JSON_INSTRUCTION
    spec = rf.get("json_schema") or {}
    schema = spec.get("schema") if isinstance(spec, dict) else None
    if not isinstance(schema, dict):
        return _JSON_INSTRUCTION
    return (_JSON_INSTRUCTION + " The JSON must conform to this JSON Schema:\n"
            + json.dumps(schema, ensure_ascii=False, sort_keys=True))


def _reasoning_request(payload: Dict[str, Any]) -> Optional[str]:
    """"off", "high"|"xhigh"|"max" (explicit opt-in to deep thinking), or None."""
    r = payload.get("reasoning")
    top = str(payload.get("reasoning_effort") or "").lower() or None
    if isinstance(r, dict):
        effort = str(r.get("effort") or "").lower() or top
        enabled = r.get("enabled")
        if enabled is False or effort == "none":
            return "off"
        if effort in _HIGH_EFFORTS and enabled is not False:
            return effort
        return None
    if top == "none":
        return "off"
    if top in _HIGH_EFFORTS:
        return top
    return None


def _clamp_effort(effort: str, allowed: Tuple[str, ...]) -> Optional[str]:
    if not allowed:
        return None
    if effort in allowed:
        return effort
    ladder = list(_EFFORTS_ALL)
    for e in reversed(ladder[:ladder.index(effort)]):
        if e in allowed:
            return e
    return None


def to_messages_request(openai_payload: Dict[str, Any], wire_model: str) -> Dict[str, Any]:
    """OpenRouter-shaped chat payload -> body for POST {base}/v1/messages."""
    p = openai_payload or {}
    caps = caps_for(wire_model)

    system_blocks: List[Dict[str, Any]] = []
    turns: List[Dict[str, Any]] = []
    seq = 0
    for msg in p.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role in ("system", "developer"):
            system_blocks.extend(_content_blocks(msg.get("content"), "system"))
        elif role == "user":
            _append(turns, "user", _content_blocks(msg.get("content"), "user"))
        elif role == "assistant":
            blocks = _content_blocks(msg.get("content"), "assistant")
            for tc in msg.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") or {}
                seq += 1
                blocks.append({"type": "tool_use", "id": _tool_id(tc.get("id"), seq),
                               "name": str(fn.get("name") or "tool"),
                               "input": _tool_input(fn.get("arguments"))})
            _append(turns, "assistant", blocks)
        elif role in ("tool", "function"):
            seq += 1
            raw_id = msg.get("tool_call_id") or (msg.get("name") if role == "function" else None)
            result: Dict[str, Any] = {"type": "tool_result", "tool_use_id": _tool_id(raw_id, seq)}
            content = msg.get("content")
            if isinstance(content, str):
                if content:
                    result["content"] = content
            else:
                blocks = _content_blocks(content, "user")
                if blocks:
                    result["content"] = blocks
            _append(turns, "user", [result])

    tools = _convert_tools(p.get("tools"))
    if not tools:
        _flatten_tool_blocks(turns)
    turns = _pair_tool_results(turns)

    if not turns or turns[0]["role"] != "user":
        turns.insert(0, {"role": "user", "content": [{"type": "text", "text": "Please proceed."}]})
    if turns[-1]["role"] == "assistant":
        if caps.prefill and not any(b.get("type") == "tool_use" for b in turns[-1]["content"]):
            # A prefill may not end in whitespace (text blocks are never blank here).
            content = turns[-1]["content"]
            if content[-1].get("type") == "text":
                content[-1]["text"] = content[-1]["text"].rstrip()
        else:
            turns.append({"role": "user", "content": [{"type": "text", "text": "Continue."}]})

    body: Dict[str, Any] = {"model": wire_model}

    # max_tokens is required; keep inside the model's output cap.
    default_max = min(caps.max_output, DEFAULT_MAX_TOKENS) if caps.max_output else UNKNOWN_MODEL_DEFAULT_MAX_TOKENS
    max_tokens = p.get("max_tokens") or p.get("max_completion_tokens")
    try:
        max_tokens = int(max_tokens) if max_tokens is not None else default_max
    except (TypeError, ValueError):
        max_tokens = default_max
    max_tokens = max(1, max_tokens)
    if caps.max_output:
        max_tokens = min(max_tokens, caps.max_output)
    body["max_tokens"] = max_tokens

    # Tools / tool_choice.
    extra_system: List[str] = []
    tool_choice, forced = _convert_tool_choice(p.get("tool_choice")) if tools else (None, None)
    if tools:
        body["tools"] = tools
        if forced and not caps.forced_tool_choice:
            # Refused on this model: ask in the prompt instead.
            tool_choice = {"type": "auto"}
            extra_system.append("You must call one of the provided tools in this reply." if forced == "*"
                                else f"You must call the `{forced}` tool in this reply.")
        if p.get("parallel_tool_calls") is False and (tool_choice or {}).get("type") != "none":
            tool_choice = {**(tool_choice or {"type": "auto"}), "disable_parallel_tool_use": True}
        if tool_choice:
            body["tool_choice"] = tool_choice
    forced_now = (body.get("tool_choice") or {}).get("type") in ("any", "tool")

    # JSON mode is a prompt instruction (fences are stripped on the way back).
    rf = p.get("response_format")
    if wants_json(p):
        extra_system.append(_json_instruction(rf))

    # Appended after any cached system block, so the cached prefix is unchanged.
    system_blocks.extend({"type": "text", "text": t} for t in extra_system)
    if system_blocks:
        if any("cache_control" in b for b in system_blocks):
            body["system"] = system_blocks
        else:
            body["system"] = "\n\n".join(b["text"] for b in system_blocks if b.get("type") == "text")

    body["messages"] = turns

    # Thinking: only on an explicit high-effort opt-in; off when asked.
    thinking_on = False
    want = _reasoning_request(p)
    if want == "off" and caps.thinking_default_on:
        if caps.thinking_off == "disabled":
            body["thinking"] = {"type": "disabled"}
        elif caps.thinking_off == "between_tools":
            body["thinking"] = {"type": "between_tools"}
        elif "low" in caps.efforts:
            body["output_config"] = {"effort": "low"}
    elif want in _HIGH_EFFORTS and not forced_now:
        if caps.thinking == "adaptive":
            body["thinking"] = {"type": "adaptive"}
            effort = _clamp_effort(want, caps.efforts)
            if effort:
                body["output_config"] = {"effort": effort}
            thinking_on = True
        elif caps.thinking == "budget":
            r = p.get("reasoning") if isinstance(p.get("reasoning"), dict) else {}
            ratio = {"high": 0.5, "xhigh": 0.7, "max": 0.8}[want]
            budget = r.get("max_tokens") if isinstance(r.get("max_tokens"), int) else int(max_tokens * ratio)
            budget = min(max(budget, _MIN_THINKING_BUDGET), max_tokens - 1)
            if budget >= _MIN_THINKING_BUDGET:
                body["thinking"] = {"type": "enabled", "budget_tokens": budget}
                thinking_on = True

    # Sampling parameters, where the model takes them (never with thinking on).
    if caps.sampling != "none" and not thinking_on:
        temperature = p.get("temperature")
        top_p = p.get("top_p")
        if isinstance(temperature, (int, float)) and not isinstance(temperature, bool):
            body["temperature"] = min(max(float(temperature), 0.0), 1.0)
        if isinstance(top_p, (int, float)) and not isinstance(top_p, bool):
            if caps.sampling == "both" or "temperature" not in body:
                body["top_p"] = min(max(float(top_p), 0.0), 1.0)
        top_k = p.get("top_k")
        if isinstance(top_k, int) and not isinstance(top_k, bool) and top_k > 0:
            body["top_k"] = top_k

    stop = p.get("stop")
    if isinstance(stop, str):
        stop = [stop]
    if isinstance(stop, list):
        seqs = [str(s) for s in stop if isinstance(s, str) and s.strip()]
        if seqs:
            body["stop_sequences"] = seqs

    if isinstance(p.get("cache_control"), dict):
        body["cache_control"] = dict(p["cache_control"])
    if p.get("stream"):
        body["stream"] = True

    _limit_cache_breakpoints(body)
    return body


# ── Response ────────────────────────────────────────────────────────────────


def usage_to_openai(usage: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Anthropic usage -> OpenAI usage. prompt_tokens counts every input token
    (uncached + cache reads + cache writes), as OpenRouter reports it; the two
    cache counters are kept verbatim for billing / key spend."""
    u = usage or {}

    def n(key: str) -> int:
        try:
            return int(u.get(key) or 0)
        except (TypeError, ValueError):
            return 0

    inp, out = n("input_tokens"), n("output_tokens")
    cache_read, cache_write = n("cache_read_input_tokens"), n("cache_creation_input_tokens")
    prompt = inp + cache_read + cache_write
    return {
        "prompt_tokens": prompt,
        "completion_tokens": out,
        "total_tokens": prompt + out,
        "prompt_tokens_details": {"cached_tokens": cache_read},
        "cache_creation_input_tokens": cache_write,
        "cache_read_input_tokens": cache_read,
    }


def finish_reason_for(stop_reason: Optional[str]) -> Optional[str]:
    if stop_reason is None:
        return None
    return _FINISH_REASONS.get(stop_reason, "stop")


def strip_json_fence(text: str) -> str:
    """```json\\n{...}\\n``` -> {...}; anything else unchanged."""
    hit = _FENCE_RE.match(text or "")
    return hit.group(1).strip() if hit else text


def from_messages_response(body: Dict[str, Any], registry_model: str, *, json_mode: bool = False,
                           created: Optional[int] = None) -> Dict[str, Any]:
    """Anthropic Message JSON -> OpenAI chat.completion JSON (model = registry id).
    json_mode: the request asked for JSON (see wants_json) — unwrap a fenced reply."""
    b = body or {}
    texts: List[str] = []
    tool_calls: List[Dict[str, Any]] = []
    for block in b.get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            texts.append(str(block.get("text") or ""))
        elif block.get("type") == "tool_use":
            tool_calls.append({
                "id": block.get("id"),
                "type": "function",
                "function": {"name": block.get("name"),
                             "arguments": json.dumps(block.get("input") or {}, ensure_ascii=False)},
            })
        # thinking / redacted_thinking / server-tool blocks are not part of the answer
    text = "".join(texts)
    if json_mode and text:
        text = strip_json_fence(text)
    message: Dict[str, Any] = {"role": "assistant", "content": text if (text or not tool_calls) else None}
    if tool_calls:
        message["tool_calls"] = tool_calls
    stop_reason = b.get("stop_reason")
    return {
        "id": b.get("id") or "",
        "object": "chat.completion",
        "created": int(created if created is not None else time.time()),
        "model": registry_model,
        "choices": [{"index": 0, "message": message,
                     "finish_reason": finish_reason_for(stop_reason) or "stop"}],
        "usage": usage_to_openai(b.get("usage")),
    }


def error_to_openai(status: int, body_text: str) -> Dict[str, Any]:
    """Anthropic error reply -> {"error": {"message", "type", "code": status}}."""
    err_type: Optional[str] = None
    message: Optional[str] = None
    try:
        parsed = json.loads(body_text) if body_text else None
    except (ValueError, TypeError):
        parsed = None
    if isinstance(parsed, dict):
        err = parsed.get("error")
        if isinstance(err, dict):
            err_type = err.get("type") or None
            message = err.get("message") or None
        elif isinstance(err, str):
            message = err
        if not message and isinstance(parsed.get("message"), str):
            message = parsed["message"]
    if not message:
        message = (body_text or "").strip()[:500] or f"Anthropic API error (HTTP {status})"
    if not err_type:
        err_type = _STATUS_ERROR.get(int(status), "api_error")
    return {"error": {"message": message, "type": err_type, "code": int(status)}}


# ── Streaming ───────────────────────────────────────────────────────────────


class StreamTranslator:
    """Anthropic Messages SSE events -> OpenAI chat.completion.chunk dicts.

        t = StreamTranslator("anthropic/claude-sonnet-4.5")
        for event, data in sse_events:
            for chunk in t.feed(event, data):
                yield chunk

    The final chunk (on message_stop) carries finish_reason and usage.
    `raw_usage` holds the Anthropic usage counters seen so far (for key spend).
    """

    def __init__(self, registry_model: str, *, created: Optional[int] = None):
        self.registry_model = registry_model
        self.created = int(created if created is not None else time.time())
        self.id = ""
        self.raw_usage: Dict[str, Any] = {}
        self.stop_reason: Optional[str] = None
        self.finished = False
        self.error: Optional[Dict[str, Any]] = None
        self._tool_index: Dict[int, int] = {}  # Anthropic block index -> OpenAI tool_calls index
        self._text_blocks: set = set()

    def _chunk(self, delta: Dict[str, Any], finish_reason: Optional[str] = None,
               **extra: Any) -> Dict[str, Any]:
        c = {
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.registry_model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        c.update(extra)
        return c

    def _merge_usage(self, usage: Any) -> None:
        if isinstance(usage, dict):
            for k, v in usage.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    self.raw_usage[k] = v

    def feed(self, event: str, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        data = data if isinstance(data, dict) else {}
        etype = event or data.get("type") or ""
        if self.finished:
            return []
        if etype == "message_start":
            msg = data.get("message") or {}
            self.id = msg.get("id") or self.id
            self._merge_usage(msg.get("usage"))
            return [self._chunk({"role": "assistant", "content": ""})]
        if etype == "content_block_start":
            idx = int(data.get("index") or 0)
            block = data.get("content_block") or {}
            if block.get("type") == "text":
                self._text_blocks.add(idx)
                text = block.get("text") or ""
                return [self._chunk({"content": text})] if text else []
            if block.get("type") == "tool_use":
                n = len(self._tool_index)
                self._tool_index[idx] = n
                return [self._chunk({"tool_calls": [{
                    "index": n, "id": block.get("id"), "type": "function",
                    "function": {"name": block.get("name"), "arguments": ""}}]})]
            return []  # thinking / server tools: not part of the answer
        if etype == "content_block_delta":
            idx = int(data.get("index") or 0)
            delta = data.get("delta") or {}
            dtype = delta.get("type")
            if dtype == "text_delta" and idx in self._text_blocks:
                text = delta.get("text") or ""
                return [self._chunk({"content": text})] if text else []
            if dtype == "input_json_delta" and idx in self._tool_index:
                part = delta.get("partial_json") or ""
                if not part:
                    return []
                return [self._chunk({"tool_calls": [{"index": self._tool_index[idx],
                                                     "function": {"arguments": part}}]})]
            return []
        if etype == "message_delta":
            delta = data.get("delta") or {}
            if delta.get("stop_reason"):
                self.stop_reason = delta["stop_reason"]
            self._merge_usage(data.get("usage"))
            return []
        if etype == "message_stop":
            self.finished = True
            return [self._chunk({}, finish_reason_for(self.stop_reason) or "stop",
                                usage=usage_to_openai(self.raw_usage))]
        if etype == "error":
            err = data.get("error") or {}
            err_type = err.get("type") or "api_error"
            self.error = {"message": err.get("message") or "Anthropic stream error",
                          "type": err_type, "code": _ERROR_STATUS.get(err_type, 500)}
            self.finished = True
            # Mid-stream: the tokens already produced are billed by Anthropic, so
            # the error chunk carries the usage seen so far (key spend, billing).
            extra = {"usage": usage_to_openai(self.raw_usage)} if self.raw_usage else {}
            return [self._chunk({}, "error", error=self.error, **extra)]
        return []  # ping, content_block_stop, unknown future events


__all__ = [
    "ANTHROPIC_VERSION",
    "ModelCaps",
    "StreamTranslator",
    "caps_for",
    "derive_wire_model",
    "error_to_openai",
    "finish_reason_for",
    "from_messages_response",
    "strip_json_fence",
    "to_messages_request",
    "usage_to_openai",
    "wants_json",
]
