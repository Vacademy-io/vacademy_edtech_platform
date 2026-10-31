"""The lesson teacher: one Spatius Video API render per lesson, cut into
transparent clips per layout run.

Facts these tests pin, measured on the real API on 2026-10-12: a second job
while one runs answers 429 (one job at a time per app); the voice sits a fixed
~0.2 s into the returned MP4; the avatar comes back on the solid colour we ask
for, so a green background keys out into a clean alpha channel.
"""

import json
import os
import shutil
import subprocess
import sys

import httpx
import pytest

_HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(_HERE, "..", "app", "ai-video-gen-main"))

import lesson_teacher as lt  # noqa: E402

FFMPEG = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")


@pytest.fixture(autouse=True)
def _keys(monkeypatch):
    monkeypatch.setenv("SPATIUS_API_KEY", "k")
    monkeypatch.setenv("SPATIUS_APP_ID", "app")
    if FFMPEG:
        monkeypatch.setenv("FFMPEG_BIN", FFMPEG)


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


# ── Spatius API ──────────────────────────────────────────────────────────────

def test_submit_waits_out_the_one_job_slot_and_asks_for_a_green_screen():
    calls = []

    def handler(req):
        calls.append(json.loads(req.content))
        if len(calls) < 3:
            return httpx.Response(429, json={"error": {"code": "rate_limit_exceeded"}})
        return httpx.Response(200, json={"jobId": "job-1", "status": "queued"})

    slept = []
    job = lt.submit_video("av", "https://s3/x.wav", name="vacademy-run", client=_client(handler),
                          sleep=slept.append)
    assert job == "job-1" and len(calls) == 3 and len(slept) == 2
    video = calls[-1]["video"]
    assert video["backgroundColor"] == "#00B140"   # with the '#': without it the API answers 400
    assert video["fit"] == "contain" and (video["width"], video["height"]) == (1920, 1080)
    assert calls[-1]["avatarId"] == "av" and calls[-1]["audioUrl"] == "https://s3/x.wav"


def test_submit_reports_a_vendor_error_returned_with_http_200():
    def handler(req):
        return httpx.Response(200, json={"errors": [{"message": "avatar not found"}]})

    with pytest.raises(lt.TeacherRenderError, match="avatar not found"):
        lt.submit_video("av", "u", name="n", client=_client(handler), sleep=lambda s: None)


def test_wait_follows_the_stages_to_the_video_url():
    stages = iter(["submitting", "driving", "rendering"])

    def handler(req):
        try:
            st = next(stages)
            return httpx.Response(200, json={"job": {"status": "processing", "progress": {"stage": st}}})
        except StopIteration:
            return httpx.Response(200, json={"job": {"status": "succeeded"}, "videoUrl": "https://r2/v.mp4"})

    seen = []
    url = lt.wait_for_video("job-1", timeout_s=60, client=_client(handler), sleep=lambda s: None,
                            on_progress=seen.append)
    assert url == "https://r2/v.mp4" and seen[:3] == ["submitting", "driving", "rendering"]


def test_a_failed_job_raises():
    def handler(req):
        return httpx.Response(200, json={"job": {"status": "failed", "error": {"message": "bad audio"}}})

    with pytest.raises(lt.TeacherRenderError, match="failed"):
        lt.wait_for_video("j", timeout_s=60, client=_client(handler), sleep=lambda s: None)


def test_platform_credits_are_a_display_estimate_of_vendor_usd():
    """The charge is made in video_generation_service from the DB price and
    ratio; this is only the estimate written into lesson_outputs.json."""
    assert lt.platform_credits_for(0.1106) == 16.59          # a real 145.7 s render
    assert lt.platform_credits_for(0.126, credits_per_usd=100) == 12.6
    assert lt.platform_credits_for(0) == 0.0
    assert lt.platform_credits_for(None) == 0.0
    # 168 s of video at $0.045/min ≈ 18.9 credits, not the old 8/started minute (24).
    assert lt.platform_credits_for(168 / 60.0 * lt.VENDOR_USD_PER_MINUTE) == 18.9


# ── framing ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("cw,ch,layout", [(422, 454, "corner"), (480, 640, "side"), (690, 842, "presenter"),
                                          (270, 270, "bubble"), (374, 498, "side")])
