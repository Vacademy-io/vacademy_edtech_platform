"""Manual live probe: read SCORM slides drawn as images with each OCR engine. NOT run in CI.

For one package it lists every iSpring slide (its own text, images, whether
it counts as an image slide), composes the chosen slides exactly as course
knowledge does, and reads each composed picture with MathPix and with the
vision model, printing both side by side so the engine for platform setting
course_knowledge.scorm_ocr_engine can be picked on real (Hindi + English)
slides. Nothing is written to the database and nothing is billed; each read
costs the platform one provider call.

Keys come from the environment only (MATHPIX_APP_ID / MATHPIX_APP_KEY,
OPENROUTER_API_KEY) and are never printed. Run it from a prod pod:

  kubectl exec deploy/ai-service -- python -m ai_service.scripts.scorm_ocr_probe \\
      --root https://d1om4dxj9e7kkd.cloudfront.net/scorm/<package-id>/ --slides 3,5 \\
      --engines mathpix,vision --save /tmp/scorm-probe
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from typing import List, Optional


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Live OCR probe of SCORM image slides (manual; not CI).")
    p.add_argument("--root", required=True, help="package root URL (the folder holding imsmanifest.xml)")
    p.add_argument("--slides", default="", help="comma list of slide numbers to read (default: the image slides)")
    p.add_argument("--engines", default="mathpix,vision", help="comma list of mathpix,vision")
    p.add_argument("--save", default="", help="folder to save the composed slide pictures in")
    return p.parse_args(argv)


async def _main(args: argparse.Namespace) -> int:
    from ai_service.app.services.course_knowledge.extract import ispring, scorm
    from ai_service.app.services.course_knowledge.extract.types import SlideRef

    root = args.root if args.root.endswith("/") else args.root + "/"
    ref = SlideRef(slide_id="probe", title="probe", description="", status="PUBLISHED", source_type="SCORM",
                   doc_type=None, pointer_kind="scorm", pointer_key="probe", extras={"launch_url": root + "x.html"})
    pkg = await scorm._read_package(ref, root)
    image_slides = set(await scorm._mark_image_slides(pkg))
    print(f"package: {len(pkg.slides)} slide(s), {len(pkg.sections)} iSpring Page section(s), "
          f"{len(pkg.html)} html page(s); image slides: {sorted(image_slides) or 'none'}")
    for s in sorted(pkg.slides, key=lambda x: x.number):
        print(f"  slide {s.number}: {len(s.layout.text)} chars of its own text, {len(s.layout.images)} image(s)"
              f"{'  <- image slide' if s.number in image_slides else ''}")
    wanted = {int(x) for x in args.slides.split(",") if x.strip().isdigit()} or image_slides
    engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    readers, closers = {}, []
    if "mathpix" in engines:
        readers["mathpix"] = (await scorm._mathpix_reader())[0]
    if "vision" in engines:
        vision = await scorm._vision_reader(os.environ.get("PROBE_INSTITUTE_ID", "default"))
        if vision is None:
            print("vision: no OpenRouter key; skipped")
        else:
            readers["vision"], closers = vision[0], [vision[1]]
    sem = asyncio.Semaphore(scorm.FETCH_CONCURRENCY)
    for slide in sorted(pkg.slides, key=lambda x: x.number):
        if slide.number not in wanted:
            continue
        await scorm._download_images(slide, root, sem, {"left": scorm.MAX_SLIDE_IMAGE_BYTES})
        picture, mime, painted = ispring.compose_slide(slide.layout, slide.images)
        print(f"\n=== slide {slide.number}: {painted} image(s) painted, {len(picture or b'')} bytes {mime}")
        if picture is None:
            continue
        if args.save:
            os.makedirs(args.save, exist_ok=True)
            path = os.path.join(args.save, f"slide{slide.number}.{'png' if mime == 'image/png' else 'jpg'}")
            with open(path, "wb") as fh:
                fh.write(picture)
            print(f"saved {path}")
        print(f"--- own text:\n{slide.layout.text or '(none)'}")
        for name, read in readers.items():
            started = time.monotonic()
            ok, text = await read(picture, mime)
            print(f"--- {name} ({'ok' if ok else 'FAILED'}, {time.monotonic() - started:.1f} s, {len(text)} chars):\n{text}")
    for close in closers:
        await close()
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    return asyncio.run(_main(_parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
