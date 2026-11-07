"""Turns Pydantic models into JSON schemas that strict structured-output mode accepts.

Strict mode needs every property listed as required, ``additionalProperties: false``
on every object and no ``$ref``. Keywords that some providers reject (lengths, ranges,
patterns, defaults) are dropped here; Pydantic still enforces them when the response
is validated.
"""

from __future__ import annotations

import copy
from typing import Any

from pydantic import BaseModel

_DROPPED_KEYWORDS = {
    "default", "title", "examples", "format", "pattern",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minLength", "maxLength", "minItems", "maxItems", "uniqueItems",
}


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def convert(node: Any, *, properties: bool = False) -> Any:
        if isinstance(node, list):
            return [convert(item) for item in node]
        if not isinstance(node, dict):
            return node
        if properties:
            # Keys here are field names, not schema keywords.
            return {name: convert(sub) for name, sub in node.items()}
        if "$ref" in node:
            return convert(copy.deepcopy(defs[node["$ref"].rsplit("/", 1)[-1]]))
        out = {
            key: convert(value, properties=key == "properties")
            for key, value in node.items()
            if key not in _DROPPED_KEYWORDS
        }
        if out.get("type") == "object":
            out.setdefault("properties", {})
            out["required"] = list(out["properties"])
            out["additionalProperties"] = False
        return out

    return convert(schema)
