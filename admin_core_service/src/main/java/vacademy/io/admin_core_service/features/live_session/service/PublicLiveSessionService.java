package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.service.LearnerPortalUrlResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Upcoming PUBLIC live classes of one institute, for anonymous visitors (institute websites and
 * the Site Assistant). Read-only: one SQL round trip in a read-only transaction (so it is served
 * by the replica), plus the institute row for the learner-portal base URL.
 *
 * <p>Rules, all deliberate:
 * <ul>
 *   <li>Only {@code live_session.access_level = PUBLIC} (any case), published ({@code LIVE}) sessions
 *       of the given institute; DELETED and CANCELLED occurrences are skipped. When the institute runs
 *       live classes in attendance-only mode, only sessions marked {@code show_to_learners} are listed,
 *       the same gate the learner app applies.</li>
 *   <li>Each {@code session_schedules} row is one occurrence. Its start and end are computed here in
 *       the session's own timezone (never with AT TIME ZONE in SQL, where one bad stored zone would
 *       abort the whole query). An end before the start means the class runs past midnight.</li>
 *   <li>Upcoming only: an occurrence is listed when it has not ended yet and starts inside the
 *       window [from, from + days). {@code from} is never earlier than now, so a past class is never
 *       listed; a class that is live right now is (it can still be joined after registering).</li>
 *   <li>{@code registration_url} is the learner portal guest registration route the admin app
 *       builds for a public session: {@code <learner portal base>/register/live-class?sessionId=<id>},
 *       base from {@link LearnerPortalUrlResolver}. {@code join_url} is always null: a visitor joins
 *       through registration, and the meeting link of a paid class must not leak.</li>
 *   <li>No attendee data, hosts, instructor details, notification texts or meeting links.</li>
 * </ul>
 */
@Slf4j
@Service
public class PublicLiveSessionService {

