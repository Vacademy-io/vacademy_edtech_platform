"""learningPath is data-bound like productPageOffer/folderBrowser: an unbound one
is flagged everywhere a page is judged (generation audit, MCP summary, publish
checks), and the composer is told never to add one."""
import json
from pathlib import Path

from app.services.catalogue_summary import data_binding, run_publish_checks
from app.services.page_audit import audit_component


def _path(props):
    return {"id": "lp1", "type": "learningPath", "props": props}


def test_audit_flags_unbound_paths_in_both_modes():
    single = {i["code"] for i in audit_component(_path({"productPageCode": ""}))}
    listed = {i["code"] for i in audit_component(_path({"mode": "list", "libraryId": ""}))}
    bound = {i["code"] for i in audit_component(_path({"productPageCode": "PATH1"}))}
    assert "path-unbound" in single and "path-unbound" in listed and "path-unbound" not in bound


def test_summary_and_publish_checks():
    assert "NO product page" in data_binding(_path({"productPageCode": ""}))
    assert '"Gurukul path"' in data_binding(_path({"productPageCode": "P1", "productPageName": "Gurukul path"}))
    assert "folder library" in data_binding(_path({"mode": "list", "libraryId": "lib", "libraryName": "Streams"}))
    config = {"pages": [{"id": "p", "route": "paths", "title": "Paths", "components": [_path({"mode": "list"})]}]}
    titles = [i["title"] for i in run_publish_checks(config) if i["severity"] == "error"]
    assert "A Learning Path section has no folder library selected" in titles


def test_schema_catalog_marks_learning_path_as_data_bound():
    catalog = json.loads((Path(__file__).resolve().parent.parent / "app" / "data" / "catalogue_schema_catalog.json").read_text())
    entry = next(c for c in catalog["components"] if c.get("type") == "learningPath")
    assert "NEVER ADD" in entry["dataBound"]
