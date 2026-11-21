"""The site-chrome AI prompt shows current settings in a 12,000-char window.
The site-language dictionary is not chrome and can be large, so it must never
be in that window (it would crowd out the header/footer the admin is editing);
_merge_chrome keeps it in the saved result."""
from app.routers import page_builder as pb


def test_dictionary_is_kept_out_of_the_settings_window():
    big = {f"Source text number {n}": f"अनुवाद {n}" for n in range(2000)}
    settings = {
        "layout": {"header": {"props": {"title": "Knowledge Streams"}}},
        "i18n": {"enabled": True, "strings": {"hi": big}},
    }
    req = pb.SiteChromeRequest(instruction="make the header blue", global_settings=settings, pages=[])
    prompt = pb._build_chrome_prompt(req, pb._load_catalog())
    assert "Knowledge Streams" in prompt
    assert "Source text number" not in prompt
    assert '"i18n"' not in prompt


def test_merge_keeps_the_dictionary():
    current = {"layout": {"header": {"props": {"title": "Old"}}}, "i18n": {"enabled": True, "strings": {"hi": {"Old": "पुराना"}}}}
    merged = pb._merge_chrome(current, {"layout": {"header": {"props": {"title": "New"}}}}, [])
    assert merged.get("i18n") == current["i18n"]