def test_crop_frames_the_teacher_inside_the_render(cw, ch, layout):
    box = (482, 114, 1437, 1080)   # measured subject box of a real render
    x, y, w, h = lt.crop_for(cw, ch, box, layout=layout)
    assert 0 <= x and x + w <= 1920 and 0 <= y and y + h <= 1080
    if layout != "bubble":
        assert y + h == 1080 or abs(h - 1080) <= 2      # shoulders reach the bottom edge
    assert w >= cw and h >= ch                           # never upscaled: the face stays sharp
    assert abs(w / h - cw / ch) < 0.02                   # no stretching
    assert x <= (482 + 1437) // 2 <= x + w               # centred on the teacher
    assert y <= 114                                      # head room kept


# ── media (real ffmpeg) ──────────────────────────────────────────────────────

def _ff(*args):
    subprocess.run([FFMPEG, "-v", "error", "-y", *args], check=True, capture_output=True)


@needs_ffmpeg
def test_offset_is_measured_from_the_audio(tmp_path):
    # speech-like bursts; the "render" carries the same audio 0.30 s later
    src = tmp_path / "voice.wav"
    _ff("-f", "lavfi", "-i",
        "sine=f=220:d=12,volume='if(lt(mod(t,1.7),0.6),1,0.02)':eval=frame", "-ac", "1", "-ar", "24000", str(src))
    rendered = tmp_path / "render.wav"
    _ff("-i", str(src), "-af", "adelay=300", "-ac", "1", "-ar", "24000", str(rendered))
    assert abs(lt.measure_offset(src, rendered) - 0.30) <= 0.02


