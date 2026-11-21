package vacademy.io.admin_core_service.features.live_session.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardRequest;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse.InstructorRef;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardService.BatchMetrics;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardService.ClassMetrics;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LiveClassDashboardServiceTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    // 2026-09-27 16:00 IST
    private static final Instant NOW = Instant.parse("2026-09-27T10:30:00Z");

    private static ClassMetrics row(String scheduleId, String sessionId, LocalDate date, String start, String end,
                                    long expected, long joined, long present, long presentInAudience,
                                    long feedback, long rated, double ratingSum) {
        return new ClassMetrics(scheduleId, sessionId, "Class " + scheduleId, "Maths", date,
                start != null ? LocalTime.parse(start) : null, end != null ? LocalTime.parse(end) : null,
                "Asia/Kolkata", "bbb", "private", "creator-" + sessionId, List.of("batch-1"),
                expected, joined, present, presentInAudience, presentInAudience, 0,
                joined, joined * 30 * 60L, joined, joined / 2,
                joined / 2, joined / 4, 0, 0, 0,
                1, 2, 30, 0, 0, 0,
                feedback, rated, ratingSum,
                0, 0, 0, rated, 0);
    }

    private static LiveClassDashboardRequest request(LocalDate start, LocalDate end) {
        LiveClassDashboardRequest request = new LiveClassDashboardRequest();
        request.setInstituteId("inst");
        request.setStartDate(start);
        request.setEndDate(end);
        return request;
    }

    @Test
    @DisplayName("class status comes from the session's own zone, and an end before the start runs past midnight")
    void classStatusUsesSessionZone() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        assertEquals("LIVE", LiveClassDashboardService.classStatus(today,
                LocalTime.of(15, 30), LocalTime.of(16, 30), IST, NOW));
        assertEquals("UPCOMING", LiveClassDashboardService.classStatus(today,
                LocalTime.of(17, 0), LocalTime.of(18, 0), IST, NOW));
        assertEquals("COMPLETED", LiveClassDashboardService.classStatus(today,
                LocalTime.of(9, 0), LocalTime.of(10, 0), IST, NOW));
        // 23:00 → 00:30 yesterday has ended; the same slot today has not started.
        assertEquals("COMPLETED", LiveClassDashboardService.classStatus(today.minusDays(1),
                LocalTime.of(23, 0), LocalTime.of(0, 30), IST, NOW));
        assertEquals("LIVE", LiveClassDashboardService.classStatus(today.minusDays(1),
                LocalTime.of(23, 0), LocalTime.of(0, 30), IST, Instant.parse("2026-09-26T18:45:00Z")));
        // Same wall clock, different zone: 15:30-16:30 in London is still ahead.
        assertEquals("UPCOMING", LiveClassDashboardService.classStatus(today,
                LocalTime.of(15, 30), LocalTime.of(16, 30), ZoneId.of("Europe/London"), NOW));
    }

    @Test
    @DisplayName("a class without a start time is never LIVE")
    void missingStartTime() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        assertEquals("UPCOMING", LiveClassDashboardService.classStatus(today, null, null, IST, NOW));
        assertEquals("COMPLETED", LiveClassDashboardService.classStatus(today.minusDays(1), null, null, IST, NOW));
    }

    @Test
    @DisplayName("scheduled minutes wrap past midnight and ignore zero-length slots")
    void scheduledMinutes() {
        assertEquals(50, LiveClassDashboardService.scheduledMinutes(LocalTime.of(20, 30), LocalTime.of(21, 20)));
        assertEquals(90, LiveClassDashboardService.scheduledMinutes(LocalTime.of(23, 0), LocalTime.of(0, 30)));
        assertNull(LiveClassDashboardService.scheduledMinutes(LocalTime.of(10, 0), LocalTime.of(10, 0)));
        assertNull(LiveClassDashboardService.scheduledMinutes(null, LocalTime.of(10, 0)));
    }

    @Test
    @DisplayName("stored link types collapse onto the platform keys the UI labels")
    void normalizePlatform() {
        assertEquals("youtube", LiveClassDashboardService.normalizePlatform("YOUTUBE"));
        assertEquals("bbb", LiveClassDashboardService.normalizePlatform("bbb"));
        assertEquals("google meet", LiveClassDashboardService.normalizePlatform("google meet"));
        assertEquals("zoho", LiveClassDashboardService.normalizePlatform("ZOHO_MEETING"));
        assertEquals("recorded", LiveClassDashboardService.normalizePlatform("RECORDED"));
        assertEquals("other", LiveClassDashboardService.normalizePlatform("UNKNOWN"));
        assertEquals("other", LiveClassDashboardService.normalizePlatform(null));
    }

    @Test
    @DisplayName("attendance, duration and engagement count completed classes only; feedback counts all")
    void summaryCountsCompletedOnly() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        List<ClassMetrics> rows = List.of(
                row("done-1", "s1", today, "09:00", "10:00", 100, 60, 50, 40, 10, 10, 45.0),
                row("done-2", "s2", today.minusDays(1), "09:00", "10:00", 100, 40, 30, 30, 0, 0, 0),
                row("live-1", "s3", today, "15:30", "16:30", 80, 20, 20, 20, 0, 0, 0),
                row("up-1", "s4", today, "18:00", "19:00", 90, 0, 0, 0, 0, 0, 0));

        LiveClassDashboardResponse response = LiveClassDashboardService.assemble(
                request(today.minusDays(1), today), rows, List.of(), rows, Map.of(), Map.of(), NOW);

        LiveClassDashboardResponse.Summary s = response.getSummary();
        assertEquals(4, s.getTotalClasses());
        assertEquals(2, s.getCompletedClasses());
        assertEquals(1, s.getLiveClasses());
        assertEquals(1, s.getUpcomingClasses());
        assertEquals(200, s.getExpectedLearners());
        assertEquals(100, s.getJoined());
        assertEquals(80, s.getPresent());
        // (40 + 30) present-in-audience / 200 expected — the upcoming 90 and live 80 stay out.
        assertEquals(0.35, s.getAttendanceRate(), 1e-9);
        assertEquals(70, s.getPresentInAudience());
        assertEquals(70, s.getJoinedInAudience());
        assertEquals(50, s.getSpokeCount());
        assertEquals(25, s.getChattedCount());
        assertEquals(50.0, s.getAvgJoinedPerClass());
        assertEquals(60.0, s.getAvgScheduledMinutes());
        assertEquals(30.0, s.getAvgAttendedMinutes());
        assertEquals(0.5, s.getAvgStayRate(), 1e-9);
        assertEquals(4.5, s.getAvgRating());
        assertEquals(10, s.getFeedbackCount());

        assertEquals(1, response.getLiveNow().size());
        assertEquals("live-1", response.getLiveNow().get(0).getScheduleId());

        // Daily trend covers every day of the range, including empty ones.
        assertEquals(2, response.getDaily().size());
        assertEquals(3, response.getDaily().get(1).getClasses());
        assertEquals(1, response.getDaily().get(1).getCompleted());
    }

    @Test
    @DisplayName("rates are null, not zero, when there is nothing to divide by")
    void emptyRatesAreNull() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        List<ClassMetrics> rows = List.of(row("up-1", "s1", today, "18:00", "19:00", 90, 0, 0, 0, 0, 0, 0));
        LiveClassDashboardResponse.Summary s = LiveClassDashboardService.assemble(
                request(today, today), rows, List.of(), rows, Map.of(), Map.of(), NOW).getSummary();
        assertNull(s.getAttendanceRate());
        assertNull(s.getAvgRating());
        assertNull(s.getEngagementRate());
        assertNull(s.getAvgAttendedMinutes());
    }

    @Test
    @DisplayName("instructor filter narrows the classes but keeps every instructor in the picker")
    void instructorFilter() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        List<ClassMetrics> rows = List.of(
                row("a", "s1", today, "09:00", "10:00", 10, 5, 5, 5, 0, 0, 0),
                row("b", "s2", today, "11:00", "12:00", 10, 8, 8, 8, 0, 0, 0));
        Map<String, List<String>> instructors = Map.of("s1", List.of("t1"), "s2", List.of("t2", "t1"));
        Map<String, InstructorRef> directory = Map.of(
                "t1", InstructorRef.builder().userId("t1").name("Asha").build(),
                "t2", InstructorRef.builder().userId("t2").name("Ravi").build());

        LiveClassDashboardRequest req = request(today, today);
        req.setInstructorIds(List.of("t2"));
        LiveClassDashboardResponse response = LiveClassDashboardService.assemble(
                req, rows, List.of(), rows, instructors, directory, NOW);

        assertEquals(1, response.getClasses().size());
        assertEquals("b", response.getClasses().get(0).getScheduleId());
        assertEquals(2, response.getInstructorOptions().size());
        assertEquals("Asha", response.getInstructorOptions().get(0).getName());
        // A co-taught class counts for both of its instructors.
        assertEquals(2, response.getInstructors().size());
        assertTrue(response.getInstructors().stream().allMatch(i -> i.getClasses() == 1));
    }

    @Test
    @DisplayName("batch roll-up drops classes the filters removed and rates completed classes only")
    void batchRollUp() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        List<ClassMetrics> rows = List.of(
                row("done", "s1", today, "09:00", "10:00", 10, 5, 5, 5, 0, 0, 0),
                row("up", "s2", today, "18:00", "19:00", 10, 0, 0, 0, 0, 0, 0));
        List<BatchMetrics> batches = List.of(
                new BatchMetrics("done", "batch-1", 10, 6, 4),
                new BatchMetrics("up", "batch-1", 10, 0, 0),
                new BatchMetrics("gone", "batch-2", 50, 50, 50));

        List<LiveClassDashboardResponse.BatchStats> stats = LiveClassDashboardService.assemble(
                request(today, today), rows, batches, rows, Map.of(), Map.of(), NOW).getBatches();

        assertEquals(1, stats.size());
        assertEquals("batch-1", stats.get(0).getPackageSessionId());
        assertEquals(2, stats.get(0).getClasses());
        assertEquals(10, stats.get(0).getExpected());
        assertEquals(0.4, stats.get(0).getAttendanceRate(), 1e-9);
    }

    @Test
    @DisplayName("the comparison period is the same length, ends the day before, and stops past a quarter")
    void previousPeriod() {
        LiveClassDashboardRequest req = request(LocalDate.of(2026, 9, 21), LocalDate.of(2026, 9, 27));
        req.setBatchIds(List.of("b1"));
        LiveClassDashboardRequest prev = LiveClassDashboardService.previousPeriod(req);
        assertEquals(LocalDate.of(2026, 9, 14), prev.getStartDate());
        assertEquals(LocalDate.of(2026, 9, 20), prev.getEndDate());
        assertEquals(List.of("b1"), prev.getBatchIds());

        LiveClassDashboardRequest today = request(LocalDate.of(2026, 9, 27), LocalDate.of(2026, 9, 27));
        assertEquals(LocalDate.of(2026, 9, 26), LiveClassDashboardService.previousPeriod(today).getStartDate());

        assertNull(LiveClassDashboardService.previousPeriod(
                request(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 9, 27))));
    }

    @Test
    @DisplayName("the class list is capped and says so")
    void classListCap() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        List<ClassMetrics> rows = java.util.stream.IntStream.range(0, LiveClassDashboardService.CLASSES_LIMIT + 5)
                .mapToObj(i -> row("c" + i, "s" + i, today, "09:00", "10:00", 1, 1, 1, 1, 0, 0, 0))
                .toList();
        LiveClassDashboardResponse response = LiveClassDashboardService.assemble(
                request(today, today), rows, List.of(), List.of(), Map.of(), Map.of(), NOW);
        assertEquals(LiveClassDashboardService.CLASSES_LIMIT, response.getClasses().size());
        assertTrue(response.getClassesTruncated());
        assertEquals(LiveClassDashboardService.CLASSES_LIMIT + 5, response.getSummary().getTotalClasses());

        LiveClassDashboardResponse small = LiveClassDashboardService.assemble(
                request(today, today), rows.subList(0, 3), List.of(), List.of(), Map.of(), Map.of(), NOW);
        assertFalse(small.getClassesTruncated());
    }
}
