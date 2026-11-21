"""Enum settings are matched case-insensitively and saved as declared."""
import pytest

from app.services.platform_settings_service import SETTING_SPECS, _coerce


def test_upper_case_options_can_be_saved():
    spec = SETTING_SPECS["billing.storefront.mode"]
    assert _coerce(spec, "SEGMENTS") == "SEGMENTS"
    assert _coerce(spec, "segments") == "SEGMENTS"
    assert _coerce(spec, " All ") == "ALL"


def test_lower_case_options_unchanged():
    lower = next(s for s in SETTING_SPECS.values() if s.type == "enum" and all(o == o.lower() for o in s.options))
    assert _coerce(lower, lower.options[0].upper()) == lower.options[0]


def test_unknown_value_refused():
    with pytest.raises(ValueError):
        _coerce(SETTING_SPECS["billing.storefront.mode"], "EVERYONE")
