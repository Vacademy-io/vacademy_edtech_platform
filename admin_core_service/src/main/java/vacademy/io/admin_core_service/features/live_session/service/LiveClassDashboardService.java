package vacademy.io.admin_core_service.features.live_session.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardRequest;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.BatchStats;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.ClassRow;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.DailyPoint;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.InstructorRef;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.InstructorStats;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.PlatformSlice;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.RatingBucket;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.Summary;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionInstructorDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Read-only aggregates for the admin Live Class Dashboard.
 *
 * <p>Two SQL round trips (per-class metrics, per-class-per-batch attendance)
 * plus one user-directory call for instructor names; everything else — live /
 * upcoming / completed split, daily trend, instructor and batch roll-ups — is
 * folded in Java by {@link #assemble}, which is pure and unit-tested.
 *
 * <p>Conventions, all deliberate:
 * <ul>
 *   <li>Sessions are scoped by {@code live_session.institute_id}; the audience
 *       (expected learners) by the learner's own enrollment
 *       {@code student_session_institute_group_mapping.institute_id}, same as the
 *       Attendance Tracker. Audience covers BATCH and USER participants.</li>
 *   <li>Only published ({@code LIVE}) sessions, and never DELETED/CANCELLED
 *       schedules — the same set the admin list tabs show.</li>
 *   <li>Live / upcoming / completed is decided here in Java from each session's
 *       own timezone, never with {@code AT TIME ZONE} in SQL: one bad stored
 *       zone would otherwise abort the whole query.</li>
 *   <li>Attendance, duration and engagement roll-ups count completed classes
 *       only, so an upcoming class with 0 joins cannot drag the rate down.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LiveClassDashboardService {

    static final int MAX_RANGE_DAYS = 366;
    static final int CLASSES_LIMIT = 1000;
    /** Ranges up to a quarter also get the same-length period before them, for ▲/▼ deltas. */
    static final int MAX_COMPARE_DAYS = 92;

    static final String STATUS_LIVE = "LIVE";
    static final String STATUS_UPCOMING = "UPCOMING";
    static final String STATUS_COMPLETED = "COMPLETED";

    private final NamedParameterJdbcTemplate jdbc;
    private final LiveSessionInstructorService instructorService;

    // ─────────────────────────────────────────────────────────────────────
    // SQL
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Shared scope: {@code sched} = the institute's published classes in the
     * range; {@code aud} = one row per (class, expected learner), narrowed to the
     * selected batches; {@code scoped} = the classes that survive the batch
     * filter (a batch with no enrolled learners still keeps its classes).
     */
    static final String SCOPE_CTES = """
            WITH sched AS (
                SELECT ss.id AS schedule_id, ss.session_id, ss.meeting_date
                FROM session_schedules ss
                JOIN live_session ls ON ls.id = ss.session_id
                WHERE ls.institute_id = :instituteId
                  AND ls.status = 'LIVE'
                  AND COALESCE(ss.status, '') NOT IN ('DELETED', 'CANCELLED')
                  AND ss.meeting_date BETWEEN :startDate AND :endDate
            ),
            aud AS (
                SELECT DISTINCT ON (s.schedule_id, m.user_id)
                       s.schedule_id, m.user_id, m.package_session_id
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
                ORDER BY s.schedule_id, m.user_id, m.enrolled_date DESC NULLS LAST
            ),
            scoped AS (
                SELECT s.schedule_id, s.session_id, s.meeting_date
                FROM sched s
                WHERE :hasBatchFilter = FALSE
                   OR EXISTS (SELECT 1 FROM live_session_participants p
                              WHERE p.session_id = s.session_id
                                AND p.source_type = 'BATCH'
                                AND p.source_id = ANY(STRING_TO_ARRAY(:batchIdsCsv, ',')))
                   OR EXISTS (SELECT 1 FROM aud a WHERE a.schedule_id = s.schedule_id)
            )
            """;

    /**
     * One row per class. Attendance rows are unique per (schedule, user) by the
     * {@code uq_lsl_attendance_schedule_user} index; feedback keeps each learner's
     * latest submission. The rating is the session's first star_rating question,
     * the same resolution the feedback page uses.
     *
     * <p>{@code att} and {@code fb_rated} are MATERIALIZED on purpose: inlined,
     * Postgres re-parses the JSON text once per referencing expression (ten
     * times per attendance row), which made a 30-day Shiksha Nation load ~3x slower.
     */
    static final String CLASS_SQL = SCOPE_CTES + """
            ,
            att AS MATERIALIZED (
                SELECT l.schedule_id,
                       l.user_source_type,
                       l.status,
                       COALESCE(l.provider_total_duration_seconds, l.provider_total_duration_minutes * 60) AS secs,
                       (a.user_id IS NOT NULL) AS in_audience,
                       -- Only BBB's counters make a row "engagement tracked": the opt-in
                       -- activeness score shares this JSON and lands during the class.
                       CASE WHEN l.engagement_data IS NOT NULL AND pg_input_is_valid(l.engagement_data, 'jsonb')
                            THEN (CASE WHEN jsonb_exists_any(CAST(l.engagement_data AS jsonb),
                                           ARRAY['chats', 'talks', 'talkTime', 'raisehand', 'emojis', 'pollVotes'])
                                       THEN CAST(l.engagement_data AS jsonb) END) END AS eng
                FROM live_session_logs l
                JOIN scoped s ON s.schedule_id = l.schedule_id
                LEFT JOIN aud a ON a.schedule_id = l.schedule_id
                               AND l.user_source_type = 'USER'
                               AND a.user_id = l.user_source_id
                WHERE l.log_type = 'ATTENDANCE_RECORDED'
                  AND (:hasBatchFilter = FALSE OR a.user_id IS NOT NULL)
            ),
            att_num AS (
                SELECT att.*,
                       CASE WHEN jsonb_typeof(eng -> 'chats') = 'number' THEN CAST(eng ->> 'chats' AS numeric) ELSE 0 END AS chats,
                       CASE WHEN jsonb_typeof(eng -> 'talks') = 'number' THEN CAST(eng ->> 'talks' AS numeric) ELSE 0 END AS talks,
                       CASE WHEN jsonb_typeof(eng -> 'talkTime') = 'number' THEN CAST(eng ->> 'talkTime' AS numeric) ELSE 0 END AS talk_time,
                       CASE WHEN jsonb_typeof(eng -> 'raisehand') = 'number' THEN CAST(eng ->> 'raisehand' AS numeric) ELSE 0 END AS raise_hands,
                       CASE WHEN jsonb_typeof(eng -> 'emojis') = 'number' THEN CAST(eng ->> 'emojis' AS numeric) ELSE 0 END AS emojis,
                       CASE WHEN jsonb_typeof(eng -> 'pollVotes') = 'number' THEN CAST(eng ->> 'pollVotes' AS numeric) ELSE 0 END AS poll_votes
                FROM att
            ),
            att_agg AS (
                SELECT schedule_id,
                       COUNT(*) AS joined,
                       COUNT(*) FILTER (WHERE status = 'PRESENT') AS present,
                       COUNT(*) FILTER (WHERE status = 'PRESENT' AND in_audience) AS present_in_audience,
                       COUNT(*) FILTER (WHERE in_audience) AS joined_in_audience,
                       COUNT(*) FILTER (WHERE user_source_type <> 'USER') AS guests,
                       COUNT(*) FILTER (WHERE secs > 0) AS timed,
                       COALESCE(SUM(secs) FILTER (WHERE secs > 0), 0) AS total_secs,
                       COUNT(eng) AS engagement_tracked,
                       COUNT(*) FILTER (WHERE eng IS NOT NULL
                                          AND chats + talks + raise_hands + emojis + poll_votes > 0) AS engaged,
                       COUNT(*) FILTER (WHERE eng IS NOT NULL AND talks > 0) AS spoke_count,
                       COUNT(*) FILTER (WHERE eng IS NOT NULL AND chats > 0) AS chatted_count,
                       COUNT(*) FILTER (WHERE eng IS NOT NULL AND raise_hands > 0) AS raised_hand_count,
                       COUNT(*) FILTER (WHERE eng IS NOT NULL AND poll_votes > 0) AS voted_count,
                       COUNT(*) FILTER (WHERE eng IS NOT NULL AND emojis > 0) AS reacted_count,
                       COALESCE(SUM(chats), 0) AS chats,
                       COALESCE(SUM(talks), 0) AS talks,
                       COALESCE(SUM(talk_time), 0) AS talk_seconds,
                       COALESCE(SUM(raise_hands), 0) AS raise_hands,
                       COALESCE(SUM(emojis), 0) AS emojis,
                       COALESCE(SUM(poll_votes), 0) AS poll_votes
                FROM att_num
                GROUP BY schedule_id
            ),
            fb AS (
                SELECT DISTINCT ON (l.schedule_id, l.user_source_id)
                       l.schedule_id, s.session_id, l.details
                FROM live_session_logs l
                JOIN scoped s ON s.schedule_id = l.schedule_id
                LEFT JOIN aud a ON a.schedule_id = l.schedule_id AND a.user_id = l.user_source_id
                WHERE l.log_type = 'FEEDBACK_SUBMITTED'
                  AND l.user_source_type = 'USER'
                  AND (:hasBatchFilter = FALSE OR a.user_id IS NOT NULL)
                ORDER BY l.schedule_id, l.user_source_id, l.created_at DESC
            ),
            fb_rated AS MATERIALIZED (
                SELECT fb.schedule_id,
                       (SELECT CAST(CAST(fb.details AS jsonb) ->> (q.value ->> 'id') AS numeric)
                          FROM jsonb_array_elements(
                                 CASE WHEN pg_input_is_valid(ls.feedback_config_json, 'jsonb')
                                       AND pg_input_is_valid(fb.details, 'jsonb')
                                      THEN CASE WHEN jsonb_typeof(CAST(ls.feedback_config_json AS jsonb) -> 'questions') = 'array'
                                                THEN CAST(ls.feedback_config_json AS jsonb) -> 'questions' END
                                 END
                               ) WITH ORDINALITY AS q(value, ord)
                         WHERE q.value ->> 'type' = 'star_rating'
                           AND (CAST(fb.details AS jsonb) ->> (q.value ->> 'id')) ~ '^[0-9]+(\\.[0-9]+){0,1}$'
                         ORDER BY q.ord
                         LIMIT 1) AS rating
                FROM fb
                JOIN live_session ls ON ls.id = fb.session_id
            ),
            fb_agg AS (
                SELECT schedule_id,
                       COUNT(*) AS feedback_count,
                       COUNT(rating) AS rated_count,
                       COALESCE(SUM(rating), 0) AS rating_sum,
                       COUNT(*) FILTER (WHERE rating < 2) AS r1,
                       COUNT(*) FILTER (WHERE rating >= 2 AND rating < 3) AS r2,
                       COUNT(*) FILTER (WHERE rating >= 3 AND rating < 4) AS r3,
                       COUNT(*) FILTER (WHERE rating >= 4 AND rating < 5) AS r4,
                       COUNT(*) FILTER (WHERE rating >= 5) AS r5
                FROM fb_rated
                GROUP BY schedule_id
            ),
            aud_agg AS (
                SELECT schedule_id, COUNT(*) AS expected
                FROM aud
                GROUP BY schedule_id
            )
            SELECT s.schedule_id,
                   s.session_id,
                   ls.title,
                   ls.subject,
                   s.meeting_date,
                   ss.start_time,
                   ss.last_entry_time,
                   ls.timezone,
                   COALESCE(NULLIF(ss.link_type, ''), ls.link_type) AS link_type,
                   ls.access_level,
                   ls.created_by_user_id,
                   (SELECT string_agg(DISTINCT p.source_id, ',')
                      FROM live_session_participants p
                     WHERE p.session_id = s.session_id
                       AND p.source_type = 'BATCH') AS batch_ids,
                   COALESCE(au.expected, 0) AS expected,
                   COALESCE(aa.joined, 0) AS joined,
                   COALESCE(aa.present, 0) AS present,
                   COALESCE(aa.present_in_audience, 0) AS present_in_audience,
                   COALESCE(aa.joined_in_audience, 0) AS joined_in_audience,
                   COALESCE(aa.guests, 0) AS guests,
                   COALESCE(aa.timed, 0) AS timed,
                   COALESCE(aa.total_secs, 0) AS total_secs,
                   COALESCE(aa.engagement_tracked, 0) AS engagement_tracked,
                   COALESCE(aa.engaged, 0) AS engaged,
                   COALESCE(aa.spoke_count, 0) AS spoke_count,
                   COALESCE(aa.chatted_count, 0) AS chatted_count,
                   COALESCE(aa.raised_hand_count, 0) AS raised_hand_count,
                   COALESCE(aa.voted_count, 0) AS voted_count,
                   COALESCE(aa.reacted_count, 0) AS reacted_count,
                   COALESCE(aa.chats, 0) AS chats,
                   COALESCE(aa.talks, 0) AS talks,
                   COALESCE(aa.talk_seconds, 0) AS talk_seconds,
                   COALESCE(aa.raise_hands, 0) AS raise_hands,
                   COALESCE(aa.emojis, 0) AS emojis,
                   COALESCE(aa.poll_votes, 0) AS poll_votes,
                   COALESCE(fa.feedback_count, 0) AS feedback_count,
                   COALESCE(fa.rated_count, 0) AS rated_count,
                   COALESCE(fa.rating_sum, 0) AS rating_sum,
                   COALESCE(fa.r1, 0) AS r1,
                   COALESCE(fa.r2, 0) AS r2,
                   COALESCE(fa.r3, 0) AS r3,
                   COALESCE(fa.r4, 0) AS r4,
                   COALESCE(fa.r5, 0) AS r5
            FROM scoped s
            JOIN session_schedules ss ON ss.id = s.schedule_id
            JOIN live_session ls ON ls.id = s.session_id
            LEFT JOIN aud_agg au ON au.schedule_id = s.schedule_id
            LEFT JOIN att_agg aa ON aa.schedule_id = s.schedule_id
            LEFT JOIN fb_agg fa ON fa.schedule_id = s.schedule_id
            ORDER BY s.meeting_date DESC, ss.start_time DESC NULLS LAST
            """;

    /** Expected / joined / present per (class, batch) — the batch roll-up. */
    static final String BATCH_SQL = SCOPE_CTES + """
            SELECT a.schedule_id,
                   a.package_session_id,
                   COUNT(*) AS expected,
                   COUNT(l.id) AS joined,
                   COUNT(l.id) FILTER (WHERE l.status = 'PRESENT') AS present
            FROM aud a
            JOIN scoped s ON s.schedule_id = a.schedule_id
            LEFT JOIN live_session_logs l
                   ON l.schedule_id = a.schedule_id
                  AND l.log_type = 'ATTENDANCE_RECORDED'
                  AND l.user_source_type = 'USER'
                  AND l.user_source_id = a.user_id
            GROUP BY a.schedule_id, a.package_session_id
            """;

    // ─────────────────────────────────────────────────────────────────────
    // Rows
    // ─────────────────────────────────────────────────────────────────────

    record ClassMetrics(
            String scheduleId, String sessionId, String title, String subject,
            LocalDate meetingDate, LocalTime startTime, LocalTime endTime, String timezone,
            String linkType, String accessLevel, String createdByUserId, List<String> batchIds,
            long expected, long joined, long present, long presentInAudience, long joinedInAudience, long guests,
            long timed, long totalSecs, long engagementTracked, long engaged,
            long spokeCount, long chattedCount, long raisedHandCount, long votedCount, long reactedCount,
            long chats, long talks, long talkSeconds, long raiseHands, long emojis, long pollVotes,
            long feedbackCount, long ratedCount, double ratingSum,
            long r1, long r2, long r3, long r4, long r5) {
    }

    record BatchMetrics(String scheduleId, String packageSessionId, long expected, long joined, long present) {
    }

    // ─────────────────────────────────────────────────────────────────────
    // Entry point
    // ─────────────────────────────────────────────────────────────────────

    public LiveClassDashboardResponse getDashboard(LiveClassDashboardRequest request) {
        validate(request);

        List<String> batchIds = cleanIds(request.getBatchIds());
        Instant now = Instant.now();
        LocalDate todayUtc = now.atZone(ZoneOffset.UTC).toLocalDate();

        List<ClassMetrics> classes = queryClasses(request.getInstituteId(),
                request.getStartDate(), request.getEndDate(), batchIds);
        List<BatchMetrics> batches = queryBatches(request.getInstituteId(),
                request.getStartDate(), request.getEndDate(), batchIds);

        // Classes in progress can start yesterday (UTC) in a far-east zone or end
        // tomorrow in a far-west one; reuse the range rows when they cover it.
        LocalDate liveFrom = todayUtc.minusDays(1);
        LocalDate liveTo = todayUtc.plusDays(1);
        boolean rangeCoversLive = !request.getStartDate().isAfter(liveFrom)
                && !request.getEndDate().isBefore(liveTo);
        List<ClassMetrics> liveCandidates = rangeCoversLive
                ? classes
                : queryClasses(request.getInstituteId(), liveFrom, liveTo, batchIds);

        // The same-length period just before the range, for the KPI deltas.
        LiveClassDashboardRequest previousRequest = previousPeriod(request);
        List<ClassMetrics> previousClasses = previousRequest != null
                ? queryClasses(request.getInstituteId(), previousRequest.getStartDate(),
                        previousRequest.getEndDate(), batchIds)
                : List.of();

        List<ClassMetrics> allRows = new ArrayList<>(classes);
        if (!rangeCoversLive) {
            allRows.addAll(liveCandidates);
        }
        allRows.addAll(previousClasses);
        Map<String, List<String>> instructorsBySession = instructorService
                .getEffectiveInstructorUserIdsBySession(toSessions(allRows));
        Map<String, InstructorRef> directory = resolveInstructors(instructorsBySession.values());

        LiveClassDashboardResponse response =
                assemble(request, classes, batches, liveCandidates, instructorsBySession, directory, now);
        if (previousRequest != null) {
            response.setPreviousStartDate(previousRequest.getStartDate());
            response.setPreviousEndDate(previousRequest.getEndDate());
            response.setPreviousSummary(assemble(previousRequest, previousClasses, List.of(), List.of(),
                    instructorsBySession, directory, now).getSummary());
        }
        return response;
    }

    /** Same filters, the same number of days ending the day before {@code start}; null past a quarter. */
    static LiveClassDashboardRequest previousPeriod(LiveClassDashboardRequest request) {
        long days = ChronoUnit.DAYS.between(request.getStartDate(), request.getEndDate()) + 1;
        if (days > MAX_COMPARE_DAYS) {
            return null;
        }
        LiveClassDashboardRequest previous = new LiveClassDashboardRequest();
        previous.setInstituteId(request.getInstituteId());
        previous.setBatchIds(request.getBatchIds());
        previous.setInstructorIds(request.getInstructorIds());
        previous.setEndDate(request.getStartDate().minusDays(1));
        previous.setStartDate(request.getStartDate().minusDays(days));
        return previous;
    }

    static void validate(LiveClassDashboardRequest request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required");
        }
        if (request.getStartDate() == null || request.getEndDate() == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "start_date and end_date are required");
        }
        if (request.getEndDate().isBefore(request.getStartDate())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "end_date must not be before start_date");
        }
        if (ChronoUnit.DAYS.between(request.getStartDate(), request.getEndDate()) >= MAX_RANGE_DAYS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Date range can be at most " + MAX_RANGE_DAYS + " days");
        }
    }

    static MapSqlParameterSource params(String instituteId, LocalDate start, LocalDate end, List<String> batchIds) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("startDate", Date.valueOf(start))
                .addValue("endDate", Date.valueOf(end))
                .addValue("hasBatchFilter", !batchIds.isEmpty())
                .addValue("batchIdsCsv", String.join(",", batchIds));
    }

    private List<ClassMetrics> queryClasses(String instituteId, LocalDate start, LocalDate end, List<String> batchIds) {
        return jdbc.query(CLASS_SQL, params(instituteId, start, end, batchIds), (rs, i) -> mapClass(rs));
    }

    private List<BatchMetrics> queryBatches(String instituteId, LocalDate start, LocalDate end, List<String> batchIds) {
        return jdbc.query(BATCH_SQL, params(instituteId, start, end, batchIds), (rs, i) -> new BatchMetrics(
                rs.getString("schedule_id"),
                rs.getString("package_session_id"),
                rs.getLong("expected"),
                rs.getLong("joined"),
                rs.getLong("present")));
    }

    private static ClassMetrics mapClass(ResultSet rs) throws SQLException {
        Date meetingDate = rs.getDate("meeting_date");
        Time start = rs.getTime("start_time");
        Time end = rs.getTime("last_entry_time");
        String batchCsv = rs.getString("batch_ids");
        BigDecimal ratingSum = rs.getBigDecimal("rating_sum");
        return new ClassMetrics(
                rs.getString("schedule_id"),
                rs.getString("session_id"),
                rs.getString("title"),
                rs.getString("subject"),
                meetingDate != null ? meetingDate.toLocalDate() : null,
                start != null ? start.toLocalTime() : null,
                end != null ? end.toLocalTime() : null,
                rs.getString("timezone"),
                rs.getString("link_type"),
                rs.getString("access_level"),
                rs.getString("created_by_user_id"),
                StringUtils.hasText(batchCsv) ? Arrays.asList(batchCsv.split(",")) : List.of(),
                rs.getLong("expected"),
                rs.getLong("joined"),
                rs.getLong("present"),
                rs.getLong("present_in_audience"),
                rs.getLong("joined_in_audience"),
                rs.getLong("guests"),
                rs.getLong("timed"),
                rs.getLong("total_secs"),
                rs.getLong("engagement_tracked"),
                rs.getLong("engaged"),
                rs.getLong("spoke_count"),
                rs.getLong("chatted_count"),
                rs.getLong("raised_hand_count"),
                rs.getLong("voted_count"),
                rs.getLong("reacted_count"),
                rs.getLong("chats"),
                rs.getLong("talks"),
                rs.getLong("talk_seconds"),
                rs.getLong("raise_hands"),
                rs.getLong("emojis"),
                rs.getLong("poll_votes"),
                rs.getLong("feedback_count"),
                rs.getLong("rated_count"),
                ratingSum != null ? ratingSum.doubleValue() : 0d,
                rs.getLong("r1"),
                rs.getLong("r2"),
                rs.getLong("r3"),
                rs.getLong("r4"),
                rs.getLong("r5"));
    }

    static List<LiveSession> toSessions(List<ClassMetrics> rows) {
        Map<String, LiveSession> bySession = new LinkedHashMap<>();
        for (ClassMetrics row : rows) {
            bySession.computeIfAbsent(row.sessionId(), id -> LiveSession.builder()
                    .id(id)
                    .createdByUserId(row.createdByUserId())
                    .build());
        }
        return new ArrayList<>(bySession.values());
    }

    Map<String, InstructorRef> resolveInstructors(Collection<List<String>> idLists) {
        List<String> ids = idLists.stream()
                .flatMap(List::stream)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        Map<String, InstructorRef> result = new HashMap<>();
        if (ids.isEmpty()) {
            return result;
        }
        for (LiveSessionInstructorDTO dto : instructorService.toInstructorDetails(ids)) {
            result.put(dto.getUserId(), InstructorRef.builder()
                    .userId(dto.getUserId())
                    .name(dto.getFullName())
                    .email(dto.getEmail())
                    .build());
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Assembly (pure)
    // ─────────────────────────────────────────────────────────────────────

    static LiveClassDashboardResponse assemble(
            LiveClassDashboardRequest request,
            List<ClassMetrics> rangeRows,
            List<BatchMetrics> batchRows,
            List<ClassMetrics> liveCandidates,
            Map<String, List<String>> instructorsBySession,
            Map<String, InstructorRef> directory,
            Instant now) {

        Set<String> instructorFilter = new HashSet<>(cleanIds(request.getInstructorIds()));
        Function<String, List<String>> instructorsOf =
                sessionId -> instructorsBySession.getOrDefault(sessionId, List.of());

        // Options come from the range BEFORE the instructor filter, so picking a
        // teacher never empties the picker.
        Map<String, InstructorRef> options = new LinkedHashMap<>();
        for (ClassMetrics row : rangeRows) {
            for (String id : instructorsOf.apply(row.sessionId())) {
                options.computeIfAbsent(id, key -> refFor(key, directory));
            }
        }

        List<ClassMetrics> rows = rangeRows.stream()
                .filter(row -> matchesInstructor(instructorsOf.apply(row.sessionId()), instructorFilter))
                .toList();

        Map<String, String> statusBySchedule = new HashMap<>();
        Map<String, Integer> minutesBySchedule = new HashMap<>();
        for (ClassMetrics row : rows) {
            ZoneId zone = zoneOf(row.timezone());
            statusBySchedule.put(row.scheduleId(),
                    classStatus(row.meetingDate(), row.startTime(), row.endTime(), zone, now));
            minutesBySchedule.put(row.scheduleId(), scheduledMinutes(row.startTime(), row.endTime()));
        }

        List<ClassMetrics> completed = rows.stream()
                .filter(row -> STATUS_COMPLETED.equals(statusBySchedule.get(row.scheduleId())))
                .toList();

        Summary summary = summarize(rows, completed, statusBySchedule, minutesBySchedule);

        List<ClassRow> classRows = rows.stream()
                .limit(CLASSES_LIMIT)
                .map(row -> toClassRow(row, statusBySchedule.get(row.scheduleId()),
                        minutesBySchedule.get(row.scheduleId()), instructorsOf, directory))
                .toList();

        List<ClassRow> liveNow = liveCandidates.stream()
                .filter(row -> matchesInstructor(instructorsOf.apply(row.sessionId()), instructorFilter))
                .filter(row -> STATUS_LIVE.equals(classStatus(row.meetingDate(), row.startTime(),
                        row.endTime(), zoneOf(row.timezone()), now)))
                .map(row -> toClassRow(row, STATUS_LIVE, scheduledMinutes(row.startTime(), row.endTime()),
                        instructorsOf, directory))
                .sorted(Comparator.comparing(ClassRow::getStartTime, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();

        Set<String> keptSchedules = rows.stream().map(ClassMetrics::scheduleId).collect(Collectors.toSet());
        Set<String> completedSchedules = completed.stream().map(ClassMetrics::scheduleId).collect(Collectors.toSet());

        return LiveClassDashboardResponse.builder()
                .startDate(request.getStartDate())
                .endDate(request.getEndDate())
                .generatedAt(now.toString())
                .summary(summary)
                .ratingDistribution(ratingDistribution(rows))
                .daily(daily(request.getStartDate(), request.getEndDate(), rows, statusBySchedule))
                .platforms(platforms(rows))
                .instructors(instructorStats(rows, statusBySchedule, minutesBySchedule, instructorsOf, directory))
                .batches(batchStats(batchRows, keptSchedules, completedSchedules))
                .classes(classRows)
                .classesLimit(CLASSES_LIMIT)
                .classesTruncated(rows.size() > CLASSES_LIMIT)
                .liveNow(liveNow)
                .instructorOptions(options.values().stream()
                        .sorted(Comparator.comparing(ref -> displayName(ref).toLowerCase(Locale.ROOT)))
                        .toList())
                .build();
    }

    static boolean matchesInstructor(List<String> instructors, Set<String> filter) {
        return filter.isEmpty() || instructors.stream().anyMatch(filter::contains);
    }

    /** Per-group accumulator shared by the summary, daily and instructor roll-ups. */
    private static final class Tally {
        int classes;
        int completed;
        long expected;
        long joined;
        long present;
        long presentInAudience;
        long joinedInAudience;
        long guests;
        long timed;
        long totalSecs;
        double stayWeighted;
        long stayWeight;
        long scheduledMinutesSum;
        int scheduledMinutesCount;
        long engagementTracked;
        long engaged;
        long spokeCount;
        long chattedCount;
        long raisedHandCount;
        long votedCount;
        long reactedCount;
        long chats;
        long talks;
        long talkSeconds;
        long raiseHands;
        long emojis;
        long pollVotes;
        long feedbackCount;
        long ratedCount;
        double ratingSum;

        void add(ClassMetrics row, boolean isCompleted, Integer scheduledMinutes) {
            classes++;
            feedbackCount += row.feedbackCount();
            ratedCount += row.ratedCount();
            ratingSum += row.ratingSum();
            if (!isCompleted) {
                return;
            }
            completed++;
            expected += row.expected();
            joined += row.joined();
            present += row.present();
            presentInAudience += row.presentInAudience();
            joinedInAudience += row.joinedInAudience();
            guests += row.guests();
            timed += row.timed();
            totalSecs += row.totalSecs();
            engagementTracked += row.engagementTracked();
            engaged += row.engaged();
            spokeCount += row.spokeCount();
            chattedCount += row.chattedCount();
            raisedHandCount += row.raisedHandCount();
            votedCount += row.votedCount();
            reactedCount += row.reactedCount();
            chats += row.chats();
            talks += row.talks();
            talkSeconds += row.talkSeconds();
            raiseHands += row.raiseHands();
            emojis += row.emojis();
            pollVotes += row.pollVotes();
            if (scheduledMinutes != null && scheduledMinutes > 0) {
                scheduledMinutesSum += scheduledMinutes;
                scheduledMinutesCount++;
                if (row.timed() > 0) {
                    double avgSecs = (double) row.totalSecs() / row.timed();
                    double stay = Math.min(1d, avgSecs / (scheduledMinutes * 60d));
                    stayWeighted += stay * row.timed();
                    stayWeight += row.timed();
                }
            }
        }

        Double attendanceRate() {
            return expected > 0 ? Math.min(1d, (double) presentInAudience / expected) : null;
        }

        Double avgAttendedMinutes() {
            return timed > 0 ? round1(totalSecs / 60d / timed) : null;
        }

        Double engagementRate() {
            return engagementTracked > 0 ? (double) engaged / engagementTracked : null;
        }

        Double avgRating() {
            return ratedCount > 0 ? round2(ratingSum / ratedCount) : null;
        }
    }

    private static Summary summarize(List<ClassMetrics> rows, List<ClassMetrics> completed,
                                     Map<String, String> statusBySchedule, Map<String, Integer> minutesBySchedule) {
        Tally t = new Tally();
        int live = 0;
        int upcoming = 0;
        for (ClassMetrics row : rows) {
            String status = statusBySchedule.get(row.scheduleId());
            if (STATUS_LIVE.equals(status)) {
                live++;
            } else if (STATUS_UPCOMING.equals(status)) {
                upcoming++;
            }
            t.add(row, STATUS_COMPLETED.equals(status), minutesBySchedule.get(row.scheduleId()));
        }
        return Summary.builder()
                .totalClasses(rows.size())
                .completedClasses(completed.size())
                .liveClasses(live)
                .upcomingClasses(upcoming)
                .expectedLearners(t.expected)
                .joined(t.joined)
                .present(t.present)
                .presentInAudience(t.presentInAudience)
                .joinedInAudience(t.joinedInAudience)
                .guests(t.guests)
                .attendanceRate(t.attendanceRate())
                .avgJoinedPerClass(t.completed > 0 ? round1((double) t.joined / t.completed) : null)
                .avgScheduledMinutes(t.scheduledMinutesCount > 0
                        ? round1((double) t.scheduledMinutesSum / t.scheduledMinutesCount) : null)
                .avgAttendedMinutes(t.avgAttendedMinutes())
                .avgStayRate(t.stayWeight > 0 ? t.stayWeighted / t.stayWeight : null)
                .engagementRate(t.engagementRate())
                .engagementTracked(t.engagementTracked)
                .spokeCount(t.spokeCount)
                .chattedCount(t.chattedCount)
                .raisedHandCount(t.raisedHandCount)
                .votedCount(t.votedCount)
                .reactedCount(t.reactedCount)
                .chats(t.chats)
                .talks(t.talks)
                .talkSeconds(t.talkSeconds)
                .raiseHands(t.raiseHands)
                .emojis(t.emojis)
                .pollVotes(t.pollVotes)
                .feedbackCount(t.feedbackCount)
                .ratedCount(t.ratedCount)
                .avgRating(t.avgRating())
                .feedbackRate(t.present > 0 ? Math.min(1d, (double) t.feedbackCount / t.present) : null)
                .build();
    }

    private static List<RatingBucket> ratingDistribution(List<ClassMetrics> rows) {
        long[] buckets = new long[6];
        for (ClassMetrics row : rows) {
            buckets[1] += row.r1();
            buckets[2] += row.r2();
            buckets[3] += row.r3();
            buckets[4] += row.r4();
            buckets[5] += row.r5();
        }
        List<RatingBucket> result = new ArrayList<>();
        for (int stars = 5; stars >= 1; stars--) {
            result.add(RatingBucket.builder().stars(stars).count(buckets[stars]).build());
        }
        return result;
    }

    private static List<DailyPoint> daily(LocalDate start, LocalDate end, List<ClassMetrics> rows,
                                          Map<String, String> statusBySchedule) {
        Map<LocalDate, Tally> byDate = new LinkedHashMap<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            byDate.put(d, new Tally());
        }
        for (ClassMetrics row : rows) {
            Tally t = byDate.get(row.meetingDate());
            if (t != null) {
                t.add(row, STATUS_COMPLETED.equals(statusBySchedule.get(row.scheduleId())), null);
            }
        }
        List<DailyPoint> result = new ArrayList<>();
        byDate.forEach((date, t) -> result.add(DailyPoint.builder()
                .date(date)
                .classes(t.classes)
                .completed(t.completed)
                .expected(t.expected)
                .joined(t.joined)
                .present(t.present)
                .presentInAudience(t.presentInAudience)
                .attendanceRate(t.attendanceRate())
                .feedbackCount(t.feedbackCount)
                .avgRating(t.avgRating())
                .build()));
        return result;
    }

    private static List<PlatformSlice> platforms(List<ClassMetrics> rows) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (ClassMetrics row : rows) {
            counts.merge(normalizePlatform(row.linkType()), 1, Integer::sum);
        }
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .map(e -> PlatformSlice.builder().platform(e.getKey()).classes(e.getValue()).build())
                .toList();
    }

    private static List<InstructorStats> instructorStats(List<ClassMetrics> rows, Map<String, String> statusBySchedule,
                                                         Map<String, Integer> minutesBySchedule,
                                                         Function<String, List<String>> instructorsOf,
                                                         Map<String, InstructorRef> directory) {
        Map<String, Tally> byInstructor = new LinkedHashMap<>();
        for (ClassMetrics row : rows) {
            boolean isCompleted = STATUS_COMPLETED.equals(statusBySchedule.get(row.scheduleId()));
            for (String id : new LinkedHashSet<>(instructorsOf.apply(row.sessionId()))) {
                byInstructor.computeIfAbsent(id, key -> new Tally())
                        .add(row, isCompleted, minutesBySchedule.get(row.scheduleId()));
            }
        }
        return byInstructor.entrySet().stream()
                .map(e -> {
                    InstructorRef ref = refFor(e.getKey(), directory);
                    Tally t = e.getValue();
                    return InstructorStats.builder()
                            .userId(ref.getUserId())
                            .name(ref.getName())
                            .email(ref.getEmail())
                            .classes(t.classes)
                            .completed(t.completed)
                            .expected(t.expected)
                            .joined(t.joined)
                            .present(t.present)
                            .attendanceRate(t.attendanceRate())
                            .avgAttendedMinutes(t.avgAttendedMinutes())
                            .engagementRate(t.engagementRate())
                            .feedbackCount(t.feedbackCount)
                            .avgRating(t.avgRating())
                            .build();
                })
                .sorted(Comparator.comparingInt(InstructorStats::getClasses).reversed()
                        .thenComparing(s -> Objects.toString(s.getName(), "")))
                .toList();
    }

    private static List<BatchStats> batchStats(List<BatchMetrics> batchRows, Set<String> keptSchedules,
                                               Set<String> completedSchedules) {
        Map<String, Set<String>> classesByBatch = new LinkedHashMap<>();
        Map<String, long[]> totals = new LinkedHashMap<>();
        for (BatchMetrics row : batchRows) {
            if (!keptSchedules.contains(row.scheduleId()) || !StringUtils.hasText(row.packageSessionId())) {
                continue;
            }
            classesByBatch.computeIfAbsent(row.packageSessionId(), k -> new HashSet<>()).add(row.scheduleId());
            if (!completedSchedules.contains(row.scheduleId())) {
                continue;
            }
            long[] t = totals.computeIfAbsent(row.packageSessionId(), k -> new long[3]);
            t[0] += row.expected();
            t[1] += row.joined();
            t[2] += row.present();
        }
        return classesByBatch.entrySet().stream()
                .map(e -> {
                    long[] t = totals.getOrDefault(e.getKey(), new long[3]);
                    return BatchStats.builder()
                            .packageSessionId(e.getKey())
                            .classes(e.getValue().size())
                            .expected(t[0])
                            .joined(t[1])
                            .present(t[2])
                            .attendanceRate(t[0] > 0 ? Math.min(1d, (double) t[2] / t[0]) : null)
                            .build();
                })
                .sorted(Comparator.comparingLong(BatchStats::getExpected).reversed()
                        .thenComparing(Comparator.comparingInt(BatchStats::getClasses).reversed()))
                .toList();
    }

    private static ClassRow toClassRow(ClassMetrics row, String status, Integer scheduledMinutes,
                                       Function<String, List<String>> instructorsOf,
                                       Map<String, InstructorRef> directory) {
        return ClassRow.builder()
                .scheduleId(row.scheduleId())
                .sessionId(row.sessionId())
                .title(row.title())
                .subject(row.subject())
                .meetingDate(row.meetingDate())
                .startTime(row.startTime() != null ? row.startTime().toString() : null)
                .endTime(row.endTime() != null ? row.endTime().toString() : null)
                .timezone(zoneOf(row.timezone()).getId())
                .platform(normalizePlatform(row.linkType()))
                .accessLevel(row.accessLevel())
                .status(status)
                .scheduledMinutes(scheduledMinutes)
                .instructors(instructorsOf.apply(row.sessionId()).stream()
                        .map(id -> refFor(id, directory))
                        .toList())
                .batchIds(row.batchIds())
                .expected(row.expected())
                .joined(row.joined())
                .present(row.present())
                .guests(row.guests())
                .attendanceRate(row.expected() > 0
                        ? Math.min(1d, (double) row.presentInAudience() / row.expected()) : null)
                .avgAttendedMinutes(row.timed() > 0 ? round1(row.totalSecs() / 60d / row.timed()) : null)
                .engagementRate(row.engagementTracked() > 0
                        ? (double) row.engaged() / row.engagementTracked() : null)
                .chats(row.chats())
                .talks(row.talks())
                .raiseHands(row.raiseHands())
                .pollVotes(row.pollVotes())
                .emojis(row.emojis())
                .feedbackCount(row.feedbackCount())
                .avgRating(row.ratedCount() > 0 ? round2(row.ratingSum() / row.ratedCount()) : null)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /**
     * LIVE between start and end in the session's zone; an end earlier than the
     * start means the class runs past midnight. A missing start time can never
     * be LIVE — it is COMPLETED once its day has passed, UPCOMING before that.
     */
    static String classStatus(LocalDate date, LocalTime start, LocalTime end, ZoneId zone, Instant now) {
        if (date == null) {
            return STATUS_COMPLETED;
        }
        if (start == null) {
            LocalDate today = now.atZone(zone).toLocalDate();
            return date.isBefore(today) ? STATUS_COMPLETED : STATUS_UPCOMING;
        }
        ZonedDateTime startAt = ZonedDateTime.of(date, start, zone);
        ZonedDateTime endAt = ZonedDateTime.of(date, end != null ? end : start, zone);
        if (endAt.isBefore(startAt)) {
            endAt = endAt.plusDays(1);
        }
        if (now.isBefore(startAt.toInstant())) {
            return STATUS_UPCOMING;
        }
        if (now.isAfter(endAt.toInstant())) {
            return STATUS_COMPLETED;
        }
        return STATUS_LIVE;
    }

    static Integer scheduledMinutes(LocalTime start, LocalTime end) {
        if (start == null || end == null) {
            return null;
        }
        long minutes = Duration.between(start, end).toMinutes();
        if (minutes < 0) {
            minutes += 24 * 60;
        }
        return minutes > 0 ? (int) minutes : null;
    }

    static String normalizePlatform(String linkType) {
        if (!StringUtils.hasText(linkType)) {
            return "other";
        }
        String value = linkType.trim().toLowerCase(Locale.ROOT).replace('_', ' ');
        return switch (value) {
            case "youtube" -> "youtube";
            case "bbb", "bigbluebutton" -> "bbb";
            case "google meet", "meet", "gmeet" -> "google meet";
            case "zoom", "zoom meeting" -> "zoom";
            case "zoho", "zoho meeting" -> "zoho";
            case "recorded" -> "recorded";
            default -> "other";
        };
    }

    static ZoneId zoneOf(String timezone) {
        try {
            return ZoneId.of(TimezoneNormalizer.normalize(timezone));
        } catch (Exception e) {
            return ZoneId.of(TimezoneNormalizer.DEFAULT_TIMEZONE);
        }
    }

    static InstructorRef refFor(String userId, Map<String, InstructorRef> directory) {
        InstructorRef ref = directory.get(userId);
        return ref != null ? ref : InstructorRef.builder().userId(userId).build();
    }

    private static String displayName(InstructorRef ref) {
        if (StringUtils.hasText(ref.getName())) {
            return ref.getName();
        }
        return StringUtils.hasText(ref.getEmail()) ? ref.getEmail() : Objects.toString(ref.getUserId(), "");
    }

    static List<String> cleanIds(List<String> ids) {
        if (ids == null) {
            return List.of();
        }
        return ids.stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .filter(id -> !id.contains(","))
                .distinct()
                .toList();
    }

    private static double round1(double value) {
        return Math.round(value * 10d) / 10d;
    }

    private static double round2(double value) {
        return Math.round(value * 100d) / 100d;
    }
}
