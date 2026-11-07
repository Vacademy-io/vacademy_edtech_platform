"""The v3 ShotPlanner must know about the user's uploaded images.

IMAGE_CLIP — the shot type that puts an uploaded screenshot on screen — was
reachable only from the deprecated v2 `_run_director`, which built its own
SOURCE IMAGE CONTEXTS block. v3 is the only supported pipeline, and its planner
was never told the images existed: `plan_shots` had no parameter for them, none
was passed, and IMAGE_CLIP appeared nowhere in its shot-type menu.

An image-led run therefore indexed every still, paid for every caption and OCR
pass, and then planned a video that referenced none of them.
"""

import os
import sys

import pytest

_HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(_HERE, "..", "app", "ai-video-gen-main"))

import shot_planner as sp  # noqa: E402


def _image(idx, name, text_blocks=(), ui=(), mode="screenshot"):
    return {
        "index": idx,
        "kind": "image",
        "name": name,
        "mode": mode,
        "source_public_url": f"https://s3/{name}",
        "duration_seconds": 6.0,
        "context": {
            "meta": {"width": 1600, "height": 900},
            "caption": {
                "short": f"{name} caption",
                "tags": ["dashboard", "form"],
                "ui_elements": list(ui),
            },
            "ocr": {
                "blocks": [
                    {"text": t, "bbox_norm": [0.1, 0.2, 0.3, 0.4]} for t in text_blocks
                ]
            },
        },
    }


def _prompt(**kw):
    base = dict(
        prompt="explain the flow",
        target_duration_s=270.0,
        target_audience="General/Adult",
        language="English",
        content_type="VIDEO",
        tier="super_ultra",
        image_ratio="16:9",
    )
    base.update(kw)
    return sp.build_shot_planner_user_prompt(**base)


def test_image_clip_is_offered_when_images_are_uploaded():
    out = _prompt(input_images=[_image(0, "dashboard.png", ["Stage tracker"])])
    assert "IMAGE_CLIP IS AVAILABLE" in out
    assert "SOURCE IMAGE CONTEXTS" in out
    assert "image_index: 0" in out
    assert "https://s3/dashboard.png" in out


def test_image_clip_is_forbidden_when_none_are_uploaded():
    """Mirrors the SOURCE_CLIP gating — an ungated shot type gets picked and
    then has nothing to render."""
    out = _prompt()
    assert "IMAGE_CLIP IS NOT AVAILABLE" in out
    assert "SOURCE IMAGE CONTEXTS" not in out


def test_the_shot_type_menu_documents_image_clip():
    assert "**IMAGE_CLIP**" in sp.SHOT_PLANNER_SYSTEM_PROMPT
    assert "image_index" in sp.SHOT_PLANNER_SYSTEM_PROMPT


def test_ocr_bboxes_reach_the_planner():
    """The bboxes are the whole reason this block is worth its tokens — they
    are what let a callout land on the element it names."""
    out = _prompt(input_images=[_image(0, "form.png", ["Send OTP", "School name"])])
    assert "bbox_norm" in out
    assert "Send OTP" in out


def test_ocr_volume_scales_down_with_many_images():
    """A 20-still run must not emit 15 OCR blocks per image."""
    many = [_image(i, f"s{i}.png", [f"line{j}" for j in range(30)]) for i in range(20)]
    few = [_image(0, "s0.png", [f"line{j}" for j in range(30)])]
    big = sp.build_input_image_block(many)
    small = sp.build_input_image_block(few)
    assert small.count("bbox_norm") >= 15
    assert big.count("bbox_norm") / 20 < small.count("bbox_norm")
    assert big.count("bbox_norm") >= 20 * 4  # floor keeps anchors usable


def test_labels_stay_one_namespace_past_ten_images():
    block = sp.build_input_image_block([_image(i, f"s{i}.png") for i in range(12)])
    assert "Image K:" in block
    assert "Image 10:" not in block


def test_planner_is_told_not_to_invent_a_substitute():
    """The failure this guards is a generated illustration standing in for a
    real screenshot the user supplied."""
    block = sp.build_input_image_block([_image(0, "cert.png")])
    assert "Do NOT invent an illustration" in block


def test_image_index_survives_normalization():
    """Without the pass-through the planner's choice is dropped and every clip
    falls back to image 0."""
    shot = sp._normalize_shot(
        {
            "shot_type": "IMAGE_CLIP",
            "image_index": 7,
            "duration_estimate_s": 6,
            "narration_brief": "the dashboard",
        },
        0,
    )
    assert shot["image_index"] == 7


