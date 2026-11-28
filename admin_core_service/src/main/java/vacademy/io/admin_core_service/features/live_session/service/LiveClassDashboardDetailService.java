package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.AtRiskLearner;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.AtRiskResponse;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.ClassLearner;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.ClassLearnersResponse;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.FeedbackAnswer;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.FeedbackComment;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails.FeedbackWallResponse;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardRequest;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.InstructorRef;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionInstructorDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The dashboard's on-demand panels — one class's learners, the at-risk list and
 * the written-feedback wall. Same scoping and definitions as
 * {@link LiveClassDashboardService} (institute, published classes, audience =
 * BATCH + USER participants resolved through enrolments, batch filter narrows the
 * audience), so every number here reconciles with the dashboard it opens from.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LiveClassDashboardDetailService {

    static final int DEFAULT_MIN_MISSED = 3;
    static final int AT_RISK_LIMIT = 200;
    static final int FEEDBACK_SCAN_LIMIT = 400;
    static final int FEEDBACK_WALL_LIMIT = 60;

    static final String STATUS_PRESENT = "PRESENT";
    static final String STATUS_BELOW_RULE = "BELOW_RULE";
    static final String STATUS_NOT_JOINED = "NOT_JOINED";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final NamedParameterJdbcTemplate jdbc;
    private final LiveSessionInstructorService instructorService;

    // ─────────────────────────────────────────────────────────────────────
    // SQL
    // ─────────────────────────────────────────────────────────────────────

    private static final String CLASS_CONFIG_SQL = """
            SELECT ls.feedback_config_json
            FROM session_schedules ss
            JOIN live_session ls ON ls.id = ss.session_id
            WHERE ss.id = :scheduleId
              AND ls.institute_id = :instituteId
            """;

    /**
     * Everyone who belongs in one class: the expected learners, plus (without a
     * batch filter) anyone else who joined — guests, registrants, learners added
     * after the fact.
     */
    static final String CLASS_LEARNERS_SQL = """
            WITH sched AS (
                SELECT ss.id AS schedule_id, ss.session_id, ss.meeting_date
                FROM session_schedules ss
                JOIN live_session ls ON ls.id = ss.session_id
                WHERE ss.id = :scheduleId
                  AND ls.institute_id = :instituteId
            ),
            aud AS (
                SELECT DISTINCT ON (m.user_id)
                       m.user_id, m.package_session_id
                FROM sched s
                JOIN live_session_participants lsp ON lsp.session_id = s.session_id
                JOIN student_session_institute_group_mapping m
                  ON m.status = 'ACTIVE'
                 AND m.institute_id = :instituteId
                 AND ((lsp.source_type = 'BATCH' AND m.package_session_id = lsp.source_id)
                   OR (lsp.source_type = 'USER' AND m.user_id = lsp.source_id))
                WHERE (m.enrolled_date IS NULL OR s.meeting_date >= CAST(m.enrolled_date AS date))
                  AND (:hasBatchFilter = FALSE
                       OR m.package_session_id = ANY(STRING_TO_ARRAY(:batchIdsCsv, ',')))
                ORDER BY m.user_id, m.enrolled_date DESC NULLS LAST
            ),
            att AS (
                SELECT l.user_source_type, l.user_source_id, l.status, l.created_at, l.engagement_data,
                       COALESCE(l.provider_total_duration_seconds, l.provider_total_duration_minutes * 60) AS secs
                FROM live_session_logs l
                JOIN sched s ON s.schedule_id = l.schedule_id
                WHERE l.log_type = 'ATTENDANCE_RECORDED'
            ),
            fb AS (
                SELECT DISTINCT ON (l.user_source_id) l.user_source_id, l.details
                FROM live_session_logs l
                JOIN sched s ON s.schedule_id = l.schedule_id
                WHERE l.log_type = 'FEEDBACK_SUBMITTED'
                  AND l.user_source_type = 'USER'
                ORDER BY l.user_source_id, l.created_at DESC
            ),
            people AS (
                SELECT a.user_id AS person_id, 'USER' AS source_type, a.package_session_id, TRUE AS expected
                FROM aud a
                UNION ALL
                SELECT t.user_source_id, t.user_source_type, NULL, FALSE
                FROM att t
                WHERE :hasBatchFilter = FALSE
                  AND NOT (t.user_source_type = 'USER'
                           AND EXISTS (SELECT 1 FROM aud a WHERE a.user_id = t.user_source_id))
            )
            SELECT p.person_id, p.source_type, p.package_session_id, p.expected,
                   t.status AS attendance_status, t.secs, t.engagement_data, t.created_at AS joined_at,
                   f.details AS feedback_details,
                   st.full_name, st.email, st.mobile_number,
                   g.email AS guest_email, g.mobile_number AS guest_mobile
            FROM people p
            LEFT JOIN att t ON t.user_source_id = p.person_id AND t.user_source_type = p.source_type
            LEFT JOIN fb f ON p.source_type = 'USER' AND f.user_source_id = p.person_id
            LEFT JOIN LATERAL (
                SELECT s2.full_name, s2.email, s2.mobile_number
                FROM student s2
                WHERE p.source_type = 'USER' AND s2.user_id = p.person_id
                ORDER BY s2.created_at DESC NULLS LAST
                LIMIT 1
            ) st ON TRUE
            LEFT JOIN session_guest_registrations g
                   ON p.source_type = 'EXTERNAL_USER' AND g.id = p.person_id
            """;

    /** Start/end/timezone of every class in scope — Java decides which have finished. */
    static final String SCHEDULE_TIMES_SQL = LiveClassDashboardService.SCOPE_CTES + """
            SELECT s.schedule_id, s.session_id, s.meeting_date, ss.start_time, ss.last_entry_time,
                   ls.timezone, ls.created_by_user_id
            FROM scoped s
            JOIN session_schedules ss ON ss.id = s.schedule_id
            JOIN live_session ls ON ls.id = s.session_id
            """;

    /**
     * Per learner over the given finished classes: expected, attended, the run of
     * misses counting back from the latest class, and the last class attended.
     * {@code presents_since} is a running count of attended classes from the
     * newest backwards, so the streak is the rows before the first attendance.
     */
    static final String AT_RISK_SQL = """
            WITH comp AS (
                SELECT ss.id AS schedule_id, ss.session_id, ss.meeting_date, ss.start_time
                FROM session_schedules ss
                JOIN live_session ls ON ls.id = ss.session_id
                WHERE ss.id = ANY(STRING_TO_ARRAY(:scheduleIdsCsv, ','))
                  AND ls.institute_id = :instituteId
            ),
            aud AS (
                SELECT DISTINCT ON (c.schedule_id, m.user_id)
                       c.schedule_id, c.meeting_date, c.start_time, m.user_id, m.package_session_id
                FROM comp c
                JOIN live_session_participants lsp ON lsp.session_id = c.session_id
                JOIN student_session_institute_group_mapping m
                  ON m.status = 'ACTIVE'
                 AND m.institute_id = :instituteId
                 AND ((lsp.source_type = 'BATCH' AND m.package_session_id = lsp.source_id)
                   OR (lsp.source_type = 'USER' AND m.user_id = lsp.source_id))
                WHERE (m.enrolled_date IS NULL OR c.meeting_date >= CAST(m.enrolled_date AS date))
                  AND (:hasBatchFilter = FALSE
                       OR m.package_session_id = ANY(STRING_TO_ARRAY(:batchIdsCsv, ',')))
                ORDER BY c.schedule_id, m.user_id, m.enrolled_date DESC NULLS LAST
            ),
            per AS (
                SELECT a.user_id, a.package_session_id, a.meeting_date, a.start_time,
                       COALESCE(l.status = 'PRESENT', FALSE) AS present
                FROM aud a
                LEFT JOIN live_session_logs l
                       ON l.schedule_id = a.schedule_id
                      AND l.log_type = 'ATTENDANCE_RECORDED'
                      AND l.user_source_type = 'USER'
                      AND l.user_source_id = a.user_id
            ),
            ranked AS (
                SELECT per.*,
                       SUM(CASE WHEN present THEN 1 ELSE 0 END) OVER (
                           PARTITION BY user_id
                           ORDER BY meeting_date DESC, start_time DESC NULLS LAST
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS presents_since
                FROM per
            ),
            agg AS (
                SELECT user_id,
                       COUNT(*) AS expected,
                       COUNT(*) FILTER (WHERE present) AS attended,
                       COUNT(*) FILTER (WHERE presents_since = 0) AS miss_streak,
                       MAX(meeting_date) FILTER (WHERE present) AS last_attended,
                       MIN(package_session_id) AS package_session_id
                FROM ranked
                GROUP BY user_id
                HAVING COUNT(*) - COUNT(*) FILTER (WHERE present) >= :minMissed
                   AND (:view = 'ALL'
                        OR (:view = 'DROPPED' AND COUNT(*) FILTER (WHERE present) > 0)
                        OR (:view = 'NEVER' AND COUNT(*) FILTER (WHERE present) = 0))
            )
            SELECT agg.*, COUNT(*) OVER () AS total, st.full_name, st.email, st.mobile_number
            FROM agg
            LEFT JOIN LATERAL (
                SELECT s2.full_name, s2.email, s2.mobile_number
                FROM student s2
                WHERE s2.user_id = agg.user_id
                ORDER BY s2.created_at DESC NULLS LAST
                LIMIT 1
            ) st ON TRUE
            ORDER BY agg.miss_streak DESC, (agg.expected - agg.attended) DESC, agg.attended ASC, agg.user_id
            LIMIT :limit
            """;

    /**
     * Latest feedback that carries at least one written answer. The LIKE is only
     * a cheap pre-filter for a string value in the JSON; Java decides what counts.
     */
    static final String FEEDBACK_WALL_SQL = LiveClassDashboardService.SCOPE_CTES + """
            ,
            fbw AS (
                SELECT DISTINCT ON (l.schedule_id, l.user_source_id)
                       l.schedule_id, s.session_id, l.user_source_id, l.details, l.created_at
                FROM live_session_logs l
                JOIN scoped s ON s.schedule_id = l.schedule_id
                LEFT JOIN aud a ON a.schedule_id = l.schedule_id AND a.user_id = l.user_source_id
                WHERE l.log_type = 'FEEDBACK_SUBMITTED'
                  AND l.user_source_type = 'USER'
                  AND l.details LIKE '%":"%'
                  AND (:hasBatchFilter = FALSE OR a.user_id IS NOT NULL)
                ORDER BY l.schedule_id, l.user_source_id, l.created_at DESC
            )
            SELECT f.schedule_id, f.session_id, f.user_source_id, f.details, f.created_at,
                   ls.title, ls.subject, ls.feedback_config_json, ls.created_by_user_id,
                   ss.meeting_date, ss.start_time, st.full_name
            FROM fbw f
            JOIN live_session ls ON ls.id = f.session_id
            JOIN session_schedules ss ON ss.id = f.schedule_id
            LEFT JOIN LATERAL (
                SELECT s2.full_name
                FROM student s2
                WHERE s2.user_id = f.user_source_id
                ORDER BY s2.created_at DESC NULLS LAST
                LIMIT 1
            ) st ON TRUE
            ORDER BY f.created_at DESC
            LIMIT :scanLimit
            """;

    // ─────────────────────────────────────────────────────────────────────
    // Class drill-down
    // ─────────────────────────────────────────────────────────────────────

    public ClassLearnersResponse getClassLearners(LiveClassDashboardRequest request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required");
        }
        if (!StringUtils.hasText(request.getScheduleId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "schedule_id is required");
        }
        List<String> batchIds = LiveClassDashboardService.cleanIds(request.getBatchIds());
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", request.getInstituteId())
                .addValue("scheduleId", request.getScheduleId())
                .addValue("hasBatchFilter", !batchIds.isEmpty())
                .addValue("batchIdsCsv", String.join(",", batchIds));

        // Also the institute check: a schedule of another institute returns no row.
        List<String> configs = jdbc.query(CLASS_CONFIG_SQL, params, (rs, i) -> rs.getString(1));
        if (configs.isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Class not found");
        }
        List<FeedbackQuestion> questions = parseQuestions(configs.get(0));

        List<ClassLearner> learners = jdbc.query(CLASS_LEARNERS_SQL, params, (rs, i) -> {
            String sourceType = rs.getString("source_type");
            String attendance = rs.getString("attendance_status");
            Timestamp joinedAt = rs.getTimestamp("joined_at");
            int secs = rs.getInt("secs");
            boolean hasSecs = !rs.wasNull() && secs > 0;
            Engagement eng = parseEngagement(rs.getString("engagement_data"));
            ParsedFeedback fb = parseFeedback(questions, rs.getString("feedback_details"));
            boolean isUser = "USER".equals(sourceType);
            return ClassLearner.builder()
                    .id(rs.getString("person_id"))
                    .sourceType(sourceType)
                    .name(isUser ? rs.getString("full_name") : null)
                    .email(isUser ? rs.getString("email") : rs.getString("guest_email"))
                    .mobile(isUser ? rs.getString("mobile_number") : rs.getString("guest_mobile"))
                    .packageSessionId(rs.getString("package_session_id"))
                    .expected(rs.getBoolean("expected"))
                    .status(learnerStatus(attendance))
                    .joinedAt(joinedAt != null ? joinedAt.toInstant().toString() : null)
                    .secondsInClass(hasSecs ? secs : null)
                    .talks(eng != null ? eng.talks() : null)
                    .chats(eng != null ? eng.chats() : null)
                    .raiseHands(eng != null ? eng.raiseHands() : null)
                    .pollVotes(eng != null ? eng.pollVotes() : null)
                    .emojis(eng != null ? eng.emojis() : null)
                    .activeness(eng != null ? eng.activeness() : null)
                    .activenessOnScreen(eng != null ? eng.activenessOnScreen() : null)
                    .activenessAttention(eng != null ? eng.activenessAttention() : null)
                    .activenessSeconds(eng != null ? eng.activenessSeconds() : null)
                    .activenessAwayCount(eng != null ? eng.activenessAwayCount() : null)
                    .activenessState(eng != null ? eng.activenessState() : null)
                    .rating(fb.rating())
                    .answers(fb.answers())
                    .build();
        });
        learners = new ArrayList<>(learners);
        learners.sort(LEARNER_ORDER);
        return ClassLearnersResponse.builder()
                .scheduleId(request.getScheduleId())
                .learners(learners)
                .build();
    }

    /** No attendance row = never joined; a non-PRESENT row = joined but short of the rule. */
    static String learnerStatus(String attendanceStatus) {
        if (attendanceStatus == null) {
            return STATUS_NOT_JOINED;
        }
        return STATUS_PRESENT.equalsIgnoreCase(attendanceStatus) ? STATUS_PRESENT : STATUS_BELOW_RULE;
    }

    private static int statusRank(String status) {
        return switch (status) {
            case STATUS_PRESENT -> 0;
            case STATUS_BELOW_RULE -> 1;
            default -> 2;
        };
    }

    /** Present first, then below the rule, then not joined; longest stay first; then name. */
    static final Comparator<ClassLearner> LEARNER_ORDER = Comparator
            .comparingInt((ClassLearner l) -> statusRank(l.getStatus()))
            .thenComparing(l -> l.getSecondsInClass() == null ? 0 : -l.getSecondsInClass())
            .thenComparing(l -> l.getName() == null ? "~" : l.getName().toLowerCase(Locale.ROOT));

    // ─────────────────────────────────────────────────────────────────────
    // At-risk learners
    // ─────────────────────────────────────────────────────────────────────

    record ScheduleTime(String scheduleId, String sessionId, LocalDate meetingDate, LocalTime startTime,
                        LocalTime endTime, String timezone, String createdByUserId) {
    }

    public AtRiskResponse getAtRisk(LiveClassDashboardRequest request) {
        LiveClassDashboardService.validate(request);
        int minMissed = request.getMinMissed() != null && request.getMinMissed() > 0
                ? request.getMinMissed() : DEFAULT_MIN_MISSED;
        String view = atRiskView(request.getAtRiskView());
        List<String> batchIds = LiveClassDashboardService.cleanIds(request.getBatchIds());
        MapSqlParameterSource params = LiveClassDashboardService.params(request.getInstituteId(),
                request.getStartDate(), request.getEndDate(), batchIds);

        List<ScheduleTime> schedules = jdbc.query(SCHEDULE_TIMES_SQL, params, (rs, i) -> {
            Date d = rs.getDate("meeting_date");
            Time s = rs.getTime("start_time");
            Time e = rs.getTime("last_entry_time");
            return new ScheduleTime(rs.getString("schedule_id"), rs.getString("session_id"),
                    d != null ? d.toLocalDate() : null, s != null ? s.toLocalTime() : null,
                    e != null ? e.toLocalTime() : null, rs.getString("timezone"),
                    rs.getString("created_by_user_id"));
        });
        Set<String> instructorFilter = new HashSet<>(LiveClassDashboardService.cleanIds(request.getInstructorIds()));
        Map<String, List<String>> instructorsBySession = instructorFilter.isEmpty()
                ? Map.of()
                : instructorService.getEffectiveInstructorUserIdsBySession(sessionsOf(schedules));
        List<String> completed = completedScheduleIds(schedules, instructorFilter, instructorsBySession, Instant.now());

        AtRiskResponse.AtRiskResponseBuilder response = AtRiskResponse.builder()
                .minMissed(minMissed)
                .view(view)
                .completedClasses(completed.size())
                .limit(AT_RISK_LIMIT);
        if (completed.size() < minMissed) {
            return response.total(0).learners(List.of()).build();
        }

        params.addValue("scheduleIdsCsv", String.join(",", completed))
                .addValue("minMissed", minMissed)
                .addValue("view", view)
                .addValue("limit", AT_RISK_LIMIT);
        long[] total = {0};
        List<AtRiskLearner> learners = jdbc.query(AT_RISK_SQL, params, (rs, i) -> {
            total[0] = rs.getLong("total");
            int expected = rs.getInt("expected");
            int attended = rs.getInt("attended");
            Date last = rs.getDate("last_attended");
            return AtRiskLearner.builder()
                    .userId(rs.getString("user_id"))
                    .name(rs.getString("full_name"))
                    .email(rs.getString("email"))
                    .mobile(rs.getString("mobile_number"))
                    .packageSessionId(rs.getString("package_session_id"))
                    .expected(expected)
                    .attended(attended)
                    .missed(expected - attended)
                    .attendanceRate(expected > 0 ? (double) attended / expected : null)
                    .missStreak(rs.getInt("miss_streak"))
                    .lastAttended(last != null ? last.toLocalDate() : null)
                    .build();
        });
        return response.total(total[0]).learners(learners).build();
    }

    /** DROPPED / NEVER as asked, anything else (incl. null) = ALL. */
    static String atRiskView(String raw) {
        if (raw == null) {
            return "ALL";
        }
        String view = raw.trim().toUpperCase(Locale.ROOT);
        return "DROPPED".equals(view) || "NEVER".equals(view) ? view : "ALL";
    }

    /** Finished classes only, optionally narrowed to the given instructors. */
    static List<String> completedScheduleIds(List<ScheduleTime> schedules, Set<String> instructorFilter,
                                             Map<String, List<String>> instructorsBySession, Instant now) {
        List<String> ids = new ArrayList<>();
        for (ScheduleTime s : schedules) {
            if (!LiveClassDashboardService.matchesInstructor(
                    instructorsBySession.getOrDefault(s.sessionId(), List.of()), instructorFilter)) {
                continue;
            }
            String status = LiveClassDashboardService.classStatus(s.meetingDate(), s.startTime(), s.endTime(),
                    LiveClassDashboardService.zoneOf(s.timezone()), now);
            if (LiveClassDashboardService.STATUS_COMPLETED.equals(status)) {
                ids.add(s.scheduleId());
            }
        }
        return ids;
    }

    private static List<LiveSession> sessionsOf(List<ScheduleTime> schedules) {
        Map<String, LiveSession> bySession = new LinkedHashMap<>();
        for (ScheduleTime s : schedules) {
            bySession.computeIfAbsent(s.sessionId(), id -> LiveSession.builder()
                    .id(id).createdByUserId(s.createdByUserId()).build());
        }
        return new ArrayList<>(bySession.values());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Feedback wall
    // ─────────────────────────────────────────────────────────────────────

    private record RawComment(String scheduleId, String sessionId, String userId, String details,
                              Timestamp createdAt, String title, String subject, String configJson,
                              String createdBy, LocalDate meetingDate, LocalTime startTime, String learnerName) {
    }

    public FeedbackWallResponse getFeedbackWall(LiveClassDashboardRequest request) {
        LiveClassDashboardService.validate(request);
        List<String> batchIds = LiveClassDashboardService.cleanIds(request.getBatchIds());
        MapSqlParameterSource params = LiveClassDashboardService.params(request.getInstituteId(),
                request.getStartDate(), request.getEndDate(), batchIds)
                .addValue("scanLimit", FEEDBACK_SCAN_LIMIT);

        List<RawComment> raw = jdbc.query(FEEDBACK_WALL_SQL, params, (rs, i) -> {
            Date d = rs.getDate("meeting_date");
            Time t = rs.getTime("start_time");
            return new RawComment(rs.getString("schedule_id"), rs.getString("session_id"),
                    rs.getString("user_source_id"), rs.getString("details"), rs.getTimestamp("created_at"),
                    rs.getString("title"), rs.getString("subject"), rs.getString("feedback_config_json"),
                    rs.getString("created_by_user_id"), d != null ? d.toLocalDate() : null,
                    t != null ? t.toLocalTime() : null, rs.getString("full_name"));
        });

        Map<String, LiveSession> sessions = new LinkedHashMap<>();
        raw.forEach(r -> sessions.computeIfAbsent(r.sessionId(), id -> LiveSession.builder()
                .id(id).createdByUserId(r.createdBy()).build()));
        Map<String, List<String>> instructorsBySession = instructorService
                .getEffectiveInstructorUserIdsBySession(new ArrayList<>(sessions.values()));
        Set<String> instructorFilter = new HashSet<>(LiveClassDashboardService.cleanIds(request.getInstructorIds()));

        List<RawComment> kept = new ArrayList<>();
        Map<String, ParsedFeedback> parsed = new HashMap<>();
        for (RawComment r : raw) {
            if (kept.size() >= FEEDBACK_WALL_LIMIT) {
                break;
            }
            if (!LiveClassDashboardService.matchesInstructor(
                    instructorsBySession.getOrDefault(r.sessionId(), List.of()), instructorFilter)) {
                continue;
            }
            ParsedFeedback fb = parseFeedback(parseQuestions(r.configJson()), r.details());
            if (fb.answers().isEmpty()) {
                continue;
            }
            parsed.put(r.scheduleId() + "|" + r.userId(), fb);
            kept.add(r);
        }

        Map<String, InstructorRef> directory = resolveInstructors(kept.stream()
                .map(r -> instructorsBySession.getOrDefault(r.sessionId(), List.of()))
                .toList());
        List<FeedbackComment> comments = kept.stream().map(r -> {
            ParsedFeedback fb = parsed.get(r.scheduleId() + "|" + r.userId());
            return FeedbackComment.builder()
                    .userId(r.userId())
                    .learnerName(r.learnerName())
                    .sessionId(r.sessionId())
                    .scheduleId(r.scheduleId())
                    .title(r.title())
                    .subject(r.subject())
                    .meetingDate(r.meetingDate())
                    .startTime(r.startTime() != null ? r.startTime().toString() : null)
                    .instructors(instructorsBySession.getOrDefault(r.sessionId(), List.of()).stream()
                            .map(id -> LiveClassDashboardService.refFor(id, directory))
                            .toList())
                    .rating(fb.rating())
                    .answers(fb.answers())
                    .submittedAt(r.createdAt() != null ? r.createdAt().toInstant().toString() : null)
                    .build();
        }).toList();

        return FeedbackWallResponse.builder()
                .limit(FEEDBACK_WALL_LIMIT)
                .comments(comments)
                .build();
    }

    private Map<String, InstructorRef> resolveInstructors(Collection<List<String>> idLists) {
        List<String> ids = idLists.stream().flatMap(List::stream).filter(StringUtils::hasText).distinct().toList();
        Map<String, InstructorRef> result = new HashMap<>();
        if (ids.isEmpty()) {
            return result;
        }
        for (LiveSessionInstructorDTO dto : instructorService.toInstructorDetails(ids)) {
            result.put(dto.getUserId(), InstructorRef.builder()
                    .userId(dto.getUserId()).name(dto.getFullName()).email(dto.getEmail()).build());
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────
    // JSON parsing (pure)
    // ─────────────────────────────────────────────────────────────────────

    record FeedbackQuestion(String id, String type, String label) {
    }

    record ParsedFeedback(Double rating, List<FeedbackAnswer> answers) {
        static final ParsedFeedback EMPTY = new ParsedFeedback(null, List.of());
    }

    /**
     * BBB counters are null when the row has none of BBB's keys — the activeness plugin
     * can write its keys before the end-of-class analytics callback, and that must not
     * read as "0 talks". Activeness fields are null when that key is absent.
     */
    record Engagement(Integer talks, Integer chats, Integer raiseHands, Integer pollVotes, Integer emojis,
                      Integer activeness, Integer activenessOnScreen, Integer activenessAttention,
                      Integer activenessSeconds, Integer activenessAwayCount, Integer activenessState) {
    }

    private static final List<String> BBB_COUNTER_KEYS =
            List.of("talks", "chats", "talkTime", "raisehand", "pollVotes", "emojis");

    /** The session's feedback questions, in form order; empty for missing or malformed config. */
    static List<FeedbackQuestion> parseQuestions(String configJson) {
        JsonNode root = readJson(configJson);
        if (root == null || !root.path("questions").isArray()) {
            return List.of();
        }
        List<FeedbackQuestion> questions = new ArrayList<>();
        for (JsonNode q : root.path("questions")) {
            String id = q.path("id").asText(null);
            if (StringUtils.hasText(id)) {
                questions.add(new FeedbackQuestion(id, q.path("type").asText(""), q.path("label").asText(null)));
            }
        }
        return questions;
    }

    /**
     * Rating = the first star_rating question's number (same rule as the feedback
     * page). Answers = every non-blank string value, labelled from the config and
     * in form order; keys the config does not know keep their key as the label.
     */
    static ParsedFeedback parseFeedback(List<FeedbackQuestion> questions, String detailsJson) {
        JsonNode details = readJson(detailsJson);
        if (details == null || !details.isObject()) {
            return ParsedFeedback.EMPTY;
        }
        Double rating = null;
        for (FeedbackQuestion q : questions) {
            if ("star_rating".equals(q.type()) && details.path(q.id()).isNumber()) {
                rating = details.path(q.id()).asDouble();
                break;
            }
        }
        List<FeedbackAnswer> answers = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (FeedbackQuestion q : questions) {
            seen.add(q.id());
            addAnswer(answers, q.id(), q.label(), details.path(q.id()));
        }
        Iterator<Map.Entry<String, JsonNode>> fields = details.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            if (!seen.contains(field.getKey())) {
                addAnswer(answers, field.getKey(), null, field.getValue());
            }
        }
        return new ParsedFeedback(rating, answers);
    }

    private static void addAnswer(List<FeedbackAnswer> answers, String id, String label, JsonNode value) {
        if (value == null || !value.isTextual()) {
            return;
        }
        String text = value.asText().trim();
        if (text.isEmpty()) {
            return;
        }
        answers.add(FeedbackAnswer.builder()
                .questionId(id)
                .label(StringUtils.hasText(label) ? label : id)
                .text(text)
                .build());
    }

    /** BBB engagement counters + activeness score; null when absent or malformed. */
    static Engagement parseEngagement(String json) {
        JsonNode root = readJson(json);
        if (root == null || !root.isObject()) {
            return null;
        }
        boolean hasCounters = BBB_COUNTER_KEYS.stream().anyMatch(root::has);
        return new Engagement(
                hasCounters ? root.path("talks").asInt(0) : null,
                hasCounters ? root.path("chats").asInt(0) : null,
                hasCounters ? root.path("raisehand").asInt(0) : null,
                hasCounters ? root.path("pollVotes").asInt(0) : null,
                hasCounters ? root.path("emojis").asInt(0) : null,
                optInt(root, "activeness"),
                optInt(root, "activenessOnScreen"),
                optInt(root, "activenessAttention"),
                optInt(root, "activenessSeconds"),
                optInt(root, "activenessAwayCount"),
                optInt(root, "activenessState"));
    }

    private static Integer optInt(JsonNode root, String key) {
        JsonNode n = root.get(key);
        return n != null && n.isNumber() ? n.asInt() : null;
    }

    private static JsonNode readJson(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
