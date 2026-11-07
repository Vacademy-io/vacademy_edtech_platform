"""The builder's default learningPath copy (the schema catalog's exampleProps,
exported from the admin template) must not read as placeholder copy to the page
review. "Learning paths are coming soon." did: every bound default path got a
'placeholder-copy' fix item, so review never passed until the assistant
rewrote the admin's empty-state text."""
import json
from pathlib import Path

from app.services.page_quality import review_page, review_with_audit

CATALOG = Path(__file__).resolve().parent.parent / "app" / "data" / "catalogue_schema_catalog.json"


def _default_path_page():
    catalog = json.loads(CATALOG.read_text())
    entry = next(c for c in catalog["components"] if c.get("type") == "learningPath")
    # Bound the way an admin binds it in the builder; every other prop is the template default.
    props = {**entry["exampleProps"], "productPageCode": "store-1", "productPageName": "Store"}
    return {"route": "courses", "components": [{"id": "lp1", "type": "learningPath", "props": props}]}


def _placeholder_issues(result):
    return [i for i in result["issues"] if i["code"] == "placeholder-copy"]


def test_default_learning_path_copy_is_not_placeholder_copy():
    page = _default_path_page()
    assert page["components"][0]["props"]["emptyText"] == "New learning paths will appear here."
    assert _placeholder_issues(review_page(page, {}, "courses")) == []
    assert _placeholder_issues(review_with_audit(page, {}, "courses")) == []


def test_the_review_still_flags_coming_soon_copy():
    page = _default_path_page()
    page["components"][0]["props"]["emptyText"] = "Learning paths are coming soon."
    assert [i.get("component_id") for i in _placeholder_issues(review_page(page, {}, "courses"))] == ["lp1"]
