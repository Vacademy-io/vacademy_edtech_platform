package vacademy.io.admin_core_service.features.institute_pulse.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.institute_pulse.dto.InstituteContentMapProjection;
import vacademy.io.admin_core_service.features.institute_pulse.dto.InstituteFeedEventProjection;
import vacademy.io.admin_core_service.features.institute_pulse.dto.InstituteRosterRowProjection;
import vacademy.io.admin_core_service.features.institute_pulse.dto.LiveClassProjection;
import vacademy.io.admin_core_service.features.institute_pulse.dto.LiveClassTotalsProjection;
import vacademy.io.admin_core_service.features.institute_pulse.dto.ProviderMeetingRefProjection;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;

import java.time.Instant;
import java.util.List;

/**
 * Read-only queries for Institute Pulse. Deliberately a separate repository from
 * {@code PulseRepository}: the batch-scoped Course Pulse queries stay byte-for-byte untouched.
 *
 * <p><b>The bound that makes this affordable.</b> Every query is anchored to the active set —
 * rows whose {@code last_seen_at} is inside the presence window, riding
 * {@code idx_activity_log_last_seen} (V404) — so cost scales with concurrent learners, not with
 * the size of {@code activity_log}. Widening from one batch to a whole institute breaks that
 * bound in two places, both fixed here rather than in SQL that merely swapped a WHERE clause:
 *
 * <ol>
 *   <li><b>Row multiplication.</b> Course Pulse scopes through
 *       {@code chapter_package_session_mapping.package_session_id = :batchId}. Institute-wide,
 *       a chapter mapped into several batches multiplies the learner's row and every head count
 *       silently inflates. Scoping is therefore done by learner membership via
 *       {@code EXISTS} on {@code student_session_institute_group_mapping}
 *       ({@code idx_ssigm_user_id_status}), which cannot multiply, and the content tree resolves
 *       each learner to exactly ONE path with {@code DISTINCT ON} before any grouping.
 *   <li><b>Correlated subqueries.</b> Course Pulse runs three per active learner. At 50–200
 *       concurrent that is fine; at ~2,000 institute-wide it is ~6,000 subqueries per cache miss.
 *       Struggle is computed here as grouped aggregates driven from the active set.
 * </ol>
 */
public interface InstitutePulseRepository extends JpaRepository<ActivityLog, String> {

