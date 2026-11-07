"""Course to knowledge-base links (course_knowledge.links_enabled).

GET / PUT / DELETE /course-knowledge/v1/packages/{package_id}/links[/{link_id}]

Staff only, by roles (auth.ck_staff; is_root_user is never read), and the
course must belong to the caller's institute. Links spend nothing, so there
is no credit preflight. 403 {code: links_not_enabled} while the platform
flag is off. The logic lives in services/course_knowledge/links.py.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..services.course_knowledge import flags
from ..services.course_knowledge import links as links_service
from ..services.course_knowledge.auth import CkStaff, ck_staff
from ..services.tutor.slide_source import package_belongs_to_institute

router = APIRouter(prefix="/course-knowledge/v1", tags=["course-knowledge"])


class ChapterTopicsItem(BaseModel):
    chapter_name: Optional[str] = Field(default=None, max_length=500)
    chapter_id: Optional[str] = Field(default=None, max_length=255)
    node_ids: List[str] = Field(default_factory=list)


class LinkUpsertRequest(BaseModel):
    knowledge_base_id: str = Field(min_length=1, max_length=255)
    role: Optional[Literal["GROUNDING", "REFERENCE"]] = None
    grounding_mode: Optional[Literal["STRICT", "BLENDED"]] = None
    use_in: Optional[List[Literal["tutor", "chatbot"]]] = None
    topic_node_ids: Optional[List[str]] = None
    # {chapter_id: [node_ids]} or [{chapter_name, node_ids}] (AI course creator).
    chapter_topics: Optional[Union[Dict[str, List[str]], List[ChapterTopicsItem]]] = None
    provenance: Literal["AI_COURSE_CREATOR", "ADMIN", "LEGACY_TUTOR_SETTING"] = "ADMIN"


def _require_links_enabled() -> None:
    if not flags.links_enabled():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "links_not_enabled",
                                    "message": "Course knowledge links are not enabled."})


def _require_package(db: Session, staff: CkStaff, package_id: str) -> None:
    if not package_belongs_to_institute(db, package_id, staff.institute_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "course_not_found", "message": "Course not found in this institute"})


def _http(exc: links_service.LinkError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/packages/{package_id}/links", summary="Knowledge bases linked to a course")
def get_links(
    package_id: str,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """{links, legacy}: the active links, plus the course's Tutor Mode KB
    grounding when no link uses that KB (read-only, never written here)."""
    _require_links_enabled()
    _require_package(db, staff, package_id)
    return links_service.list_links(db, staff.institute_id, package_id)


@router.put("/packages/{package_id}/links", summary="Link a knowledge base to a course (create or update)")
def put_link(
    package_id: str,
    payload: LinkUpsertRequest,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _require_links_enabled()
    _require_package(db, staff, package_id)
    data = payload.model_dump(exclude_unset=True)
    data["knowledge_base_id"] = payload.knowledge_base_id
    data["provenance"] = payload.provenance
    try:
        return links_service.upsert_link(db, staff.institute_id, package_id, data, staff.user_id)
    except links_service.LinkError as exc:
        raise _http(exc) from exc


@router.delete("/packages/{package_id}/links/{link_id}", summary="Remove a course's knowledge-base link")
def delete_link(
    package_id: str,
    link_id: str,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _require_links_enabled()
    _require_package(db, staff, package_id)
    try:
        return links_service.remove_link(db, staff.institute_id, package_id, link_id)
    except links_service.LinkError as exc:
        raise _http(exc) from exc


__all__ = ["router", "LinkUpsertRequest"]
