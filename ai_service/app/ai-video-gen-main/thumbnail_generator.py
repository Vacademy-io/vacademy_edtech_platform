"""
Thumbnail generator — single Recraft call with text baked into the image.

Called from automation_pipeline immediately after the Director plan is finalized.
Generates ONE thumbnail (not 4) using Recraft, which renders the headline text
directly into the image — no client-side overlay needed.

Soft-fails everywhere: thumbnails are a nice-to-have, never gate the render.
If the call fails, the caller persists `{}` and the FE shows a placeholder.

History: an earlier version produced 4 Seedream options with a client-side
text overlay. Seedream hallucinated text/hex codes into the image even with
explicit "no text" guards, and the FE overlay couldn't fully compensate for
poor base images. The single-Recraft path lets one model own both the
photograph and the typography.
"""
from __future__ import annotations

import base64
import json
import os
import time
import traceback
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

# Sibling import — `ai-video-gen-main` is not a Python package (the dirname
# contains hyphens and there's no __init__.py). The caller adds the directory
# to sys.path and loads this module flat via `from thumbnail_generator import …`,
# so a plain `from . import thumbnail_prompts` raises
# "attempted relative import with no known parent package". The try/except is
# deliberate so an autoformatter can't silently convert one form into the
# other and break runtime imports.
try:
    import thumbnail_prompts as tp  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover — only if loaded inside a real package
    from . import thumbnail_prompts as tp  # type: ignore[no-redef]

try:
    try:
        from app.services.vendor_call_log import record_vendor_failure
    except ModuleNotFoundError:
        # Loaded flat via sys.path (hyphenated dir); in the container the package is ai_service.app.
        from ai_service.app.services.vendor_call_log import record_vendor_failure
except Exception:  # noqa: BLE001
    def record_vendor_failure(*args, **kwargs):  # type: ignore[misc]
        return None


_S3_BUCKET = "vacademy-media-storage-public"
_S3_KEY_PREFIX = "AI_THUMBNAILS"


# ---------------------------------------------------------------------------
# Standalone image-gen caller (Recraft via OpenRouter)
# ---------------------------------------------------------------------------

_IMAGE_GEN_MODEL = "recraft/recraft-v4.1"


