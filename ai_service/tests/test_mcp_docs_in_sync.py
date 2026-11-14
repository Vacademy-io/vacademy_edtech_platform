"""
The MCP docs' tool reference (vacademy-docs/mcp-server/) is generated from the tool
registry by scripts/gen_mcp_docs.py. When a tool, an action or a settings
label changes, regenerate: ``cd ai_service && python scripts/gen_mcp_docs.py``.
"""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "ai_service" / "scripts" / "gen_mcp_docs.py"


def _generator():
    spec = importlib.util.spec_from_file_location("gen_mcp_docs", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.skipif(not (ROOT / "vacademy-docs" / "mcp-server" / "tools" / "catalogue.mdx").exists(), reason="docs site not in this checkout")
def test_tool_reference_matches_the_registry():
    gen = _generator()
    stale = [p for p, text in gen.build().items()
             if not (gen.DOCS / p).exists() or (gen.DOCS / p).read_text() != text]
    assert not stale, f"Regenerate the MCP docs (python scripts/gen_mcp_docs.py): {stale}"


def test_every_exposed_tool_has_a_reference_page():
    gen = _generator()
    from app.mcp.adapter import exposed_specs
    from app.mcp.constants import MCP_EXPOSED_TOOLS
    # a module that failed to import would silently vanish from the docs and the server alike
    assert {s.name for s in exposed_specs()} == set(MCP_EXPOSED_TOOLS)
    pages = "\n".join(gen.build().values())
    for name in MCP_EXPOSED_TOOLS:
        assert f"## `{name}`" in pages, name
