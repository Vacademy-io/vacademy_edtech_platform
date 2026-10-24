"""
Repository for AI Generated Video database operations.
"""
from __future__ import annotations

import json
import logging
from typing import Optional, Dict, Any, Iterable, List
from uuid import uuid4
from datetime import datetime

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.exc import IntegrityError, OperationalError, PendingRollbackError

from ..models.ai_gen_video import AiGenVideo
from ..db import get_engine


logger = logging.getLogger(__name__)

# extra_metadata keys owned by the resume machinery (lease, run request,
# checkpoint manifest, billing ledger, leg history). They are written ONLY by
# the single-statement atomic SQL below; the whole-column read-modify-write
# writers copy the database's current value of each key into the dict they
# write, so a stale in-memory copy can never revert a heartbeat / claim.
OWNED_METADATA_KEYS = ("run_lease", "run_request", "checkpoint", "billing", "resume_history")


def _preserve_owned_keys(db_meta: Optional[Dict[str, Any]], new_meta: Dict[str, Any]) -> Dict[str, Any]:
    """Return ``new_meta`` with every owned key taken from ``db_meta`` (the row
    as locked FOR UPDATE). A key the database does not have yet is left as the
    caller wrote it."""
    out = dict(new_meta or {})
    db_meta = db_meta if isinstance(db_meta, dict) else {}
    for key in OWNED_METADATA_KEYS:
        if key in db_meta:
            out[key] = db_meta[key]
    return out


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def _is_connection_error(exc: Exception) -> bool:
    """Return True if the exception looks like a stale/dropped DB connection."""
    if isinstance(exc, (OperationalError, PendingRollbackError)):
        return True
    msg = str(exc).lower()
    return (
        "server closed the connection" in msg
        or "connection was reset" in msg
        or "ssl connection has been closed" in msg
        or "could not connect" in msg
        or "broken pipe" in msg
    )


