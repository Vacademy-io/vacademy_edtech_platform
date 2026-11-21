"""Capacity rules for indexed input assets.

The asset list is polymorphic — indexed videos and indexed images share one
field — and the original flat cap of 5 was sized for videos. An image-led run
(a product walkthrough built from screenshots) was silently truncated to five
stills, which is not enough to carry a flow, and the truncation was invisible:
no error, just a shorter video than the user selected assets for.
"""

import ast
import os
import re
import sys

import pytest

_HERE = os.path.dirname(__file__)
_GEN = os.path.join(_HERE, "..", "app", "ai-video-gen-main")
sys.path.insert(0, _GEN)


def _schema_src():
    with open(os.path.join(_HERE, "..", "app", "schemas", "video_generation.py")) as fh:
        return fh.read()


def _pipeline_src():
    with open(os.path.join(_GEN, "automation_pipeline.py")) as fh:
        return fh.read()


def _load_label_helper():
    src = _pipeline_src()
    start = src.index("def _img_label_for")
    end = src.index("QUALITY_TIERS: dict")
    ns: dict = {}
    exec(src[start:end], ns)
    return ns["_img_label_for"]


def test_image_led_runs_are_not_capped_at_the_video_limit():
    src = _schema_src()
    assert "MAX_INPUT_ASSETS = 20" in src
    assert "MAX_INPUT_VIDEOS = 5" in src
    # The truncation must go through the asset ceiling, not a literal 5.
    assert "self.input_video_ids[:MAX_INPUT_ASSETS]" in src
    assert "input_video_ids[:5]" not in src


def test_the_video_sub_cap_is_enforced_where_kind_is_known():
    """The schema cannot tell a video id from an image id — `kind` lives on the
    row — so the video-specific limit has to be applied after the fetch."""
    with open(os.path.join(_HERE, "..", "app", "services", "video_generation_service.py")) as fh:
        src = fh.read()
    assert "MAX_INPUT_VIDEOS" in src
    assert '_video_count > MAX_INPUT_VIDEOS' in src
    # It must only count non-image rows, or a run of screenshots would trip it.
    assert 'if iv_kind != "image":' in src


@pytest.mark.parametrize(
    "index,expected",
    [(0, "A"), (9, "J"), (10, "K"), (25, "Z"), (26, "AA"), (27, "AB")],
)
def test_image_labels_stay_one_namespace_past_ten(index, expected):
    """The old lookup indexed a 10-character string and fell back to the bare
    integer, so an 12-image run produced 'Image J' then 'Image 10'. The
    Director cites these labels back when planning IMAGE_CLIP shots."""
    assert _load_label_helper()(index) == expected


def test_labels_are_unique_across_a_full_run():
    label = _load_label_helper()
    labels = [label(i) for i in range(20)]
    assert len(set(labels)) == 20


def test_ocr_budget_shrinks_as_image_count_grows():
    """OCR blocks dominate an image section. A fixed 15-per-image allowance
    times 20 images is a prompt-budget blowout, and the bboxes are what let
    annotations land on the right element — so they scale, not vanish."""
    src = _pipeline_src()
    assert "_ocr_per_image = max(4, 90 // max(1, _num_images))" in src
    assert "_img_ocr_blocks[:_ocr_per_image]" in src
    assert "_img_ocr_blocks[:15]" not in src

    budget = lambda n: max(4, 90 // max(1, n))
    assert budget(1) >= 15          # a single still keeps a rich read
    assert budget(20) >= 4          # a full run still gets usable anchors
    assert budget(20) < budget(5)   # and the total stays bounded


def test_a_screenshot_run_has_more_than_one_visual_idea():
    """input_image_screenshot is the domain for a product walkthrough. With
    only IMAGE_CLIP + annotation types, 15 shots are 15 framed screenshots."""
    src = ast.parse(open(os.path.join(_GEN, "shot_type_cards.py")).read())
    catalogue = None
    for node in ast.walk(src):
        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value == "input_image_screenshot":
                    catalogue = [e.value for e in v.elts]
    assert catalogue is not None, "input_image_screenshot domain not found"
    assert "IMAGE_CLIP" in catalogue
    # Explanatory graphics for the beats between screenshots.
    assert "TEXT_DIAGRAM" in catalogue
    assert "DATA_STORY" in catalogue
    # DEVICE_MOCKUP builds a synthetic UI from primitives; with the real
    # screenshots attached it would fabricate a product that contradicts them.
    assert "DEVICE_MOCKUP" not in catalogue
