package vacademy.io.admin_core_service.features.reporting.sections;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.reporting.client.ClassroomPanelReportClient;
import vacademy.io.admin_core_service.features.reporting.client.ClassroomPanelReportClient.UsageResult;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ClassroomPanelsSectionTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final ClassroomPanelReportClient client = mock(ClassroomPanelReportClient.class);

    private ClassroomPanelsSection section(boolean enabled) {
        return new ClassroomPanelsSection(client, enabled, "https://console.example.test/");
    }

    /** Mon 3 Nov 00:00 IST to Mon 10 Nov 00:00 IST, exclusive end. */
    private static ReportContext weekly() {
        return ReportContext.builder()
                .instituteId("inst-1")
                .zone(IST)
                .windowStart(Instant.parse("2026-11-02T18:30:00Z"))
                .windowEnd(Instant.parse("2026-11-09T18:30:00Z"))
                .scopeType(ReportContext.ScopeType.INSTITUTE)
                .cadence("weekly")
                .build();
    }

    private static ObjectNode summary(int sessions, int rooms, int idle) {
        ObjectNode s = M.createObjectNode();
        ObjectNode t = s.putObject("totals");
        t.put("panel_hours", 182.46);
        t.put("sessions", sessions);
        t.put("teachers", 24);
        t.put("rooms_used", rooms);
        t.put("rooms_with_panel", rooms + idle);
        t.put("idle_rooms", idle);
        ArrayNode byRoom = s.putArray("by_room");
        for (int i = 0; i < Math.min(rooms, 15); i++) {
            ObjectNode r = byRoom.addObject();
            r.putObject("room").put("id", "r" + i).put("name", "Room " + i);
            r.put("panel_hours", 1.5 + i);
            r.put("sessions", 2 + i);
            r.put("teachers", 1);
            r.put("last_used_at", "2026-11-07T05:00:00Z");
        }
        ArrayNode idleRooms = s.putArray("idle_rooms");
        for (int i = 0; i < Math.min(idle, 10); i++) {
            ObjectNode r = idleRooms.addObject();
            r.putObject("room").put("id", "idle" + i).put("name", "Idle " + i);
            r.putNull("last_used_at");
            r.put("online", true);
        }
        return s;
    }

    @Test
    void aNullClientResponseThrowsInsteadOfReportingNothing() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.failed());
        assertThrows(IllegalStateException.class, () -> section(true).compute(weekly()));
    }

    @Test
    void authsUsageSwitchedOffDropsTheSectionInsteadOfFailingTheDocument() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.featureOff());
        assertTrue(section(true).compute(weekly()).isEmpty());
    }

    @Test
    void theBeanExistsOnlyWhileTheReportSwitchIsOn() {
        org.springframework.boot.test.context.runner.ApplicationContextRunner runner =
                new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                        .withBean(ClassroomPanelReportClient.class, () -> client)
                        .withUserConfiguration(ClassroomPanelsSection.class);
        runner.run(ctx -> assertFalse(ctx.containsBean("classroomPanelsSection")
                || ctx.getBeanNamesForType(ClassroomPanelsSection.class).length > 0));
        runner.withPropertyValues("classroom.report.enabled=true")
                .run(ctx -> assertEquals(1, ctx.getBeanNamesForType(ClassroomPanelsSection.class).length));
    }

    @Test
    void aResponseWithoutTotalsThrows() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.ok(M.createObjectNode()));
        assertThrows(IllegalStateException.class, () -> section(true).compute(weekly()));
    }

    @Test
    void zeroSessionsAndNoIdleRoomIsEmpty() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.ok(summary(0, 0, 0)));
        SectionFacts f = section(true).compute(weekly());
        assertTrue(f.isEmpty());
        assertFalse(f.isIdentifying());
    }

    @Test
    void idleRoomsAloneAreNotEmptyAndWarn() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.ok(summary(0, 0, 2)));
        SectionFacts f = section(true).compute(weekly());
        assertFalse(f.isEmpty());
        assertEquals("2", f.getHeadlines().get(ClassroomPanelsSection.H_IDLE));
        assertEquals("warn", f.getTones().get(ClassroomPanelsSection.H_IDLE));
    }

    @Test
    void headlinesReadAsTheSpecSays() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.ok(summary(311, 18, 0)));
        SectionFacts f = section(true).compute(weekly());
        assertEquals("182.5", f.getHeadlines().get(ClassroomPanelsSection.H_HOURS));
        assertEquals("18 of 18", f.getHeadlines().get(ClassroomPanelsSection.H_ROOMS));
        assertEquals("24", f.getHeadlines().get(ClassroomPanelsSection.H_TEACHERS));
        assertEquals("good", f.getTones().get(ClassroomPanelsSection.H_IDLE));
        assertEquals(List.of("Room", "Hours", "Sessions", "Teachers", "Last used"), f.getColumns());
        // First row is the least used room, in the institute's own day.
        assertEquals(List.of("Room 0", "1.5", "2", "1", "7 Nov"), f.getRows().get(0).getValues());
    }

    @Test
    void rowsStayWithinTheRunnersCapAndIdleRoomsAreNotCut() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.ok(summary(400, 40, 14)));
        SectionFacts f = section(true).compute(weekly());
        assertTrue(f.getRows().size() <= 25, "rows: " + f.getRows().size());
        long idleRows = f.getRows().stream()
                .filter(r -> r.getValues().get(0).endsWith("(not used)")).count();
        assertEquals(ClassroomPanelsSection.MAX_IDLE_ROWS, idleRows);
        List<String> notes = f.getRows().stream().map(r -> r.getValues().get(0))
                .filter(v -> v.contains("not shown") || v.startsWith("Full usage report")).toList();
        assertEquals(3, notes.size(), notes.toString());
        assertTrue(notes.contains("28 more rooms used more than these not shown"), notes.toString());
        assertTrue(notes.contains("4 more idle rooms not shown"), notes.toString());
        assertTrue(notes.contains("Full usage report: "
                + "https://console.example.test/settings?selectedTab=classroomPanels&view=usage"), notes.toString());
        f.getRows().forEach(r -> assertEquals(5, r.getValues().size()));
    }

    @Test
    void theWindowIsSentAsInclusiveLocalDatesInTheInstituteZone() {
        when(client.usageSummary(anyString(), any(), any(), anyString())).thenReturn(UsageResult.ok(summary(1, 1, 0)));
        section(true).compute(weekly());
        verify(client).usageSummary("inst-1", LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 9),
                "Asia/Kolkata");
    }

    @Test
    void aCohortScopedReaderGetsNothingRatherThanTheWholeInstitute() {
        ReportContext ctx = weekly().toBuilder().visibleCohortIds(List.of("ps-1")).build();
        assertTrue(section(true).compute(ctx).isEmpty());
        verifyNoInteractions(client);
    }

    @Test
    void offByDefaultMakesNoCallAndOffersNothing() {
        ClassroomPanelsSection off = section(false);
        assertFalse(off.isAvailableFor("inst-1"));
        assertTrue(off.compute(weekly()).isEmpty());
        verifyNoInteractions(client);
    }

    @Test
    void availabilityFollowsHasPanelsAndAFailureAnswersFalse() {
        when(client.hasPanels("yes")).thenReturn(Boolean.TRUE);
        when(client.hasPanels("no")).thenReturn(Boolean.FALSE);
        when(client.hasPanels("down")).thenReturn(null);
        ClassroomPanelsSection on = section(true);
        assertTrue(on.isAvailableFor("yes"));
        assertFalse(on.isAvailableFor("no"));
        assertFalse(on.isAvailableFor("down"));
        verify(client, never()).usageSummary(anyString(), any(), any(), anyString());
    }

    @Test
    void keyRolesAndScope() {
        ClassroomPanelsSection s = section(true);
        assertEquals("classroom_panels", s.key());
        assertEquals(java.util.Set.of("ADMIN"), s.visibleToRoles());
        assertFalse(s.identifying());
    }

    @Test
    void hoursAndDatesFormatSafely() {
        assertEquals("0", ClassroomPanelsSection.hoursText(0));
        assertEquals("12", ClassroomPanelsSection.hoursText(12.0));
        assertEquals("0.1", ClassroomPanelsSection.hoursText(0.05));
        assertEquals("0", ClassroomPanelsSection.hoursText(Double.NaN));
        JsonNode nul = M.nullNode();
        assertEquals("never", ClassroomPanelsSection.lastUsed(nul, IST));
        assertEquals("8 Nov", ClassroomPanelsSection.lastUsed(M.getNodeFactory().textNode("2026-11-07T20:00:00"), IST));
        assertEquals("—", ClassroomPanelsSection.lastUsed(M.getNodeFactory().textNode("yesterday"), IST));
    }
}
