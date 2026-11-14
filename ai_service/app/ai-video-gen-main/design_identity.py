"""Run-level DESIGN IDENTITY — Phase B of the world-class craft roadmap.

Every video used to ship with the same fingerprint: Montserrat/Inter,
power3.out on everything, one constant flat palette, zero texture. This
module gives each run a small, validated design identity chosen by one
cheap LLM call at shot-planning time:

  - typography  : a font PAIRING from a curated registry (never free text —
                  the registry carries the exact Google-Fonts URL fragments,
                  so no LLM output is ever interpolated into a URL)
  - motion      : a named motion PERSONALITY (ease + timing values that
                  parameterize the shot pack instead of its hardcoded
                  constants)
  - finishing   : grain / vignette / light tokens rendered as a constant
                  overlay layer by the renderer preamble
  - color_arc   : a one-line color-script note threaded into prompts
  - image_art_direction : lighting/palette/lens descriptors appended to the
                  run's image-generation style prefix
  - styleframe  : optionally, ONE hero image generated from the identity as
                  an approval artifact + art-direction anchor (NOT used as
                  an i2i reference — Recraft reference-bleed is a documented
                  failure mode; see automation_pipeline.py ~24494)

The identity dict rides shot_plan.json under the top-level key
"design_identity" (resume loads the file raw, so it survives legs
verbatim) and is user-approvable via the assist "styleframe" gate.

Pure module: stdlib only, no pipeline imports.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Font pairing registry
#
# Each pairing carries the EXACT Google Fonts css2 fragment for the families
# it needs beyond the always-loaded base set (Montserrat 700/900, Inter
# 400/600, Fira Code, Bebas Neue). `gf_fragment` may be "" when the base
# import already covers the pairing. The fragment is appended as a SECOND
# @import so a bad family can never 400 the base request.
# ---------------------------------------------------------------------------

FONT_PAIRINGS: Dict[str, Dict[str, Any]] = {
    "montserrat-inter": {
        "label": "Montserrat + Inter",
        "vibe": "modern default — confident geometric sans",
        "display": "Montserrat",
        "display_css": "'Montserrat', sans-serif",
        "display_weight": 800,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "Montserrat:wght@700;800;900",
    },
    "bebas-inter": {
        "label": "Bebas Neue + Inter",
        "vibe": "impact / kinetic — tall condensed shout",
        "display": "Bebas Neue",
        "display_css": "'Bebas Neue', Impact, sans-serif",
        "display_weight": 400,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "",  # both families in the base import
    },
    "playfair-inter": {
        "label": "Playfair Display + Inter",
        "vibe": "editorial luxury — high-contrast serif headlines",
        "display": "Playfair Display",
        "display_css": "'Playfair Display', Georgia, serif",
        "display_weight": 800,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "Playfair+Display:ital,wght@0,700;0,800;1,700",
    },
    "space-grotesk-inter": {
        "label": "Space Grotesk + Inter",
        "vibe": "tech startup — quirky engineered grotesque",
        "display": "Space Grotesk",
        "display_css": "'Space Grotesk', sans-serif",
        "display_weight": 700,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "Space+Grotesk:wght@500;700",
    },
    "archivo-inter": {
        "label": "Archivo Black + Inter",
        "vibe": "brutalist bold — heavy poster type",
        "display": "Archivo Black",
        "display_css": "'Archivo Black', 'Montserrat', sans-serif",
        "display_weight": 400,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "Archivo+Black",
    },
    "poppins-poppins": {
        "label": "Poppins + Poppins",
        "vibe": "friendly geometric — round approachable",
        "display": "Poppins",
        "display_css": "'Poppins', sans-serif",
        "display_weight": 700,
        "body": "Poppins",
        "body_css": "'Poppins', sans-serif",
        "gf_fragment": "Poppins:wght@400;500;600;700;800",
    },
    "sora-inter": {
        "label": "Sora + Inter",
        "vibe": "futuristic clean — wide techno sans",
        "display": "Sora",
        "display_css": "'Sora', sans-serif",
        "display_weight": 700,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "Sora:wght@600;700;800",
    },
    "dm-serif-inter": {
        "label": "DM Serif Display + Inter",
        "vibe": "warm editorial — bookish confidence",
        "display": "DM Serif Display",
        "display_css": "'DM Serif Display', Georgia, serif",
        "display_weight": 400,
        "body": "Inter",
        "body_css": "'Inter', sans-serif",
        "gf_fragment": "DM+Serif+Display:ital@0;1",
    },
    "oswald-source": {
        "label": "Oswald + Source Sans 3",
        "vibe": "condensed documentary — newsy authority",
        "display": "Oswald",
        "display_css": "'Oswald', 'Arial Narrow', sans-serif",
        "display_weight": 600,
        "body": "Source Sans 3",
        "body_css": "'Source Sans 3', 'Inter', sans-serif",
        "gf_fragment": "Oswald:wght@500;600;700&family=Source+Sans+3:wght@400;600",
    },
    "manrope-manrope": {
        "label": "Manrope + Manrope",
        "vibe": "soft modern SaaS — rounded neo-grotesque",
        "display": "Manrope",
        "display_css": "'Manrope', sans-serif",
        "display_weight": 800,
        "body": "Manrope",
        "body_css": "'Manrope', sans-serif",
        "gf_fragment": "Manrope:wght@400;500;700;800",
    },
}

DEFAULT_PAIRING_KEY = "montserrat-inter"

# Brand fonts (VideoStyleConfig heading_font/body_font) come from the FE
# allowlist / brand-kit scraper _FONT_ALLOWLIST. Map each allowed family to
# its exact css2 fragment so a custom brand font finally LOADS (today the
# name reaches the prompts but the @import never includes it). Families
# absent from this map are silently not loaded (browser falls back) —
# never interpolate an unknown name into the URL.
BRAND_FONT_FRAGMENTS: Dict[str, str] = {
    "Inter": "Inter:wght@300;400;600;700",
    "Roboto": "Roboto:wght@400;500;700;900",
    "Open Sans": "Open+Sans:wght@400;600;700",
    "Poppins": "Poppins:wght@400;500;600;700;800",
    "Montserrat": "Montserrat:wght@700;800;900",
    "Lato": "Lato:wght@400;700;900",
    "Playfair Display": "Playfair+Display:ital,wght@0,700;0,800;1,700",
    "Source Serif 4": "Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700",
    # Pairing display families (so a brand kit that names one still loads it)
    "Space Grotesk": "Space+Grotesk:wght@500;700",
    "Archivo Black": "Archivo+Black",
    "Sora": "Sora:wght@600;700;800",
    "DM Serif Display": "DM+Serif+Display:ital@0;1",
    "Oswald": "Oswald:wght@500;600;700",
    "Source Sans 3": "Source+Sans+3:wght@400;600",
    "Manrope": "Manrope:wght@400;500;700;800",
    "Bebas Neue": "Bebas+Neue",
    "Fira Code": "Fira+Code",
}

_FONT_CSS_FALLBACKS: Dict[str, str] = {
    "Playfair Display": "'Playfair Display', Georgia, serif",
    "Source Serif 4": "'Source Serif 4', Georgia, serif",
    "DM Serif Display": "'DM Serif Display', Georgia, serif",
}


def font_css_stack(family: str) -> str:
    """CSS font-family stack for an allowlisted family name."""
    fam = (family or "").strip()
    if not fam:
        return "'Inter', sans-serif"
    return _FONT_CSS_FALLBACKS.get(fam, f"'{fam}', sans-serif")


# ---------------------------------------------------------------------------
# Motion personality registry
#
# "standard-clean" is byte-identical to the values _build_shot_pack has
# always hardcoded — it is the safe default and what educational runs keep.
# Every ease string must be a valid GSAP ease.
# ---------------------------------------------------------------------------

MOTION_PERSONALITIES: Dict[str, Dict[str, Any]] = {
    "standard-clean": {
        "label": "Standard clean",
        "vibe": "the house default — smooth, unobtrusive",
        "ease": {
            "entry": "power3.out",
            "exit": "power2.in",
            "emphasis": "back.out(1.6)",
            "bg_crossfade": "power2.inOut",
            "snappy": "expo.out",
            "settle": "power4.out",
        },
        "timing": {
            "entry_stagger": 0.12,
            "title_delay": 0.3,
            "subtitle_delay": 0.8,
            "bg_crossfade_sec": 1.2,
            "word_wipe_per_word": 0.15,
        },
        "signature": "clean staggered rises, no overshoot on body text",
    },
    "confident-snap": {
        "label": "Confident snap",
        "vibe": "launch-film assertive — fast arrivals that settle hard",
        "ease": {
            "entry": "expo.out",
            "exit": "power2.in",
            "emphasis": "back.out(1.4)",
            "bg_crossfade": "power2.inOut",
            "snappy": "expo.out",
            "settle": "power4.out",
        },
        "timing": {
            "entry_stagger": 0.08,
            "title_delay": 0.25,
            "subtitle_delay": 0.6,
            "bg_crossfade_sec": 1.0,
            "word_wipe_per_word": 0.12,
        },
        "signature": "blur-in rises that snap to rest; one back.out pop per shot",
    },
    "smooth-luxe": {
        "label": "Smooth luxe",
        "vibe": "premium calm — long eased glides, zero overshoot",
        "ease": {
            "entry": "power3.out",
            "exit": "power2.inOut",
            "emphasis": "power2.out",
            "bg_crossfade": "power2.inOut",
            "snappy": "power3.out",
            "settle": "power4.out",
        },
        "timing": {
            "entry_stagger": 0.16,
            "title_delay": 0.4,
            "subtitle_delay": 1.0,
            "bg_crossfade_sec": 1.6,
            "word_wipe_per_word": 0.18,
        },
        "signature": "slow drifts and cross-dissolves; nothing ever bounces",
    },
    "kinetic-punch": {
        "label": "Kinetic punch",
        "vibe": "high-energy social — rhythmic slams on the beat",
        "ease": {
            "entry": "expo.out",
            "exit": "power1.in",
            "emphasis": "back.out(1.7)",
            "bg_crossfade": "power2.inOut",
            "snappy": "expo.out",
            "settle": "power3.out",
        },
        "timing": {
            "entry_stagger": 0.06,
            "title_delay": 0.15,
            "subtitle_delay": 0.45,
            "bg_crossfade_sec": 0.8,
            "word_wipe_per_word": 0.10,
        },
        "signature": "hard cuts, scale slams, quick alternating directions",
    },
    "calm-scholar": {
        "label": "Calm scholar",
        "vibe": "lecture-friendly — gentle, predictable, unhurried",
        "ease": {
            "entry": "power2.out",
            "exit": "power2.in",
            "emphasis": "back.out(1.2)",
            "bg_crossfade": "power2.inOut",
            "snappy": "power3.out",
            "settle": "power2.out",
        },
        "timing": {
            "entry_stagger": 0.14,
            "title_delay": 0.35,
            "subtitle_delay": 0.9,
            "bg_crossfade_sec": 1.4,
            "word_wipe_per_word": 0.16,
        },
        "signature": "soft fades and small rises; motion explains, never performs",
    },
}

DEFAULT_MOTION_KEY = "standard-clean"


# ---------------------------------------------------------------------------
# Finishing tokens — rendered by the renderer preamble as .vx-* overlay
# layers (see automation_pipeline._ensure_fonts). All values deliberately
# subtle: the finishing layer must never read as an effect, only as film.
# ---------------------------------------------------------------------------

FINISHING_GRAIN = ("none", "soft", "film")       # opacity 0 / .05 / .09
FINISHING_VIGNETTE = ("none", "soft", "medium")  # edge alpha 0 / .16 / .26
FINISHING_LIGHT = ("none", "glow")               # brand-tinted top glow

DEFAULT_FINISHING = {"grain": "none", "vignette": "none", "light": "none"}
MARKETING_DEFAULT_FINISHING = {"grain": "soft", "vignette": "soft", "light": "none"}


def build_finishing_overlay_html(finishing: Optional[Dict[str, str]]) -> str:
    """The per-shot finishing overlay markup. Class definitions live in the
    renderer preamble (global_css); this returns only the layer divs so the
    per-shot payload stays tiny. Empty string when every token is none."""
    f = finishing or {}
    grain = str(f.get("grain") or "none")
    vignette = str(f.get("vignette") or "none")
    light = str(f.get("light") or "none")
    layers: List[str] = []
    if grain in ("soft", "film"):
        layers.append(f'<div class="vx-grain{" vx-grain-film" if grain == "film" else ""}"></div>')
    if vignette in ("soft", "medium"):
        layers.append(f'<div class="vx-vignette{" vx-vignette-medium" if vignette == "medium" else ""}"></div>')
    if light == "glow":
        layers.append('<div class="vx-glow"></div>')
    if not layers:
        return ""
    # aria-hidden + pointer-events:none; z-index below the transition
    # overlays (9999) so dip-to-black / flashes still cover the frame.
    return (
        '<div class="vx-finish" aria-hidden="true" '
        'style="position:absolute;inset:0;pointer-events:none;z-index:8000;">'
        + "".join(layers)
        + "</div>"
    )


# CSS for the .vx-* classes — injected once into the renderer preamble.
# Grain uses an SVG-noise data-URI as a CSS background (same technique as
# .paper-texture) so the bbox walker never sees a media element.
VX_FINISHING_CSS = """
            /* --- RUN FINISHING LAYER (design identity) --- */
            .vx-finish { position: absolute; inset: 0; pointer-events: none; }
            .vx-grain {
              position: absolute; inset: 0;
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
              background-size: 220px 220px;
              mix-blend-mode: overlay;
              opacity: 0.05;
            }
            .vx-grain.vx-grain-film { opacity: 0.09; }
            .vx-vignette {
              position: absolute; inset: 0;
              background: radial-gradient(120% 95% at 50% 45%, transparent 62%, rgba(0,0,0,0.16));
            }
            .vx-vignette.vx-vignette-medium {
              background: radial-gradient(115% 90% at 50% 45%, transparent 58%, rgba(0,0,0,0.26));
            }
            .vx-glow {
              position: absolute; inset: 0;
              background: radial-gradient(70% 45% at 50% 0%, color-mix(in srgb, var(--brand-accent, #38bdf8) 10%, transparent), transparent 70%);
            }
"""


# ---------------------------------------------------------------------------
# Identity normalization + LLM call
# ---------------------------------------------------------------------------

# Words that would trip the image scanner's _SVG_KW_RE (diagram-ish prompts
# skip AI generation entirely) — keep them out of the art-direction string.
_ART_DIRECTION_BANNED = re.compile(
    r"\b(diagram|flowchart|flow chart|bar chart|pie chart|line graph|graph|"
    r"schematic|blueprint|venn|infographic|chart)\b",
    re.IGNORECASE,
)


def sanitize_art_direction(text: str) -> str:
    """Lighting/palette/lens words only; strip svg-keyword tokens that would
    make the image scanner skip generation, plus newlines/quotes."""
    t = re.sub(r"[\"'`<>\n\r]", " ", str(text or ""))
    t = _ART_DIRECTION_BANNED.sub("", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,;")
    return t[:220]


def _safe_styleframe_url(url: Any) -> Optional[str]:
    """The styleframe URL is only ever set by the PIPELINE'S OWN S3 upload —
    an LLM response or user edit must never plant one (it renders as an <img>
    in the approval card). Same character rules as decision_gates.
    sanitize_media_url, plus https-only."""
    if not isinstance(url, str):
        return None
    u = url.strip()
    if (
        not u.lower().startswith("https://")
        or len(u) > 2000
        or any(c in u for c in ('"', "'", "<", ">", "`", "\\"))
        or any(ord(c) < 33 for c in u)
    ):
        return None
    return u


def normalize_design_identity(
    raw: Any,
    *,
    mode: str = "marketing",
    brand_fonts_locked: bool = False,
    brand_heading: str = "",
    brand_body: str = "",
) -> Dict[str, Any]:
    """Coerce an LLM-emitted (or user-edited) identity into a safe, fully
    registry-validated dict. NEVER trusts free text where a registry key is
    expected. Always returns a complete identity."""
    d = raw if isinstance(raw, dict) else {}

    pairing_key = str(d.get("font_pairing") or d.get("typography", {}).get("pairing") or "").strip()
    if pairing_key not in FONT_PAIRINGS:
        pairing_key = DEFAULT_PAIRING_KEY
    pairing = FONT_PAIRINGS[pairing_key]

    motion_key = str(d.get("motion_personality") or d.get("motion", {}).get("personality") or "").strip()
    if motion_key not in MOTION_PERSONALITIES:
        motion_key = DEFAULT_MOTION_KEY

    fin_raw = d.get("finishing") if isinstance(d.get("finishing"), dict) else {}
    default_fin = MARKETING_DEFAULT_FINISHING if mode in ("marketing", "bold") else DEFAULT_FINISHING
    finishing = {
        "grain": fin_raw.get("grain") if fin_raw.get("grain") in FINISHING_GRAIN else default_fin["grain"],
        "vignette": fin_raw.get("vignette") if fin_raw.get("vignette") in FINISHING_VIGNETTE else default_fin["vignette"],
        "light": fin_raw.get("light") if fin_raw.get("light") in FINISHING_LIGHT else default_fin["light"],
    }

    typography: Dict[str, Any] = {
        "pairing": pairing_key,
        "display": pairing["display"],
        "display_css": pairing["display_css"],
        "display_weight": pairing["display_weight"],
        "body": pairing["body"],
        "body_css": pairing["body_css"],
        "locked_by_brand": False,
    }
    if brand_fonts_locked:
        # An institute that configured brand fonts wins over the LLM's pick.
        heading = (brand_heading or "").strip() or "Montserrat"
        body = (brand_body or "").strip() or "Inter"
        typography.update({
            "pairing": "brand",
            "display": heading,
            "display_css": font_css_stack(heading),
            "display_weight": 800,
            "body": body,
            "body_css": font_css_stack(body),
            "locked_by_brand": True,
        })

    return {
        "identity_name": re.sub(r"[^a-z0-9\- ]", "", str(d.get("identity_name") or "").lower())[:48]
                         or f"{motion_key}",
        "typography": typography,
        "motion": {"personality": motion_key},
        "finishing": finishing,
        "color_arc_note": str(d.get("color_arc_note") or "")[:220],
        "image_art_direction": sanitize_art_direction(d.get("image_art_direction") or ""),
        "rationale": str(d.get("rationale") or "")[:240],
        "styleframe_url": _safe_styleframe_url(d.get("styleframe_url")),
    }


def motion_values(identity: Optional[Dict[str, Any]]) -> Tuple[Dict[str, str], Dict[str, float]]:
    """(ease, timing) dicts for the shot pack — registry lookup by the
    identity's personality key, defaulting to the historical constants."""
    key = DEFAULT_MOTION_KEY
    if isinstance(identity, dict):
        k = ((identity.get("motion") or {}).get("personality") or "").strip()
        if k in MOTION_PERSONALITIES:
            key = k
    p = MOTION_PERSONALITIES[key]
    return dict(p["ease"]), dict(p["timing"])


DESIGN_IDENTITY_SYSTEM_PROMPT = """You are the design director for a short video. Given the video's creative concept and script summary, choose ONE design identity that a motion-design team will execute. You choose from fixed registries — output keys, not inventions.

Choose for CONTRAST with the generic default (montserrat-inter + standard-clean) when the content earns it, but never against the brand: a bank explainer should not get kinetic-punch.

Output STRICT JSON only:
{
  "identity_name": "<2-4 word slug, e.g. 'confident launch'>",
  "font_pairing": "<one of: %(pairings)s>",
  "motion_personality": "<one of: %(motions)s>",
  "finishing": {"grain": "none|soft|film", "vignette": "none|soft|medium", "light": "none|glow"},
  "color_arc_note": "<=200 chars — how background energy should progress across the video within the brand palette (e.g. 'open quiet and dark, warm mid-video as trust builds, brightest gradient at the CTA')",
  "image_art_direction": "<=200 chars — lighting/palette/lens descriptors applied to EVERY generated image for cross-shot consistency (e.g. 'warm golden-hour light, shallow depth of field, muted teal-amber grade'). No chart/diagram words.",
  "rationale": "<=200 chars — why this identity fits"
}

Pairing vibes: %(pairing_vibes)s
Motion vibes: %(motion_vibes)s"""


def build_design_identity_prompt() -> str:
    return DESIGN_IDENTITY_SYSTEM_PROMPT % {
        "pairings": ", ".join(FONT_PAIRINGS.keys()),
        "motions": ", ".join(MOTION_PERSONALITIES.keys()),
        "pairing_vibes": "; ".join(f"{k}: {v['vibe']}" for k, v in FONT_PAIRINGS.items()),
        "motion_vibes": "; ".join(f"{k}: {v['vibe']}" for k, v in MOTION_PERSONALITIES.items()),
    }


def generate_design_identity(
    llm_chat: Callable[..., Any],
    *,
    concept: Optional[Dict[str, Any]],
    script_summary: str,
    mode: str,
    brand_brief: str = "",
    model: Optional[str] = None,
    brand_fonts_locked: bool = False,
    brand_heading: str = "",
    brand_body: str = "",
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """One cheap LLM call → validated identity. Never raises: any failure
    returns the mode's default identity. Returns (identity, usage)."""
    # The pipeline's brand brief is a dict (`_extract_brand_brief() -> Dict`),
    # not text. Slicing it raised "unhashable type: 'slice'" OUTSIDE the try
    # below, so every run with a brand kit lost its design identity and fell
    # back to the default look - while unbranded runs (which pass {} -> "")
    # worked, which is why it went unnoticed.
    if isinstance(brand_brief, dict):
        brand_brief = json.dumps(brand_brief, ensure_ascii=False, default=str)
    user_payload = {
        "visual_style_mode": mode,
        "creative_concept": concept or {},
        "script_summary": str(script_summary or "")[:1500],
        "brand_brief": str(brand_brief or "")[:600],
        "brand_fonts_locked": bool(brand_fonts_locked),
    }
    try:
        kwargs: Dict[str, Any] = dict(
            messages=[
                {"role": "system", "content": build_design_identity_prompt()},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            temperature=0.7,
            max_tokens=600,
        )
        if model:
            kwargs["model"] = model
        raw, usage = llm_chat(**kwargs)
        cleaned = re.sub(r"^```(?:json)?|```$", "", str(raw or "").strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(cleaned)
    except Exception:
        parsed, usage = {}, {}
    identity = normalize_design_identity(
        parsed,
        mode=mode,
        brand_fonts_locked=brand_fonts_locked,
        brand_heading=brand_heading,
        brand_body=brand_body,
    )
    # The LLM never gets to plant a styleframe URL — only the pipeline's own
    # S3 upload sets this, explicitly, after generation.
    identity["styleframe_url"] = None
    return identity, (usage or {})


def default_design_identity(
    *,
    mode: str,
    brand_fonts_locked: bool = False,
    brand_heading: str = "",
    brand_body: str = "",
) -> Dict[str, Any]:
    return normalize_design_identity(
        {},
        mode=mode,
        brand_fonts_locked=brand_fonts_locked,
        brand_heading=brand_heading,
        brand_body=brand_body,
    )


# ---------------------------------------------------------------------------
# Prompt threading helpers
# ---------------------------------------------------------------------------

def identity_style_context_lines(identity: Optional[Dict[str, Any]]) -> str:
    """Lines appended to the per-shot STYLE block. Empty for no identity."""
    if not isinstance(identity, dict):
        return ""
    typ = identity.get("typography") or {}
    motion_key = (identity.get("motion") or {}).get("personality") or DEFAULT_MOTION_KEY
    p = MOTION_PERSONALITIES.get(motion_key, MOTION_PERSONALITIES[DEFAULT_MOTION_KEY])
    ease = p["ease"]
    timing = p["timing"]
    lines = [
        f"Design identity: {identity.get('identity_name') or motion_key}",
        f"Display font: var(--font-display) [{typ.get('display', 'Montserrat')}] for headlines; "
        f"var(--font-body) [{typ.get('body', 'Inter')}] for everything else; Fira Code for code.",
        # Self-contained (some tiers don't inject the shot pack): the actual
        # ease/timing values ride here, and match the pack where it exists.
        f"Motion personality: {p['label']} — {p['signature']}. "
        f"Entrances `{ease['entry']}`, emphasis pops `{ease['emphasis']}`, exits `{ease['exit']}`, "
        f"stagger {timing['entry_stagger']}s between sibling entrances. Use these values verbatim.",
    ]
    arc = str(identity.get("color_arc_note") or "").strip()
    if arc:
        lines.append(f"Color arc: {arc}")
    return "\n".join(lines) + "\n"


def styleframe_prompt(identity: Dict[str, Any], concept: Optional[Dict[str, Any]], palette: Optional[Dict[str, Any]] = None) -> str:
    """Prompt for the ONE run styleframe image — the identity rendered as a
    hero frame. Used as an approval artifact + art-direction anchor."""
    art = identity.get("image_art_direction") or "clean premium brand photography, soft directional light"
    metaphor = ((concept or {}).get("visual_metaphor") or "").strip()
    idea = ((concept or {}).get("controlling_idea") or "").strip()
    pal = palette or {}
    color_hint = ""
    if pal.get("primary") or pal.get("accent"):
        color_hint = f" Brand colors {pal.get('primary', '')} and {pal.get('accent', '')} present as accents."
    subject = metaphor or idea or "the video's central subject"
    return (
        f"Single cinematic hero frame establishing a video's visual identity: {subject}. "
        f"{art}.{color_hint} No text, no logos, no watermarks, no charts. "
        "Composed like the opening frame of a premium brand film."
    )
