"""Request/response shapes for POST /copy-check/scan/build (Scan Station, contract C2).

assessment_service sends the pages of up to 10 copies, already planned: which
pages, in which order, and how far to turn each one. This endpoint only builds
one PDF per copy and uploads it; it never decides grouping or blanks.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_COPIES_PER_CALL = 10
MAX_PAGES_PER_CALL = 300


class ScanBuildPage(BaseModel):
    url: str = Field(..., min_length=8, max_length=4096)
    kind: Literal["IMAGE", "PDF"]
    # Page of a PDF source (0-based); an IMAGE source has only page 0.
    page_index: int = Field(0, ge=0, le=10_000)
    # Clockwise degrees that turn this page upright.
    rotation: Literal[0, 90, 180, 270] = 0
    dpi: int = Field(300, ge=50, le=1200)

    @field_validator("url")
    @classmethod
    def _http_url(cls, v: str) -> str:
        if not v.lower().startswith(("https://", "http://")):
            raise ValueError("url must be http(s)")
        return v


class ScanBuildCopy(BaseModel):
    copy_key: str = Field(..., min_length=1, max_length=64)
    file_name: str = Field(..., min_length=1, max_length=200)
    pages: list[ScanBuildPage] = Field(..., min_length=1)


class ScanBuildRequest(BaseModel):
    institute_id: str = Field(..., min_length=1, max_length=64)
    session_id: Optional[str] = Field(None, max_length=64)
    source_id: str = Field("ASSESSMENT_SCAN_STATION", pattern=r"^[A-Za-z0-9_\-]{1,64}$")
    copies: list[ScanBuildCopy] = Field(..., min_length=1, max_length=MAX_COPIES_PER_CALL)

    @model_validator(mode="after")
    def _caps(self) -> "ScanBuildRequest":
        total = sum(len(c.pages) for c in self.copies)
        if total > MAX_PAGES_PER_CALL:
            raise ValueError(f"at most {MAX_PAGES_PER_CALL} pages per call (got {total})")
        keys = [c.copy_key for c in self.copies]
        if len(set(keys)) != len(keys):
            raise ValueError("copy_key must be unique within a call")
        return self


class ScanBuildCopyResult(BaseModel):
    copy_key: str
    file_id: Optional[str] = None
    page_count: int = 0
    bytes: int = 0
    # null, COPY_TOO_LARGE, SOURCE_UNREADABLE, BUILD_FAILED, UPLOAD_FAILED or TIMEOUT
    error: Optional[str] = None


class ScanBuildResponse(BaseModel):
    copies: list[ScanBuildCopyResult]
