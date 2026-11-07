"""
Learner-chatbot tools about the learner's own studies: courses and where to
resume, live classes, tests and results.

Each tool reads the shared admin_core_service database directly (one short
query, identity from the chat session — never from model arguments) and
returns a ToolOutput: text for the model plus a card the learner can click.
Links are learner-app routes, built exactly the way the app builds them.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from .chat_cards import ToolOutput

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

SLIDE_ROUTE = "/study-library/courses/course-details/subjects/modules/chapters/slides"
COURSE_ROUTE = "/study-library/courses/course-details"


def slide_link(row) -> str:
    """Learner-app route that opens a slide (same params as the dashboard)."""
    return SLIDE_ROUTE + "?" + urlencode({
        "courseId": row["package_id"] or "",
        "levelId": row["level_id"] or "",
        "subjectId": row["subject_id"] or "",
        "moduleId": row["module_id"] or "",
        "chapterId": row["chapter_id"] or "",
        "slideId": row["slide_id"] or "",
        "sessionId": row["package_session_id"] or "",
    })


def course_link(package_id: str, package_session_id: str) -> str:
    """Learner-app course page (CourseCards.tsx builds the same)."""
    return COURSE_ROUTE + "?" + urlencode({
        "courseId": package_id or "",
        "packageSessionId": package_session_id or "",
    })


def to_ist(value: Optional[datetime]) -> Optional[datetime]:
    """DB timestamps are naive UTC (the JVMs run in UTC); timestamptz passes through."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST)


def when_label(value: Optional[datetime], now: Optional[datetime] = None) -> str:
    """'today 5:30 PM', 'yesterday 9:00 AM', 'Mon 12 Oct 4:00 PM' (IST)."""
    local = to_ist(value)
    if local is None:
        return ""
    now = (now or datetime.now(IST)).astimezone(IST)
    clock = local.strftime("%I:%M %p").lstrip("0")
    days = (local.date() - now.date()).days
    if days == 0:
        return f"today {clock}"
    if days == -1:
        return f"yesterday {clock}"
    if days == 1:
        return f"tomorrow {clock}"
    return local.strftime("%a %d %b ") + clock


# ── get_my_courses ───────────────────────────────────────────────────────────

