"""extra_metadata.run_request: capture → JSON → rehydrate gives back the exact
generate_till_stage kwargs of the first leg (services/video_run_request)."""
import json
import os
import sys
import types
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from app.routers.external_video_generation import build_generate_kwargs  # noqa: E402
from app.schemas.video_generation import (  # noqa: E402
    BrandOverrides, HostConfig, LessonConfig, ModelOverrides, VideoGenerationRequest,
)
from app.services.video_run_request import capture, rehydrate  # noqa: E402

INST = "11111111-1111-1111-1111-111111111111"


def _full_request() -> VideoGenerationRequest:
    return VideoGenerationRequest(
        prompt="Explain the water cycle",
        video_id="vid-rr",
        quality_tier="ultra",
        language="Hindi",
        target_duration="5 minutes",
        target_audience="Class 8",
        voice_gender="male",
        tts_provider="premium",
        voice_id="hi-IN-Chirp3-HD-Puck",
        captions_enabled=False,
        html_quality="classic",
        orientation="portrait",
        sound_effects_enabled=False,
        background_music_enabled=True,
        background_music_volume=0.3,
        host={"type": "avatar", "host_in_video_percentage": 30,
              "avatar": {"saved_avatar_id": "av-123", "use_avatar_voice": False, "details_prompt": "teacher"}},
        lesson={"enabled": True, "teacher": {"avatar_id": "spatius-avatar-1", "name": "Ms Rao"},
                "subject": "Science"},
        brand_overrides={"palette": {"primary": "#112233"}, "system_prompt": "Be crisp"},
        reference_files=[{"url": "https://bkt.s3.amazonaws.com/x/diagram.png", "name": "diagram.png",
                          "type": "image"}],
        model_overrides={"default": "z-ai/glm-5", "per_stage": {"per_shot_html": "anthropic/claude"}},
        assist_mode=True,
        assist_gates=["shot_plan", "narration"],
        assist_granularity="per_stage",
        routing_overrides={"video_type": "explainer"},
    )


def test_capture_then_rehydrate_round_trips_the_generate_kwargs():
    p = _full_request()
    kwargs = build_generate_kwargs(p, "HTML", INST, "user-1")
    rr = capture("external", "HTML", kwargs)
    stored = json.loads(json.dumps(rr))          # what the JSONB column gives back
    rec = SimpleNamespace(prompt=p.prompt)
    back = rehydrate(stored, rec)

    # Pydantic values come back as their models (host is read with getattr).
    assert isinstance(back["host"], HostConfig)
    assert back["host"].avatar.saved_avatar_id == "av-123"
    assert isinstance(back["lesson"], LessonConfig)
    assert isinstance(back["brand_overrides"], BrandOverrides)
    assert isinstance(back["model_overrides"], ModelOverrides)

    expected = dict(kwargs)
    expected.pop("video_id")                     # the row key, not part of the request
    assert back == expected
    assert stored["kind"] == "external" and stored["final_target_stage"] == "HTML"
    assert stored["institute_id"] == INST and stored["user_id"] == "user-1"
    assert "db_session" not in stored["kwargs"] and "prompt" not in stored["kwargs"]


def test_course_builder_keeps_the_final_target_not_the_leg_target():
    leg_kwargs = dict(language="English", captions_enabled=True, html_quality="advanced", model=None,
                      target_audience="General/Adult", target_duration="2-3 minutes", voice_gender="female",
                      tts_provider="standard", voice_id=None, quality_tier="ultra", institute_id=INST,
                      user_id="u")
    rr = capture("course_builder", "HTML", {**leg_kwargs, "target_stage": "SCRIPT", "resume": False})
    assert rr["kind"] == "course_builder" and rr["final_target_stage"] == "HTML"
    back = rehydrate(json.loads(json.dumps(rr)))
    assert back["target_stage"] == "HTML"
    assert "resume" not in back
    for k, v in leg_kwargs.items():
        assert back[k] == v


def test_rehydrate_drops_a_corrupt_reference_file_and_tolerates_schema_drift():
    rr = {"v": 1, "kind": "lms", "final_target_stage": "HTML",
          "kwargs": {"reference_files": [{"url": "u", "name": "n", "type": "image"}, {"bogus": True}],
                     "host": {"type": "nonsense"}}}
    back = rehydrate(rr)
    assert back["reference_files"] == [{"url": "u", "name": "n", "type": "image"}]
    assert back["host"] == {"type": "nonsense"}   # left as-is rather than crashing the resume
