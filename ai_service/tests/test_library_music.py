"""Built-in CC0 background music (app/services/music_library.py): catalogue,
request plumbing, pipeline choice handling and the mix that ducks it."""
from __future__ import annotations

import __future__
import ast
import inspect
import json
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from pydantic import ValidationError  # noqa: E402

from app.services import music_library as ml  # noqa: E402

PIPELINE_DIR = Path(__file__).resolve().parent.parent / "app" / "ai-video-gen-main"
PIPELINE = PIPELINE_DIR / "automation_pipeline.py"
sys.path.insert(0, str(PIPELINE_DIR))
INST = "11111111-1111-1111-1111-111111111111"


# --------------------------------------------------------------------------
# catalogue
# --------------------------------------------------------------------------

ARCHIVE_FILES = {  # the set's real files and durations (archive.org metadata, 2026-10-27)
    "winaaa_bgm_calm_v1.mp3": 182.88, "winaaa_bgm_calm_v3.mp3": 174.58, "winaaa_bgm_warm_v2.mp3": 170.71,
    "winaaa_bgm_explainer_v2.mp3": 142.26, "winaaa_bgm_explainer_v3.mp3": 156.76,
    "winaaa_bgm_bright_v1.mp3": 132.44,
}


def test_every_track_is_a_real_file_of_the_cc0_set():
    assert len(ml.TRACKS) == 6
    for tid, t in ml.TRACKS.items():
        assert t.id == tid and t.file in ARCHIVE_FILES
        assert t.duration_s == ARCHIVE_FILES[t.file]
        assert t.file == f"winaaa_bgm_{tid}.mp3", "ids trace back to the source file"
        assert t.source_url == f"https://archive.org/download/winaaa-bgm-cc0/{t.file}"
        assert t.s3_key == f"ai-videos/_library/music/winaaa/{t.file}"
        assert t.url == f"https://vacademy-media-storage-public.s3.amazonaws.com/{t.s3_key}"
        assert 60 <= t.bpm <= 130 and t.mood in ("calm", "warm", "explainer", "bright")
    assert ml.CHOICES == ("none", "auto", *ml.TRACKS)


def test_choice_validation():
    assert ml.normalize_choice(None) is None and ml.normalize_choice("  ") is None
    assert ml.normalize_choice(" AUTO ") == "auto" and ml.normalize_choice("Calm_V1") == "calm_v1"
    assert ml.normalize_choice("none") == "none"
    with pytest.raises(ValueError):
        ml.normalize_choice("lyria")


def test_auto_picks_by_tone():
    assert ml.pick_track("auto", lesson=True, style_mode="marketing").id == "calm_v1"
    assert ml.pick_track("auto", style_mode="marketing").id == "bright_v1"
    assert ml.pick_track("auto", style_mode="bold").id == "bright_v1"
    assert ml.pick_track("auto", style_mode="educational").id == "explainer_v2"
    assert ml.pick_track("warm_v2", lesson=True).id == "warm_v2"
    assert ml.pick_track("none") is None and ml.pick_track(None) is None


def test_s3_copy_when_uploaded_else_the_archive_original():
    t = ml.TRACKS["calm_v1"]
    assert ml.playable_url(t, lambda u: True) == t.url
    assert ml.playable_url(t, lambda u: False) == t.source_url

    def boom(_u):
        raise OSError("403")

    assert ml.playable_url(t, boom) == t.source_url


# --------------------------------------------------------------------------
# request plumbing: schema → generate kwargs → run_request → service → pipeline
# --------------------------------------------------------------------------

def _req(**kw):
    from app.schemas.video_generation import VideoGenerationRequest
    return VideoGenerationRequest(prompt="Explain the water cycle", video_id="vid-m", **kw)


def test_the_request_field_is_validated_and_off_by_default():
    assert _req().background_music is None
    assert _req(background_music="AUTO").background_music == "auto"
    assert _req(background_music="bright_v1").background_music == "bright_v1"
    with pytest.raises(ValidationError):
        _req(background_music="jazz")