    /**
     * One PAGE of currently-present learners, ordered needs-attention first, PLUS the KPI counts
     * for the whole active set.
     *
     * <p><b>Why state and ordering moved into SQL.</b> They used to be derived in Java, which
     * meant materialising every present learner before capping the list — fine for one batch,
     * wasteful institute-wide. Sorting and limiting here means the payload carries only the rows
     * actually shown.
     *
     * <p><b>Why the counts are window aggregates rather than a second query.</b> The KPI strip
     * needs totals over the whole active set, not the page. A separate counting query would run
     * the same three CTEs twice. {@code COUNT(*) OVER ()} computes across all rows BEFORE the
     * LIMIT is applied, so one scan yields both the page and exact institute-wide counts — and
     * they stay correct on every page.
     *
     * <p><b>Struggle semantics differ from Course Pulse, deliberately.</b> Course Pulse counts
     * wrong answers across ALL visits to a slide and failing code submissions for all time. Both
     * are bounded here to the current presence window: for a "who needs help right now" signal
     * that is more accurate, and it is what keeps the query index-driven instead of unbounded.
     *
     * <p>Passive slides (video/audio/document) produce no tracked rows, so a learner watching a
     * two-hour video never registers as needing help.
     */
    @Query(value = """
            WITH latest AS (
                SELECT DISTINCT ON (al.user_id)
                       al.user_id                                                   AS user_id,
                       st.full_name                                                 AS full_name,
                       al.slide_id                                                  AS slide_id,
                       sl.title                                                     AS slide_title,
                       sl.source_type                                               AS slide_type,
                       CAST(EXTRACT(EPOCH FROM (now() - al.created_at)) AS bigint)   AS on_slide_seconds,
                       CAST(EXTRACT(EPOCH FROM (now() - al.last_seen_at)) AS bigint) AS last_seen_ago_seconds
                FROM activity_log al
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE al.last_seen_at > :offlineCutoff
                  AND EXISTS (
                      SELECT 1 FROM student_session_institute_group_mapping m
                      WHERE m.user_id = al.user_id
                        AND m.institute_id = :instituteId
                        AND m.status = 'ACTIVE'
                        AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId)
                  )
                ORDER BY al.user_id, al.last_seen_at DESC
            ),
            wrong AS (
                SELECT user_id, slide_id, SUM(c) AS wrong_count
                FROM (
                    SELECT a.user_id, a.slide_id, COUNT(*) AS c
                    FROM activity_log a
                        JOIN question_slide_tracked q
                            ON q.activity_id = a.id AND q.response_status = 'INCORRECT'
                    WHERE a.last_seen_at > :offlineCutoff
                    GROUP BY a.user_id, a.slide_id
                    UNION ALL
                    SELECT a.user_id, a.slide_id, COUNT(*) AS c
                    FROM activity_log a
                        JOIN quiz_slide_question_tracked z
                            ON z.activity_id = a.id AND z.response_status = 'INCORRECT'
                    WHERE a.last_seen_at > :offlineCutoff
                    GROUP BY a.user_id, a.slide_id
                ) parts
                GROUP BY user_id, slide_id
            ),
            failed_code AS (
                SELECT cs.learner_id AS user_id, cs.slide_id, COUNT(*) AS failed_count
                FROM coding_submissions cs
                WHERE cs.submitted_at > :offlineCutoff
                  AND cs.total_count > 0
                  AND cs.passed_count < cs.total_count
                GROUP BY cs.learner_id, cs.slide_id
            ),
            scored AS (
                SELECT l.user_id, l.full_name, l.slide_id, l.slide_title, l.slide_type,
                       l.on_slide_seconds, l.last_seen_ago_seconds,
                       COALESCE(w.wrong_count, 0)  AS wrong_count,
                       COALESCE(f.failed_count, 0) AS failed_count,
                       CASE
                           WHEN l.last_seen_ago_seconds > :activeWindowSeconds THEN 'IDLE'
                           WHEN COALESCE(w.wrong_count, 0) >= :wrongThreshold
                             OR COALESCE(f.failed_count, 0) >= :failedCodeThreshold THEN 'NEEDS_HELP'
                           ELSE 'ACTIVE'
                       END AS state
                FROM latest l
                    LEFT JOIN wrong w       ON w.user_id = l.user_id AND w.slide_id = l.slide_id
                    LEFT JOIN failed_code f ON f.user_id = l.user_id AND f.slide_id = l.slide_id
            )
            SELECT user_id               AS userId,
                   full_name             AS fullName,
                   slide_id              AS slideId,
                   slide_title           AS slideTitle,
                   slide_type            AS slideType,
                   on_slide_seconds      AS onSlideSeconds,
                   last_seen_ago_seconds AS lastSeenAgoSeconds,
                   wrong_count           AS wrongCount,
                   failed_count          AS failedCodeCount,
                   state                 AS state,
                   COUNT(*) OVER ()                                          AS totalPresent,
                   COUNT(*) FILTER (WHERE state = 'ACTIVE')     OVER ()      AS activeCount,
                   COUNT(*) FILTER (WHERE state = 'IDLE')       OVER ()      AS idleCount,
                   COUNT(*) FILTER (WHERE state = 'NEEDS_HELP') OVER ()      AS needHelpCount
            FROM scored
            ORDER BY CASE state WHEN 'NEEDS_HELP' THEN 0 WHEN 'IDLE' THEN 1 ELSE 2 END,
                     on_slide_seconds DESC
            LIMIT :limitCount OFFSET :offsetCount
            """, nativeQuery = true)
    List<InstituteRosterRowProjection> getRosterPage(@Param("instituteId") String instituteId,
                                                     @Param("packageSessionId") String packageSessionId,
                                                     @Param("offlineCutoff") Instant offlineCutoff,
                                                     @Param("activeWindowSeconds") long activeWindowSeconds,
                                                     @Param("wrongThreshold") long wrongThreshold,
                                                     @Param("failedCodeThreshold") long failedCodeThreshold,
                                                     @Param("limitCount") int limitCount,
                                                     @Param("offsetCount") int offsetCount);

    /** ACTIVE enrolments in the institute — the offline denominator. Cache for minutes, not seconds. */
    @Query(value = """
            SELECT COUNT(DISTINCT user_id)
            FROM student_session_institute_group_mapping
            WHERE institute_id = :instituteId
              AND status = 'ACTIVE'
              AND (:packageSessionId = '' OR package_session_id = :packageSessionId)
            """, nativeQuery = true)
    long countEnrolled(@Param("instituteId") String instituteId,
                       @Param("packageSessionId") String packageSessionId);

