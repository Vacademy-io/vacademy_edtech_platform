"""Caption track selection: a pure function over the listing, no I/O.

YouTube's speech recognition always runs in the spoken language, so the
auto-generated track's language is the video's spoken language S. With a
requested language R (matched on the base code: en-IN matches en):

  1. R manual, then R auto
  2. manual in S
  3. manual hi, then manual en
  4. auto in S
  5. auto hi / en (only when more than one auto track exists)
  6. any manual, then any auto
  7. translation of the best translatable track into R: last resort, and
     only when R was requested (never without a request)

strict=True keeps only steps 1 and 7. A route fetches at most
MAX_NATIVE_CANDIDATES native tracks, plus the translation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

MAX_NATIVE_CANDIDATES = 3
FALLBACK_LANGS = ("hi", "en")


def base(code: Optional[str]) -> str:
    return (code or "").strip().split("-")[0].split("_")[0].lower()


@dataclass(frozen=True)
class Track:
    code: str
    is_generated: bool
    is_translatable: bool = False

    @property
    def base(self) -> str:
        return base(self.code)


@dataclass(frozen=True)
class Candidate:
    code: str                         # the listed track's language code
    is_generated: bool
    translate_to: Optional[str] = None

    @property
    def kind(self) -> str:
        if self.translate_to:
            return "translated"
        return "auto" if self.is_generated else "manual"


def _tracks(raw: Iterable) -> List[Track]:
    out: List[Track] = []
    for t in raw:
        if isinstance(t, Track):
            out.append(t)
        else:
            code, gen, *rest = tuple(t)
            out.append(Track(str(code), bool(gen), bool(rest[0]) if rest else False))
    return out


def spoken_language(tracks: Sequence[Track]) -> Optional[str]:
    for t in tracks:
        if t.is_generated:
            return t.base
    return None


def pick(tracks: Iterable, requested: Optional[str] = None, strict: bool = False) -> List[Candidate]:
    """Ordered candidates (duplicates removed). ``tracks`` holds Track objects or
    (code, is_generated, is_translatable) tuples."""
    ts = _tracks(tracks)
    r = base(requested) if requested else ""
    manual = [t for t in ts if not t.is_generated]
    auto = [t for t in ts if t.is_generated]
    s = spoken_language(ts)
    out: List[Candidate] = []
    seen = set()

    def add(t: Track) -> None:
        key = (t.code, t.is_generated)
        if key not in seen:
            seen.add(key)
            out.append(Candidate(t.code, t.is_generated))

    def matching(lst: List[Track], lang: Optional[str]) -> List[Track]:
        return [t for t in lst if lang and t.base == lang]

    if r:
        for t in matching(manual, r) + matching(auto, r):
            add(t)
    if not strict:
        if s:
            for t in matching(manual, s):
                add(t)
        for lang in FALLBACK_LANGS:
            for t in matching(manual, lang):
                add(t)
        if s:
            for t in matching(auto, s):
                add(t)
        if len(auto) > 1:
            for lang in FALLBACK_LANGS:
                for t in matching(auto, lang):
                    add(t)
        for t in manual + auto:
            add(t)

    if r and requested:
        # The best translatable track in the non-strict order, not already in R.
        order = pick(ts, requested, strict=False) if strict else list(out)
        by_key = {(t.code, t.is_generated): t for t in ts}
        source = next((c for c in order
                       if by_key[(c.code, c.is_generated)].is_translatable and base(c.code) != r), None)
        if source is not None:
            out.append(Candidate(source.code, source.is_generated, translate_to=requested.strip()))
    return out


def route_candidates(cands: Sequence[Candidate]) -> List[Candidate]:
    """What one route actually tries: the first native candidates plus the
    translation (kept reachable even when many native tracks exist)."""
    natives = [c for c in cands if not c.translate_to][:MAX_NATIVE_CANDIDATES]
    translated = [c for c in cands if c.translate_to][:1]
    return natives + translated


def availability(tracks: Iterable) -> Tuple[str, ...]:
    return tuple(f"{t.code}:{'auto' if t.is_generated else 'manual'}" for t in _tracks(tracks))


__all__ = ["Track", "Candidate", "pick", "route_candidates", "availability", "base", "spoken_language",
           "MAX_NATIVE_CANDIDATES"]
