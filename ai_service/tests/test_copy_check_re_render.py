"""Teacher corrections on a checked copy: pen style + re-render from saved inputs."""
import asyncio

import fitz
import pytest

from app.services.copy_check import annotator, pen_style, re_render
from app.repositories import copy_check_render_snapshot_repository as snapshots


def _scan() -> tuple[bytes, dict, list]:
    src = fitz.open()
    page = src.new_page(width=595, height=842)
    lines = []
    y = 90
    for i, text in enumerate(["iii) b) The mud on which he stepped.",
                              "iv) According to Griffin the advantage was that he is invisible",
                              "and can take revenge on his landlord."]):
        page.insert_text((48, y), text, fontsize=12, color=(0.1, 0.15, 0.5))
        lines.append({"line_id": f"L{i}", "text": text, "box": [92, (y - 12) * 2, 900, 32]})
        y += 34
    pix = page.get_pixmap(dpi=144)
    scan = fitz.open()
    scan.new_page(width=595, height=842).insert_image(fitz.Rect(0, 0, 595, 842), pixmap=pix)
    layout = {"pages": [{"page_id": "P1", "width": 1190, "height": 1684, "lines": lines}]}
    verdicts = [
        {"question_id": "q1", "question_number": 1, "marks_awarded": 1, "max_marks": 1,
         "feedback": "The footprints were caused by mud.",
         "annotations": [{"target": "L0", "style": "tick"},
                         {"target": "L0", "style": "score", "text": "1/1", "page_id": "P1"},
                         {"target": "L0", "style": "total", "text": "2/3"}]},
        {"question_id": "q2", "question_number": 2, "marks_awarded": 1, "max_marks": 2,
         "feedback": "Half the answer.",
         "annotations": [{"target": "L2", "style": "deduction_reason", "page_id": "P1",
                          "text": "Explain both sides directly."},
                         {"target": "L2", "style": "score", "text": "1/2", "page_id": "P1"}]},
    ]
    return scan.tobytes(), layout, verdicts


# ---------------------------------------------------------------- overrides

def test_overrides_rescore_feedback_total_and_pen_notes():
    _pdf, _layout, verdicts = _scan()
    total, out_of = re_render.apply_overrides(verdicts, [
        {"question_id": "q2", "marks_awarded": 2, "feedback": "Fully correct after review.",
         "annotation_edits": [{"style": "deduction_reason", "target": "L2", "page_id": "P1",
                               "text": "Explain both sides directly.", "action": "DELETE"}]},
        {"question_id": "q1", "annotation_edits": [
            {"style": "tick", "target": "L0", "action": "EDIT", "new_text": "ignored for marks"}]},
    ], None)
    q1, q2 = verdicts
    assert (total, out_of) == (3.0, 3.0)
    assert q2["marks_awarded"] == 2 and q2["feedback"] == "Fully correct after review."
    assert [a["style"] for a in q2["annotations"]] == ["score"]
    assert q2["annotations"][0]["text"] == "2/2"
    assert next(a for a in q1["annotations"] if a["style"] == "total")["text"] == "3/3"
    assert q1["annotations"][0]["text"] == "ignored for marks"


def test_marks_are_capped_and_table_rows_follow():
    _pdf, _layout, verdicts = _scan()
    table = {"rows": [{"part": "A", "question_id": "q2", "obtained": 1, "deducted": 1, "max": 2, "percent": 50.0}],
             "total": {"obtained": 1, "max": 2, "percent": 50.0}}
    re_render.apply_overrides(verdicts, [{"question_id": "q2", "marks_awarded": 9}], table)
    assert verdicts[1]["marks_awarded"] == 2
    assert table["rows"][0]["obtained"] == 2 and table["rows"][0]["deducted"] == 0
    assert table["total"] == {"obtained": 2, "max": 2, "percent": 100.0}