    /**
     * Content Map: every slide with at least one live learner, carrying its full
     * course → subject → module → chapter path.
     *
     * <p><b>The dedup that makes the rollup exact.</b> Three separate fan-outs would otherwise
     * multiply a learner: a chapter can map to several package_sessions, to several modules, and
     * a module to several subjects. {@code placed} first resolves the learner to the ONE
     * package_session they are actually enrolled in that carries this chapter (intersecting
     * {@code chapter_package_session_mapping} with their own enrolment rows), then
     * {@code placed_full} collapses the remaining module/subject fan-out with a second
     * {@code DISTINCT ON}. Each learner therefore contributes exactly one leaf row, so summing
     * slide heads up the tree is an exact distinct-learner count at every level.
     *
     * <p>Ordering inside both {@code DISTINCT ON}s is by id so the choice is deterministic —
     * the same learner lands in the same course/subject between polls and the tree does not
     * flicker.
     */
    @Query(value = """
            WITH latest AS (
                SELECT DISTINCT ON (al.user_id)
                       al.user_id                                                 AS user_id,
                       al.slide_id                                                AS slide_id,
                       CAST(EXTRACT(EPOCH FROM (now() - al.created_at)) AS bigint) AS on_slide_seconds
                FROM activity_log al
                WHERE al.last_seen_at > :offlineCutoff
                  AND EXISTS (
                      SELECT 1 FROM student_session_institute_group_mapping m
                      WHERE m.user_id = al.user_id
                        AND m.institute_id = :instituteId
                        AND m.status = 'ACTIVE'
                        AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId)
                  )
                ORDER BY al.user_id, al.last_seen_at DESC
            ),
            placed AS (
                SELECT DISTINCT ON (l.user_id)
                       l.user_id, l.slide_id, l.on_slide_seconds,
                       cts.chapter_id        AS chapter_id,
                       m.package_session_id  AS package_session_id
                FROM latest l
                    JOIN chapter_to_slides cts
                        ON cts.slide_id = l.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m
                        ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    JOIN student_session_institute_group_mapping ssigm
                        ON ssigm.package_session_id = m.package_session_id
                       AND ssigm.user_id = l.user_id
                       AND ssigm.institute_id = :instituteId
                       AND ssigm.status = 'ACTIVE'
                       AND (:packageSessionId = '' OR ssigm.package_session_id = :packageSessionId)
                ORDER BY l.user_id, m.package_session_id
            ),
            placed_full AS (
                SELECT DISTINCT ON (p.user_id)
                       p.user_id, p.on_slide_seconds,
                       pkg.id           AS course_id,
                       pkg.package_name AS course_name,
                       subj.id          AS subject_id,
                       subj.subject_name AS subject_name,
                       mod.id           AS module_id,
                       mod.module_name  AS module_name,
                       ch.id            AS chapter_id,
                       ch.chapter_name  AS chapter_name,
                       sl.id            AS slide_id,
                       sl.title         AS slide_title,
                       sl.source_type   AS slide_type
                FROM placed p
                    JOIN package_session ps ON ps.id = p.package_session_id
                    JOIN package pkg        ON pkg.id = ps.package_id
                    JOIN slide sl           ON sl.id = p.slide_id
                    JOIN chapter ch         ON ch.id = p.chapter_id
                    JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id
                    JOIN modules mod        ON mod.id = mcm.module_id
                    JOIN subject_module_mapping smm ON smm.module_id = mod.id
                    JOIN subject subj       ON subj.id = smm.subject_id
                ORDER BY p.user_id, pkg.id, subj.id, mod.id
            )
            SELECT course_id    AS courseId,
                   course_name  AS courseName,
                   subject_id   AS subjectId,
                   subject_name AS subjectName,
                   module_id    AS moduleId,
                   module_name  AS moduleName,
                   chapter_id   AS chapterId,
                   chapter_name AS chapterName,
                   slide_id     AS slideId,
                   slide_title  AS slideTitle,
                   slide_type   AS slideType,
                   COUNT(*)                                              AS headsNow,
                   CAST(COALESCE(AVG(on_slide_seconds), 0) AS bigint)    AS avgOnSlideSeconds
            FROM placed_full
            GROUP BY course_id, course_name, subject_id, subject_name, module_id, module_name,
                     chapter_id, chapter_name, slide_id, slide_title, slide_type
            """, nativeQuery = true)
    List<InstituteContentMapProjection> getContentMap(@Param("instituteId") String instituteId,
                                                      @Param("packageSessionId") String packageSessionId,
                                                      @Param("offlineCutoff") Instant offlineCutoff);