def test_source_video_index_survives_normalization():
    """Same bug on the video side: source_start/source_end were passed through
    but the index naming WHICH video they refer to was not."""
    shot = sp._normalize_shot(
        {
            "shot_type": "SOURCE_CLIP",
            "source_video_index": 2,
            "source_start": 10,
            "source_end": 18,
            "duration_estimate_s": 8,
            "narration_brief": "the demo",
        },
        0,
    )
    assert shot["source_video_index"] == 2


def test_plan_shots_accepts_input_images():
    import inspect

    assert "input_images" in inspect.signature(sp.plan_shots).parameters


def test_ocr_full_text_carries_identity_when_there_is_no_caption():
    """The image indexer emits meta / colors / ocr only — no caption block.

    So `short`, `long`, `tags` and `ui_elements` are absent on every real asset,
    and OCR is the ONLY signal describing what an upload depicts. The prompt
    names screenshots by content ("the framework formula screenshot"), so
    without this the planner has nothing but the filename to match on.
    """
    img = {
        "name": "02-framework-formula",
        "mode": "screenshot",
        "source_public_url": "https://s3/x.png",
        "duration_seconds": 6.0,
        "context": {
            "meta": {"width": 1600, "height": 900},
            # Exactly the shape the indexer produces — note: no "caption" key.
            "ocr": {
                "full_text": "Accreditation\nFramework\nPART 1 OF 2\n600",
                "blocks": [{"text": "600", "bbox_norm": [0.1, 0.2, 0.3, 0.4]}] * 30,
            },
            "colors": {"dominant": []},
        },
    }
    block = sp.build_input_image_block([img])
    assert "Text on screen:" in block
    assert "PART 1 OF 2" in block
    # Placement anchors survive alongside identity.
    assert "bbox_norm" in block


def test_a_caption_less_asset_does_not_crash_the_block():
    """Every caption-derived line must degrade to absent, not raise."""
    bare = {
        "name": "x",
        "mode": "screenshot",
        "source_public_url": "https://s3/x.png",
        "context": {"meta": {}, "ocr": {}},
    }
    block = sp.build_input_image_block([bare])
    assert "image_index: 0" in block
    assert "https://s3/x.png" in block


def test_bbox_floor_survives_a_full_twenty_image_run():
    """OCR was budgeted assuming a caption existed. With no caption it is the
    only content signal, so the floor must stay usable at the 20-image cap."""
    img = {
        "name": "s", "mode": "screenshot", "source_public_url": "https://s3/s.png",
        "context": {"meta": {}, "ocr": {
            "full_text": "hello", "blocks": [{"text": "t", "bbox_norm": [0, 0, 1, 1]}] * 40}},
    }
    block = sp.build_input_image_block([img] * 20)
    assert block.count("bbox_norm") >= 20 * 6


def _shot(name, lines):
    return {
        "name": name, "mode": "screenshot",
        "source_public_url": f"https://s3/{name}.png",
        "context": {"meta": {}, "ocr": {"full_text": "\n".join(lines), "blocks": []}},
    }


def test_shared_chrome_does_not_make_every_screen_read_the_same():
    """Screens from one product share a nav bar. Taken verbatim, the first
    characters of every screenshot in a walkthrough are that same menu, so each
    image described itself identically and the planner could not tell them
    apart — the whole point of this block.
    """
    NAV = ["Home", "Framework", "Fee", "Login", "Apply Now"]
    imgs = [
        _shot("formula", NAV + ["Dual-Assessment Framework", "600 marks"]),
        _shot("dashboard", NAV + ["Five stages", "Under review"]),
        _shot("certificate", NAV + ["Certificate of Accreditation", "A++"]),
        _shot("verify", NAV + ["ICOSA Verified", "Credential ID"]),
    ]
    block = sp.build_input_image_block(imgs)
    excerpts = [
        line[len("Text on screen: "):]
        for line in block.split("\n")
        if line.startswith("Text on screen:")
    ]
    assert len(excerpts) == 4
    assert len(set(excerpts)) == 4, f"screens not distinguishable: {excerpts}"
    # The distinctive text must lead; chrome may appear but must not crowd it out.
    assert "Dual-Assessment Framework" in excerpts[0]
    assert "Certificate of Accreditation" in excerpts[2]


def test_a_screen_that_is_only_chrome_still_describes_itself():
    """Ranking must not empty an excerpt — a screen whose text is entirely
    shared still needs to say something rather than nothing."""
    NAV = ["Home", "Framework", "Login"]
    imgs = [_shot(f"s{i}", NAV) for i in range(5)]
    block = sp.build_input_image_block(imgs)
    excerpts = [l for l in block.split("\n") if l.startswith("Text on screen:")]
    assert len(excerpts) == 5
    assert all(len(e) > len("Text on screen: ") for e in excerpts)
