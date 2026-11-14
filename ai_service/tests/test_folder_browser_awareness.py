"""folderBrowser is data-bound like productPageOffer: its folders live in an
admin-built library, so an unbound section is flagged everywhere a page is
judged — the generation audit, the MCP site summary and the publish checks.
"""
from app.services.catalogue_summary import data_binding, run_publish_checks
from app.services.page_audit import audit_component


def _folder(props):
    return {"id": "fb1", "type": "folderBrowser", "props": props}


def test_audit_flags_unbound_folder_browser_for_removal():
    issues = audit_component(_folder({"libraryId": "", "title": "Browse"}))
    codes = {(i["code"], i["severity"]) for i in issues}
    assert ("folders-unbound", "fix") in codes


def test_audit_accepts_bound_folder_browser():
    issues = audit_component(_folder({"libraryId": "lib-1", "title": "Browse"}))
    assert not [i for i in issues if i["code"] == "folders-unbound"]


def test_summary_says_where_the_folders_come_from():
    assert "NONE selected" in data_binding(_folder({"libraryId": ""}))
    bound = data_binding(_folder({"libraryId": "lib-1", "libraryName": "By class", "rootFolderId": "f9"}))
    assert '"By class"' in bound and "chosen folder" in bound


def test_publish_checks_block_an_unbound_folder_browser():
    config = {"pages": [{"id": "courses", "route": "courses", "title": "Courses",
                         "components": [_folder({"libraryId": ""})]}]}
    titles = [i["title"] for i in run_publish_checks(config) if i["severity"] == "error"]
    assert "A Folder Browser section has no folder library selected" in titles