    /**
     * Live classes: schedules whose wall-clock window contains now(), with invited and joined
     * counts.
     *
     * <p>The correlated subqueries here are bounded by the number of on-air sessions (tens, not
     * thousands) and each rides {@code idx_lsl_schedule_type_status} (V408) — without that index
     * every one of them sequentially scans the whole attendance log.
     *
     * <p><b>{@code joinedCount} means "ever joined", not "in the room now".</b> Provider leave
     * events are discarded (see {@code ZoomWebhookService}), so there is no way to know who is
     * still present. The UI must label it accordingly.
     *
     * <p><b>{@code started}</b> is the existence of any attendance row. It is what removes the
     * need for an {@code actual_start_at} column: a scheduled window that is open with no
     * attendance yet reads as "not started" rather than as 0% turnout.
     */

    /**
     * Institute-wide live-class totals. Kept separate from the card pages so the KPI strip stays
     * correct no matter how many pages the user has expanded.
     */
    @Query(value = """
            WITH sched AS (
                SELECT ls.id AS session_id, ss.id AS schedule_id,
                       ss.meeting_date AS meeting_date, ss.start_time AS start_time,
                       ss.last_entry_time AS last_entry_time,
                       COALESCE(
                           (SELECT n.name FROM pg_timezone_names n
                            WHERE n.name = btrim(COALESCE(ls.timezone, ''), '''" ')),
                           'Asia/Kolkata'
                       ) AS tz
                FROM live_session ls
                    JOIN session_schedules ss ON ss.session_id = ls.id
                WHERE ls.institute_id = :instituteId
                  AND ls.status = 'LIVE'
                  AND (ss.status IS NULL OR ss.status <> 'DELETED')
                  AND ss.meeting_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
                  AND (:packageSessionId = '' OR EXISTS (
                          SELECT 1 FROM live_session_participants lp
                          WHERE lp.session_id = ls.id
                            AND lp.source_type = 'BATCH'
                            AND lp.source_id = :packageSessionId))
            ),
            on_air AS (
                SELECT * FROM sched s
                WHERE (s.meeting_date + s.start_time)
                          <= CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
                  -- last_entry_time is the LAST-ENTRY cutoff, not the end of the class, and no
                  -- end/duration column exists anywhere. Classes routinely run past it, so a
                  -- configurable grace period keeps them on air instead of vanishing mid-lesson.
                  AND (s.meeting_date + s.last_entry_time)
                          + make_interval(mins => :overrunGraceMinutes)
                          >= CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
            )
            SELECT (SELECT COUNT(*) FROM on_air) AS onAirCount,
                   (SELECT COUNT(*) FROM sched s
                    WHERE (s.meeting_date + s.start_time)
                              > CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
                      AND (s.meeting_date + s.start_time)
                              <= CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
                                 + make_interval(mins => :lookaheadMinutes)) AS upcomingCount,
                   (SELECT COALESCE(SUM(
                        CASE WHEN p.source_type = 'BATCH' THEN (
                            SELECT COUNT(*) FROM student_session_institute_group_mapping m
                            WHERE m.package_session_id = p.source_id AND m.status = 'ACTIVE'
                        ) ELSE 1 END), 0)
                    FROM live_session_participants p
                    WHERE p.session_id IN (SELECT session_id FROM on_air)) AS invitedNow,
                   (SELECT COUNT(DISTINCT lsl.user_source_id)
                    FROM live_session_logs lsl
                    WHERE lsl.schedule_id IN (SELECT schedule_id FROM on_air)
                      AND lsl.log_type = 'ATTENDANCE_RECORDED'
                      AND lsl.status = 'PRESENT'
                      AND (lsl.details IS NULL OR lsl.details NOT LIKE '%role=MODERATOR%')
                   ) AS joinedNow
            """, nativeQuery = true)
    LiveClassTotalsProjection getLiveClassTotals(@Param("instituteId") String instituteId,
                                                 @Param("packageSessionId") String packageSessionId,
                                                 @Param("lookaheadMinutes") int lookaheadMinutes,
                                                 @Param("overrunGraceMinutes") int overrunGraceMinutes);