def test_it_rides_the_generate_kwargs_and_survives_a_resume():
    from app.routers.external_video_generation import build_generate_kwargs
    from app.services.video_run_request import capture, rehydrate

    kwargs = build_generate_kwargs(_req(background_music="warm_v2"), "HTML", INST, "u")
    assert kwargs["background_music"] == "warm_v2"
    back = rehydrate(json.loads(json.dumps(capture("external", "HTML", kwargs))), SimpleNamespace(prompt="p"))
    assert back["background_music"] == "warm_v2"
    assert build_generate_kwargs(_req(), "HTML", INST, "u")["background_music"] is None


def test_the_service_passes_it_to_the_pipeline_and_stores_it():
    from app.services.video_generation_service import VideoGenerationService

    for fn in (VideoGenerationService.generate_till_stage, VideoGenerationService._run_pipeline_stages):
        p = inspect.signature(fn).parameters["background_music"]
        assert p.default is None
    src = inspect.getsource(VideoGenerationService)
    assert 'gen_metadata["background_music"] = str(background_music)' in src
    assert src.count("background_music=background_music,") == 2  # → _run_pipeline_stages, → pipeline.run
    run_params = _pipeline_run_params()
    assert "background_music" in run_params


def _pipeline_run_params() -> List[str]:
    tree = ast.parse(PIPELINE.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "VideoGenerationPipeline")
    run = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "run")
    return [a.arg for a in run.args.args + run.args.kwonlyargs]


def test_the_lms_request_carries_it_and_the_institute_policy_can_default_it():
    from app.routers import lms_video
    from app.services import ai_video_policy_service as policy_svc

    assert "background_music" in lms_video.LmsVideoRequest.model_fields if hasattr(lms_video, "LmsVideoRequest") \
        else "background_music: Optional[str]" in inspect.getsource(lms_video)
    src = inspect.getsource(lms_video)
    assert "background_music=req.background_music," in src
    assert 'payload.model_copy(update={"background_music": policy["background_music"]})' in src
    assert policy_svc.normalize_policy(None)["background_music"] is None
    assert policy_svc.normalize_policy({"background_music": "AUTO"})["background_music"] == "auto"
    assert policy_svc.normalize_policy({"background_music": "jazz"})["background_music"] is None
    assert "background_music" in policy_svc.public_policy(policy_svc.normalize_policy({}))


def test_super_admin_can_set_and_clear_the_default():
    from app.routers.super_admin_ai_video_policy import AiVideoPolicyUpdate

    assert AiVideoPolicyUpdate(background_music="calm_v1", reason="r").changes() == {"background_music": "calm_v1"}
    assert AiVideoPolicyUpdate(background_music=None, reason="r").changes() == {"background_music": None}
    assert AiVideoPolicyUpdate(reason="r").changes() == {}
    with pytest.raises(ValidationError):
        AiVideoPolicyUpdate(background_music="jazz", reason="r")


# --------------------------------------------------------------------------
# pipeline choice handling
# --------------------------------------------------------------------------

_FUTURE = __future__.annotations.compiler_flag


def _pipeline(choice: Optional[str], *, tier_on: bool = False, override: Optional[bool] = None,
              lesson: bool = False, mode: str = "educational"):
    tree = ast.parse(PIPELINE.read_text())
    body: List[ast.stmt] = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_normalize_music_choice"]
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "VideoGenerationPipeline")
    want = {"_is_background_music_enabled", "_wants_generated_music", "_library_music_track", "_effective_music_volume"}
    body.append(ast.ClassDef(name="P", bases=[], keywords=[], decorator_list=[],
                             body=[n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in want]))
    # The pipeline reaches music_library through _platform_module; hand it this
    # file's copy so the monkeypatches below are the ones it sees.
    ns: Dict[str, Any] = {"Any": Any, "Dict": Dict, "Optional": Optional,
                          "_platform_module": lambda dotted: ml if dotted == "services.music_library" else None}
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(PIPELINE), "exec",
                 flags=_FUTURE, dont_inherit=True), ns)
    p = object.__new__(ns["P"])
    p._background_music_choice = ns["_normalize_music_choice"](choice)
    p._background_music_enabled_override = override
    p._background_music_volume_override = None
    p._tier_config = {"background_music_enabled": tier_on, "background_music_default_volume": 0.10}
    p._lesson_plan = {"teacher": {}} if lesson else None
    p._resolve_visual_style_mode = lambda: mode
    return p


