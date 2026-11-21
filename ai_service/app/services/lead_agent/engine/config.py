"""The few limits the engine's pure functions use.

Replaces the engine's ``Config`` (read from ``worker/.env`` on the research laptop, with database,
OpenRouter and browser settings). Only the values that planning and extraction read are kept, with
the engine's defaults; the platform decides models, keys and budgets elsewhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class EngineConfig:
    # Organisations researched per run; guided runs research a few more than the leads asked for.
    max_candidates: int = 150
    # Email lists read websites without AI, so they can be much larger.
    max_email_candidates: int = 1500
    max_pages_per_account: int = 4
    max_run_minutes: int = 90
    # Room for page text in one extraction request.
    max_input_chars: int = 60_000
    max_output_tokens: int = 4_000
    # General web searches per (unguided) run.
    max_search_queries: int = 6
    # Buying-signal searches per industry across the chosen sources.
    max_signal_queries: int = 6
    # Keyword searches per run, one per keyword on the web by default.
    max_keyword_queries: int = 10
    # Results read per search.
    search_results: int = 8
    # The run's search budget is set so a run costs about this much (USD) per lead asked for.
    target_cost_per_lead: Decimal = Decimal("0.002")


DEFAULT_CONFIG = EngineConfig()