    @Query(value = """
            WITH sched AS (
                SELECT ls.id    AS session_id,
                       ss.id    AS schedule_id,
                       ls.title AS title,
                       ls.subject AS subject,
                       ls.session_streaming_service_type AS provider,
                       ss.last_attendance_sync_at AS last_sync,
                       ss.meeting_date AS meeting_date,
                       ss.start_time AS start_time,
                       ss.last_entry_time AS last_entry_time,
                       COALESCE(
                           (SELECT n.name FROM pg_timezone_names n
                            WHERE n.name = btrim(COALESCE(ls.timezone, ''), '''" ')),
                           'Asia/Kolkata'
                       ) AS tz
                FROM live_session ls
                    JOIN session_schedules ss ON ss.session_id = ls.id
                WHERE ls.institute_id = :instituteId
                  AND ls.status = 'LIVE'
                  AND (ss.status IS NULL OR ss.status <> 'DELETED')
                  -- +/- 1 day so no timezone offset can push a schedule out of the driving set
                  AND ss.meeting_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
                  AND (:packageSessionId = '' OR EXISTS (
                          SELECT 1 FROM live_session_participants lp
                          WHERE lp.session_id = ls.id
                            AND lp.source_type = 'BATCH'
                            AND lp.source_id = :packageSessionId))
            )
            SELECT s.session_id  AS sessionId,
                   s.schedule_id AS scheduleId,
                   s.title       AS title,
                   s.subject     AS subject,
                   CAST(EXTRACT(EPOCH FROM ((s.meeting_date + s.start_time) AT TIME ZONE s.tz)) * 1000 AS bigint)      AS startEpoch,
                   CAST(EXTRACT(EPOCH FROM ((s.meeting_date + s.last_entry_time) AT TIME ZONE s.tz)) * 1000 AS bigint) AS endEpoch,
                   s.provider AS provider,
                   CAST(EXTRACT(EPOCH FROM s.last_sync) * 1000 AS bigint) AS lastSyncEpoch,
                   (
                       SELECT COALESCE(SUM(
                           CASE WHEN p.source_type = 'BATCH' THEN (
                               SELECT COUNT(*)
                               FROM student_session_institute_group_mapping m
                               WHERE m.package_session_id = p.source_id AND m.status = 'ACTIVE'
                           ) ELSE 1 END
                       ), 0)
                       FROM live_session_participants p
                       WHERE p.session_id = s.session_id
                   ) AS invitedCount,
                   (
                       SELECT COUNT(DISTINCT lsl.user_source_id)
                       FROM live_session_logs lsl
                       WHERE lsl.schedule_id = s.schedule_id
                         AND lsl.log_type = 'ATTENDANCE_RECORDED'
                         AND lsl.status = 'PRESENT'
                         -- Exclude the teacher. `invited` expands BATCH participants through the
                         -- enrolment table and so counts LEARNERS only; counting the moderator in
                         -- `joined` inflated turnout and understated `absent` by exactly one on
                         -- every class. Role is only present on provider-synced rows, so an
                         -- in-app teacher join would still slip through.
                         AND (lsl.details IS NULL OR lsl.details NOT LIKE '%role=MODERATOR%')
                   ) AS joinedCount,
                   EXISTS (
                       SELECT 1 FROM live_session_logs lsl2
                       WHERE lsl2.schedule_id = s.schedule_id
                         AND lsl2.log_type = 'ATTENDANCE_RECORDED'
                   ) AS started,
                   ((s.meeting_date + s.last_entry_time)
                        < CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)) AS runningOver
            FROM sched s
            WHERE (s.meeting_date + s.start_time)
                      <= CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
              -- Grace period past the last-entry cutoff; see the totals query for why.
              AND (s.meeting_date + s.last_entry_time)
                      + make_interval(mins => :overrunGraceMinutes)
                      >= CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
            ORDER BY (s.meeting_date + s.start_time) ASC
            LIMIT :limitCount OFFSET :offsetCount
            """, nativeQuery = true)
    List<LiveClassProjection> getOnAirClasses(@Param("instituteId") String instituteId,
                                              @Param("packageSessionId") String packageSessionId,
                                              @Param("overrunGraceMinutes") int overrunGraceMinutes,
                                              @Param("limitCount") int limitCount,
                                              @Param("offsetCount") int offsetCount);

