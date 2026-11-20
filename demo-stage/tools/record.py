"""Record a narrated demo video from the tour catalogue.

Drives the stage page in film mode (the real app, no guide panel), plays the
chosen tours, and lays each step's narration over the recording. The video is
re-made, never edited: change the tour, run this again.

    python3 tools/record.py --lang en --out vacademy-demo-en.mp4
    python3 tools/record.py --tours leads-and-calling,tests --lang hi --out grow-hi.mp4

Needs: playwright (chromium), ffmpeg (PATH or the imageio_ffmpeg package), the
stage page reachable at --stage, and a narration source: --guide (the guide
backend, all four languages) or the open preview voice (English and Hindi).
"""

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

PREVIEW_TTS = "https://backend-stage.vacademy.io/ai-service/tts/v1/speak"
PREVIEW_LANGS = {"en", "hi"}


def ffmpeg_exe() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg  # type: ignore

    return imageio_ffmpeg.get_ffmpeg_exe()


def audio_seconds(ffmpeg: str, path: Path) -> float:
    out = subprocess.run([ffmpeg, "-i", str(path)], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out)
    if not m:
        raise RuntimeError(f"cannot read duration of {path}")
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def line_of(value, lang: str) -> str:
    if isinstance(value, str):
        return value
    return (value or {}).get(lang) or (value or {}).get("en") or ""


def fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "vacademy-demo-recorder"})
    with urllib.request.urlopen(req, timeout=120) as res, open(dest, "wb") as f:
        shutil.copyfileobj(res, f)


def narration(args, catalog, tours, work: Path, ffmpeg: str):
    """Download one audio clip per spoken step. Returns {key: (path, seconds)}."""
    clips = {}
    if not args.guide and args.lang not in PREVIEW_LANGS:
        print(f"! no voice for '{args.lang}' without --guide: recording with captions only")
        return clips
    for tour in tours:
        for i, step in enumerate(tour["steps"]):
            text = line_of(step.get("say"), args.lang)
            if not text:
                continue
            key = f"{tour['id']}:{i}"
            dest = work / f"{tour['id']}-{i}.mp3"
            if args.guide:
                url = f"{args.guide}/narration/{catalog['product']}/{tour['id']}/{i}?lang={args.lang}"
            else:
                url = f"{PREVIEW_TTS}?language={args.lang}&text={urllib.parse.quote(text)}"
            fetch(url, dest)
            clips[key] = (dest, audio_seconds(ffmpeg, dest))
    return clips


async def record(args, tours, clips, work: Path):
    width, height = (int(x) for x in args.size.split("x"))
    sep = "&" if "?" in args.stage else "?"
    url = f"{args.stage}{sep}film=1&lang={args.lang}"
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            viewport={"width": width, "height": height},
            record_video_dir=str(work),
            record_video_size={"width": width, "height": height},
        )
        created = time.time()
        page = await context.new_page()
        await page.goto(url)
        await page.wait_for_function(
            "document.getElementById('veil').classList.contains('off')", timeout=240000
        )
        await page.wait_for_function("window.demoStage && window.demoStage.catalog", timeout=30000)
        await page.wait_for_timeout(5000)  # let the first screen finish loading
        origin = await page.evaluate("performance.timeOrigin") / 1000.0
        await page.evaluate(
            "d => { Object.assign(window.demoStage.film.durations, d); }",
            {k: int(v[1] * 1000) for k, v in clips.items()},
        )
        start = await page.evaluate("performance.now()") / 1000.0
        missed = []
        for tour in tours:
            await page.evaluate(
                "t => window.demoStage.player.caption(t)", line_of(tour["title"], args.lang)
            )
            await page.wait_for_timeout(1600)
            result = await page.evaluate(
                """async ([id, lang]) => {
                    const tour = window.demoStage.catalog.tours.find((t) => t.id === id);
                    return window.demoStage.player.play(tour, lang);
                }""",
                [tour["id"], args.lang],
            )
            missed += [(tour["id"], m["index"], m.get("error")) for m in result.get("missed", [])]
        await page.wait_for_timeout(1200)
        end = await page.evaluate("performance.now()") / 1000.0
        log = await page.evaluate("window.demoStage.film.log")
        video = page.video
        await context.close()
        raw = Path(await video.path())
        await browser.close()
    # Seconds into the raw recording at which the stage document's clock started.
    offset = origin - created
    marks = {entry["key"]: offset + entry["at"] / 1000.0 for entry in log}
    return raw, offset + start, offset + end, marks, missed


def mux(args, ffmpeg: str, raw: Path, start: float, end: float, marks, clips):
    cmd = [ffmpeg, "-y", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(raw)]
    spoken = [(k, clips[k][0], marks[k] - start) for k in clips if k in marks]
    for _, path, _ in spoken:
        cmd += ["-i", str(path)]
    video_args = ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30"]
    if spoken:
        parts = []
        for n, (_, _, at) in enumerate(spoken, start=1):
            ms = max(0, int(at * 1000))
            parts.append(f"[{n}:a]adelay={ms}|{ms},aresample=48000[a{n}]")
        mix = "".join(f"[a{n}]" for n in range(1, len(spoken) + 1))
        parts.append(f"{mix}amix=inputs={len(spoken)}:normalize=0,alimiter=limit=0.95[aout]")
        cmd += ["-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[aout]"]
        cmd += video_args + ["-c:a", "aac", "-b:a", "160k"]
    else:
        cmd += video_args + ["-an"]
    cmd += ["-movflags", "+faststart", args.out]
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(done.stderr[-2000:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", default="http://localhost:5280/?app=http://localhost:5273")
    ap.add_argument("--guide", default="", help="guide backend base URL (…/ai-service/demo-guide/v1)")
    ap.add_argument("--product", default="vacademy")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--tours", default="", help="comma-separated tour ids; default all, in catalogue order")
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    args.guide = args.guide.rstrip("/")

    catalog = json.loads((Path(__file__).resolve().parent.parent / "tours" / f"{args.product}.json").read_text())
    wanted = [t for t in args.tours.split(",") if t]
    by_id = {t["id"]: t for t in catalog["tours"]}
    unknown = [t for t in wanted if t not in by_id]
    if unknown:
        raise SystemExit(f"unknown tours: {unknown}")
    tours = [by_id[t] for t in wanted] if wanted else catalog["tours"]

    ffmpeg = ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix="demo-record-") as tmp:
        work = Path(tmp)
        clips = narration(args, catalog, tours, work, ffmpeg)
        raw, start, end, marks, missed = asyncio.run(record(args, tours, clips, work))
        mux(args, ffmpeg, raw, start, end, marks, clips)
    print(f"wrote {args.out}: {end - start:.1f} s, {len(tours)} tours, {len(clips)} narrated steps")
    if missed:
        print("! steps whose element was not found (shown without a ring):")
        for tour_id, index, error in missed:
            print(f"  {tour_id} step {index}: {error}")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
