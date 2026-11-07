"""Web search results as the engine sees them.

In the engine, searches ran in the worker's own browser (Bing) or through OpenRouter's web plugin.
On the platform, search always runs through a search API from our servers (Serper, Parallel),
outside this package: the engine is handed a ``search(query) -> list[SearchResult]`` callable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol


@dataclass(frozen=True)
class SearchResult:
    query: str
    rank: int
    title: str
    url: str
    snippet: str


class SearchBlocked(Exception):
    """The search provider refused further searches (verification page, quota); stop searching
    for this run and keep what was found."""


class SearchFailed(Exception):
    """One search could not be run (timeout, provider error); that search is skipped. Raise
    anything else (keys, credit) to stop the caller."""


# search(query) -> results, best first.
SearchFn = Callable[[str], "list[SearchResult]"]


class SearchProvider(Protocol):
    def search(self, query: str, limit: int = 10) -> list[SearchResult]: ...