    public static final int DEFAULT_DAYS = 30;
    public static final int MAX_DAYS = 90;
    public static final int DEFAULT_LIMIT = 20;
    public static final int MAX_LIMIT = 50;
    static final int SCAN_LIMIT = 500;
    static final int MAX_DESCRIPTION = 500;
    static final String REGISTRATION_PATH = "/register/live-class?sessionId=";

    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_\\-]{1,64}$");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * The institute's published PUBLIC sessions with an occurrence on a date in [fromDate, toDate]
     * (a day wider than the window on each side; the exact window is applied in Java), and the fee
     * of a paid session: the newest ACTIVE LIVE_SESSION payment option and its first ACTIVE plan,
     * in the order LiveSessionPaymentService reads them.
     */
    static final String SQL = """
            SELECT s.id AS session_id, ss.id AS schedule_id, s.title, s.subject, s.description_html,
                   s.timezone, s.bbb_config_json, ss.meeting_date, ss.start_time, ss.last_entry_time,
                   pp.actual_price, pp.currency
            FROM live_session s
            JOIN session_schedules ss ON ss.session_id = s.id
            LEFT JOIN LATERAL (
                SELECT po.id FROM payment_option po
                WHERE po.source = 'LIVE_SESSION' AND po.source_id = s.id AND po.status = 'ACTIVE'
                ORDER BY po.created_at DESC
                LIMIT 1
            ) opt ON TRUE
            LEFT JOIN LATERAL (
                SELECT p.actual_price, p.currency FROM payment_plan p
                WHERE p.payment_option_id = opt.id AND p.status = 'ACTIVE'
                ORDER BY p.validity_in_days ASC NULLS LAST, p.id
                LIMIT 1
            ) pp ON TRUE
            WHERE s.institute_id = :instituteId
              AND s.status = 'LIVE'
              AND UPPER(s.access_level) = 'PUBLIC'
              AND COALESCE(ss.status, '') NOT IN ('DELETED', 'CANCELLED')
              AND ss.meeting_date BETWEEN :fromDate AND :toDate
              AND (:attendanceOnly = FALSE OR s.show_to_learners IS TRUE)
            ORDER BY ss.meeting_date, ss.start_time, ss.id
            LIMIT :scanLimit
            """;

    /** One occurrence as read from the database. */
    record Row(String sessionId, String scheduleId, String title, String subject, String descriptionHtml,
               String timezone, String bbbConfigJson, LocalDate meetingDate, LocalTime startTime,
               LocalTime lastEntryTime, Double price, String currency) {
    }

    /** Validated query. */
    public record Query(String instituteId, Instant from, int days, int limit) {
    }

    private final NamedParameterJdbcTemplate jdbc;
    private final InstituteRepository instituteRepository;
    private final LearnerPortalUrlResolver learnerPortalUrlResolver;
    private final LiveSessionAttendanceOnlyModeService attendanceOnlyModeService;
    private final Clock clock;

    @Autowired
    public PublicLiveSessionService(NamedParameterJdbcTemplate jdbc, InstituteRepository instituteRepository,
                                    LearnerPortalUrlResolver learnerPortalUrlResolver,
                                    LiveSessionAttendanceOnlyModeService attendanceOnlyModeService) {
        this(jdbc, instituteRepository, learnerPortalUrlResolver, attendanceOnlyModeService, Clock.systemUTC());
    }

    PublicLiveSessionService(NamedParameterJdbcTemplate jdbc, InstituteRepository instituteRepository,
                             LearnerPortalUrlResolver learnerPortalUrlResolver,
                             LiveSessionAttendanceOnlyModeService attendanceOnlyModeService, Clock clock) {
        this.jdbc = jdbc;
        this.instituteRepository = instituteRepository;
        this.learnerPortalUrlResolver = learnerPortalUrlResolver;
        this.attendanceOnlyModeService = attendanceOnlyModeService;
        this.clock = clock;
    }

    /**
     * Parses the raw query parameters; {@link IllegalArgumentException} with a caller-facing message
     * when one is not usable. {@code from} accepts an ISO instant ({@code 2026-10-20T10:00:00Z}), an
     * offset date-time or a date ({@code 2026-10-20}, read as midnight UTC); it is raised to now.
     */
    public Query parse(String instituteId, String from, String days, String limit) {
        if (!StringUtils.hasText(instituteId) || !ID.matcher(instituteId.trim()).matches()) {
            throw new IllegalArgumentException("instituteId is required.");
        }
        Instant now = clock.instant();
        Instant start = now;
        if (StringUtils.hasText(from)) {
            Instant parsed = parseInstant(from.trim());
            if (parsed == null) {
                throw new IllegalArgumentException("from must be an ISO date or date-time, e.g. 2026-10-20T10:00:00Z.");
            }
            if (parsed.isAfter(now)) start = parsed;
        }
        int d = intParam("days", days, DEFAULT_DAYS);
        int l = intParam("limit", limit, DEFAULT_LIMIT);
        if (d < 1 || d > MAX_DAYS) throw new IllegalArgumentException("days must be between 1 and " + MAX_DAYS + ".");
        if (l < 1 || l > MAX_LIMIT) throw new IllegalArgumentException("limit must be between 1 and " + MAX_LIMIT + ".");
        return new Query(instituteId.trim(), start, d, l);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> list(Query query) {
        Map<String, Object> out = new LinkedHashMap<>();
        Optional<Institute> institute = instituteRepository.findById(query.instituteId());
        if (institute.isEmpty()) {
            out.put("data", List.of());
            return out;
        }
        Instant to = query.from().plus(Duration.ofDays(query.days()));
        boolean attendanceOnly = attendanceOnlyModeService.isEnabled(query.instituteId());
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", query.instituteId())
                .addValue("fromDate", Date.valueOf(query.from().atOffset(ZoneOffset.UTC).toLocalDate().minusDays(1)))
                .addValue("toDate", Date.valueOf(to.atOffset(ZoneOffset.UTC).toLocalDate().plusDays(1)))
                .addValue("attendanceOnly", attendanceOnly)
                .addValue("scanLimit", SCAN_LIMIT);
        List<Row> rows = jdbc.query(SQL, params, (rs, i) -> mapRow(rs));
        String base = learnerPortalUrlResolver.resolveBaseUrl(query.instituteId(), institute.get());
        out.put("data", select(rows, query.from(), to, query.limit(), base));
        return out;
    }

    /** The window filter and the public view, free of I/O (unit-tested). */
    static List<Map<String, Object>> select(List<Row> rows, Instant from, Instant to, int limit, String portalBase) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Row r : rows) {
            if (r.meetingDate() == null || r.startTime() == null || !StringUtils.hasText(r.sessionId())) continue;
            ZoneId zone = LiveClassDashboardService.zoneOf(r.timezone());
            ZonedDateTime startAt = ZonedDateTime.of(r.meetingDate(), r.startTime(), zone);
            ZonedDateTime endAt = ZonedDateTime.of(r.meetingDate(),
                    r.lastEntryTime() != null ? r.lastEntryTime() : r.startTime(), zone);
            if (endAt.isBefore(startAt)) endAt = endAt.plusDays(1);
            Instant start = startAt.toInstant();
            Instant end = endAt.toInstant();
            if (!end.isAfter(from) || !start.isBefore(to)) continue;
            items.add(view(r, start, end, zone, portalBase));
        }
        items.sort((a, b) -> ((String) a.get("starts_at")).compareTo((String) b.get("starts_at")));
        return items.size() > limit ? new ArrayList<>(items.subList(0, limit)) : items;
    }

    static Map<String, Object> view(Row r, Instant start, Instant end, ZoneId zone, String portalBase) {
        boolean paid = r.price() != null && r.price() > 0;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("session_id", r.sessionId());
        m.put("schedule_id", r.scheduleId());
        m.put("title", r.title());
        m.put("subject", StringUtils.hasText(r.subject()) ? r.subject() : null);
        m.put("description_text", descriptionText(r.descriptionHtml()));
        m.put("starts_at", start.toString());
        m.put("ends_at", end.toString());
        m.put("timezone", zone.getId());
        m.put("is_paid", paid);
        m.put("price", paid ? r.price() : null);
        m.put("currency", paid && StringUtils.hasText(r.currency()) ? r.currency().trim().toUpperCase() : null);
        m.put("registration_url", registrationUrl(portalBase, r.sessionId()));
        m.put("join_url", null);
        m.put("recorded", recorded(r.bbbConfigJson()));
        return m;
    }

    static String registrationUrl(String portalBase, String sessionId) {
        if (!StringUtils.hasText(portalBase)) return null;
        return portalBase + REGISTRATION_PATH + URLEncoder.encode(sessionId, StandardCharsets.UTF_8);
    }

    /** Plain text of the description, whitespace collapsed, at most 500 characters; null when empty. */
    static String descriptionText(String html) {
        if (!StringUtils.hasText(html)) return null;
        String text = Jsoup.parse(html).text().replaceAll("[\\s\\u00a0]+", " ").trim();
        if (text.isEmpty()) return null;
        return text.length() <= MAX_DESCRIPTION ? text : text.substring(0, MAX_DESCRIPTION - 1).trim() + "…";
    }

    /** The BigBlueButton record switch when the session stores one, else null (unknown). */
    static Boolean recorded(String bbbConfigJson) {
        if (!StringUtils.hasText(bbbConfigJson)) return null;
        try {
            JsonNode n = MAPPER.readTree(bbbConfigJson).get("record");
            return n != null && n.isBoolean() ? n.asBoolean() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Row mapRow(ResultSet rs) throws SQLException {
        Date date = rs.getDate("meeting_date");
        Time start = rs.getTime("start_time");
        Time end = rs.getTime("last_entry_time");
        double price = rs.getDouble("actual_price");
        Double priceOrNull = rs.wasNull() ? null : price;
        return new Row(rs.getString("session_id"), rs.getString("schedule_id"), rs.getString("title"),
                rs.getString("subject"), rs.getString("description_html"), rs.getString("timezone"),
                rs.getString("bbb_config_json"), date == null ? null : date.toLocalDate(),
                start == null ? null : start.toLocalTime(), end == null ? null : end.toLocalTime(),
                priceOrNull, rs.getString("currency"));
    }

    private static Instant parseInstant(String s) {
        try {
            return Instant.parse(s);
        } catch (DateTimeParseException ignored) {
            // next shape
        }
        try {
            return java.time.OffsetDateTime.parse(s).toInstant();
        } catch (DateTimeParseException ignored) {
            // next shape
        }
        try {
            return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static int intParam(String name, String raw, int fallback) {
        if (!StringUtils.hasText(raw)) return fallback;
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " must be a whole number.");
        }
    }
}