def make_standalone_seedream_call(api_key: str) -> Callable[..., Tuple[Optional[bytes], Optional[Dict[str, Any]]]]:
    """Return a `(prompt, width, height, reference_image_url) -> (bytes, usage)`
    callable that talks to OpenRouter directly.

    Name kept as `make_standalone_seedream_call` for back-compat with existing
    callers; the underlying model is now Recraft (see `_IMAGE_GEN_MODEL`).
    Matches the signature of `AutomationPipeline._call_image_generation_llm`
    so `thumbnail_generator.run()` is agnostic to its caller.
    """

    def _call(
        prompt: str,
        width: int = 1920,
        height: int = 1080,
        reference_image_url: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> Tuple[Optional[bytes], Optional[Dict[str, Any]]]:
        if not api_key:
            print("   ⚠️ No OpenRouter API key for standalone image-gen call")
            return None, None

        if width < height:
            aspect_hint = "9:16 vertical framing"
        elif width > height:
            aspect_hint = "16:9 widescreen framing"
        else:
            aspect_hint = "1:1 square framing"
        full_prompt = f"{prompt}\n\n({aspect_hint})"

        if reference_image_url:
            content: Any = [
                {"type": "text", "text": full_prompt},
                {"type": "image_url", "image_url": {"url": reference_image_url}},
            ]
        else:
            content = full_prompt

        payload = {
            "model": model_override or _IMAGE_GEN_MODEL,
            "messages": [{"role": "user", "content": content}],
            "modalities": ["image"],
        }
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://stilllift-automation.local",
                "X-Title": "StillLift Automation",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            record_vendor_failure("https://openrouter.ai/api/v1/chat/completions", "generate thumbnail image", request=payload, error=e)
            print(f"   ⚠️ Standalone Recraft HTTP {e.code}: {e}")
            return None, None
        except Exception as e:
            record_vendor_failure("https://openrouter.ai/api/v1/chat/completions", "generate thumbnail image", request=payload, error=e)
            print(f"   ⚠️ Standalone Recraft call failed: {e}")
            return None, None

        usage_metadata = data.get("usage", {}) or {}
        for choice in (data.get("choices") or []):
            message = choice.get("message", {}) or {}
            for image in (message.get("images") or []):
                image_url = (image.get("image_url") or {}).get("url", "")
                if not image_url:
                    continue
                b64 = image_url.split(",", 1)[1] if "," in image_url else image_url
                try:
                    return base64.b64decode(b64), usage_metadata
                except Exception:
                    return None, None
        return None, None

    return _call


def _resolve_orientation(width: int, height: int) -> str:
    if height > width:
        return "portrait"
    return "landscape"


def _resolve_dimensions(orientation: str) -> Tuple[int, int]:
    """Output dimensions Recraft is asked to honor (textually)."""
    if orientation == "portrait":
        return 1080, 1920
    return 1920, 1080


def _pick_hero_subject_label(
    director_plan: Dict[str, Any],
    subjects_list: List[Dict[str, Any]],
) -> Optional[str]:
    """Pick a human-readable label for the recurring hero of the video.

    Priority:
      1. The subject_extractor's first subject (recurs across multiple shots).
      2. The first shot's image_prompt (truncated).
      3. None → caller falls back to the script title.
    """
    if subjects_list:
        first = subjects_list[0]
        label = (first.get("label") or first.get("id") or "").strip()
        if label:
            return label

    shots = (director_plan or {}).get("shots") or []
    if shots:
        first = shots[0] or {}
        ip = (first.get("image_prompt") or first.get("visual_description") or "").strip()
        if ip:
            return ip[:140]
    return None


def _upload_png_to_s3(
    *,
    image_bytes: bytes,
    run_id: str,
    option_id: str,
    batch_ts: int,
) -> Optional[str]:
    """Upload a Seedream-returned PNG to the public media bucket. Returns the URL.

    `batch_ts` is the generated_at epoch ms — namespacing by it means a
    regenerate produces a fresh URL (no CDN/browser cache poisoning of the
    previous image).

    Resolves credentials via Pydantic settings first (the same case-insensitive,
    .env-aware source `S3Service` uses), then bare env vars as a fallback. The
    earlier env-only path logged "Unable to locate credentials" because the
    exact-case env names weren't present in the pipeline worker, so boto3 fell
    through to its default chain (no IAM role here). `boto3` is imported lazily
    so this module stays import-safe in tests that don't have boto3 installed.
    """
    s3_key = f"{_S3_KEY_PREFIX}/{run_id}/{batch_ts}/{option_id}.png"
    try:
        import boto3  # type: ignore[import-not-found]

        _settings = None
        try:
            try:
                from app.config import get_settings as _get_settings_thumb
            except ModuleNotFoundError:
                from ai_service.app.config import get_settings as _get_settings_thumb
            _settings = _get_settings_thumb()
        except Exception:
            _settings = None

        access_key = (getattr(_settings, "s3_aws_access_key", None)
                      or os.environ.get("S3_AWS_ACCESS_KEY") or None)
        secret_key = (getattr(_settings, "s3_aws_access_secret", None)
                      or os.environ.get("S3_AWS_ACCESS_SECRET") or None)
        region = (getattr(_settings, "s3_aws_region", None)
                  or os.environ.get("S3_AWS_REGION") or "ap-south-1")
        bucket = (
            getattr(_settings, "aws_bucket_name", None)
            or getattr(_settings, "aws_s3_public_bucket", None)
            or os.environ.get("AWS_BUCKET_NAME")
            or os.environ.get("AWS_S3_PUBLIC_BUCKET")
            or _S3_BUCKET
        )

        if not access_key or not secret_key:
            print(
                "   ⚠️ Thumbnail S3 upload skipped — "
                "S3_AWS_ACCESS_KEY / S3_AWS_ACCESS_SECRET not set in env"
            )
            return None

        client = boto3.client(
            "s3",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )
        client.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=image_bytes,
            ContentType="image/png",
        )
        return f"https://{bucket}.s3.amazonaws.com/{s3_key}"
    except Exception as e:
        print(f"   ⚠️ Thumbnail S3 upload failed for {option_id}: {e}")
        return None