@needs_ffmpeg
def test_green_is_keyed_to_a_transparent_webm(tmp_path):
    # green 1920x1080 frame with a skin-toned "teacher" block in the middle
    src = tmp_path / "render.mp4"
    _ff("-f", "lavfi", "-i", "color=c=0x00B140:s=1920x1080:d=2:r=25",
        "-vf", "drawbox=x=760:y=200:w=400:h=880:color=0xD9A07A:t=fill", "-pix_fmt", "yuv420p", str(src))
    assert lt.subject_box(src, 1.0)[0] in range(755, 766)
    out = tmp_path / "clip.webm"
    try:
        lt.cut_clip(src, start_s=0.2, duration_s=1.0, crop=(470, 100, 980, 980), out_w=576, out_h=576,
                    out_path=out)
    except lt.TeacherRenderError as e:
        if "libvpx" in str(e) or "Unknown encoder" in str(e):
            pytest.skip("ffmpeg without libvpx-vp9")
        raise
    raw = subprocess.run([FFMPEG, "-v", "error", "-c:v", "libvpx-vp9", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
    assert len(raw) == 576 * 576 * 4
    alpha = lambda x, y: raw[(y * 576 + x) * 4 + 3]  # noqa: E731
    assert alpha(10, 10) < 20            # green → transparent
    assert alpha(288, 400) > 235         # teacher → opaque


# ── pre-cut reuse ────────────────────────────────────────────────────────────

def test_precut_clips_are_reused_when_the_section_still_matches(monkeypatch, tmp_path):
    """Clips are cut while the board is generated; the timeline step reuses
    them. Section starts are fixed by the recorded voice — only the last
    section can be stretched to the audio end, which the +1 s tail covers."""
    cuts = []

    def fake_cut(src, *, start_s, duration_s, crop, out_w, out_h, out_path):
        cuts.append((round(start_s, 2), round(duration_s, 2)))
        out_path.write_bytes(b"x")
        return out_path

    monkeypatch.setattr(lt, "cut_clip", fake_cut)
    up = lambda path, key, ct: f"https://s3/{path.name}"  # noqa: E731
    track = {"raw_mp4": str(tmp_path / "raw.mp4"), "offset_s": 0.2, "subject_box": [482, 114, 1437, 1080],
             "video_seconds": 40.0}
    pre = [{"layout": "presenter", "start": 0.0, "end": 9.0}, {"layout": "side", "start": 9.0, "end": 30.0}]
    lt.build_clips(track, pre, content_starts_at=0.0, width=1920, height=1080, run_dir=tmp_path,
                   run_name="r", uploader=up, pad_end_s=1.0)
    assert cuts == [(0.2, 10.0), (9.2, 22.0)] and len(track["precut"]) == 2

    cuts.clear()
    # final timeline: 3 s intro, last section stretched by 0.6 s, and a corner run that was never pre-cut
    final = [{"layout": "presenter", "start": 3.0, "end": 12.0}, {"layout": "side", "start": 12.0, "end": 33.6},
             {"layout": "corner", "start": 33.6, "end": 38.0}]
    urls = lt.build_clips(track, final, content_starts_at=3.0, width=1920, height=1080, run_dir=tmp_path,
                          run_name="r", uploader=up, reuse=track["precut"])
    assert urls[0].endswith("teacher_pre_000_presenter.webm") and urls[1].endswith("teacher_pre_001_side.webm")
    assert cuts == [(30.8, 4.4)]   # only the new run is cut (narration 30.6 s + 0.2 s offset)


# ── resume: the Spatius job survives a deploy / crash ────────────────────────

def _fake_media(monkeypatch, *, events, voice_bytes=b"VOICE-PCM"):
    """Stub every ffmpeg / network edge of render_track. `events` records the
    paid calls in order so tests can assert what happened when."""
    def to_wav(src, out):
        out.write_bytes(voice_bytes)
        return out

    def submit(avatar_id, audio_url, *, name, **kw):
        events.append(("submit", audio_url))
        return "job-new"

    def wait(job_id, *, timeout_s, **kw):
        events.append(("wait", job_id))
        return f"https://vendor/{job_id}.mp4"

    def download(url, out):
        events.append(("download", url))
        out.write_bytes(b"MP4")
        return out

    monkeypatch.setattr(lt, "to_wav", to_wav)
    monkeypatch.setattr(lt, "media_duration", lambda p: 40.0)
    monkeypatch.setattr(lt, "submit_video", submit)
    monkeypatch.setattr(lt, "wait_for_video", wait)
    monkeypatch.setattr(lt, "_download", download)
    monkeypatch.setattr(lt, "measure_offset", lambda a, b: 0.2)
    monkeypatch.setattr(lt, "subject_box", lambda p, t: (480, 110, 1440, 1080))


def _voice(tmp_path):
    v = tmp_path / "narration.mp3"
    v.write_bytes(b"mp3")
    return v


def _uploader(events, fail_mp4=False):
    def up(path, key, ct):
        if fail_mp4 and key.endswith("teacher_raw.mp4"):
            raise RuntimeError("s3 down")
        events.append(("upload", key))
        return f"https://s3/{key}"
    return up


def test_fresh_render_persists_the_job_right_after_submit(monkeypatch, tmp_path):
    events, ckpts = [], []
    _fake_media(monkeypatch, events=events)
    cache = tmp_path / lt.CACHE_NAME

    def checkpoint(paths):
        # Snapshot what the uploader would read at this moment.
        ckpts.append([(p.name, json.loads(p.read_text()).get("status") if p.suffix == ".json" else None)
                      for p in paths])
        events.append(("checkpoint", None))

    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events), checkpoint=checkpoint)
    kinds = [e[0] for e in events]
    # the submitted job is checkpointed BEFORE the (long) wait for the render
    assert kinds.index("submit") < kinds.index("checkpoint") < kinds.index("wait")
    assert ckpts[0] == [(lt.CACHE_NAME, "submitted")]
    # ready: json only — the raw mp4 went up once through the uploader
    assert ckpts[-1] == [(lt.CACHE_NAME, "ready")]
    assert res["status"] == "ready" and res["job_id"] == "job-new"
    assert res["raw_mp4_url"] == "https://s3/ai-videos/vid1/lesson/teacher_raw.mp4"
    assert res["voice_sha256"] and json.loads(cache.read_text())["raw_mp4_url"] == res["raw_mp4_url"]
    assert not [p for p in tmp_path.iterdir() if p.name.endswith(".tmp")]   # atomic writes