class AiVideoRepository:
    """Repository for managing AI generated video records."""
    
    def __init__(self, session: Optional[Session] = None, engine: Any = None):
        """
        Initialize repository with optional session.
        If no session provided, creates a new one for each operation.
        ``engine`` overrides the app engine (tests against a scratch database).
        """
        self.session = session
        self._engine = engine if engine is not None else get_engine()
    
    def _get_session(self) -> Session:
        """Get session for database operations."""
        if self.session:
            return self.session
        return Session(self._engine)

    def _get_fresh_session(self) -> Session:
        """Always create a fresh session from the engine.

        Used for post-pipeline DB operations where the injected FastAPI session
        may have become stale after a long-running background task.
        """
        return Session(self._engine)
    
    def create(
        self,
        video_id: str,
        prompt: str,
        language: str = "English",
        content_type: str = "VIDEO",
        metadata: Optional[Dict[str, Any]] = None
    ) -> AiGenVideo:
        """
        Create a new AI video generation record.
        
        Args:
            video_id: Unique identifier for the video
            prompt: Text prompt for video generation
            language: Language for video content
            content_type: Type of content (VIDEO, QUIZ, STORYBOOK, etc.)
            metadata: Additional metadata
            
        Returns:
            Created AiGenVideo instance
        """
        session = self._get_session()
        try:
            video_record = AiGenVideo(
                video_id=video_id,
                prompt=prompt,
                language=language,
                content_type=content_type,
                current_stage="PENDING",
                status="PENDING",
                extra_metadata=metadata or {},
                file_ids={},
                s3_urls={}
            )
            session.add(video_record)
            session.commit()
            session.refresh(video_record)
            return video_record
        except IntegrityError:
            session.rollback()
            # Video ID already exists, fetch and return it
            return self.get_by_video_id(video_id)
        finally:
            if not self.session:
                session.close()
    
    def get_by_video_id(self, video_id: str) -> Optional[AiGenVideo]:
        """Get video record by video_id."""
        def _do_get(session: Session) -> Optional[AiGenVideo]:
            stmt = select(AiGenVideo).where(AiGenVideo.video_id == video_id)
            return session.execute(stmt).scalar_one_or_none()

        session = self._get_session()
        try:
            return _do_get(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            # An injected request session can be killed mid-transaction by the
            # server's idle-in-transaction timeout after a long-running task;
            # retry the read once on a fresh engine session.
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do_get(fresh)
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()

    def get_by_id(self, id: str) -> Optional[AiGenVideo]:
        """Get video record by primary key id."""
        def _do_get(session: Session) -> Optional[AiGenVideo]:
            stmt = select(AiGenVideo).where(AiGenVideo.id == id)
            return session.execute(stmt).scalar_one_or_none()

        session = self._get_session()
        try:
            return _do_get(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do_get(fresh)
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()
    
    def update_stage(
        self,
        video_id: str,
        stage: str,
        status: str = "IN_PROGRESS",
        file_id: Optional[str] = None,
        s3_url: Optional[str] = None,
        stage_key: Optional[str] = None
    ) -> Optional[AiGenVideo]:
        """
        Update the current stage and optionally add file information.
        
        Args:
            video_id: Video identifier
            stage: New stage (SCRIPT, TTS, WORDS, HTML, RENDER, COMPLETED)
            status: Status (IN_PROGRESS, COMPLETED, FAILED)
            file_id: File ID to store for this stage
            s3_url: S3 URL to store for this stage
            stage_key: Key to use in file_ids/s3_urls JSON (defaults to lowercase stage)
            
        Returns:
            Updated AiGenVideo instance
        """
        def _do_update_stage(session: Session) -> Optional[AiGenVideo]:
            video = session.query(AiGenVideo).filter_by(video_id=video_id).first()
            if not video:
                return None
            video.current_stage = stage
            video.status = status
            video.updated_at = datetime.utcnow()
            if file_id or s3_url:
                key = stage_key or stage.lower()
                if file_id:
                    file_ids = {}
                    if video.file_ids:
                        file_ids.update(video.file_ids)
                    file_ids[key] = file_id
                    video.file_ids = file_ids
                    flag_modified(video, "file_ids")
                if s3_url:
                    s3_urls = {}
                    if video.s3_urls:
                        s3_urls.update(video.s3_urls)
                    s3_urls[key] = s3_url
                    video.s3_urls = s3_urls
                    flag_modified(video, "s3_urls")
            if stage == "COMPLETED":
                video.completed_at = datetime.utcnow()
            session.commit()
            session.refresh(video)
            return video

        session = self._get_session()
        try:
            return _do_update_stage(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            # If the injected session is stale, retry with a fresh engine session
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do_update_stage(fresh)
                except Exception as e2:
                    fresh.rollback()
                    raise e2
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()
    
    def update_files(
        self,
        video_id: str,
        file_ids: Optional[Dict[str, str]] = None,
        s3_urls: Optional[Dict[str, str]] = None
    ) -> Optional[AiGenVideo]:
        """
        Update file_ids and s3_urls for a video.
        
        Args:
            video_id: Video identifier
            file_ids: Dictionary of stage -> file_id mappings
            s3_urls: Dictionary of stage -> s3_url mappings
            
        Returns:
            Updated AiGenVideo instance
        """
        def _do_update_files(session: Session) -> Optional[AiGenVideo]:
            video = session.query(AiGenVideo).filter_by(video_id=video_id).first()
            if not video:
                return None
            if file_ids:
                current_file_ids = {}
                if video.file_ids:
                    current_file_ids.update(video.file_ids)
                current_file_ids.update(file_ids)
                video.file_ids = current_file_ids
                flag_modified(video, "file_ids")
            if s3_urls:
                current_s3_urls = {}
                if video.s3_urls:
                    current_s3_urls.update(video.s3_urls)
                current_s3_urls.update(s3_urls)
                video.s3_urls = current_s3_urls
                flag_modified(video, "s3_urls")
            video.updated_at = datetime.utcnow()
            session.commit()
            session.refresh(video)
            return video

        session = self._get_session()
        try:
            return _do_update_files(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            # If the injected session is stale, retry with a fresh engine session
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do_update_files(fresh)
                except Exception as e2:
                    fresh.rollback()
                    raise e2
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()
    
    def clear_video_url(self, video_id: str) -> Optional[AiGenVideo]:
        """Remove the rendered video file from s3_urls and file_ids.

        Used when the user wants to re-render a video — the next download
        button click should trigger a fresh render instead of returning the
        old cached video.
        """
        def _do_clear(session: Session) -> Optional[AiGenVideo]:
            video = self._load_locked(session, video_id)
            if not video:
                return None
            if video.s3_urls and "video" in video.s3_urls:
                new_urls = dict(video.s3_urls)
                new_urls.pop("video", None)
                video.s3_urls = new_urls
                flag_modified(video, "s3_urls")
            if video.file_ids and "video" in video.file_ids:
                new_ids = dict(video.file_ids)
                new_ids.pop("video", None)
                video.file_ids = new_ids
                flag_modified(video, "file_ids")
            # Also clear render_job_id from metadata so the frontend doesn't
            # try to resume a stale render job after the URL is cleared.
            if video.extra_metadata and "render_job_id" in video.extra_metadata:
                new_meta = dict(video.extra_metadata)
                new_meta.pop("render_job_id", None)
                video.extra_metadata = _preserve_owned_keys(video.extra_metadata, new_meta)
                flag_modified(video, "extra_metadata")
            video.updated_at = datetime.utcnow()
            session.commit()
            session.refresh(video)
            return video

        session = self._get_session()
        try:
            return _do_clear(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do_clear(fresh)
                except Exception as e2:
                    fresh.rollback()
                    raise e2
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()

    @staticmethod
    def _load_locked(session: Session, video_id: str) -> Optional[AiGenVideo]:
        """The row locked FOR UPDATE with its CURRENT column values.

        populate_existing() matters for an injected session: without it the
        identity map would hand back the attributes loaded earlier in the
        session, and _preserve_owned_keys would copy a stale lease."""
        return (
            session.query(AiGenVideo)
            .filter_by(video_id=video_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def update_metadata(self, video_id: str, metadata: Dict[str, Any]) -> None:
        """Update the metadata JSON column for a video.

        Whole-column write; the resume-owned keys (OWNED_METADATA_KEYS) keep
        the database's current value."""
        session = self._get_session()
        try:
            video = self._load_locked(session, video_id)
            if video:
                video.extra_metadata = _preserve_owned_keys(video.extra_metadata, metadata)
                flag_modified(video, "extra_metadata")
                video.updated_at = datetime.utcnow()
                session.commit()
        except Exception:
            session.rollback()
        finally:
            if not self.session:
                session.close()

    def update_assist_state(
        self,
        video_id: str,
        assist_block: Dict[str, Any],
        status: Optional[str] = None,
        current_stage: Optional[str] = None,
    ) -> Optional[AiGenVideo]:
        """Persist the assist-mode block into ``extra_metadata.assist``.

        Used by the gate framework to store the pending decision, record answers,
        and flip the video to ``AWAITING_INPUT`` while a gate waits on the user.
        The caller computes ``assist_block`` (via ``decision_gates`` helpers) so
        this method stays a dumb, robust writer. Mirrors ``update_stage``'s
        stale-session retry so the /decision endpoint can rely on it.
        """
        def _do(session: Session) -> Optional[AiGenVideo]:
            video = self._load_locked(session, video_id)
            if not video:
                return None
            meta = dict(video.extra_metadata or {})
            meta["assist"] = assist_block
            video.extra_metadata = _preserve_owned_keys(video.extra_metadata, meta)
            flag_modified(video, "extra_metadata")
            if status is not None:
                video.status = status
            if current_stage is not None:
                video.current_stage = current_stage
            video.updated_at = datetime.utcnow()
            session.commit()
            session.refresh(video)
            return video

        session = self._get_session()
        try:
            return _do(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do(fresh)
                except Exception as e2:
                    fresh.rollback()
                    raise e2
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()

    def update_thumbnails(self, video_id: str, thumbnails: Dict[str, Any]) -> None:
        """Replace the thumbnails JSONB blob for a video.

        Used by the pipeline after the thumbnail stage produces a set, and by
        the external API when the user swaps selection or regenerates.
        """
        session = self._get_fresh_session()
        try:
            video = session.query(AiGenVideo).filter_by(video_id=video_id).first()
            if not video:
                return
            video.thumbnails = thumbnails or {}
            flag_modified(video, "thumbnails")
            video.updated_at = datetime.utcnow()
            session.commit()
        except Exception:
            session.rollback()
        finally:
            if not self.session:
                session.close()

    def set_selected_thumbnail(self, video_id: str, selected_id: str) -> Optional[Dict[str, Any]]:
        """Swap which option is selected. Returns the updated thumbnails blob, or None on miss.

        Returns None if the video doesn't exist or the selected_id isn't in the option set.
        """
        session = self._get_fresh_session()
        try:
            video = session.query(AiGenVideo).filter_by(video_id=video_id).first()
            if not video:
                return None
            current = dict(video.thumbnails or {})
            options = current.get("options") or []
            if not any(isinstance(o, dict) and o.get("id") == selected_id for o in options):
                return None
            current["selected_id"] = selected_id
            video.thumbnails = current
            flag_modified(video, "thumbnails")
            video.updated_at = datetime.utcnow()
            session.commit()
            return current
        except Exception:
            session.rollback()
            return None
        finally:
            if not self.session:
                session.close()

    def update_live_snapshot(
        self,
        video_id: str,
        snapshot: Dict[str, Any],
    ) -> None:
        """Replace ``extra_metadata.live`` with the latest aggregator snapshot.

        Called periodically (~every 5 s) by the async flusher in the
        generation service so post-restart polls and history reads can fall
        back to the persisted snapshot when the in-process aggregator no
        longer has the run. Always overwrites — the snapshot is already the
        authoritative shape; merging would double-count.

        Best-effort: any DB error is swallowed so a transient Postgres
        hiccup never breaks the pipeline thread.
        """
        if not snapshot:
            return
        session = self._get_fresh_session()
        try:
            video = self._load_locked(session, video_id)
            if not video:
                return
            meta = dict(video.extra_metadata or {})
            meta["live"] = snapshot
            video.extra_metadata = _preserve_owned_keys(video.extra_metadata, meta)
            flag_modified(video, "extra_metadata")
            video.updated_at = datetime.utcnow()
            session.commit()
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
        finally:
            session.close()

    def update_generation_progress(
        self,
        video_id: str,
        event: Dict[str, Any],
    ) -> None:
        """Merge a pipeline progress event into extra_metadata.generation_progress.

        Persisted structure (all fields optional — set as they become available):
          sub_stage          str    current human-readable label
          shots_completed    int    running count of completed shots
          shots_total        int    total shots planned by Director
          shot_plan          list   [{shot_index, shot_type, duration_s, start_time,
                                      end_time, narration_excerpt}]  — set once from director_done
          shots_history      list   per-shot record: {shot_index, shot_type, duration_s,
                                      start_time, end_time, token_delta, cumulative_tokens}
                                    capped at 200 entries for storage safety
          cumulative_tokens  dict   {prompt_tokens, completion_tokens, total_tokens,
                                      estimated_cost_usd}  — latest snapshot
          last_shot          dict   most recent completed shot (quick access)
          errors             list   [{shot_index, shot_type, error, retrying, attempt,
                                      timestamp}]  — all shot_error events, capped at 50
          last_event         dict   raw last pipeline event (no shots_summary/shot_plan)
        """
        session = self._get_fresh_session()
        try:
            video = self._load_locked(session, video_id)
            if not video:
                return
            meta = dict(video.extra_metadata or {})
            prog = dict(meta.get("generation_progress") or {})

            event_type = event.get("type")

            if event_type == "shot_done":
                prog["shots_completed"] = prog.get("shots_completed", 0) + 1
                prog["sub_stage"] = event.get("message", "Generating visuals")

                _shot_record = {
                    "shot_index": event.get("shot_index"),
                    "shot_type": event.get("shot_type"),
                    "duration_s": event.get("duration_s"),
                    "start_time": event.get("start_time"),
                    "end_time": event.get("end_time"),
                    "model": event.get("model"),
                    "token_delta": event.get("token_delta"),
                    "cumulative_tokens": event.get("cumulative_tokens"),
                }
                prog["last_shot"] = _shot_record
                # Full per-shot history for post-run analysis (capped at 200)
                history = list(prog.get("shots_history") or [])
                history.append(_shot_record)
                prog["shots_history"] = history[-200:]

            elif event_type == "shot_error":
                prog["sub_stage"] = event.get("message", "Shot error")
                errors = list(prog.get("errors") or [])
                errors.append({
                    "shot_index": event.get("shot_index"),
                    "shot_type": event.get("shot_type"),
                    "error": event.get("error", "")[:300],
                    "retrying": event.get("retrying", False),
                    "attempt": event.get("attempt"),
                    "timestamp": datetime.utcnow().isoformat(),
                })
                prog["errors"] = errors[-50:]  # keep last 50 errors

            elif event_type == "sub_stage":
                prog["sub_stage"] = event.get("message") or event.get("sub_stage", "")
                sub = event.get("sub_stage", "")
                if sub == "director_done":
                    prog["shots_total"] = event.get("shot_count", prog.get("shots_total"))
                    if event.get("shots_summary"):
                        prog["shot_plan"] = event["shots_summary"]

            if event.get("cumulative_tokens"):
                prog["cumulative_tokens"] = event["cumulative_tokens"]

            # Compact last_event (strip large lists to keep JSONB row size sane)
            prog["last_event"] = {k: v for k, v in event.items()
                                  if k not in ("shots_summary", "shot_plan", "shots_history")}

            meta["generation_progress"] = prog
            video.extra_metadata = _preserve_owned_keys(video.extra_metadata, meta)
            flag_modified(video, "extra_metadata")
            video.updated_at = datetime.utcnow()
            session.commit()
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
        finally:
            session.close()

    def record_warning(self, video_id: str, message: str) -> None:
        """Attach a warning to a run WITHOUT changing its status.

        A film that shipped 20 of 28 shots is still watchable, so marking it
        FAILED would be wrong and marking it PARTIAL would hand the frontend a
        status value it does not know. But COMPLETED with an empty
        error_message is how a missing certificate reveal went unnoticed. This
        keeps the status honest and the shortfall visible.
        """
        session = self._get_fresh_session()
        try:
            video = session.query(AiGenVideo).filter(
                AiGenVideo.video_id == video_id
            ).first()
            if not video:
                return
            video.error_message = message
            session.commit()
        finally:
            session.close()

    def mark_failed(
        self,
        video_id: str,
        error_message: str,
        current_stage: Optional[str] = None
    ) -> Optional[AiGenVideo]:
        """
        Mark video generation as failed.
        
        Args:
            video_id: Video identifier
            error_message: Error description
            current_stage: Stage where failure occurred (optional)
            
        Returns:
            Updated AiGenVideo instance
        """
        def _do_mark_failed(session: Session) -> Optional[AiGenVideo]:
            video = session.query(AiGenVideo).filter_by(video_id=video_id).first()
            if not video:
                return None
            video.status = "FAILED"
            video.error_message = error_message
            if current_stage:
                video.current_stage = current_stage
            video.updated_at = datetime.utcnow()
            session.commit()
            session.refresh(video)
            return video

        session = self._get_session()
        try:
            return _do_mark_failed(session)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            if self.session and _is_connection_error(e):
                fresh = self._get_fresh_session()
                try:
                    return _do_mark_failed(fresh)
                except Exception as e2:
                    fresh.rollback()
                    raise e2
                finally:
                    fresh.close()
            raise e
        finally:
            if not self.session:
                session.close()
    
    def mark_completed(self, video_id: str) -> Optional[AiGenVideo]:
        """Mark video generation as completed."""
        return self.update_stage(video_id, "COMPLETED", "COMPLETED")

    # ── Atomic metadata writes (resume machinery) ─────────────────────────
    # Each is ONE statement on a fresh session, decided from RETURNING (psycopg
    # 3 can report rowcount -1). They never read-modify-write the column, so
    # concurrent writers on other pods / threads cannot lose each other's keys.

    def _returning(self, sql: str, params: Dict[str, Any], lock_timeout: Optional[str] = None) -> Optional[Any]:
        """Run one UPDATE ... RETURNING on a fresh session and commit; the first
        returned row (None when nothing matched). DB errors propagate.
        ``lock_timeout`` (e.g. "5s") bounds the wait for the row lock — SET
        LOCAL, so it ends with this transaction (pgbouncer-safe)."""
        session = self._get_fresh_session()
        try:
            if lock_timeout:
                session.execute(text(f"SET LOCAL lock_timeout = '{lock_timeout}'"))
            row = session.execute(text(sql), params).fetchone()
            session.commit()
            return row
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
            raise
        finally:
            session.close()

    def merge_metadata(self, video_id: str, patch: Dict[str, Any]) -> bool:
        """Shallow-merge ``patch`` into the metadata column (``||``). True when
        the row exists. Never raises (logged)."""
        try:
            row = self._returning(
                "UPDATE ai_gen_video SET metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:p AS jsonb), "
                "updated_at = now() WHERE video_id = :v RETURNING video_id",
                {"v": video_id, "p": _json(patch or {})},
            )
            return row is not None
        except Exception as exc:  # noqa: BLE001
            logger.warning("[AiVideoRepo] merge_metadata failed for %s: %s", video_id, exc)
            return False

    def update_checkpoint(
        self,
        video_id: str,
        fields: Optional[Dict[str, Any]] = None,
        add_stages: Iterable[str] = (),
    ) -> bool:
        """Merge ``fields`` into ``metadata.checkpoint`` and union ``add_stages``
        into ``checkpoint.completed_stages`` — one statement, so a stage append
        and the uploader's progress writes never overwrite each other."""
        fields = {k: v for k, v in (fields or {}).items() if k != "completed_stages"}
        try:
            row = self._returning(
                """
                UPDATE ai_gen_video SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb), '{checkpoint}',
                    COALESCE(metadata->'checkpoint', '{}'::jsonb) || CAST(:f AS jsonb)
                    || jsonb_build_object('completed_stages', (
                        SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
                        FROM jsonb_array_elements_text(
                            COALESCE(metadata #> '{checkpoint,completed_stages}', '[]'::jsonb)
                            || CAST(:st AS jsonb)) AS t(x)))
                ), updated_at = now()
                WHERE video_id = :v RETURNING video_id
                """,
                {"v": video_id, "f": _json(fields), "st": _json([str(s) for s in add_stages if s])},
            )
            return row is not None
        except Exception as exc:  # noqa: BLE001
            logger.warning("[AiVideoRepo] update_checkpoint failed for %s: %s", video_id, exc)
            return False

    def record_stage_billed(self, video_id: str, stage: str, info: Dict[str, Any]) -> bool:
        """``metadata.billing.stages_billed[stage] = info`` (observability)."""
        try:
            row = self._returning(
                """
                UPDATE ai_gen_video SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb), '{billing}',
                    COALESCE(metadata->'billing', '{}'::jsonb)
                    || jsonb_build_object('stages_billed',
                        COALESCE(metadata #> '{billing,stages_billed}', '{}'::jsonb)
                        || jsonb_build_object(CAST(:s AS text), CAST(:i AS jsonb)))
                ) WHERE video_id = :v RETURNING video_id
                """,
                {"v": video_id, "s": str(stage), "i": _json(info or {})},
            )
            return row is not None
        except Exception as exc:  # noqa: BLE001
            logger.warning("[AiVideoRepo] record_stage_billed failed for %s: %s", video_id, exc)
            return False

    def acquire_lease(self, video_id: str, lease: Dict[str, Any], stale_s: int = 180) -> bool:
        """Take the run lease for a new leg. Succeeds when there is no lease,
        it was released / interrupted / handed off, its heartbeat is older than
        ``stale_s``, or this very process owns it. False = another live leg
        holds it (or the row is missing / CANCELLED). DB errors propagate."""
        row = self._returning(
            """
            UPDATE ai_gen_video
               SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{run_lease}', CAST(:l AS jsonb)),
                   updated_at = now()
             WHERE video_id = :v
               AND status NOT IN ('CANCELLED')
               AND (metadata->'run_lease' IS NULL
                    OR metadata->'run_lease'->>'state' IN ('released', 'interrupted', 'handoff')
                    OR (metadata->'run_lease'->>'heartbeat_at')::timestamptz
                       < now() - make_interval(secs => CAST(:stale AS double precision))
                    OR metadata->'run_lease'->>'owner_boot' = :me)
            RETURNING video_id
            """,
            {"v": video_id, "l": _json(lease), "stale": int(stale_s), "me": str(lease.get("owner_boot") or "")},
        )
        return row is not None

    def heartbeat(self, video_id: str, leg_id: str) -> Optional[str]:
        """Bump ``run_lease.heartbeat_at`` (and updated_at, so /urls never
        reads a live run as STALLED) for the leg that owns the lease. Returns
        the row's status, or None when the lease belongs to another leg
        (fenced) or the row is gone."""
        row = self._returning(
            """
            UPDATE ai_gen_video
               SET metadata = jsonb_set(metadata, '{run_lease,heartbeat_at}', to_jsonb(now()::text)),
                   updated_at = now()
             WHERE video_id = :v AND metadata->'run_lease'->>'leg_id' = :leg
            RETURNING status
            """,
            {"v": video_id, "leg": str(leg_id)},
            # One heartbeat thread serves every leg on the pod: a row lock held
            # by a long transaction must fail THIS beat, not stall all of them
            # until the other pod reads every leg as dead and takes it over.
            lock_timeout="5s",
        )
        return row[0] if row is not None else None

    def release_lease(
        self,
        video_id: str,
        leg_id: str,
        state: str,
        history: Optional[Dict[str, Any]] = None,
        **fields: Any,
    ) -> bool:
        """End a leg: merge ``{state, **fields}`` into the lease when it is
        still this leg's (compare-and-set on leg_id) and append ``history`` to
        ``metadata.resume_history`` (last 10 kept)."""
        patch = {"state": state, **fields}
        hist = history if isinstance(history, dict) else None
        try:
            row = self._returning(
                """
                UPDATE ai_gen_video
                   SET metadata = CASE WHEN CAST(:h AS jsonb) IS NULL
                       THEN jsonb_set(metadata, '{run_lease}', (metadata->'run_lease') || CAST(:p AS jsonb))
                       ELSE jsonb_set(
                           jsonb_set(metadata, '{run_lease}', (metadata->'run_lease') || CAST(:p AS jsonb)),
                           '{resume_history}',
                           (SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) FROM (
                               SELECT e, ord FROM jsonb_array_elements(
                                   CASE WHEN jsonb_typeof(metadata->'resume_history') = 'array'
                                        THEN metadata->'resume_history' ELSE '[]'::jsonb END
                                   || jsonb_build_array(CAST(:h AS jsonb))) WITH ORDINALITY AS t(e, ord)
                               ORDER BY ord DESC LIMIT 10) AS last10))
                       END,
                       updated_at = now()
                 WHERE video_id = :v AND metadata->'run_lease'->>'leg_id' = :leg
                RETURNING video_id
                """,
                {"v": video_id, "leg": str(leg_id), "p": _json(patch), "h": _json(hist) if hist else None},
            )
            return row is not None
        except Exception as exc:  # noqa: BLE001
            logger.warning("[AiVideoRepo] release_lease failed for %s: %s", video_id, exc)
            return False

    def claim_for_resume(self, video_id: str, observed_leg_id: str, new_lease: Dict[str, Any]) -> bool:
        """Compare-and-set the lease from the leg the caller observed to
        ``new_lease``. Exactly one concurrent claimer wins."""
        row = self._returning(
            """
            UPDATE ai_gen_video
               SET metadata = jsonb_set(metadata, '{run_lease}', CAST(:l AS jsonb)),
                   updated_at = now()
             WHERE video_id = :v
               AND metadata->'run_lease'->>'leg_id' = :observed
               AND status NOT IN ('FAILED', 'CANCELLED', 'AWAITING_INPUT')
            RETURNING video_id
            """,
            {"v": video_id, "observed": str(observed_leg_id), "l": _json(new_lease)},
        )
        return row is not None

    def find_resumable(self, limit: int, my_boot_at: str) -> List[Dict[str, Any]]:
        """Rows a resumer may pick up: a live-looking status, a recorded run
        request, a lease that was interrupted before this process booted or
        whose heartbeat is more than 180 s old, created in the last 6 h."""
        session = self._get_fresh_session()
        try:
            rows = session.execute(
                text(
                    """
                    SELECT video_id, metadata->'run_lease' AS lease, current_stage, status
                      FROM ai_gen_video
                     WHERE status NOT IN ('FAILED', 'CANCELLED', 'AWAITING_INPUT')
                       AND metadata ? 'run_request'
                       AND metadata->'run_lease'->>'state' IN ('running', 'handoff', 'interrupted')
                       AND created_at > now() - interval '6 hours'
                       AND ((metadata->'run_lease'->>'state' = 'interrupted'
                             AND (metadata->'run_lease'->>'interrupted_at')::timestamptz
                                 < CAST(:boot AS timestamptz))
                            OR (metadata->'run_lease'->>'heartbeat_at')::timestamptz
                               < now() - interval '180 seconds')
                     ORDER BY updated_at
                     LIMIT :lim
                    """
                ),
                {"boot": my_boot_at, "lim": int(limit)},
            ).fetchall()
            session.commit()
            out: List[Dict[str, Any]] = []
            for r in rows:
                lease = r[1]
                if isinstance(lease, str):
                    try:
                        lease = json.loads(lease)
                    except Exception:  # noqa: BLE001
                        lease = None
                out.append({"video_id": r[0], "lease": lease or {}, "current_stage": r[2], "status": r[3]})
            return out
        finally:
            session.close()

    def get_history_by_institute(
        self,
        institute_id: str,
        limit: int = 10,
        offset: int = 0
    ) -> list[AiGenVideo]:
        """Get history of generations for an institute."""
        session = self._get_session()
        try:
            # Query JSONB metadata field
            stmt = (
                select(AiGenVideo)
                .where(AiGenVideo.extra_metadata['institute_id'].astext == institute_id)
                .order_by(AiGenVideo.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
            result = session.execute(stmt)
            return result.scalars().all()
        finally:
            if not self.session:
                session.close()

