"""Language selection shared by live Smallest speech, previews and cache renders."""


def smallest_language_code(language: str | None = None) -> str:
    # Preserve live behavior: Hindi/Hinglish code-switch with hi; English with en.
    return "en" if (language or "").strip().lower().startswith("en") else "hi"
