"""Lead Agent research library: the pure, testable core of the Lead Agent.

Ported from Himang's lead engine, ``himangkalal/vacademy-lead-engine`` (``worker/lead_worker/``,
commit ``2e45c2f``), reviewed 2026-10-25. Module names and function signatures are kept wherever
possible (``research/``, ``discovery/``, ``schemas.py``; ``planning.py`` and ``profiles.py`` are the
pure parts of ``jobs/planning.py`` and ``jobs/profiles.py``).

Nothing here touches the database, the network, a browser or an LLM client: web search, page
fetching and the model are injected callables (``search(query) -> list[SearchResult]``,
``ask(system, user, OutputModel) -> OutputModel``). The engine's Supabase/RLS code, the Playwright
browser, OpenRouter client, Windows keystore, CLI worker and Excel export were left behind.

New in the platform port (see docs/crm/LEAD_AGENT_BUILD_SPEC.md §3):
  pagefetch.py   - raw HTML (server fetcher or Chrome extension) -> page record; which pages to read
  fingerprint.py - platforms a site runs on (Appx, Classplus, LeadSquared, ...) and size signals
  scoring.py     - fit / intent / reach / risk score and the AUTO / REVIEW / REJECT gate
"""

ENGINE_SOURCE = "himangkalal/vacademy-lead-engine@2e45c2f"