def test_re_render_uses_snapshot_and_refuses_other_institute(monkeypatch):
    _pdf, layout, verdicts = _scan()
    snap = snapshots.RenderSnapshot("p1", "a1", "inst-1", layout, verdicts,
                                    {"comment_placement": None, "pen_style": {"ink": "GREEN"}})
    monkeypatch.setattr(snapshots, "get", lambda db, pid: snap if pid == "p1" else None)
    seen = {}

    async def fake_upload(pdf_url, layout_map, vs, attempt_id, **panel):
        seen.update(panel=panel, marks=[v["marks_awarded"] for v in vs], attempt=attempt_id)
        return "file-9"

    monkeypatch.setattr(annotator, "render_and_upload", fake_upload)
    out = asyncio.run(re_render.re_render(None, process_id="p1", pdf_url="https://x/a.pdf",
                                          institute_id="inst-1", attempt_id=None,
                                          overrides=[{"question_id": "q2", "marks_awarded": 0}]))
    assert out["evaluated_file_id"] == "file-9"
    assert seen["marks"] == [1, 0] and seen["attempt"] == "a1"
    assert seen["panel"] == {"pen_style": {"ink": "GREEN"}}
    # The snapshot is never modified: the next call starts from the AI's marks.
    assert snap.verdicts[1]["marks_awarded"] == 1

    with pytest.raises(re_render.SnapshotForbidden):
        asyncio.run(re_render.re_render(None, process_id="p1", pdf_url="u", institute_id="other",
                                        attempt_id=None, overrides=[]))
    with pytest.raises(re_render.SnapshotMissing):
        asyncio.run(re_render.re_render(None, process_id="nope", pdf_url="u", institute_id=None,
                                        attempt_id=None, overrides=[]))


def test_a_corrected_copy_really_draws():
    """The corrected verdicts go through the real annotator: removed note, new
    mark, new remark and another pen, without the render falling over."""
    pdf, layout, verdicts = _scan()
    re_render.apply_overrides(verdicts, [
        {"question_id": "q2", "marks_awarded": 2, "feedback": "Fully correct after review.",
         "annotation_edits": [{"style": "deduction_reason", "target": "L2", "page_id": "P1",
                               "text": "Explain both sides directly.", "action": "DELETE"}]},
    ], None)
    out = annotator._render_sync(pdf, layout, verdicts, "OUTSIDE", {"q1": "1", "q2": "2"}, None,
                                 pen_style.parse({"ink": "GREEN", "font": "ARCHITECTS_DAUGHTER", "size": "SMALL"}))
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "Fully correct after review" in panel
    assert "Explain both sides" not in panel


def test_choice_group_decision_and_total_come_from_the_system():
    """'Any 1 of 2': the teacher raised q2 above q1, so the system now counts q2.
    The copy moves the 'not counted' note to q1 and shows the system's total."""
    from app.services.copy_check.orchestrator import NOT_COUNTED_NOTE
    _pdf, _layout, verdicts = _scan()
    verdicts[1]["counted"] = False
    verdicts[1]["annotations"].append({"style": "margin_note", "target": "L2", "page_id": "P1",
                                       "text": NOT_COUNTED_NOTE})
    total, out_of = re_render.apply_overrides(
        verdicts, [{"question_id": "q2", "marks_awarded": 2}], None,
        counted={"q1": False, "q2": True}, system_total=2.0)
    q1, q2 = verdicts
    assert q1["counted"] is False and q2["counted"] is True
    assert not any(a.get("text") == NOT_COUNTED_NOTE for a in q2["annotations"])
    assert [a["target"] for a in q1["annotations"] if a.get("text") == NOT_COUNTED_NOTE] == ["L0"]
    assert total == 2.0
    assert next(a for a in q1["annotations"] if a["style"] == "total")["text"] == "2/3"


def test_partner_copies_never_get_the_not_counted_note():
    _pdf, _layout, verdicts = _scan()
    re_render.apply_overrides(verdicts, [], None, counted={"q1": False, "q2": True}, api_copy=True)
    assert all(a.get("style") != "margin_note" for v in verdicts for a in v["annotations"])


def test_snapshot_json_is_stored_compressed_and_reads_back():
    _pdf, layout, verdicts = _scan()
    big = {"pages": [dict(layout["pages"][0], lines=layout["pages"][0]["lines"] * 200)]}
    packed = snapshots._pack(big)
    assert packed.startswith("z1:")
    assert len(packed) < len(__import__("json").dumps(big)) / 4
    assert snapshots._unpack(packed) == big
    assert snapshots._unpack('{"a": 1}') == {"a": 1}
    assert snapshots._unpack(snapshots._pack(verdicts)) == verdicts
