"""Shared helpers for the Lead Agent engine tests (no conftest.py, so nothing clashes with other test
folders; imported by name because pytest puts this folder on sys.path)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # ai_service/

from app.services.lead_agent.engine.config import EngineConfig  # noqa: E402
from app.services.lead_agent.engine.discovery.search import SearchBlocked, SearchResult  # noqa: E402
from app.services.lead_agent.engine.schemas import DiscoverySelection, ResearchPlan, SignalSelection  # noqa: E402


def make_config(**overrides: Any) -> EngineConfig:
    """The engine tests' configuration (tests/conftest.py make_config), reduced to EngineConfig."""
    values: dict[str, Any] = dict(max_candidates=20, max_email_candidates=60, max_pages_per_account=8,
                                  max_run_minutes=30, max_input_chars=60_000, max_output_tokens=4_000,
                                  max_search_queries=3, max_signal_queries=2, max_keyword_queries=6, search_results=10)
    values.update(overrides)
    return EngineConfig(**values)


class FakeSearch:
    """Canned search results per query ({query: [(title, url, snippet)]}, "*" for any query); records
    what was asked for. Called as search(query); blocked_after raises SearchBlocked."""

    def __init__(self, results_by_query: dict[str, list[tuple[str, str, str]]] | None = None, *,
                 blocked_after: int | None = None):
        self.results_by_query = results_by_query or {}
        self.blocked_after = blocked_after
        self.queries: list[str] = []

    def __call__(self, query: str) -> list[SearchResult]:
        if self.blocked_after is not None and len(self.queries) >= self.blocked_after:
            raise SearchBlocked("verification page")
        self.queries.append(query)
        rows = self.results_by_query.get(query, self.results_by_query.get("*", []))
        return [SearchResult(query=query, rank=i, title=title, url=url, snippet=snippet)
                for i, (title, url, snippet) in enumerate(rows, start=1)]


class BatchSearch(FakeSearch):
    """A provider that can run searches at once: records each batch (pass .search_many)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.batches: list[list[str]] = []

    def search_many(self, queries: list[str]) -> list[list[SearchResult]]:
        self.batches.append(list(queries))
        return [self(q) for q in queries]


def asker(select=None, select_signals=None):
    """ask(system, user, OutputModel) from the engine tests' select / select_signals callables."""

    def ask(system: str, user: str, model):
        if model is DiscoverySelection:
            return select(system, user) if select else DiscoverySelection(organisations=[])
        if model is SignalSelection:
            return select_signals(system, user) if select_signals else SignalSelection(findings=[])
        raise AssertionError(f"unexpected output model {model}")

    return ask


PLAN = ResearchPlan(
    summary="Find coaching institutes in Bangalore for LMS and CRM.",
    segment="coaching institutes",
    locations=["Bangalore"],
    target_products=["lms", "crm"],
    candidate_count=20,
    priority_signals=[],
    buyer_roles=["owner"],
    search_term="coaching institute",
    hiring_roles=["telecaller", "admission counsellor"],
    search_queries=["JEE coaching Bangalore", "NEET coaching Bangalore"],
    page_types=["home"],
    assumptions=[],
    not_possible=[],
)
