"""PDF → page images → deskewed/denoised np arrays."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

logger = logging.getLogger(__name__)

DEFAULT_DPI = 200
# Largest tilt deskew() will correct; see the note inside it.
MAX_DESKEW_DEGREES = 10.0


def pdf_to_pages(pdf_path: Path, dpi: int = DEFAULT_DPI) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (page_index, BGR image) for each page in the PDF.

    Uses PyMuPDF (already a dep for the Stage 8 renderer) instead of pdf2image
    so we don't need poppler installed system-wide.
    """
    import fitz

    doc = fitz.open(pdf_path)
    try:
        # PyMuPDF default DPI is 72; scale to target DPI for sharp OCR input.
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
            elif pix.n == 1:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            yield i, img
    finally:
        doc.close()


def deskew(img: np.ndarray) -> np.ndarray:
    """Rotate the page so text is horizontal. Skips if already within ±0.5°."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

    coords = np.column_stack(np.where(binary > 0))
    if coords.size == 0:
        return img
    angle = cv2.minAreaRect(coords)[-1]
    # cv2.minAreaRect's angle convention changed in OpenCV 4.5: it used to be
    # [-90, 0) and is now (0, 90]. A straight page therefore reads as -90 on
    # one version and +90 on the other. Fold both onto a small correction
    # around zero first; the old code only knew the first convention, so on
    # OpenCV 4.6 it turned every straight page by -90 degrees before OCR and
    # the detector saw sideways text as a handful of page-sized boxes.
    if angle > 45:
        angle -= 90
    elif angle < -45:
        angle += 90
    angle = -angle
    if abs(angle) < 0.5:
        return img
    # A scan is never skewed by more than a few degrees; anything larger is
    # the ruled lines or a margin dominating the fit, not a real tilt.
    if abs(angle) > MAX_DESKEW_DEGREES:
        logger.info("deskew: ignoring implausible angle %.1f", angle)
        return img

    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        img, matrix, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def denoise_and_contrast(img: np.ndarray) -> np.ndarray:
    """Denoise + CLAHE for handwriting clarity. Operates on grayscale, returns BGR."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Light non-local-means — strong enough for scan noise, fast enough not to dominate runtime.
    denoised = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def preprocess_page(img: np.ndarray) -> np.ndarray:
    return denoise_and_contrast(deskew(img))
