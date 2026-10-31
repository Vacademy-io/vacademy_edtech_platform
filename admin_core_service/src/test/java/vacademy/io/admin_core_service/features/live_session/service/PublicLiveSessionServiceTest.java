package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.domain_routing.service.LearnerPortalUrlResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Upcoming PUBLIC live classes for anonymous visitors (SPEC 3.1). */
class PublicLiveSessionServiceTest {

    /** 2026-10-20 10:00 UTC = 15:30 IST. */
    static final Instant NOW = Instant.parse("2026-10-20T10:00:00Z");
    static final String PORTAL = "https://learning.brahmvarchas.org";

    NamedParameterJdbcTemplate jdbc;
    InstituteRepository institutes;
    LearnerPortalUrlResolver portal;
    LiveSessionAttendanceOnlyModeService attendanceOnly;
    PublicLiveSessionService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        institutes = mock(InstituteRepository.class);
        portal = mock(LearnerPortalUrlResolver.class);
        attendanceOnly = mock(LiveSessionAttendanceOnlyModeService.class);
        service = new PublicLiveSessionService(jdbc, institutes, portal, attendanceOnly,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    static PublicLiveSessionService.Row row(String id, LocalDate date, String start, String end, String tz) {
        return new PublicLiveSessionService.Row(id, "sch-" + id, "Garbh Sanskar Q&A", "Parenting",
                "<p>Join <b>Dr. Mehta</b>\n for an open session.</p>", tz, null, date,
                start == null ? null : LocalTime.parse(start), end == null ? null : LocalTime.parse(end), null, null);
    }

    static List<String> ids(List<Map<String, Object>> items) {
        return items.stream().map(m -> (String) m.get("session_id")).toList();
    }

    @Test
    void listsOnlyClassesThatHaveNotEndedAndStartInsideTheWindow() {
        LocalDate today = LocalDate.of(2026, 10, 20);
        Instant to = NOW.plusSeconds(7 * 86400);
        List<PublicLiveSessionService.Row> rows = List.of(
                row("ended", today, "09:00:00", "10:00:00", "Asia/Kolkata"),          // 03:30-04:30 UTC
                row("live-now", today, "15:00:00", "16:30:00", "Asia/Kolkata"),       // 09:30-11:00 UTC
                row("tonight", today, "20:00:00", "21:00:00", "Asia/Kolkata"),
                row("next-week-edge", today.plusDays(7), "15:29:00", "16:00:00", "Asia/Kolkata"), // 09:59 UTC, inside
                row("too-far", today.plusDays(7), "15:31:00", "16:00:00", "Asia/Kolkata"),        // 10:01 UTC, outside
                row("no-time", today.plusDays(1), null, null, "Asia/Kolkata"),
                row("london", today, "11:30:00", "12:00:00", "Europe/London"));        // 10:30 UTC (BST)
        List<Map<String, Object>> out = PublicLiveSessionService.select(rows, NOW, to, 20, PORTAL);
        assertEquals(List.of("live-now", "london", "tonight", "next-week-edge"), ids(out));
        assertEquals("2026-10-20T09:30:00Z", out.get(0).get("starts_at"));
        assertEquals("2026-10-20T11:00:00Z", out.get(0).get("ends_at"));
        assertEquals("Asia/Kolkata", out.get(0).get("timezone"));
        assertEquals("Europe/London", out.get(1).get("timezone"));
    }

    @Test
    void aClassPastMidnightEndsTheNextDayAndTheLimitApplies() {
        LocalDate today = LocalDate.of(2026, 10, 20);
        List<PublicLiveSessionService.Row> rows = List.of(
                row("late", today.minusDays(1), "23:00:00", "01:00:00", "UTC"),  // 19th 23:00 to 20th 01:00: ended
                row("a", today, "23:30:00", "00:30:00", "UTC"),
                row("b", today.plusDays(1), "10:00:00", "11:00:00", "UTC"),
                row("c", today.plusDays(2), "10:00:00", "11:00:00", "UTC"));
        List<Map<String, Object>> out = PublicLiveSessionService.select(rows, NOW, NOW.plusSeconds(30L * 86400), 2, PORTAL);
        assertEquals(List.of("a", "b"), ids(out));
        assertEquals("2026-10-21T00:30:00Z", out.get(0).get("ends_at"));
    }

    @Test
    void theViewIsPublicDataOnlyWithTheGuestRegistrationLink() {
        PublicLiveSessionService.Row paid = new PublicLiveSessionService.Row("s-1", "sch-1", "Vedic Maths",
                "", "<p>Hello&nbsp;<i>world</i></p>", "Asia/Kolkata", "{\"record\":true,\"muteOnStart\":false}",
                LocalDate.of(2026, 10, 21), LocalTime.parse("18:00:00"), LocalTime.parse("19:00:00"), 499.0, "inr");
        Map<String, Object> v = PublicLiveSessionService.select(List.of(paid), NOW, NOW.plusSeconds(86400 * 3), 5, PORTAL).get(0);
        assertEquals(List.of("session_id", "schedule_id", "title", "subject", "description_text", "starts_at",
                "ends_at", "timezone", "is_paid", "price", "currency", "registration_url", "join_url", "recorded"),
                List.copyOf(v.keySet()));
        assertEquals("https://learning.brahmvarchas.org/register/live-class?sessionId=s-1", v.get("registration_url"));
        assertNull(v.get("join_url"));
        assertNull(v.get("subject"));
        assertEquals(true, v.get("is_paid"));
        assertEquals(499.0, v.get("price"));
        assertEquals("INR", v.get("currency"));
        assertEquals(true, v.get("recorded"));
        assertEquals("Hello world", v.get("description_text"));

        Map<String, Object> free = PublicLiveSessionService.select(
                List.of(row("f", LocalDate.of(2026, 10, 21), "18:00:00", "19:00:00", "Asia/Kolkata")),
                NOW, NOW.plusSeconds(86400 * 3), 5, PORTAL).get(0);
        assertEquals(false, free.get("is_paid"));
        assertNull(free.get("price"));
        assertNull(free.get("currency"));
        assertNull(free.get("recorded"));
        assertEquals("Join Dr. Mehta for an open session.", free.get("description_text"));
    }

    @Test
    void helpersDegradeQuietly() {
        assertNull(PublicLiveSessionService.recorded("not json"));
        assertNull(PublicLiveSessionService.recorded("{\"record\":\"yes\"}"));
        assertEquals(false, PublicLiveSessionService.recorded("{\"record\":false}"));
        assertNull(PublicLiveSessionService.descriptionText("<p> </p>"));
        String longText = PublicLiveSessionService.descriptionText("<p>" + "word ".repeat(300) + "</p>");
        assertTrue(longText.length() <= PublicLiveSessionService.MAX_DESCRIPTION);
        assertTrue(longText.endsWith("…"));
        assertEquals("https://x.io/register/live-class?sessionId=a%2Fb",
                PublicLiveSessionService.registrationUrl("https://x.io", "a/b"));
    }

    @Test
    void parsesAndBoundsTheQuery() {
        PublicLiveSessionService.Query q = service.parse(" inst-1 ", null, null, null);
        assertEquals("inst-1", q.instituteId());
        assertEquals(NOW, q.from());
        assertEquals(30, q.days());
        assertEquals(20, q.limit());
        // A past "from" is raised to now: past classes are never listed.
        assertEquals(NOW, service.parse("inst-1", "2026-01-01", "7", "5").from());
        assertEquals(Instant.parse("2026-11-01T00:00:00Z"), service.parse("inst-1", "2026-11-01", null, null).from());
        assertEquals(Instant.parse("2026-11-01T04:30:00Z"),
                service.parse("inst-1", "2026-11-01T10:00:00+05:30", null, null).from());
        assertThrows(IllegalArgumentException.class, () -> service.parse(null, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> service.parse("inst 1; drop", null, null, null));
        assertThrows(IllegalArgumentException.class, () -> service.parse("inst-1", "tomorrow", null, null));
        assertThrows(IllegalArgumentException.class, () -> service.parse("inst-1", null, "0", null));
        assertThrows(IllegalArgumentException.class, () -> service.parse("inst-1", null, "91", null));
        assertThrows(IllegalArgumentException.class, () -> service.parse("inst-1", null, null, "51"));
        assertThrows(IllegalArgumentException.class, () -> service.parse("inst-1", null, "x", null));
    }

    @Test
    @SuppressWarnings("unchecked")
    void queriesOnlyPublishedPublicClassesOfThatInstituteOnTheReplica() throws Exception {
        Institute inst = new Institute();
        inst.setId("inst-1");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(inst));
        when(portal.resolveBaseUrl("inst-1", inst)).thenReturn(PORTAL);
        when(attendanceOnly.isEnabled("inst-1")).thenReturn(true);
        when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class))).thenReturn(List.of(
                row("s-1", LocalDate.of(2026, 10, 22), "18:00:00", "19:00:00", "Asia/Kolkata")));

        Map<String, Object> out = service.list(service.parse("inst-1", null, "7", null));
        List<Map<String, Object>> data = (List<Map<String, Object>>) out.get("data");
        assertEquals(List.of("s-1"), ids(data));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).query(sql.capture(), params.capture(), any(RowMapper.class));
        String s = sql.getValue();
        assertTrue(s.contains("s.institute_id = :instituteId"));
        assertTrue(s.contains("s.status = 'LIVE'"));
        assertTrue(s.contains("UPPER(s.access_level) = 'PUBLIC'"));
        assertTrue(s.contains("NOT IN ('DELETED', 'CANCELLED')"));
        assertTrue(s.contains("(:attendanceOnly = FALSE OR s.show_to_learners IS TRUE)"));
        assertFalse(s.toUpperCase().contains("AT TIME ZONE"));
        // No column a visitor must not see.
        for (String forbidden : List.of("default_meet_link", "registration_form_link", "notification_email",
                "created_by", "provider_", "email", "instructor", "participants")) {
            assertFalse(s.toLowerCase().contains(forbidden), forbidden);
        }
        MapSqlParameterSource p = (MapSqlParameterSource) params.getValue();
        assertEquals("inst-1", p.getValue("instituteId"));
        assertEquals(true, p.getValue("attendanceOnly"));
        assertEquals(java.sql.Date.valueOf("2026-10-19"), p.getValue("fromDate"));
        assertEquals(java.sql.Date.valueOf("2026-10-28"), p.getValue("toDate"));

        Transactional tx = PublicLiveSessionService.class
                .getMethod("list", PublicLiveSessionService.Query.class).getAnnotation(Transactional.class);
        assertNotNull(tx);
        assertTrue(tx.readOnly(), "read-only transaction routes to the replica");
    }

    @Test
    void anUnknownInstituteHasNoClassesAndIsNotQueried() {
        when(institutes.findById("nope")).thenReturn(Optional.empty());
        Map<String, Object> out = service.list(service.parse("nope", null, null, null));
        assertEquals(List.of(), out.get("data"));
        verifyNoInteractions(jdbc);
    }

    @Test
    void sqlTextBlockKeepsSpacesBetweenTokens() {
        String flat = PublicLiveSessionService.SQL.replaceAll("\\s+", " ");
        assertFalse(flat.matches(".*[a-z0-9_)](FROM|WHERE|JOIN|ORDER|LIMIT|AND)\\b.*"), flat);
        assertTrue(flat.contains("s.description_html, s.timezone"));
    }
}