MY_COURSES_TOOL = {
    "type": "function",
    "function": {
        "name": "get_my_courses",
        "description": (
            "The student's enrolled courses with completion %, the lesson they last opened (and "
            "when), or the lesson to start with if they haven't begun. Shown to them as cards "
            "with a Continue/Start link. Use for: 'my courses', 'where did I leave off', "
            "'continue', 'what should I study now', 'how far am I', or when they seem unsure "
            "where to begin."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

# Mirrors the learner app's course list (PackageRepository active-course rules,
# % from learner_operation PACKAGE_SESSION rollup) and resolves a resume point
# per course from activity_log — newest real view wins. The app's own
# dashboard "recent slides" query is not ordered by time, so it is not reused.
# For a course never opened: its first slide in the app's own order.
_MY_COURSES_SQL = text("""
WITH enrolled AS (
    SELECT ps.id AS package_session_id, ps.package_id, ps.level_id,
           p.package_name, l.level_name, se.session_name,
           MIN(m.enrolled_date) AS enrolled_date, MAX(m.expiry_date) AS expiry_date
      FROM student_session_institute_group_mapping m
      JOIN package_session ps ON ps.id = m.package_session_id AND ps.status IN ('ACTIVE','HIDDEN')
      JOIN package p ON p.id = ps.package_id AND p.status = 'ACTIVE'
                    AND COALESCE(p.package_type,'') NOT IN ('DELIVERY_CHARGE','SECURITY_DEPOSIT')
      LEFT JOIN level l ON l.id = ps.level_id
      LEFT JOIN session se ON se.id = ps.session_id
     WHERE m.user_id = :user_id AND m.institute_id = :institute_id AND m.status = 'ACTIVE'
       -- an unpaid checkout left behind is not an enrolment
       AND COALESCE(m.type, '') <> 'ABANDONED_CART'
     GROUP BY ps.id, ps.package_id, ps.level_id, p.package_name, l.level_name, se.session_name
), last_view AS (
    SELECT DISTINCT ON (e.package_session_id)
           e.package_session_id, cts.slide_id, cts.chapter_id, al.viewed_at
      FROM enrolled e
      JOIN chapter_package_session_mapping cpsm
        ON cpsm.package_session_id = e.package_session_id AND cpsm.status <> 'DELETED'
      JOIN chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id AND cts.status IN ('PUBLISHED','UNSYNC')
      JOIN LATERAL (
            -- activity_log.end_time is client time and can lag created_at by hours
            SELECT MAX(GREATEST(a.created_at, a.end_time)) AS viewed_at
              FROM activity_log a
             WHERE a.slide_id = cts.slide_id AND a.user_id = :user_id
               AND a.source_type NOT LIKE 'llm%'
      ) al ON al.viewed_at IS NOT NULL
     ORDER BY e.package_session_id, al.viewed_at DESC
), first_slide AS (
    SELECT DISTINCT ON (e.package_session_id)
           e.package_session_id, cts.slide_id, cts.chapter_id
      FROM enrolled e
      JOIN subject_session ss ON ss.session_id = e.package_session_id
      JOIN subject sub ON sub.id = ss.subject_id AND sub.status = 'ACTIVE'
      JOIN subject_module_mapping smm ON smm.subject_id = sub.id
      JOIN modules mo ON mo.id = smm.module_id AND mo.status = 'ACTIVE'
      JOIN module_chapter_mapping mcm ON mcm.module_id = mo.id
      JOIN chapter_package_session_mapping cpsm
        ON cpsm.chapter_id = mcm.chapter_id AND cpsm.package_session_id = e.package_session_id
       AND cpsm.status <> 'DELETED'
      JOIN chapter c ON c.id = cpsm.chapter_id AND c.status = 'ACTIVE'
      JOIN chapter_to_slides cts ON cts.chapter_id = c.id AND cts.status IN ('PUBLISHED','UNSYNC')
      JOIN slide s ON s.id = cts.slide_id AND s.status IN ('PUBLISHED','UNSYNC')
     WHERE NOT EXISTS (SELECT 1 FROM last_view lv WHERE lv.package_session_id = e.package_session_id)
     ORDER BY e.package_session_id, ss.subject_order NULLS LAST, sub.created_at,
              smm.module_order NULLS LAST, smm.created_at, cpsm.chapter_order NULLS LAST, c.created_at,
              (cts.slide_order IS NOT NULL), cts.slide_order, cts.created_at DESC
), target AS (
    SELECT package_session_id, slide_id, chapter_id, viewed_at, 'RESUME' AS kind FROM last_view
    UNION ALL
    SELECT package_session_id, slide_id, chapter_id, NULL, 'START' FROM first_slide
)
SELECT e.package_session_id, e.package_id, e.level_id, e.package_name, e.level_name, e.session_name,
       e.enrolled_date, e.expiry_date,
       LEAST(COALESCE(CAST(pct.value AS DOUBLE PRECISION), 0), 100) AS percent,
       t.kind, t.viewed_at, t.slide_id, s.title AS slide_title, s.source_type,
       t.chapter_id, c.chapter_name, path.module_id, path.module_name, path.subject_id, path.subject_name
  FROM enrolled e
  LEFT JOIN learner_operation pct
         ON pct.user_id = :user_id AND pct.source = 'PACKAGE_SESSION'
        AND pct.source_id = e.package_session_id AND pct.operation = 'PERCENTAGE_PACKAGE_SESSION_COMPLETED'
  LEFT JOIN target t ON t.package_session_id = e.package_session_id
  LEFT JOIN slide s ON s.id = t.slide_id
  LEFT JOIN chapter c ON c.id = t.chapter_id
  LEFT JOIN LATERAL (
        SELECT mo.id AS module_id, mo.module_name, sub.id AS subject_id, sub.subject_name
          FROM module_chapter_mapping mcm
          JOIN modules mo ON mo.id = mcm.module_id AND mo.status <> 'DELETED'
          JOIN subject_module_mapping smm ON smm.module_id = mo.id
          JOIN subject sub ON sub.id = smm.subject_id AND sub.status <> 'DELETED'
          JOIN subject_session ss ON ss.subject_id = sub.id AND ss.session_id = e.package_session_id
         WHERE mcm.chapter_id = t.chapter_id
         LIMIT 1
  ) path ON true
 ORDER BY t.viewed_at DESC NULLS LAST, e.package_name
 LIMIT 12
""")


def _course_title(row) -> str:
    title = row["package_name"] or "Course"
    level = (row["level_name"] or "").strip()
    if level and level.upper() != "DEFAULT" and level.lower() not in title.lower():
        title = f"{title} · {level}"
    return title


async def get_my_courses(db: Session, user_id: str, institute_id: str) -> ToolOutput | str:
    rows = db.execute(_MY_COURSES_SQL, {"user_id": user_id, "institute_id": institute_id}).mappings().all()
    if not rows:
        return (
            "This student has no active course enrolments in this institute. Tell them so "
            "plainly and suggest they check the Courses page or contact the institute."
        )

    now = datetime.now(IST)
    items: List[Dict[str, Any]] = []
    lines: List[str] = []
    for row in rows:
        title = _course_title(row)
        pct = round(float(row["percent"] or 0), 1)
        expired = bool(row["expiry_date"] and to_ist(row["expiry_date"]) < now)
        where = " › ".join(
            x for x in (row["subject_name"], row["chapter_name"])
            if x and x.strip().upper() != "DEFAULT"  # placeholder subject in flat courses
        )
        if row["kind"] == "RESUME":
            subtitle = f"Continue: {row['slide_title']}" + (f" · last opened {when_label(row['viewed_at'], now)}" if row["viewed_at"] else "")
            href = slide_link(row)
            line = (f"- {title}: {pct:g}% complete; last opened '{row['slide_title']}' ({where}) "
                    f"{when_label(row['viewed_at'], now)}")
        elif row["kind"] == "START":
            subtitle = f"Start with: {row['slide_title']}"
            href = slide_link(row)
            line = f"- {title}: not started; first lesson is '{row['slide_title']}' ({where})"
        else:
            subtitle = "No lessons published yet"
            href = course_link(row["package_id"], row["package_session_id"])
            line = f"- {title}: no lessons published in this course yet"
        if expired:
            subtitle += " · access period ended"
            line += " (their access period has ended)"
        items.append({"title": title, "percent": pct, "subtitle": subtitle, "href": href})
        lines.append(line)

    text_out = (
        "The student's courses (newest activity first). They already see these as cards with "
        "Continue/Start links, so don't repeat the list — point them to the one to continue "
        "and why, in a sentence or two:\n" + "\n".join(lines)
    )
    return ToolOutput(text=text_out, card={"kind": "progress", "title": "Your courses", "items": items})


# ── get_my_live_classes ──────────────────────────────────────────────────────

LIVE_CLASSES_TOOL = {
    "type": "function",
    "function": {
        "name": "get_my_live_classes",
        "description": (
            "The student's live classes: upcoming ones (next 7 days) with times in IST, which are "
            "live/joinable now, and a Join link; and past ones (last 14 days) with their "
            "attendance and whether a recording exists. Shown to them as cards. Use for: class "
            "timings, schedule, 'is there a class today', class link / how to join, recordings, "
            "'did I miss a class', attendance."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "which": {
                    "type": "string",
                    "enum": ["upcoming", "past", "both"],
                    "description": "upcoming for schedule/joining; past for recordings/attendance; both if unsure. Default upcoming.",
                },
            },
            "required": [],
        },
    },
}

LIVE_CLASS_LIST_ROUTE = "/study-library/live-class"

# Mirrors the learner app's live-class list (LiveSessionRepository learner
# queries, GetLiveSessionService / LearnerPastSessionService): a learner sees a
# class through live_session_participants (one of their batches, or them
# directly), plus unassigned PUBLIC classes when the institute shows those.
# Honours attendanceOnlyMode / showPastSessions / showRecordings /
# showAttendance. Every occurrence is its own session_schedules row; the end is
# last_entry_time, in the class's own timezone. Teacher = assigned instructors
# only (the app's creator fallback names the admin who set the class up).
_UPCOMING_LIVE_SQL = text("""
WITH learner_batches AS (
  SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
   WHERE user_id = :user_id AND institute_id = :institute_id AND status = 'ACTIVE' AND package_session_id IS NOT NULL
), cfg AS (
  SELECT COALESCE((i.setting_json::jsonb #>> '{setting,LIVE_SESSION_SETTING,data,attendanceOnlyMode}')::boolean, false) AS attendance_only,
         COALESCE((i.setting_json::jsonb #>> '{setting,STUDENT_DISPLAY_SETTINGS,data,liveClasses,showUnassignedPublicSessions}')::boolean, false) AS show_public
    FROM institutes i WHERE i.id = :institute_id
), visible_sessions AS (
  SELECT lsp.session_id FROM live_session_participants lsp
   WHERE (lsp.source_type = 'BATCH' AND lsp.source_id IN (SELECT package_session_id FROM learner_batches))
      OR (lsp.source_type = 'USER' AND lsp.source_id = :user_id)
  UNION
  SELECT s.id FROM live_session s, cfg
   WHERE cfg.show_public AND EXISTS (SELECT 1 FROM learner_batches)
     AND s.institute_id = :institute_id AND s.status = 'LIVE' AND UPPER(s.access_level) = 'PUBLIC'
     AND NOT EXISTS (SELECT 1 FROM live_session_participants p WHERE p.session_id = s.id)
), occ AS (
  SELECT s.id AS session_id, ss.id AS schedule_id, s.title, s.subject, s.access_level,
         COALESCE(ss.link_type, s.link_type) AS link_type, s.session_streaming_service_type,
         COALESCE(s.waiting_room_time, 0) AS waiting_room_minutes, s.waiting_room_type,
         COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS tz, s.created_by_user_id,
         (ss.meeting_date + ss.start_time) AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS start_at,
         (ss.meeting_date + ss.last_entry_time
            + CASE WHEN ss.last_entry_time < ss.start_time THEN interval '1 day' ELSE interval '0' END)
           AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS end_at
    FROM visible_sessions v
    JOIN live_session s ON s.id = v.session_id
    JOIN session_schedules ss ON ss.session_id = s.id
    CROSS JOIN cfg
   WHERE s.institute_id = :institute_id
     AND s.status IN ('DRAFT', 'LIVE')
     AND ss.status <> 'DELETED'
     AND (NOT cfg.attendance_only OR s.show_to_learners IS TRUE)
     AND ss.meeting_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 8
)
SELECT o.schedule_id, o.title, o.subject, o.link_type,
       o.start_at, o.end_at,
       EXTRACT(EPOCH FROM (o.end_at - o.start_at))::int / 60 AS duration_min,
       now() BETWEEN o.start_at - make_interval(mins => o.waiting_room_minutes) AND o.end_at AS joinable_now,
       now() BETWEEN o.start_at AND o.end_at AS live_now,
       (SELECT string_agg(DISTINCT f.name, ', ')
          FROM live_session_instructors lsi
          JOIN LATERAL (SELECT name FROM faculty_subject_package_session_mapping fm
                         WHERE fm.user_id = lsi.user_id AND fm.name IS NOT NULL AND fm.name <> '' LIMIT 1) f ON TRUE
         WHERE lsi.session_id = o.session_id AND lsi.status = 'ACTIVE') AS teacher
  FROM occ o
 WHERE o.end_at >= now() AND o.start_at < now() + interval '7 days'
 ORDER BY o.start_at, o.schedule_id
 LIMIT 15
""")

# Attendance: latest ATTENDANCE_RECORDED log per class wins (the app's own
# lookup has no ORDER BY); none = UNMARKED. A recording counts when the
# provider JSON has a playable entry (expired Zoom cloud links excluded).
_PAST_LIVE_SQL = text("""
WITH learner_batches AS (
  SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
   WHERE user_id = :user_id AND institute_id = :institute_id AND status = 'ACTIVE' AND package_session_id IS NOT NULL
), cfg AS (
  SELECT COALESCE((j #>> '{setting,LIVE_SESSION_SETTING,data,attendanceOnlyMode}')::boolean, false) AS attendance_only,
         COALESCE((j #>> '{setting,STUDENT_DISPLAY_SETTINGS,data,liveClasses,showUnassignedPublicSessions}')::boolean, false) AS show_public,
         COALESCE((j #>> '{setting,STUDENT_DISPLAY_SETTINGS,data,liveClasses,showPastSessions}')::boolean, false) AS show_past,
         COALESCE((j #>> '{setting,STUDENT_DISPLAY_SETTINGS,data,liveClasses,showRecordings}')::boolean, false) AS show_recordings,
         COALESCE((j #>> '{setting,STUDENT_DISPLAY_SETTINGS,data,liveClasses,showAttendance}')::boolean, false) AS show_attendance
    FROM (SELECT setting_json::jsonb AS j FROM institutes WHERE id = :institute_id) i
), visible_sessions AS (
  SELECT lsp.session_id FROM live_session_participants lsp
   WHERE (lsp.source_type = 'BATCH' AND lsp.source_id IN (SELECT package_session_id FROM learner_batches))
      OR (lsp.source_type = 'USER' AND lsp.source_id = :user_id)
  UNION
  SELECT s.id FROM live_session s, cfg
   WHERE cfg.show_public AND EXISTS (SELECT 1 FROM learner_batches)
     AND s.institute_id = :institute_id AND s.status = 'LIVE' AND UPPER(s.access_level) = 'PUBLIC'
     AND NOT EXISTS (SELECT 1 FROM live_session_participants p WHERE p.session_id = s.id)
), occ AS (
  SELECT s.id AS session_id, ss.id AS schedule_id, s.title, s.subject,
         COALESCE(ss.link_type, s.link_type) AS link_type, ss.provider_recordings_json,
         (ss.meeting_date + ss.start_time) AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS start_at,
         (ss.meeting_date + ss.last_entry_time
            + CASE WHEN ss.last_entry_time < ss.start_time THEN interval '1 day' ELSE interval '0' END)
           AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata') AS end_at,
         cfg.*
    FROM visible_sessions v
    JOIN live_session s ON s.id = v.session_id
    JOIN session_schedules ss ON ss.session_id = s.id
    CROSS JOIN cfg
   WHERE cfg.show_past
     AND s.institute_id = :institute_id
     AND s.status = 'LIVE'
     AND ss.status <> 'DELETED'
     AND (NOT cfg.attendance_only OR s.show_to_learners IS TRUE)
     AND ss.meeting_date BETWEEN CURRENT_DATE - 15 AND CURRENT_DATE
)
SELECT o.schedule_id, o.title, o.subject, o.link_type,
       o.start_at,
       EXTRACT(EPOCH FROM (o.end_at - o.start_at))::int / 60 AS duration_min,
       CASE WHEN NOT o.show_recordings THEN NULL
            ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(
                           CASE WHEN o.provider_recordings_json LIKE '[%' THEN o.provider_recordings_json::jsonb ELSE '[]'::jsonb END) r
                          WHERE COALESCE(r->>'fileId', '') <> '' OR COALESCE(r->>'youtubeVideoUrl', '') <> ''
                             OR (COALESCE(r->>'playbackUrl', '') <> ''
                                 AND (r->>'recordingStorage' IS DISTINCT FROM 'ZOOM_CLOUD'
                                      OR r->>'expiresAt' IS NULL OR (r->>'expiresAt')::timestamptz > now())))
       END AS has_recording,
       CASE WHEN NOT o.show_attendance THEN NULL
            ELSE COALESCE((SELECT UPPER(l.status) FROM live_session_logs l
                            WHERE l.schedule_id = o.schedule_id AND l.user_source_type = 'USER'
                              AND l.user_source_id = :user_id AND l.log_type = 'ATTENDANCE_RECORDED'
                            ORDER BY l.created_at DESC LIMIT 1), 'UNMARKED')
       END AS attendance,
       (SELECT cl.slide_id FROM live_session_content_links cl
         WHERE cl.schedule_id = o.schedule_id AND cl.content_type LIKE 'RECORDING%' AND cl.status = 'ACTIVE'
           AND cl.package_session_id IN (SELECT package_session_id FROM learner_batches) LIMIT 1) AS recording_slide_id
  FROM occ o
 WHERE o.end_at < now() AND o.start_at >= now() - interval '14 days'
 ORDER BY o.start_at DESC
 LIMIT 12
""")

_USERNAME_SQL = text("SELECT username FROM student WHERE user_id = :user_id AND username IS NOT NULL AND username <> '' LIMIT 1")


def _join_link(db: Session, user_id: str) -> str:
    """The app's own join page (handles payment, waiting room, attendance, personal BBB link)."""
    try:
        row = db.execute(_USERNAME_SQL, {"user_id": user_id}).first()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"username lookup failed: {e}")
        row = None
    return f"{LIVE_CLASS_LIST_ROUTE}/{row[0]}" if row and row[0] else LIVE_CLASS_LIST_ROUTE


def _time_range(start: Optional[datetime], end: Optional[datetime], now: datetime) -> str:
    label = when_label(start, now)
    end_local = to_ist(end)
    if end_local is not None:
        label += " – " + end_local.strftime("%I:%M %p").lstrip("0")
    return label


async def get_my_live_classes(db: Session, user_id: str, institute_id: str, which: str = "upcoming") -> ToolOutput | str:
    which = which if which in ("upcoming", "past", "both") else "upcoming"
    params = {"user_id": user_id, "institute_id": institute_id}
    now = datetime.now(IST)
    upcoming = db.execute(_UPCOMING_LIVE_SQL, params).mappings().all() if which in ("upcoming", "both") else []
    past = db.execute(_PAST_LIVE_SQL, params).mappings().all() if which in ("past", "both") else []

    items: List[Dict[str, Any]] = []
    lines: List[str] = []
    join_href = _join_link(db, user_id) if any(r["joinable_now"] for r in upcoming) else None

    for row in upcoming:
        title = " ".join(str(row["title"] or "Live class").split())
        bits = [_time_range(row["start_at"], row["end_at"], now)]
        if row["subject"]:
            bits.append(row["subject"])
        if row["teacher"]:
            bits.append(row["teacher"])
        state = "LIVE NOW" if row["live_now"] else ("Join now" if row["joinable_now"] else None)
        item: Dict[str, Any] = {
            "title": title,
            "subtitle": " · ".join(bits),
            "icon": "live",
            "href": join_href if row["joinable_now"] and join_href else LIVE_CLASS_LIST_ROUTE,
        }
        if state:
            item["badge"] = state
        items.append(item)
        lines.append(f"- UPCOMING {title}: {' · '.join(bits)}" + (f" [{state}]" if state else ""))

    present = absent = 0
    for row in past:
        title = " ".join(str(row["title"] or "Live class").split())
        bits = [when_label(row["start_at"], now)]
        if row["subject"]:
            bits.append(row["subject"])
        attendance = row["attendance"]
        if attendance == "PRESENT":
            present += 1
            bits.append("Attended")
        elif attendance == "ABSENT":
            absent += 1
            bits.append("Missed")
        recording = row["has_recording"]
        if recording:
            bits.append("Recording available")
        items.append({
            "title": title,
            "subtitle": " · ".join(bits),
            "icon": "video" if recording else "live",
            "href": LIVE_CLASS_LIST_ROUTE,
        })
        lines.append(
            f"- PAST {title}: {' · '.join(bits)}"
            + ("" if recording is not None else " (this institute does not show recordings to learners)")
            + ("" if attendance is not None else " (attendance is not shown to learners here)")
        )

    if not items:
        if which == "past":
            return (
                "No past live classes in the last 14 days are visible to this student (or the "
                "institute does not show past classes to learners). Say so; don't guess."
            )
        return (
            "This student has no live classes scheduled in the next 7 days. Say so plainly; "
            "don't invent timings. They can check the Live Classes page for later dates."
        )

    summary = ""
    if present + absent:
        summary = (f"\nAttendance in the classes listed: present {present}, absent {absent} "
                   f"({round(100 * present / (present + absent))}% of marked classes).")
    text_out = (
        "The student's live classes (times are IST; already shown to them as cards — LIVE/joinable "
        "ones have a Join link that opens the class in the app; recordings play from the Live "
        "Classes page's Past section). Don't repeat the whole list; answer their question:\n"
        + "\n".join(lines) + summary
    )
    title = "Your live classes" if which != "past" else "Your recent live classes"
    return ToolOutput(text=text_out, card={"kind": "link_list", "title": title, "items": items[:10]})


# ── tests: upcoming, results, everything we measure ─────────────────────────
# Assessments live in assessment_service's own database. These go through its
# internal learner-chat endpoints (HMAC service auth), which reuse the learner
# app's own queries — so a result the institute has not released never comes
# back with marks.

_LEARNER_CHAT_ROUTE = "/assessment-service/internal/learner-chat/v1"
TEST_ROUTE = "/assessment/examination"
REPORT_ROUTE = "/assessment/reports/student-report"
AI_REPORT_ROUTE = "/assessment/reports/ai-report"
MY_REPORTS_ROUTE = "/my-reports"
_NO_END_YEAR = 9000  # bound_end_time 9999-12-31 means "no end date"

_BATCH_IDS_SQL = text("""
SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
 WHERE user_id = :user_id AND institute_id = :institute_id AND status = 'ACTIVE'
   AND package_session_id IS NOT NULL
""")


async def _assessment_get(path: str, params: Any) -> Dict[str, Any]:
    import httpx

    from ..config import get_settings
    from .internal_auth import internal_auth_headers

    base = get_settings().assessment_service_base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(f"{base}{_LEARNER_CHAT_ROUTE}{path}", params=params,
                                headers=await internal_auth_headers())
        resp.raise_for_status()
        data = resp.json()
    return data if isinstance(data, dict) else {}


def _parse_when(value: Any) -> Optional[datetime]:
    """Jackson sends Dates as epoch millis (default) or ISO strings; both are UTC."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        text_value = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text_value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def _num(value: Any) -> Optional[float]:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _fmt(value: Optional[float]) -> str:
    return "" if value is None else f"{round(value, 1):g}"


MY_TESTS_TOOL = {
    "type": "function",
    "function": {
        "name": "get_my_tests",
        "description": (
            "The student's tests/exams that are open now or coming up: name, window (IST), "
            "duration, attempts, with a link to open each. Shown to them as cards. Use for: "
            "'upcoming test', 'when is my exam', 'any test today', 'which tests are pending'."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

MY_RESULTS_TOOL = {
    "type": "function",
    "function": {
        "name": "get_my_results",
        "description": (
            "The student's recent test results that the institute has released: marks, total, %, "
            "rank, percentile, class average and section-wise marks, with a link to each full "
            "report; plus tests still awaiting results (no marks). Shown to them as cards. Use "
            "for: 'my result', 'how did I do in the test', 'my marks/rank', 'report card'."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

MY_PERFORMANCE_TOOL = {
    "type": "function",
    "function": {
        "name": "get_my_performance",
        "description": (
            "Everything the platform measures about the student, for coaching: strengths, "
            "weaknesses, misconceptions and topics to work on (from their released test "
            "analyses and saved reports), study time and active days, streak, live-class "
            "attendance, and what they ask doubts about. Use for: 'my strengths/weaknesses', "
            "'what should I improve', 'how am I doing overall', 'give me feedback', 'study plan'."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def _test_line_and_item(item: Dict[str, Any], live: bool, now: datetime):
    name = " ".join(str(item.get("name") or "Test").split())
    start = _parse_when(item.get("bound_start_time"))
    end = _parse_when(item.get("bound_end_time"))
    no_end = end is not None and end.year >= _NO_END_YEAR
    duration = item.get("duration")
    bits: List[str] = []
    if live:
        bits.append("open now" + ("" if no_end or end is None else f", closes {when_label(end, now)}"))
    else:
        bits.append(f"opens {when_label(start, now)}")
    if duration:
        bits.append(f"{duration} min")
    allowed = item.get("user_attempts") or item.get("assessment_attempts")
    used = item.get("created_attempts")
    status = item.get("recent_attempt_status")
    if status == "LIVE":
        bits.append("you have an attempt in progress")
    elif used:
        # Very large allowances (e.g. 100000) mean "unlimited".
        bits.append(f"attempted {used}" + (f" of {allowed}" if allowed and int(allowed) < 1000 else "") + " time(s)")
    entry = {
        "title": name,
        "subtitle": " · ".join(bits),
        "href": f"{TEST_ROUTE}/{item.get('assessment_id')}",
        "icon": "assessment",
    }
    if live:
        entry["badge"] = "Resume" if status == "LIVE" else "Open now"
    return f"- {'OPEN' if live else 'UPCOMING'} {name}: {'; '.join(bits)}", entry


async def get_my_tests(db: Session, user_id: str, institute_id: str) -> ToolOutput | str:
    batch_ids = [r[0] for r in db.execute(_BATCH_IDS_SQL, {"user_id": user_id, "institute_id": institute_id}).all()]
    data = await _assessment_get(
        "/assessments",
        [("userId", user_id), ("instituteId", institute_id)] + [("batchIds", b) for b in batch_ids],
    )
    now = datetime.now(IST)
    lines: List[str] = []
    items: List[Dict[str, Any]] = []
    for live, key in ((True, "live"), (False, "upcoming")):
        for raw in data.get(key) or []:
            line, entry = _test_line_and_item(raw, live, now)
            lines.append(line)
            items.append(entry)
    if not items:
        return (
            "The student has no tests open now and none scheduled. Say so plainly; don't invent "
            "dates. New tests appear on the Assessments page."
        )
    return ToolOutput(
        text=(
            "The student's open and upcoming tests (IST; already shown as cards with links, so "
            "don't repeat the list — answer their question):\n" + "\n".join(lines)
        ),
        card={"kind": "link_list", "title": "Your tests", "items": items[:10]},
    )


def _f(d: Dict[str, Any], snake: str) -> Any:
    """A field from assessment_service JSON in either spelling: the history item
    DTOs are camelCase (other callers depend on that), the list DTOs snake_case."""
    if snake in d:
        return d[snake]
    head, *rest = snake.split("_")
    return d.get(head + "".join(w.title() for w in rest))


def _result_lines(results: List[Dict[str, Any]], now: datetime):
    lines: List[str] = []
    items: List[Dict[str, Any]] = []
    for r in results:
        name = " ".join(str(_f(r, 'assessment_name') or "Test").split())
        marks, total = _num(_f(r, 'marks')), _num(_f(r, 'total_marks'))
        pct = _num(_f(r, 'percentage'))
        if pct is None and marks is not None and total:
            pct = 100 * marks / total
        when = when_label(_parse_when(_f(r, 'attempt_date')), now)
        sub: List[str] = []
        if marks is not None:
            sub.append(f"{_fmt(marks)}/{_fmt(total)}" if total else f"{_fmt(marks)} marks")
        if _f(r, 'rank'):
            sub.append(f"rank {_f(r, 'rank')}")
        if when:
            sub.append(when)
        detail = [f"{_fmt(marks)}/{_fmt(total)} ({_fmt(pct)}%)" if marks is not None else "score not available"]
        if _f(r, 'rank'):
            detail.append(f"rank {_f(r, 'rank')}")
        if _f(r, 'percentile') is not None:
            detail.append(f"percentile {_fmt(_num(_f(r, 'percentile')))}")
        if _f(r, 'class_average_marks') is not None:
            detail.append(f"class average {_fmt(_num(_f(r, 'class_average_marks')))}")
        if _f(r, 'accuracy') is not None:
            detail.append(f"accuracy {_fmt(_num(_f(r, 'accuracy')))}%")
        sections = []
        for sec in _f(r, 'sections') or []:
            sections.append(
                f"{_f(sec, 'section_name') or 'Section'} {_fmt(_num(_f(sec, 'student_marks')))}/"
                f"{_fmt(_num(_f(sec, 'section_total_marks')))}"
                + (f" (class avg {_fmt(_num(_f(sec, 'section_average_marks')))})"
                   if _f(sec, 'section_average_marks') is not None else "")
            )
        line = f"- {name}" + (f" ({when})" if when else "") + ": " + ", ".join(detail)
        if sections:
            line += "; sections: " + "; ".join(sections)
        lines.append(line)
        items.append({
            "title": name,
            "percent": pct or 0,
            "subtitle": " · ".join(sub),
            "href": REPORT_ROUTE + "?" + urlencode({
                "assessmentId": _f(r, 'assessment_id') or "",
                "attemptId": _f(r, 'attempt_id') or "",
            }),
        })
    return lines, items


async def get_my_results(db: Session, user_id: str, institute_id: str) -> ToolOutput | str:
    data = await _assessment_get("/results", {"userId": user_id, "instituteId": institute_id, "limit": 5})
    now = datetime.now(IST)
    results = data.get("results") or []
    awaiting = data.get("awaiting_release") or []
    lines, items = _result_lines(results, now)
    waiting = [
        f"- {' '.join(str(a.get('assessment_name') or 'Test').split())} (submitted {when_label(_parse_when(a.get('attempt_date')), now)})"
        for a in awaiting
    ]
    if not lines and not waiting:
        return "The student has no submitted tests with results yet. Say so; don't invent scores."
    parts = []
    if lines:
        parts.append("Released results, newest first (already shown as cards linking to each full report):\n" + "\n".join(lines))
    if waiting:
        parts.append(
            "Submitted but the institute has NOT released the result yet — you do not know these "
            "scores; say they're awaiting results:\n" + "\n".join(waiting)
        )
    text_out = "\n\n".join(parts)
    if not items:
        return text_out
    return ToolOutput(text=text_out, card={"kind": "progress", "title": "Your recent results", "items": items})


_ACTIVITY_SQL = text("""
SELECT COALESCE(SUM(engaged_ms) FILTER (WHERE created_at > (now() AT TIME ZONE 'UTC') - interval '7 days'), 0) / 60000 AS minutes_7d,
       COALESCE(SUM(engaged_ms), 0) / 60000 AS minutes_30d,
       COUNT(DISTINCT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date) AS active_days_30d,
       ARRAY(SELECT DISTINCT (a2.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
               FROM activity_log a2
              WHERE a2.user_id = :user_id AND a2.slide_id IS NOT NULL
                AND a2.created_at > (now() AT TIME ZONE 'UTC') - interval '60 days'
              ORDER BY 1 DESC) AS days
  FROM activity_log
 WHERE user_id = :user_id AND slide_id IS NOT NULL
   AND created_at > (now() AT TIME ZONE 'UTC') - interval '30 days'
""")

# Latest attendance log per class in the last 30 days (latest wins; none = unmarked).
_ATTENDANCE_SQL = text("""
SELECT COUNT(*) FILTER (WHERE status = 'PRESENT') AS present,
       COUNT(*) FILTER (WHERE status = 'ABSENT') AS absent
  FROM (SELECT DISTINCT ON (l.schedule_id) UPPER(l.status) AS status
          FROM live_session_logs l
          JOIN session_schedules ss ON ss.id = l.schedule_id
          JOIN live_session s ON s.id = ss.session_id AND s.institute_id = :institute_id
         WHERE l.user_source_type = 'USER' AND l.user_source_id = :user_id
           AND l.log_type = 'ATTENDANCE_RECORDED'
           AND ss.meeting_date >= CURRENT_DATE - 30
         ORDER BY l.schedule_id, l.created_at DESC) t
""")

_LINKED_SQL = text("""
SELECT type, data, percentage FROM user_linked_data
 WHERE user_id = :user_id AND type IN ('strength', 'weakness')
 ORDER BY percentage DESC NULLS LAST LIMIT 12
""")

_DOUBTS_SQL = text("""
SELECT topic, COUNT(*) AS n FROM learning_analytics
 WHERE user_id = :user_id AND institute_id = :institute_id AND event_type = 'doubt'
   AND topic IS NOT NULL AND topic NOT IN ('', 'Current Topic', 'current topic')
   AND created_at > now() - interval '60 days'
 GROUP BY topic ORDER BY n DESC LIMIT 5
""")

_REPORT_SQL = text("""
SELECT id, report_json, created_at FROM student_analysis_process
 WHERE user_id = :user_id AND institute_id = :institute_id AND status = 'COMPLETED'
 ORDER BY created_at DESC LIMIT 1
""")

# Per-test AI analysis, ONLY for tests whose result is released (ids come from
# the gated results endpoint). The analysis is written at submit time, so it
# exists for held results too.
_INSIGHTS_SQL = text("""
SELECT DISTINCT ON (source_id) source_id, processed_json, created_at
  FROM activity_log
 WHERE user_id = :user_id AND source_type = 'llm_assessment'
   AND source_id IN :ids AND processed_json IS NOT NULL
 ORDER BY source_id, created_at DESC
""").bindparams(bindparam("ids", expanding=True))


def _as_list(value: Any, limit: int = 4) -> List[str]:
    """Insight fields are lists of strings or of {topic/title/description...} objects."""
    import re

    out: List[str] = []
    if isinstance(value, str):
        # Usually a markdown bullet list in one string: split it into points.
        value = [p for p in re.split(r"\n\s*(?:[-*•]|\d+\.)\s+", "\n" + value) if p.strip()]
    items = value if isinstance(value, list) else ([value] if value else [])
    for v in items:
        if isinstance(v, dict):
            v = (v.get("topic") or v.get("title") or v.get("area") or v.get("misconception")
                 or v.get("description") or v.get("text") or "")
        v = " ".join(str(v).replace("**", "").split())
        if v:
            out.append(v if len(v) <= 220 else v[:217].rsplit(" ", 1)[0] + "…")
        if len(out) >= limit:
            break
    return out


def _topic_split(data: Dict[str, Any], limit: int = 4):
    """Strong and weak topics of one test analysis, as "Topic (9/10, 90%)".

    topic_analysis (per-topic accuracy) wins, split at 75% like the learner's AI
    report; older analyses only carry {topic: percent} maps under
    strengths / weaknesses."""
    strong: List[tuple] = []
    weak: List[tuple] = []
    for t in data.get("topic_analysis") or []:
        if not isinstance(t, dict) or not str(t.get("topic") or "").strip():
            continue
        acc = _num(t.get("accuracy"))
        if acc is None:
            continue
        count = f"{_int(t.get('correct'))}/{_int(t.get('questions_count'))}, " if t.get("questions_count") else ""
        label = f"{' '.join(str(t['topic']).split())} ({count}{_fmt(acc)}%)"
        (strong if acc >= 75 else weak).append((acc, label))
    if not strong and not weak:
        for key, bucket in (("strengths", strong), ("weaknesses", weak)):
            value = data.get(key)
            if isinstance(value, dict):
                for topic, pct in value.items():
                    acc = _num(pct)
                    if str(topic).strip() and acc is not None:
                        bucket.append((acc, f"{' '.join(str(topic).split())} ({_fmt(acc)}%)"))
            else:
                bucket.extend((0, v) for v in _as_list(value, limit))
    strong.sort(key=lambda x: -x[0])
    weak.sort(key=lambda x: x[0])
    return [label for _, label in strong[:limit]], [label for _, label in weak[:limit]]


def _topic_names(labels: List[str], limit: int = 2) -> str:
    return ", ".join(label.rsplit(" (", 1)[0] for label in labels[:limit])


def _int(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _streak(days: List[Any], today) -> int:
    from datetime import date

    seen = set()
    for d in days or []:
        if isinstance(d, datetime):
            d = d.date()
        elif not isinstance(d, date):
            try:
                d = date.fromisoformat(str(d)[:10])
            except ValueError:
                continue
        seen.add(d)
    streak = 0
    day = today if today in seen else today - timedelta(days=1)
    while day in seen:
        streak += 1
        day -= timedelta(days=1)
    return streak


async def get_my_performance(db: Session, user_id: str, institute_id: str) -> ToolOutput | str:
    import json

    params = {"user_id": user_id, "institute_id": institute_id}
    now = datetime.now(IST)
    sections: List[str] = []
    links: List[Dict[str, Any]] = []

    released: List[Dict[str, Any]] = []
    try:
        released = (await _assessment_get("/results", {**params_camel(params), "limit": 5})).get("results") or []
    except Exception as e:  # noqa: BLE001
        logger.warning(f"performance: results unavailable: {e}")
    if released:
        lines, _ = _result_lines(released, now)
        sections.append("RECENT RELEASED TEST RESULTS:\n" + "\n".join(lines))
        ids = [_f(r, "assessment_id") for r in released if _f(r, "assessment_id")]
        rows = db.execute(_INSIGHTS_SQL, {"user_id": user_id, "ids": ids}).all() if ids else []
        analysed: Dict[str, tuple] = {}
        insight_lines: List[str] = []
        by_id = {_f(r, "assessment_id"): r for r in released}
        for source_id, raw, _created in rows:
            try:
                data = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except (ValueError, TypeError):
                continue
            if not isinstance(data, dict):
                continue
            strong, weak = _topic_split(data)
            parts = []
            if strong:
                parts.append("strong topics: " + "; ".join(strong))
            if weak:
                parts.append("weak topics: " + "; ".join(weak))
            for label, key in (("misconceptions", "misconception_analysis"),
                               ("work on", "areas_of_improvement")):
                vals = _as_list(data.get(key), 3)
                if vals:
                    parts.append(f"{label}: " + "; ".join(vals))
            if parts:
                analysed[source_id] = (strong, weak)
                name = _f(by_id.get(source_id) or {}, "assessment_name") or "Test"
                insight_lines.append(f"- {name} — " + " | ".join(parts))
        if insight_lines:
            sections.append("FROM THE AI ANALYSIS OF THOSE TESTS:\n" + "\n".join(insight_lines))
        for r in released:
            aid = _f(r, "assessment_id")
            name = " ".join(str(_f(r, "assessment_name") or "Test").split())
            if aid in analysed:
                strong, weak = analysed[aid]
                bits = ([f"Strong: {_topic_names(strong)}"] if strong else []) + (
                    [f"Work on: {_topic_names(weak)}"] if weak else [])
                links.append({
                    "title": name,
                    "subtitle": " · ".join(bits) or "AI analysis",
                    "href": AI_REPORT_ROUTE + "?" + urlencode({
                        "assessmentId": aid, "assessmentName": name, "attemptId": _f(r, "attempt_id") or "",
                    }),
                    "icon": "assessment",
                })
            elif aid:
                links.append({
                    "title": name,
                    "subtitle": "Result report",
                    "href": REPORT_ROUTE + "?" + urlencode({"assessmentId": aid, "attemptId": _f(r, "attempt_id") or ""}),
                    "icon": "assessment",
                })

    linked = db.execute(_LINKED_SQL, {"user_id": user_id}).mappings().all()
    if linked:
        st = [f"{r['data']} ({_fmt(_num(r['percentage']))}%)" for r in linked if r["type"] == "strength"]
        wk = [f"{r['data']} ({_fmt(_num(r['percentage']))}%)" for r in linked if r["type"] == "weakness"]
        if st:
            sections.append("SAVED STRENGTHS: " + "; ".join(st))
        if wk:
            sections.append("SAVED WEAKNESSES: " + "; ".join(wk))

    report = db.execute(_REPORT_SQL, params).first()
    if report and report[1]:
        try:
            rj = json.loads(report[1]) if isinstance(report[1], str) else report[1]
            rj = rj if isinstance(rj, dict) else {}
            # v2 reports keep the summary under ai_insights and topics as [{topic, confidence}].
            ai = rj.get("ai_insights") if isinstance(rj.get("ai_insights"), dict) else {}
            summary = " ".join(str(rj.get("summary") or ai.get("summary") or "").split())
            parts = [summary[:600]] if summary else []
            for label, key in (("strengths", "strengths"), ("areas to improve", "areas_to_improve")):
                vals = _as_list(rj.get(key))
                if vals:
                    parts.append(f"{label}: " + "; ".join(vals))
            if parts:
                sections.append(f"LATEST PROGRESS REPORT ({when_label(report[2], now)}): " + " | ".join(parts))
                meta = rj.get("meta") if isinstance(rj.get("meta"), dict) else {}
                links.append({
                    "title": " ".join(str(meta.get("report_name") or "Progress report").split()),
                    "subtitle": when_label(report[2], now) or "Progress report",
                    "href": f"{MY_REPORTS_ROUTE}/{report[0]}",
                    "icon": "assessment",
                })
        except (ValueError, TypeError, AttributeError):
            pass

    act = db.execute(_ACTIVITY_SQL, {"user_id": user_id}).mappings().first()
    if act:
        streak = _streak(list(act["days"] or []), now.date())
        sections.append(
            f"STUDY ACTIVITY: {_int(act['minutes_7d'])} min in the last 7 days, "
            f"{_int(act['minutes_30d'])} min in 30 days, active on {_int(act['active_days_30d'])} of "
            f"the last 30 days, current streak {streak} day(s)."
        )

    att = db.execute(_ATTENDANCE_SQL, params).mappings().first()
    present, absent = (_int(att["present"]), _int(att["absent"])) if att else (0, 0)
    if present + absent:
        total = present + absent
        sections.append(
            f"LIVE-CLASS ATTENDANCE (30 days): present {present} of {total} marked classes "
            f"({round(100 * present / total)}%)."
        )

    doubts = db.execute(_DOUBTS_SQL, params).all()
    if doubts:
        sections.append("ASKS DOUBTS MOST ABOUT: " + "; ".join(f"{t} ({n})" for t, n in doubts))

    if not sections:
        return (
            "There is no performance data for this student yet (no released tests, saved reports, "
            "study activity or attendance). Say so kindly and suggest starting with their course."
        )
    text_out = (
        "What the platform has measured about this student. Use it to coach: name 2-3 concrete "
        "strengths and 2-3 priorities with a next step each; quote numbers only from here."
        + (" The reports these come from are already shown as linked cards; don't list the links."
           if links else "")
        + "\n\n" + "\n\n".join(sections)
    )
    if not links:
        return text_out
    return ToolOutput(text=text_out, card={"kind": "link_list", "title": "Your reports", "items": links[:6]})


def params_camel(params: Dict[str, str]) -> Dict[str, str]:
    return {"userId": params["user_id"], "instituteId": params["institute_id"]}


# ── ask_teacher: hand a question to a human teacher ─────────────────────────

ASK_TEACHER_TOOL = {
    "type": "function",
    "function": {
        "name": "ask_teacher",
        "description": (
            "Send the student's question to their teacher as a doubt in the institute's Help & "
            "Queries system; a teacher is assigned and notified, and the student can follow the "
            "reply in the app. Use ONLY after the student has clearly said yes to your offer to "
            "ask their teacher. Offer it when you can't resolve something: institute/operational "
            "questions (fees, schedules, recordings, certificates, access), or a study doubt "
            "they're still stuck on after your help, or when they ask for a teacher."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question_for_teacher": {
                    "type": "string",
                    "description": (
                        "Written for the teacher, in the student's words where possible: the exact "
                        "question, the topic/lesson, and what you already explained or tried. "
                        "3-6 sentences."
                    ),
                },
                "type": {
                    "type": "string",
                    "description": "DOUBT for study questions (default); otherwise a category like TECHNICAL or PAYMENT.",
                },
            },
            "required": ["question_for_teacher"],
        },
    },
}

_PICK_BATCH_SQL = text("""
SELECT package_session_id FROM student_session_institute_group_mapping
 WHERE user_id = :user_id AND institute_id = :institute_id AND status = 'ACTIVE'
   AND package_session_id IS NOT NULL
   AND COALESCE(type, '') <> 'ABANDONED_CART'
 ORDER BY (package_session_id = :preferred) DESC, updated_at DESC NULLS LAST
 LIMIT 1
""")

_QUERIES_ENABLED_SQL = text("""
SELECT COALESCE((setting_json::jsonb #>> '{setting,DOUBT_MANAGEMENT_SETTING,data,learner_query,enabled}')::boolean, false)
  FROM institutes WHERE id = :institute_id
""")


async def ask_teacher(db: Session, user_id: str, institute_id: str, args: Dict[str, Any],
                      context_meta: Optional[Dict[str, Any]] = None) -> ToolOutput | str:
    import httpx

    from ..config import get_settings
    from .internal_auth import internal_auth_headers

    question = " ".join(str(args.get("question_for_teacher") or "").split())
    if len(question) < 10:
        return "No question was given. Ask the student what exactly they want their teacher to answer."
    meta = context_meta or {}
    preferred = str(meta.get("package_session_id") or meta.get("session_id") or "")
    row = db.execute(_PICK_BATCH_SQL, {"user_id": user_id, "institute_id": institute_id,
                                       "preferred": preferred}).first()
    batch_id = row[0] if row else None
    slide_id = str(meta.get("slide_id") or "") or None

    base = get_settings().admin_core_service_base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{base}/admin-core-service/internal/doubts/v1/learner-create",
            json={
                "user_id": user_id,
                "institute_id": institute_id,
                "batch_id": batch_id,
                "slide_id": slide_id,
                "type": str(args.get("type") or "DOUBT"),
                "text": question,
            },
            headers=await internal_auth_headers({"Content-Type": "application/json"}),
        )
        resp.raise_for_status()
        doubt_id = (resp.json() or {}).get("doubt_id")

    try:
        trackable = bool(db.execute(_QUERIES_ENABLED_SQL, {"institute_id": institute_id}).scalar())
    except Exception:  # noqa: BLE001
        trackable = False
    item: Dict[str, Any] = {
        "title": question if len(question) <= 120 else question[:117] + "…",
        "subtitle": "Sent to your teacher · you'll be notified when it's answered",
        "icon": "question",
        "badge": "Sent",
    }
    if trackable:
        # Opens Help & Queries → My queries on the page the learner is on.
        item["href"] = "?openQueries=1" + (f"&doubtId={doubt_id}" if doubt_id else "")
    text_out = (
        "Done — the question was sent to the student's teacher as a doubt"
        + (f" (id {doubt_id})" if doubt_id else "")
        + ". A teacher has been notified. Tell the student briefly"
        + (" that they can follow the reply in Help & Queries → My queries" if trackable
           else " that they'll be notified when it's answered")
        + ". Do not promise a time."
    )
    return ToolOutput(text=text_out, card={"kind": "link_list", "title": "Sent to your teacher", "items": [item]})


# ── daily engagement tasks ───────────────────────────────────────────────────
# The institute's Daily Engagement plan (teacher- or AI-planned daily tasks,
# points ledger, server streak) is the learner's daily habit loop. The tutor
# reads the SAME feed the Today module shows, through admin_core's internal
# learner-snapshot (answer keys are redacted there exactly as for the app).

ENGAGEMENT_ROUTE = "/engagement"
_TASK_LABELS = {
    "READING_HTML": "Reading", "VISUAL_NOTE": "Visual note", "QUESTION_OF_DAY": "Question of the day",
    "QUIZ": "Quiz", "GAME": "Game", "POLL": "Poll", "COURSE_SLIDE": "Lesson", "FLASHCARDS": "Flashcards",
}
_TASK_ICONS = {
    "READING_HTML": "pdf", "VISUAL_NOTE": "pdf", "QUESTION_OF_DAY": "question", "QUIZ": "quiz",
    "GAME": "quiz", "POLL": "question", "COURSE_SLIDE": "slide", "FLASHCARDS": "quiz",
}
_GRADED_TYPES = ("QUESTION_OF_DAY",)

DAILY_TASKS_TOOL = {
    "type": "function",
    "function": {
        "name": "get_my_daily_tasks",
        "description": (
            "The student's daily tasks from their institute (question of the day, readings, "
            "flashcards, games, polls, lessons): what's open today and until when, points, what's "
            "done, catch-ups, what unlocks next, plus their points and streak. Shown as cards with "
            "links. Use for: 'what should I do today', 'daily task', 'question of the day', "
            "'my streak', 'my points', 'did I miss anything'."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


async def engagement_snapshot(user_id: str, institute_id: str) -> Dict[str, Any]:
    import httpx

    from ..config import get_settings
    from .internal_auth import internal_auth_headers

    base = get_settings().admin_core_service_base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{base}/admin-core-service/internal/engagement/v1/learner-snapshot",
            params={"userId": user_id, "instituteId": institute_id},
            headers=await internal_auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
    return data if isinstance(data, dict) else {}


def _task_href(item: Dict[str, Any]) -> str:
    slot = _f(item, "slot_id")
    return f"{ENGAGEMENT_ROUTE}?slot={slot}" if slot else ENGAGEMENT_ROUTE


def summarize_engagement(data: Dict[str, Any], now: Optional[datetime] = None):
    """(lines for the model, card items, counts) from a learner snapshot."""
    now = now or datetime.now(IST)
    feed = data.get("feed") or {}
    points = data.get("points") or {}
    catch_ids = {_f(i, "id") for i in (feed.get("catchUp") or feed.get("catch_up") or [])}
    open_items = [i for i in (feed.get("items") or []) if _f(i, "id") not in catch_ids]
    catch_up = feed.get("catchUp") or feed.get("catch_up") or []
    done = feed.get("doneToday") or feed.get("done_today") or []
    upcoming = feed.get("upcoming") or []
    lines: List[str] = []
    items: List[Dict[str, Any]] = []

    def label(i):
        return _TASK_LABELS.get(str(_f(i, "item_type") or ""), "Task")

    for i in open_items:
        closes = when_label(_parse_when(_f(i, "closes_at")), now)
        pts = _f(i, "earnable_points") or _f(i, "effective_points")
        graded = str(_f(i, "item_type")) in _GRADED_TYPES and not _f(i, "is_revealed")
        lines.append(
            f"- OPEN {label(i)}: {_f(i, 'title')}" + (f", closes {closes}" if closes else "")
            + (f", {pts} pts" if pts else "")
            + (" [GRADED and not yet revealed: do NOT solve it or confirm an answer; you may explain the underlying concept and give a hint]" if graded else "")
        )
        items.append({"title": str(_f(i, "title") or label(i)),
                      "subtitle": " · ".join(x for x in (label(i), f"closes {closes}" if closes else "", f"{pts} pts" if pts else "") if x),
                      "href": _task_href(i), "icon": _TASK_ICONS.get(str(_f(i, "item_type")), "slide"), "badge": "To do"})
    for i in catch_up:
        pts = _f(i, "effective_points")
        lines.append(f"- CATCH-UP {label(i)}: {_f(i, 'title')}" + (f", {pts} pts if done now" if pts else ""))
        items.append({"title": str(_f(i, "title") or label(i)), "subtitle": f"{label(i)} · catch up" + (f" · {pts} pts" if pts else ""),
                      "href": _task_href(i), "icon": _TASK_ICONS.get(str(_f(i, "item_type")), "slide"), "badge": "Catch up"})
    for i in done:
        res = "correct" if _f(i, "is_correct") is True else ("wrong" if _f(i, "is_correct") is False else "done")
        if _f(i, "result_pending"):
            res = "answer revealed later"
        lines.append(f"- DONE {label(i)}: {_f(i, 'title')} ({res}" + (f", +{_f(i, 'points_awarded')} pts" if _f(i, 'points_awarded') else "") + ")")
    for i in upcoming[:3]:
        lines.append(f"- LOCKED until {when_label(_parse_when(_f(i, 'opens_at')), now)}: {label(i)} {_f(i, 'title')}")
    for i in (feed.get("revealed") or [])[:3]:
        prompt = " ".join(str(_f(i, "prompt_text") or "").split())[:300]
        expl = " ".join(str(_f(i, "explanation") or "").split())[:300]
        if prompt:
            lines.append(f"- REVEALED {label(i)}: \"{prompt}\"" + (f" Explanation: {expl}" if expl else "")
                         + (" (student was correct)" if _f(i, "is_correct") is True else " (student was wrong)" if _f(i, "is_correct") is False else ""))
    scheduled = int(feed.get("scheduledToday") or feed.get("scheduled_today") or 0)
    completed = int(feed.get("completedToday") or feed.get("completed_today") or 0)
    if points:
        streak = points.get("currentStreak") if "currentStreak" in points else points.get("current_streak")
        kept = points.get("keptToday") if "keptToday" in points else points.get("kept_today")
        lines.append(
            f"Points: {points.get('totalPoints', points.get('total_points', 0))} total, "
            f"{points.get('weekPoints', points.get('week_points', 0))} this week, level {points.get('level', '?')}. "
            f"Streak: {streak or 0} day(s)" + (", kept today" if kept else ", NOT yet kept today")
        )
    return lines, items, {"scheduled": scheduled, "completed": completed, "open": len(open_items), "catch_up": len(catch_up)}


async def get_my_daily_tasks(db: Session, user_id: str, institute_id: str) -> ToolOutput | str:
    data = await engagement_snapshot(user_id, institute_id)
    lines, items, counts = summarize_engagement(data)
    if not lines:
        return ("The student has no daily tasks from their institute right now (none scheduled, or "
                "daily tasks aren't used here). Say so briefly and offer to help with their courses.")
    head = (f"Today: {counts['completed']} of {counts['scheduled']} daily tasks done."
            if counts["scheduled"] else "No daily tasks scheduled today.")
    text_out = (
        head + " Open tasks are shown to the student as cards linking to them, so don't repeat the "
        "list; encourage the next one. Never solve an open graded question.\n" + "\n".join(lines)
    )
    if not items:
        return text_out
    title = f"Today's tasks · {counts['completed']}/{counts['scheduled']} done" if counts["scheduled"] else "Your tasks"
    return ToolOutput(text=text_out, card={"kind": "link_list", "title": title, "items": items[:8]})



async def award_tutor_quiz_points(user_id: str, institute_id: str, quiz_id: str, percentage: float) -> Dict[str, Any]:
    """Ask admin_core to award points for a passed tutor quiz (small, capped; see TutorQuizPointsService)."""
    import httpx

    from ..config import get_settings
    from .internal_auth import internal_auth_headers

    base = get_settings().admin_core_service_base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post(
            f"{base}/admin-core-service/internal/engagement/v1/tutor-quiz-points",
            json={"user_id": user_id, "institute_id": institute_id, "quiz_id": quiz_id, "percentage": percentage},
            headers=await internal_auth_headers({"Content-Type": "application/json"}),
        )
        resp.raise_for_status()
        data = resp.json()
    return data if isinstance(data, dict) else {}


__all__ = [
    "MY_COURSES_TOOL",
    "get_my_courses",
    "LIVE_CLASSES_TOOL",
    "get_my_live_classes",
    "MY_TESTS_TOOL",
    "get_my_tests",
    "MY_RESULTS_TOOL",
    "get_my_results",
    "MY_PERFORMANCE_TOOL",
    "get_my_performance",
    "ASK_TEACHER_TOOL",
    "ask_teacher",
    "award_tutor_quiz_points",
    "DAILY_TASKS_TOOL",
    "get_my_daily_tasks",
    "engagement_snapshot",
    "summarize_engagement",
    "slide_link",
    "course_link",
    "to_ist",
    "when_label",
    "IST",
]