    /** Schedules starting inside the lookahead window — the "Next 60 min" strip. */
    @Query(value = """
            WITH sched AS (
                SELECT ls.id    AS session_id,
                       ss.id    AS schedule_id,
                       ls.title AS title,
                       ls.subject AS subject,
                       ls.session_streaming_service_type AS provider,
                       ss.last_attendance_sync_at AS last_sync,
                       ss.meeting_date AS meeting_date,
                       ss.start_time AS start_time,
                       ss.last_entry_time AS last_entry_time,
                       COALESCE(
                           (SELECT n.name FROM pg_timezone_names n
                            WHERE n.name = btrim(COALESCE(ls.timezone, ''), '''" ')),
                           'Asia/Kolkata'
                       ) AS tz
                FROM live_session ls
                    JOIN session_schedules ss ON ss.session_id = ls.id
                WHERE ls.institute_id = :instituteId
                  AND ls.status = 'LIVE'
                  AND (ss.status IS NULL OR ss.status <> 'DELETED')
                  -- +/- 1 day so no timezone offset can push a schedule out of the driving set
                  AND ss.meeting_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
                  AND (:packageSessionId = '' OR EXISTS (
                          SELECT 1 FROM live_session_participants lp
                          WHERE lp.session_id = ls.id
                            AND lp.source_type = 'BATCH'
                            AND lp.source_id = :packageSessionId))
            )
            SELECT s.session_id  AS sessionId,
                   s.schedule_id AS scheduleId,
                   s.title       AS title,
                   s.subject     AS subject,
                   CAST(EXTRACT(EPOCH FROM ((s.meeting_date + s.start_time) AT TIME ZONE s.tz)) * 1000 AS bigint)      AS startEpoch,
                   CAST(EXTRACT(EPOCH FROM ((s.meeting_date + s.last_entry_time) AT TIME ZONE s.tz)) * 1000 AS bigint) AS endEpoch,
                   s.provider AS provider,
                   CAST(NULL AS bigint) AS lastSyncEpoch,
                   (
                       SELECT COALESCE(SUM(
                           CASE WHEN p.source_type = 'BATCH' THEN (
                               SELECT COUNT(*)
                               FROM student_session_institute_group_mapping m
                               WHERE m.package_session_id = p.source_id AND m.status = 'ACTIVE'
                           ) ELSE 1 END
                       ), 0)
                       FROM live_session_participants p
                       WHERE p.session_id = s.session_id
                   ) AS invitedCount,
                   CAST(0 AS bigint) AS joinedCount,
                   false AS started,
                   false AS runningOver
            FROM sched s
            WHERE (s.meeting_date + s.start_time)
                      > CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
              AND (s.meeting_date + s.start_time)
                      <= CAST((CURRENT_TIMESTAMP AT TIME ZONE s.tz) AS timestamp)
                         + make_interval(mins => :lookaheadMinutes)
            ORDER BY (s.meeting_date + s.start_time) ASC
            LIMIT :limitCount OFFSET :offsetCount
            """, nativeQuery = true)
    List<LiveClassProjection> getUpcomingClasses(@Param("instituteId") String instituteId,
                                                 @Param("packageSessionId") String packageSessionId,
                                                 @Param("lookaheadMinutes") int lookaheadMinutes,
                                                 @Param("limitCount") int limitCount,
                                                 @Param("offsetCount") int offsetCount);

