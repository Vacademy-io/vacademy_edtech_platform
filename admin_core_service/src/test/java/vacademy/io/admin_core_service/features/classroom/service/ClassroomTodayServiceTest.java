package vacademy.io.admin_core_service.features.classroom.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse.TodayClass;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionInstructorDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionListDTO;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchRequest;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchResponse;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Date;
import java.sql.Time;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClassroomTodayServiceTest {

    /** 15:30 in Kolkata, so a Kolkata class at 15:30 starts exactly now. */
    private static final Instant NOW = Instant.parse("2026-11-04T10:00:00Z");
    private static final long NOW_MS = NOW.toEpochMilli();
    private static final long MINUTE = 60_000L;

    private GetLiveSessionService search;
    private ClassroomTodayService service;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        search = mock(GetLiveSessionService.class);
        service = new ClassroomTodayService(search, Clock.fixed(NOW, ZoneOffset.UTC));
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("teacher-1");
        dto.setUsername("teacher-1");
        dto.setAuthorities(List.of("TEACHER"));
        user = new CustomUserDetails(dto);
    }

    private static LiveSessionListDTO row(String id, String timezone, String start, String end) {
        LiveSessionListDTO dto = new LiveSessionListDTO();
        dto.setScheduleId(id);
        dto.setSessionId("session-" + id);
        dto.setTitle("Title " + id);
        dto.setSubject("Physics");
        dto.setMeetingDate(Date.valueOf("2026-11-04"));
        dto.setStartTime(start == null ? null : Time.valueOf(start));
        dto.setLastEntryTime(end == null ? null : Time.valueOf(end));
        dto.setTimezone(timezone);
        dto.setLinkType("bbb");
        dto.setSessionStreamingServiceType("embed");
        return dto;
    }

    private ClassroomTodayResponse answer(long total, LiveSessionListDTO... rows) {
        SessionSearchResponse.PageMetadata page = new SessionSearchResponse.PageMetadata();
        page.setTotalElements(total);
        when(search.searchSessions(any(), any())).thenReturn(new SessionSearchResponse(List.of(rows), page));
        return service.today("inst-a", "mine", user);
    }

    private TodayClass one(LiveSessionListDTO row) {
        return answer(1, row).getClasses().get(0);
    }

    private SessionSearchRequest capturedRequest(String scope) {
        when(search.searchSessions(any(), any())).thenReturn(new SessionSearchResponse(List.of(), null));
        service.today("inst-a", scope, user);
        ArgumentCaptor<SessionSearchRequest> captor = ArgumentCaptor.forClass(SessionSearchRequest.class);
        verify(search).searchSessions(captor.capture(), same(user));
        return captor.getValue();
    }

    // ---- request ----

    @Test
    void mineFiltersByTheCallerAndAsksForTodayByStartTime() {
        SessionSearchRequest request = capturedRequest("mine");
        assertEquals("inst-a", request.getInstituteId());
        assertEquals(List.of("teacher-1"), request.getInstructorUserIds());
        assertEquals(List.of("LIVE"), request.getStatuses());
        assertEquals(Boolean.TRUE, request.getTodayInSessionTimezone());
        assertEquals(50, request.getSize());
        assertEquals(0, request.getPage());
        assertEquals("startTime", request.getSortBy());
        assertEquals("ASC", request.getSortDirection());
    }

    @Test
    void allPassesNoInstructorFilter() {
        assertNull(capturedRequest("all").getInstructorUserIds());
    }

    @Test
    void anUnknownScopeIsMineNeverWider() {
        assertEquals(List.of("teacher-1"), capturedRequest("everything").getInstructorUserIds());
    }

    // ---- times ----

    @Test
    void wallClockIsReadInTheSessionsZone() {
        TodayClass c = one(row("a", "Asia/Kolkata", "15:30:00", "16:15:00"));
        assertEquals(NOW_MS, c.getStartsAtMs());
        assertEquals(NOW_MS + 45 * MINUTE, c.getEndsAtMs());
        assertEquals("15:30", c.getTimeLabel());
        assertEquals("2026-11-04", c.getMeetingDate());
        assertEquals("Asia/Kolkata", c.getTimezone());
    }

    @Test
    void anotherZoneGivesAnotherInstantWithTheSameLabel() {
        TodayClass c = one(row("a", "America/New_York", "15:30:00", null));
        assertEquals(Instant.parse("2026-11-04T20:30:00Z").toEpochMilli(), c.getStartsAtMs());
        assertEquals("15:30", c.getTimeLabel());
    }

    @Test
    void aRowWithAnAbbreviatedZoneDoesNotFailTheResponse() {
        TodayClass c = one(row("a", "IST", "15:30:00", null));
        assertEquals(NOW_MS, c.getStartsAtMs());
        assertEquals("15:30", c.getTimeLabel());
        assertEquals("IST", c.getTimezone());
    }

    @Test
    void anUnreadableZoneFallsBackForThatRowOnly() {
        ClassroomTodayResponse response = answer(2,
                row("bad", "Not/AZone", "15:30:00", null),
                row("good", "America/New_York", "09:00:00", null));
        assertEquals(2, response.getClasses().size());
        assertEquals(NOW_MS, response.getClasses().get(0).getStartsAtMs());
        assertEquals("bad", response.getClasses().get(0).getScheduleId());
        assertEquals(Instant.parse("2026-11-04T14:00:00Z").toEpochMilli(), response.getClasses().get(1).getStartsAtMs());
    }

    @ParameterizedTest
    @CsvSource({
            "Asia/Kolkata, Asia/Kolkata",
            "IST, Asia/Kolkata",
            "ist, Asia/Kolkata",
            "' Asia/Kolkata ', Asia/Kolkata",
            "america/new_york, America/New_York",
            "UTC, UTC",
            "+05:30, +05:30",
            "PST, America/Los_Angeles",
            "Not/AZone, Asia/Kolkata",
            "'; DROP TABLE x', Asia/Kolkata",
    })
    void zoneResolution(String input, String expected) {
        assertEquals(ZoneId.of(expected), ClassroomTodayService.resolveZone(input));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = "   ")
    void noZoneIsTheDefaultZone(String input) {
        assertEquals(ZoneId.of("Asia/Kolkata"), ClassroomTodayService.resolveZone(input));
    }

    @Test
    void noEndTimeStaysNull() {
        assertNull(one(row("a", "Asia/Kolkata", "15:30:00", null)).getEndsAtMs());
    }

    @Test
    void anEndEarlierThanTheStartIsTheNextDay() {
        TodayClass c = one(row("a", "Asia/Kolkata", "23:30:00", "00:30:00"));
        assertEquals(c.getStartsAtMs() + 60 * MINUTE, c.getEndsAtMs());
        assertEquals("23:30", c.getTimeLabel());
    }

    @Test
    void wallClockSurvivesAnyJvmZone() {
        TimeZone original = TimeZone.getDefault();
        try {
            for (String jvmZone : List.of("UTC", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati")) {
                TimeZone.setDefault(TimeZone.getTimeZone(jvmZone));
                TodayClass c = one(row("a", "Asia/Kolkata", "15:30:00", null));
                assertEquals(NOW_MS, c.getStartsAtMs(), jvmZone);
                assertEquals("15:30", c.getTimeLabel(), jvmZone);
                assertEquals("2026-11-04", c.getMeetingDate(), jvmZone);
            }
        } finally {
            TimeZone.setDefault(original);
        }
    }

    @Test
    void aRowWithNoTimeIsSkippedNotFatal() {
        LiveSessionListDTO noStart = row("no-start", "Asia/Kolkata", null, null);
        LiveSessionListDTO noDate = row("no-date", "Asia/Kolkata", "10:00:00", null);
        noDate.setMeetingDate(null);
        ClassroomTodayResponse response = answer(3, noStart, noDate, row("ok", "Asia/Kolkata", "15:30:00", null));
        assertEquals(List.of("ok"), response.getClasses().stream().map(TodayClass::getScheduleId).toList());
    }

    @Test
    void classesAreOrderedByTheInstantAcrossZones() {
        ClassroomTodayResponse response = answer(3,
                row("kolkata-late", "Asia/Kolkata", "16:00:00", null),
                row("ny-early-wall-clock", "America/New_York", "09:00:00", null),
                row("kolkata-early", "Asia/Kolkata", "09:30:00", null));
        assertEquals(List.of("kolkata-early", "kolkata-late", "ny-early-wall-clock"),
                response.getClasses().stream().map(TodayClass::getScheduleId).toList());
    }

    // ---- live now ----

    @Test
    void liveNowFollowsTheServerClock() {
        assertTrue(one(row("a", "Asia/Kolkata", "15:30:00", "16:00:00")).isLiveNow(), "starts exactly now");
        assertTrue(one(row("a", "Asia/Kolkata", "15:00:00", "16:00:00")).isLiveNow(), "in progress");
        assertFalse(one(row("a", "Asia/Kolkata", "15:31:00", "16:00:00")).isLiveNow(), "not started");
        assertFalse(one(row("a", "Asia/Kolkata", "15:00:00", "15:30:00")).isLiveNow(), "just ended");
        assertTrue(one(row("a", "Asia/Kolkata", "15:00:00", null)).isLiveNow(), "started, no end time");
        assertFalse(one(row("a", "Asia/Kolkata", "16:00:00", null)).isLiveNow(), "upcoming, no end time");
    }

    @Test
    void serverTimeIsSentForTheClientsOffset() {
        assertEquals(NOW_MS, answer(0).getServerTimeMs());
    }

    // ---- truncation ----

    @Test
    void truncatedOnlyWhenMoreExistThanTheCap() {
        assertFalse(answer(50, row("a", "Asia/Kolkata", "15:30:00", null)).isTruncated());
        assertTrue(answer(51, row("a", "Asia/Kolkata", "15:30:00", null)).isTruncated());
    }

    // ---- external link ----

    private static LiveSessionListDTO linked(String linkType, String streamingType, String link) {
        LiveSessionListDTO dto = row("a", "Asia/Kolkata", "15:30:00", null);
        dto.setLinkType(linkType);
        dto.setSessionStreamingServiceType(streamingType);
        dto.setMeetingLink(link);
        return dto;
    }

    @ParameterizedTest
    @CsvSource(nullValues = "NULL", value = {
            "bbb, embed", "embed, bbb", "BBB, redirect", "bbb_meeting, NULL",
            "zoom, redirect", "redirect, zoom", "ZOOM, NULL", "zoom_meeting, other",
            "google meet, redirect", "redirect, google meet", "google_meet, NULL", "googlemeet, NULL", "GMEET, NULL",
            "zoho, embed", "embed, zoho", "ZOHO_MEETING, NULL",
            "other, bbb", "youtube, zoom", "NULL, zoho", "NULL, google meet",
    })
    void noExternalLinkWhenEitherColumnNamesAHostedProvider(String linkType, String streamingType) {
        assertNull(ClassroomTodayService.externalLinkOf(linked(linkType, streamingType, "https://example.com/room")));
    }

    @ParameterizedTest
    @CsvSource(nullValues = "NULL", value = {
            "other, embed", "other, other", "youtube, redirect", "CUSTOM, NULL", "NULL, other", "NULL, NULL",
    })
    void externalLinkWhenBothColumnsAreOutsideHostedProviders(String linkType, String streamingType) {
        assertEquals("https://example.com/room",
                ClassroomTodayService.externalLinkOf(linked(linkType, streamingType, "https://example.com/room")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"javascript:alert(1)", "intent://x#Intent;end", "ftp://example.com/a", "example.com/room", "   "})
    void onlyHttpLinksAreOffered(String link) {
        assertNull(ClassroomTodayService.externalLinkOf(linked("other", "embed", link)));
    }

    @Test
    void anAbsentLinkIsNoLink() {
        assertNull(ClassroomTodayService.externalLinkOf(linked("other", "embed", null)));
    }

    // ---- wire shape ----

    @Test
    void wireShapeMatchesTheContractAndCarriesNoHostOrContactData() throws Exception {
        LiveSessionListDTO dto = linked("other", "embed", "https://example.com/room");
        dto.setProviderMeetingId("provider-secret");
        dto.setDefaultClassLink("https://example.com/default-secret");
        dto.setInstructors(List.of(LiveSessionInstructorDTO.builder()
                .userId("t1").fullName("Tara").email("tara@example.com").profilePicFileId("pic-secret").build()));
        LiveSessionListDTO.PackageSessionInfo batch = new LiveSessionListDTO.PackageSessionInfo(
                "ps-secret", "2026-27", "Class 8", "Session");
        LiveSessionListDTO.PackageSessionInfo sameBatch = new LiveSessionListDTO.PackageSessionInfo(
                "ps-2", "2026-27", "Class 8", "Other");
        dto.setPackageSessionDetails(List.of(batch, sameBatch));

        String json = new ObjectMapper().writeValueAsString(answer(1, dto));
        JsonNode root = new ObjectMapper().readTree(json);

        assertEquals(Set.of("server_time_ms", "classes", "truncated"), names(root));
        JsonNode c = root.get("classes").get(0);
        assertEquals(Set.of("schedule_id", "session_id", "title", "subject", "batches", "meeting_date",
                "starts_at_ms", "ends_at_ms", "time_label", "timezone", "link_type", "streaming_type",
                "live_now", "instructors", "external_link"), names(c));
        assertEquals(Set.of("user_id", "name"), names(c.get("instructors").get(0)));
        assertEquals("Tara", c.get("instructors").get(0).get("name").asText());
        assertEquals(1, c.get("batches").size());
        assertEquals("Class 8 2026-27", c.get("batches").get(0).asText());
        assertEquals("embed", c.get("streaming_type").asText());
        assertEquals("https://example.com/room", c.get("external_link").asText());
        for (String leaked : List.of("provider-secret", "default-secret", "tara@example.com", "pic-secret", "ps-secret")) {
            assertFalse(json.contains(leaked), leaked);
        }
    }

    @Test
    void missingEnrichmentGivesEmptyListsNotNulls() {
        TodayClass c = one(row("a", "Asia/Kolkata", "15:30:00", null));
        assertEquals(List.of(), c.getBatches());
        assertEquals(List.of(), c.getInstructors());
    }

    private static Set<String> names(JsonNode node) {
        Set<String> out = new TreeSet<>();
        node.fieldNames().forEachRemaining(out::add);
        return out;
    }
}