def test_submitted_cache_re_polls_the_same_job_without_a_second_render(monkeypatch, tmp_path):
    events, ckpts = [], []
    _fake_media(monkeypatch, events=events)
    import hashlib
    (tmp_path / lt.CACHE_NAME).write_text(json.dumps({
        "status": "submitted", "provider": "spatius", "job_id": "job-old", "avatar_id": "av",
        "audio_url": "https://s3/old.wav", "voice_sha256": hashlib.sha256(b"VOICE-PCM").hexdigest(),
    }))
    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events), checkpoint=lambda paths: ckpts.append([p.name for p in paths]))
    assert not [e for e in events if e[0] == "submit"]           # no new paid job
    assert ("wait", "job-old") in events
    assert not [e for e in events if e == ("upload", "ai-videos/vid1/lesson/teacher_voice.wav")]
    assert res["status"] == "ready" and res["job_id"] == "job-old" and res["audio_url"] == "https://s3/old.wav"
    assert ckpts == [[lt.CACHE_NAME]]


def test_submitted_cache_for_a_different_voice_renders_again(monkeypatch, tmp_path):
    events = []
    _fake_media(monkeypatch, events=events)
    (tmp_path / lt.CACHE_NAME).write_text(json.dumps({
        "status": "submitted", "job_id": "job-old", "avatar_id": "av", "voice_sha256": "not-this-voice",
    }))
    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events))
    assert [e for e in events if e[0] == "submit"] and res["job_id"] == "job-new"


def test_a_dead_submitted_job_is_submitted_once_more(monkeypatch, tmp_path):
    events = []
    _fake_media(monkeypatch, events=events)
    import hashlib

    def wait(job_id, *, timeout_s, **kw):
        events.append(("wait", job_id))
        if job_id == "job-old":
            raise lt.TeacherRenderError("Spatius job expired")
        return "https://vendor/new.mp4"

    monkeypatch.setattr(lt, "wait_for_video", wait)
    (tmp_path / lt.CACHE_NAME).write_text(json.dumps({
        "status": "submitted", "job_id": "job-old", "avatar_id": "av", "audio_url": "https://s3/old.wav",
        "voice_sha256": hashlib.sha256(b"VOICE-PCM").hexdigest(),
    }))
    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events))
    assert [e[0] for e in events if e[0] in ("wait", "submit")] == ["wait", "submit", "wait"]
    assert ("submit", "https://s3/old.wav") in events and res["job_id"] == "job-new"


def test_ready_cache_restored_on_another_pod_downloads_the_raw_render(monkeypatch, tmp_path):
    events = []
    _fake_media(monkeypatch, events=events)
    (tmp_path / lt.CACHE_NAME).write_text(json.dumps({
        "status": "ready", "job_id": "job-old", "avatar_id": "av", "raw_mp4": "/old-pod/tmp/lesson/teacher_raw.mp4",
        "raw_mp4_url": "https://s3/ai-videos/vid1/lesson/teacher_raw.mp4", "precut": [{"url": "https://s3/c.webm"}],
    }))
    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events))
    assert [e[0] for e in events] == ["download"]                  # no submit, no wait, no upload
    assert res["raw_mp4"] == str(tmp_path / "lesson" / "teacher_raw.mp4")
    assert (tmp_path / "lesson" / "teacher_raw.mp4").read_bytes() == b"MP4"
    assert res["precut"] == [{"url": "https://s3/c.webm"}]


def test_raw_mp4_goes_to_the_checkpoint_only_when_its_own_upload_failed(monkeypatch, tmp_path):
    events, ckpts = [], []
    _fake_media(monkeypatch, events=events)
    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events, fail_mp4=True),
                          checkpoint=lambda paths: ckpts.append([p.name for p in paths]))
    assert res["raw_mp4_url"] is None and res["status"] == "ready"
    assert ckpts[-1] == [lt.CACHE_NAME, "teacher_raw.mp4"]


def test_a_failing_checkpoint_never_fails_the_render(monkeypatch, tmp_path):
    events = []
    _fake_media(monkeypatch, events=events)

    def boom(paths):
        raise RuntimeError("uploader exploded")

    res = lt.render_track(voice_audio=_voice(tmp_path), avatar_id="av", run_dir=tmp_path, run_name="vid1",
                          uploader=_uploader(events), checkpoint=boom)
    assert res["status"] == "ready"