def test_absent_choice_keeps_todays_behaviour():
    assert _pipeline(None, tier_on=True)._is_background_music_enabled() is True
    assert _pipeline(None, tier_on=True)._wants_generated_music() is True
    assert _pipeline(None, tier_on=False)._is_background_music_enabled() is False
    assert _pipeline(None, override=True)._wants_generated_music() is True
    assert _pipeline(None, tier_on=True)._library_music_track() is None


def test_none_turns_music_off_even_on_a_music_tier():
    p = _pipeline("none", tier_on=True, override=True)
    assert p._is_background_music_enabled() is False and p._wants_generated_music() is False
    assert p._library_music_track() is None


def test_a_library_choice_turns_music_on_without_lyria(monkeypatch):
    monkeypatch.setattr(ml, "head_ok", lambda url, timeout=5.0: False)  # not uploaded yet
    p = _pipeline("auto", tier_on=False, lesson=True)
    assert p._is_background_music_enabled() is True
    assert p._wants_generated_music() is False, "no Director music plan, no Lyria call"
    track = p._library_music_track()
    assert track["id"] == "background-music" and track["provider"] == "library:calm_v1"
    assert track["url"] == ml.TRACKS["calm_v1"].source_url
    assert track["loop"] is True and track["fadeIn"] == 2.0 and track["fadeOut"] == 3.0
    assert track["volume"] == 0.10


def test_marketing_auto_is_bright_and_louder(monkeypatch):
    monkeypatch.setattr(ml, "head_ok", lambda url, timeout=5.0: True)
    track = _pipeline("auto", mode="marketing")._library_music_track()
    assert track["provider"] == "library:bright_v1" and track["url"] == ml.TRACKS["bright_v1"].url
    assert track["volume"] == 0.22


def test_an_unknown_stored_choice_is_dropped_not_fatal():
    p = _pipeline("jazz", tier_on=False)
    assert p._background_music_choice is None and p._is_background_music_enabled() is False


def test_the_music_block_uses_the_library_before_lyria():
    src = PIPELINE.read_text()
    i = src.index("_lib_track = (")
    block = src[i:i + 1600]
    assert "self._background_music_track = _lib_track" in block
    assert block.index("_lib_track") < block.index("self._is_background_music_enabled()")
    assert src.count("include_music_plan=self._wants_generated_music(),") == 2
    assert "if self._wants_generated_music():\n            director_system = director_system + MUSIC_PLAN_EXTENSION" in src


# --------------------------------------------------------------------------
# the mix that bakes it in: looped, faded, ducked under the voice
# --------------------------------------------------------------------------

def test_the_mix_loops_fades_and_ducks_the_music(tmp_path):
    import audio_mixer as am

    spec = am.MixSpec(vo_path=tmp_path / "vo.mp3", video_duration_s=600.0, music_path=tmp_path / "bed.mp3",
                      music_volume=0.10, music_fade_in_s=2.0, music_fade_out_s=3.0,
                      enable_ducking=True, enable_loudnorm=True, enable_vo_aware_volume=False)
    graph, _out = am._build_filter_graph(spec, [], 2)
    assert "aloop=loop=-1" in graph and "atrim=duration=600.0" in graph, "a 3-min loop fills 10 min"
    assert "afade=t=in:st=0:d=2.00" in graph and "afade=t=out:st=597.00:d=3.00" in graph
    assert "sidechaincompress=" in graph and "[bgm_raw][vo_sc]" in graph


def test_no_music_is_todays_vo_only_graph(tmp_path):
    import audio_mixer as am

    spec = am.MixSpec(vo_path=tmp_path / "vo.mp3", video_duration_s=60.0, enable_vo_aware_volume=False)
    graph, _out = am._build_filter_graph(spec, [], 1)
    assert "aloop" not in graph and "sidechaincompress" not in graph and "bgm" not in graph


def test_the_upload_script_targets_the_catalogue_keys():
    src = (Path(__file__).resolve().parent.parent / "scripts" / "upload_music_library.py").read_text()
    assert "from app.services.music_library import S3_BUCKET, TRACKS" in src
    assert "track.s3_key" in src and "track.source_url" in src and 'ContentType="audio/mpeg"' in src
