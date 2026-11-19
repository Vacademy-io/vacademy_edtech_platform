"""The third-party APIs the platform has integrated, by the hosts they answer on.

Only these are recorded in external_api_call_log. Anything else an HTTP client reaches (an
institute's website fetched for lead research, a page scraped for course content, a DNS check)
is not an integration and is not recorded.

Same list in: voice_bot_service/app/vendor_failures.py (INTEGRATED_DOMAINS),
admin_core .../core/external/IntegratedVendors.java and the portal's
src/lib/integrated-vendors.ts. Add a new integration to all four.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple

# (vendor name, domains). A host matches a domain exactly or as a subdomain of it.
INTEGRATED_VENDORS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("OpenRouter", ("openrouter.ai",)),
    ("Isoquant", ("api.isoquant.ai",)),
    ("Anthropic", ("api.anthropic.com",)),
    ("OpenAI", ("api.openai.com",)),
    ("Google AI", ("generativelanguage.googleapis.com", "aiplatform.googleapis.com")),
    ("Parallel", ("api.parallel.ai",)),
    ("Sarvam", ("api.sarvam.ai",)),
    ("Smallest.ai", ("smallest.ai",)),
    ("Navana", ("navana.ai",)),
    ("Rumik", ("rumik.ai",)),
    ("Deepgram", ("deepgram.com",)),
    ("Google speech", ("texttospeech.googleapis.com", "speech.googleapis.com")),
    ("Edge TTS", ("speech.platform.bing.com",)),
    ("fal.ai", ("fal.run", "fal.ai", "fal.media")),
    ("RunPod", ("runpod.ai", "runpod.io")),
    ("Spatius", ("spatius.ai",)),
    ("Mathpix", ("api.mathpix.com",)),
    ("DocConverter", ("api.docconverter.pro",)),
    ("CloudConvert", ("cloudconvert.com",)),
    ("Serper", ("google.serper.dev",)),
    ("Pexels", ("api.pexels.com",)),
    ("Pixabay", ("pixabay.com",)),
    ("Google APIs", ("www.googleapis.com", "oauth2.googleapis.com", "meet.googleapis.com",
                     "workspaceevents.googleapis.com")),
    ("Plivo", ("api.plivo.com",)),
    ("Exotel", ("exotel.com", "exotel.in")),
    ("Vonage / Airtel", ("api.vonage.com", "api.nexmo.com")),
    ("Aavtaar", ("aavtaar.ai",)),
    ("Razorpay", ("api.razorpay.com",)),
    ("Cashfree", ("api.cashfree.com", "sandbox.cashfree.com")),
    ("Stripe", ("api.stripe.com",)),
    ("PhonePe", ("api.phonepe.com", "api-preprod.phonepe.com")),
    ("PayPal", ("api.paypal.com", "api-m.paypal.com", "api.sandbox.paypal.com", "api-m.sandbox.paypal.com")),
    ("Eway", ("ewaypayments.com",)),
    ("WATI", ("wati.io",)),
    ("Meta", ("graph.facebook.com",)),
    ("Zoom", ("api.zoom.us", "zoom.us")),
    ("Zoho", ("zohoapis.in", "zohoapis.com", "zoho.in")),
    ("Cloudflare", ("api.cloudflare.com",)),
    ("FX rates", ("open.er-api.com",)),
    ("Firebase", ("fcm.googleapis.com", "firebase.googleapis.com")),
    ("Google Play", ("androidpublisher.googleapis.com",)),
    ("App Store Connect", ("api.appstoreconnect.apple.com",)),
    ("GitHub", ("api.github.com",)),
    ("Microsoft Partner Center", ("manage.devcenter.microsoft.com", "login.microsoftonline.com")),
)


def integrated_vendor(host: Optional[str]) -> Optional[str]:
    """The integrated vendor a host belongs to, or None when it is not an integration."""
    h = (host or "").strip().lower().rstrip(".")
    if not h:
        return None
    for name, domains in INTEGRATED_VENDORS:
        if any(h == d or h.endswith("." + d) for d in domains):
            return name
    return None


# --- what a failed call sent and got back, safe to store ---

MAX_BODY_CHARS = 4000
MAX_STRING_CHARS = 500
_SECRET_KEY = re.compile(r"(?i)(api[_-]?key|key|token|secret|password|passwd|authorization|auth|signature|"
                         r"otp|phone|mobile|msisdn|email|card|cvv|account_number|ifsc)")
_SECRETISH = re.compile(r"(?i)(key|token|secret|authorization|bearer|password)[\s:=\"']+(?:bearer\s+)?[^\s,;\"'&]+")


def _redact(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return "…"
    if isinstance(value, dict):
        return {k: ("<hidden>" if _SECRET_KEY.search(str(k)) else _redact(v, depth + 1)) for k, v in value.items()}
    if isinstance(value, list):
        out = [_redact(v, depth + 1) for v in value[:50]]
        return out + ([f"… {len(value) - 50} more"] if len(value) > 50 else [])
    if isinstance(value, str):
        v = _SECRETISH.sub(lambda m: m.group(1) + "=<hidden>", value)
        return v if len(v) <= MAX_STRING_CHARS else v[:MAX_STRING_CHARS] + f"… ({len(v)} chars)"
    return value


def body_summary(raw: Any) -> Optional[Dict[str, Any]]:
    """A request or response body as something safe to keep: JSON with secrets and personal
    fields hidden and long strings cut, or the first part of plain text. None when empty."""
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        if not raw:
            return None
        try:
            raw = bytes(raw).decode("utf-8")
        except UnicodeDecodeError:
            return {"binary_bytes": len(raw)}
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except ValueError:
            cleaned = _SECRETISH.sub(lambda m: m.group(1) + "=<hidden>", text)
            return {"text": cleaned[:MAX_BODY_CHARS]}
        raw = parsed
    redacted = _redact(raw)
    dumped = json.dumps(redacted, default=str)
    if len(dumped) > MAX_BODY_CHARS:
        return {"truncated_json": dumped[:MAX_BODY_CHARS]}
    return redacted if isinstance(redacted, dict) else {"json": redacted}


__all__ = ["INTEGRATED_VENDORS", "body_summary", "integrated_vendor"]