def _extract_key_terms_from_script_plan(script_plan: Dict[str, Any]) -> List[str]:
    """Flatten and dedupe `key_terms` from every beat in the script plan.

    These are the domain-specific nouns the script writer flagged as central
    to the topic — exactly the words the headline and visuals should anchor
    to (e.g. ["UPSC", "civil services", "preliminary exam"] for a coaching
    video, ["forest", "land grab", "Telangana"] for a news recap). Used as
    a topic-grounding signal for both the headline LLM and Recraft.
    """
    if not script_plan:
        return []
    beats = script_plan.get("beat_outline") or []
    if not isinstance(beats, list):
        return []
    seen: set = set()
    out: List[str] = []
    for beat in beats:
        if not isinstance(beat, dict):
            continue
        terms = beat.get("key_terms") or []
        if not isinstance(terms, list):
            continue
        for t in terms:
            if not isinstance(t, str):
                continue
            t = t.strip()
            if not t:
                continue
            k = t.lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(t)
    # Cap to a reasonable size so the prompts don't bloat.
    return out[:12]


def run(
    *,
    seedream_call: Callable[..., Tuple[Optional[bytes], Optional[Dict[str, Any]]]],
    run_id: str,
    script_plan: Dict[str, Any],
    director_plan: Optional[Dict[str, Any]],
    orientation: str = "landscape",
    subjects_list: Optional[List[Dict[str, Any]]] = None,
    brand_color_hex: Optional[str] = None,
    brand_heading_font: Optional[str] = None,
    avatar_face_url: Optional[str] = None,
    original_prompt: Optional[str] = None,
    llm_chat: Optional[Callable[..., Tuple[str, Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """Generate ONE thumbnail with the headline rendered into the image by Recraft.

    Args:
        seedream_call: callable matching `(prompt, width, height,
                       reference_image_url=None) -> (image_bytes, usage)`.
                       The name is back-compat; the underlying model is now
                       Recraft (see `_IMAGE_GEN_MODEL`).
        run_id: stable id used as the S3 key prefix.
        script_plan: the inner JSON from `_generate_script_plan` (title,
                     intent, visual_style, script, beat_outline).
        director_plan: optional Director shot plan — used only to derive a
                       hero subject hint from the first shot's image_prompt.
        orientation: 'landscape' (16:9) or 'portrait' (9:16).
        subjects_list: subject_extractor output for hero-subject lookup.
        brand_color_hex: optional brand primary color (e.g. "#FF6B00"). Fed
                         to Recraft as a descriptive color name, soft hint.
        original_prompt: the user's raw input prompt — the most authoritative
                         topic source. Carries cultural / regional / domain
                         signals (e.g. "UPSC coaching", "Brazilian football")
                         that get diluted by the time the Director plans
                         shots. Used to anchor both the headline LLM and the
                         Recraft visuals to the actual topic, preventing the
                         drift mode where a UPSC-coaching video produced a
                         "you won't believe what physics did" headline over a
                         generic excited person.
        llm_chat: callable for the headline LLM. If None, falls back to a
                  truncated title.

    Returns:
        A dict matching the `thumbnails` JSONB shape on `ai_gen_video`:
        {selected_id, intent, orientation, generated_at, options:[ONE entry]}.
        The single option uses `layout: "baked"` so the FE renders the image
        as-is without any client-side text overlay.
    """
    try:
        intent = tp.normalize_intent(script_plan.get("intent") if script_plan else None)
        orientation = "portrait" if orientation == "portrait" else "landscape"
        out_w, out_h = _resolve_dimensions(orientation)
        batch_ts = int(time.time() * 1000)

        visual_style = (script_plan or {}).get("visual_style") if script_plan else None
        subject_domain = (script_plan or {}).get("subject_domain") if script_plan else None
        title = ((script_plan or {}).get("title") or "").strip()

        # Key terms across all beats — the domain-specific nouns the script
        # writer flagged. The most reliable anchor for both headline and visuals.
        key_terms = _extract_key_terms_from_script_plan(script_plan or {})

        # Topic context — the authoritative grounding signal we pass to both
        # the headline LLM and Recraft. Composed from the original user prompt
        # (strongest cultural/topical cue) + script title + subject_domain +
        # key_terms. Always represents the ACTUAL topic, no matter how much
        # downstream layers may have diluted it.
        topic_context: Dict[str, Any] = {
            "original_prompt": (original_prompt or "").strip(),
            "title": title,
            "subject_domain": subject_domain,
            "key_terms": key_terms,
        }

        # Hero subject — recurring subject from extractor wins; otherwise first
        # shot's image_prompt. The sanitizer in `tp.build_recraft_thumbnail_prompt`
        # will strip any text-cue language before it reaches the model.
        hero_label = _pick_hero_subject_label(director_plan or {}, subjects_list or [])

        # Headline package — structured (primary / secondary / tagline /
        # accent_word) so Recraft can render multi-tier text with size
        # hierarchy and an accent-colored word, matching the look of top
        # creator thumbnails (vs the old uniform single-line output).
        narration_hint = None
        if script_plan:
            narration_hint = (script_plan.get("script") or script_plan.get("key_takeaway") or None)

        headline_pkg, _hl_usage = tp.generate_thumbnail_headline(
            llm_chat=llm_chat,
            title=title or "Watch this",
            intent=intent,
            narration_hint=narration_hint,
            topic_context=topic_context,
        )

        # Build the Recraft prompt with the structured headline baked in.
        # `orientation` flows through so the prompt picks the right split axis:
        # left/right for landscape, top/bottom for portrait. The old global
        # left/right rule produced narrow squeezed columns on 9:16 canvases.
        # `avatar_face_url` is also passed so the prompt can explicitly tell
        # Recraft to anchor the SUBJECT ZONE to the same person.
        prompt = tp.build_recraft_thumbnail_prompt(
            intent=intent,
            headline=headline_pkg,
            hero_subject_label=hero_label,
            visual_style=visual_style,
            brand_color_hex=brand_color_hex,
            brand_heading_font=brand_heading_font,
            topic_context=topic_context,
            orientation=orientation,
            avatar_face_url=avatar_face_url,
        )

        try:
            # When a custom-avatar face URL is available we want the host
            # to appear in the thumbnail with their actual identity (face,
            # ethnicity, build) — not Recraft's interpretation of "a person
            # who looks vaguely like this." Recraft's i2i path drifts on
            # identity (same comment lives on the host-shot call site in
            # automation_pipeline._call_image_generation_llm), so route this
            # specific call to Seedream 4.5, which preserves identity across
            # image-to-image. Text rendering on Seedream is slightly weaker
            # than Recraft, but for the avatar case the host's face matters
            # more than perfect typography — we'd rather show the right
            # person with okay text than the wrong person with great text.
            # Without an avatar URL we stay on Recraft (default) for the
            # crisper headline rendering. Built-in catalog avatars (Argil /
            # VEED) have no face_image_url and skip both this branch and
            # the i2i reference image entirely.
            _i2i_kwargs: Dict[str, Any] = {}
            if avatar_face_url:
                _i2i_kwargs["model_override"] = "bytedance-seed/seedream-4.5"

            image_bytes, _img_usage = seedream_call(
                prompt=prompt,
                width=out_w,
                height=out_h,
                reference_image_url=avatar_face_url,
                **_i2i_kwargs,
            )
        except Exception as e:
            print(f"   ⚠️ Thumbnail image-gen call raised: {e}")
            return {}

        if not image_bytes:
            print("   ⚠️ Thumbnail image-gen returned no bytes")
            return {}

        # Single canonical option id — kept as `thumb_1` so existing FE code
        # that checks `selected_id === 'thumb_1'` keeps working.
        option_id = "thumb_1"

        url = _upload_png_to_s3(
            image_bytes=image_bytes,
            run_id=run_id,
            option_id=option_id,
            batch_ts=batch_ts,
        )
        if not url:
            return {}

        option = {
            "id": option_id,
            "image_url": url,
            # Flat headline string for back-compat (anything still reading a
            # single .headline field gets the human-readable collapse of the
            # structured package).
            "headline": tp.package_to_flat_headline(headline_pkg),
            # Full structured package — primary / secondary / tagline /
            # accent_word — so the FE could later render its own overlay
            # variant if we ever revisit the "no-bake" path, and so debug
            # tools can see what we asked Recraft to render.
            "headline_package": dict(headline_pkg),
            # `baked` means: text is already inside the image, FE must not
            # overlay anything. Legacy `bottom_band` / `top_left` / `center`
            # / `none` values continue to render the old overlay path.
            "layout": "baked",
            "subject_focus": "hero",
            "intent_style": intent,
        }

        return {
            "selected_id": option_id,
            "intent": intent,
            "orientation": orientation,
            "generated_at": batch_ts,
            "options": [option],
        }
    except Exception as e:
        print(f"   ⚠️ Thumbnail generator crashed: {e}")
        print(f"   📋 {traceback.format_exc()[:400]}")
        return {}