    /**
     * Institute-wide live feed: content events plus live-class joins, newest first.
     *
     * <p>Each branch is driven by its own {@code created_at DESC} index (V408). Without those the
     * institute-scoped feed loses the small driving set that batch scope got from
     * {@code idx_cpsm_package_session_id} and this one query would dominate the entire feature's
     * per-refresh cost.
     *
     * <p>Institute scoping is an {@code EXISTS} on the learner's enrolment
     * ({@code idx_ssigm_user_id_status}) rather than a join through the chapter mapping — the
     * same anti-multiplication reasoning as the roster query.
     *
     * <p><b>Attendee identity needs three fallbacks.</b>
     * {@code live_session_logs.user_source_id} is not one kind of id:
     * <ol>
     *   <li>an in-app join writes our own {@code student.user_id} — resolves to a full name;
     *   <li>a public/guest join writes {@code session_guest_registrations.id} — that table has no
     *       name column, so email is the only identity available;
     *   <li>the BBB attendance sync writes the PROVIDER's external participant id
     *       ({@code w_xxxxxxxx}), which maps to nothing of ours — but the attendee's display name
     *       is embedded in {@code details} as {@code "Name | role=VIEWER"}.
     * </ol>
     * Joining {@code student} alone leaves cases 2 and 3 anonymous, which is why the feed read
     * "Unknown learner" for every provider-synced and guest attendee. Resolving the provider id
     * properly needs the SDK customerKey wiring that is still deferred.
     */
    @Query(value = """
            SELECT occurredAtEpoch, userId, fullName, slideId, slideTitle, slideType,
                   rail, eventType, detail, actorRole
            FROM (
                SELECT CAST(EXTRACT(EPOCH FROM ast.created_at) * 1000 AS bigint) AS occurredAtEpoch,
                       al.user_id AS userId, st.full_name AS fullName,
                       al.slide_id AS slideId, sl.title AS slideTitle, sl.source_type AS slideType,
                       'CONTENT' AS rail, 'SUBMITTED_ASSIGNMENT' AS eventType,
                       CASE WHEN ast.late_submission THEN 'late submission' ELSE 'submitted' END AS detail,
                       CAST(NULL AS varchar) AS actorRole
                FROM assignment_slide_tracked ast
                    JOIN activity_log al ON al.id = ast.activity_id
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE ast.created_at > :sinceCutoff
                  AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                              WHERE m.user_id = al.user_id AND m.institute_id = :instituteId
                                AND m.status = 'ACTIVE'
                                AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId))

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM aest.created_at) * 1000 AS bigint),
                       al.user_id, st.full_name, al.slide_id, sl.title, sl.source_type,
                       'CONTENT', 'SUBMITTED_ASSESSMENT', 'submitted', NULL
                FROM assessment_slide_tracked aest
                    JOIN activity_log al ON al.id = aest.activity_id
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE aest.created_at > :sinceCutoff
                  AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                              WHERE m.user_id = al.user_id AND m.institute_id = :instituteId
                                AND m.status = 'ACTIVE'
                                AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId))

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM cs.submitted_at) * 1000 AS bigint),
                       cs.learner_id, st.full_name, cs.slide_id, sl.title, sl.source_type,
                       'CONTENT', 'CODE_SUBMISSION',
                       cs.verdict || ' (' || cs.passed_count || '/' || cs.total_count || ')', NULL
                FROM coding_submissions cs
                    JOIN slide sl ON sl.id = cs.slide_id
                    LEFT JOIN student st ON st.user_id = cs.learner_id
                WHERE cs.submitted_at > :sinceCutoff
                  AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                              WHERE m.user_id = cs.learner_id AND m.institute_id = :instituteId
                                AND m.status = 'ACTIVE'
                                AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId))

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM qst.created_at) * 1000 AS bigint),
                       al.user_id, st.full_name, al.slide_id, sl.title, sl.source_type,
                       'CONTENT', 'ANSWERED_QUESTION', qst.response_status, NULL
                FROM question_slide_tracked qst
                    JOIN activity_log al ON al.id = qst.activity_id
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE qst.created_at > :sinceCutoff
                  AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                              WHERE m.user_id = al.user_id AND m.institute_id = :instituteId
                                AND m.status = 'ACTIVE'
                                AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId))

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM quiz.created_at) * 1000 AS bigint),
                       al.user_id, st.full_name, al.slide_id, sl.title, sl.source_type,
                       'CONTENT', 'ANSWERED_QUIZ', quiz.response_status, NULL
                FROM quiz_slide_question_tracked quiz
                    JOIN activity_log al ON al.id = quiz.activity_id
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE quiz.created_at > :sinceCutoff
                  AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                              WHERE m.user_id = al.user_id AND m.institute_id = :instituteId
                                AND m.status = 'ACTIVE'
                                AND (:packageSessionId = '' OR m.package_session_id = :packageSessionId))

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM lsl.created_at) * 1000 AS bigint),
                       lsl.user_source_id,
                       COALESCE(
                           st.full_name,
                           g.email,
                           NULLIF(CASE WHEN lsl.details LIKE '%| role=%'
                                       THEN split_part(lsl.details, ' | role=', 1) END, '')
                       ),
                       NULL, ls.title, NULL,
                       'LIVE_CLASS', 'JOINED_CLASS',
                       NULL,
                       -- The provider sync embeds role in details as "Name | role=MODERATOR".
                       CASE WHEN lsl.details LIKE '%role=MODERATOR%' THEN 'HOST' END
                FROM live_session_logs lsl
                    JOIN live_session ls ON ls.id = lsl.session_id
                    LEFT JOIN student st ON st.user_id = lsl.user_source_id
                    LEFT JOIN session_guest_registrations g ON g.id = lsl.user_source_id
                WHERE lsl.created_at > :sinceCutoff
                  AND lsl.log_type = 'ATTENDANCE_RECORDED'
                  AND ls.institute_id = :instituteId
                  AND (:packageSessionId = '' OR EXISTS (
                          SELECT 1 FROM live_session_participants lp
                          WHERE lp.session_id = ls.id
                            AND lp.source_type = 'BATCH'
                            AND lp.source_id = :packageSessionId))
            ) feed
            ORDER BY occurredAtEpoch DESC
            LIMIT :limitCount
            """, nativeQuery = true)
    List<InstituteFeedEventProjection> getFeed(@Param("instituteId") String instituteId,
                                               @Param("packageSessionId") String packageSessionId,
                                               @Param("sinceCutoff") Instant sinceCutoff,
                                               @Param("limitCount") int limitCount);

    /**
     * BBB servers that currently have at least one schedule inside its live window, with the
     * provider meeting ids on that server.
     *
     * <p><b>This query is the cost gate for the BBB poller.</b> It returns nothing outside class
     * hours, and the poller then makes ZERO HTTP calls — so the feature costs nothing whenever
     * nothing is running, which is most of the day. One indexed query per poll replaces what would
     * otherwise be an unconditional fan-out to every configured server.
     *
     * <p>pg_timezone_names reads the whole timezone database (~9 ms) on every scan, and the
     * per-row lookups scanned it twice per candidate schedule: 53 ms a poll, ~8k polls a day.
     * The tz CTE scans it once per query; LEFT JOIN + COALESCE keeps the same fallback to
     * Asia/Kolkata for a missing or unknown timezone.
     */
    @Query(value = """
            WITH tz AS MATERIALIZED (SELECT name FROM pg_timezone_names)
            SELECT DISTINCT ss.bbb_server_id AS bbbServerId
            FROM session_schedules ss
                JOIN live_session ls ON ls.id = ss.session_id
                LEFT JOIN tz ON tz.name = btrim(COALESCE(ls.timezone, ''), '''" ')
            WHERE ls.status = 'LIVE'
              AND ls.link_type = 'bbb'
              AND ss.bbb_server_id IS NOT NULL
              AND ss.provider_meeting_id IS NOT NULL
              AND (ss.status IS NULL OR ss.status <> 'DELETED')
              AND ss.meeting_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
              AND (ss.meeting_date + ss.start_time)
                      - make_interval(mins => :startGraceMinutes)
                      <= CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(tz.name, 'Asia/Kolkata')) AS timestamp)
              AND (ss.meeting_date + ss.last_entry_time)
                      + make_interval(mins => :endGraceMinutes)
                      >= CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(tz.name, 'Asia/Kolkata')) AS timestamp)
            """, nativeQuery = true)
    List<String> findActiveBbbServerIds(@Param("startGraceMinutes") int startGraceMinutes,
                                        @Param("endGraceMinutes") int endGraceMinutes);

    /** Schedule identity for every provider meeting id on the given servers. Cheap; ids only. */
    @Query(value = """
            SELECT ss.provider_meeting_id AS providerMeetingId,
                   ss.id                  AS scheduleId,
                   ls.id                  AS sessionId,
                   ls.institute_id        AS instituteId,
                   ls.title               AS title
            FROM session_schedules ss
                JOIN live_session ls ON ls.id = ss.session_id
            WHERE ss.bbb_server_id IN (:serverIds)
              AND ss.provider_meeting_id IS NOT NULL
              AND (ss.status IS NULL OR ss.status <> 'DELETED')
              AND ss.meeting_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
            """, nativeQuery = true)
    List<ProviderMeetingRefProjection> findMeetingRefs(@Param("serverIds") List<String> serverIds);
}
