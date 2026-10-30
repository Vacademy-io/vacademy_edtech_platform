package vacademy.io.admin_core_service.features.timeline.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository.JourneyFollowupRow;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Converted leads migrated into the CRM carry their history as lead_followup rows with no
 * timeline event, so their Lead Journey was empty. The journey now shows those follow-ups,
 * never twice for one that already logged its events, and is untouched otherwise.
 */
class LeadJourneyFollowupServiceTest {

    private static final String LEAD = "lead-user";
    private static final String RESPONSE = "response-1";

    private TimelineEventService timeline;
    private LeadFollowupRepository followups;
    private AuthService auth;
    private LeadJourneyFollowupService service;

    @BeforeEach
    void setUp() {
        timeline = mock(TimelineEventService.class);
        followups = mock(LeadFollowupRepository.class);
        auth = mock(AuthService.class);
        service = new LeadJourneyFollowupService(timeline, followups, auth);
        when(timeline.requestInstituteId()).thenReturn("inst-1");
        UserDTO counsellor = new UserDTO();
        counsellor.setId("counsellor-1");
        counsellor.setFullName("Counsellor One");
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(counsellor));
    }

    @Test
    void leadWithoutFollowupGapsGetsThePlainTimelineUnchanged() {
        when(followups.findJourneyFollowups(anyList(), anyList(), any()))
                .thenReturn(List.of(row("f1", 10, true, false, null, true)));
        Page<TimelineEventDTO> plain = new PageImpl<>(List.of(event("e1", 20)));
        Pageable page = PageRequest.of(0, 50);
        when(timeline.getAllEventsForStudent(LEAD, List.of(RESPONSE), page)).thenReturn(plain);

        assertSame(plain, service.allEventsForStudent(LEAD, List.of(RESPONSE), page));
        verifyNoInteractions(auth);
    }

    @Test
    void migratedLeadShowsItsFollowupsWithNoteAndCounsellor() {
        when(followups.findJourneyFollowups(List.of(LEAD), List.of(RESPONSE), "inst-1"))
                .thenReturn(List.of(row("f1", 10, false, true, 15L, false)));
        when(timeline.getAllEventsForStudent(eq(LEAD), anyList(), any()))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 50), 0));

        Page<TimelineEventDTO> page = service.allEventsForStudent(LEAD, List.of(RESPONSE), PageRequest.of(0, 50));

        assertEquals(2, page.getTotalElements());
        TimelineEventDTO closed = page.getContent().get(0);
        TimelineEventDTO scheduled = page.getContent().get(1);
        assertEquals("FOLLOWUP_CLOSED", closed.getActionType());
        assertEquals("Follow-up completed", closed.getTitle());
        assertEquals("closing note f1", closed.getDescription());
        assertEquals("SYSTEM", closed.getActorType());
        assertEquals("FOLLOWUP_SCHEDULED", scheduled.getActionType());
        assertEquals("note f1", scheduled.getDescription());
        assertEquals("Counsellor One", scheduled.getActorName());
        assertEquals(LEAD, scheduled.getStudentUserId());
        assertEquals(ts(10), scheduled.getCreatedAt());
        Map<?, ?> meta = (Map<?, ?>) scheduled.getMetadata();
        assertEquals("f1", meta.get("followupId"));
        assertEquals(ts(12).getTime(), meta.get("scheduleTime"));
    }

    @Test
    void followupWithItsEventsIsNeverShownTwice() {
        when(followups.findJourneyFollowups(anyList(), anyList(), any())).thenReturn(List.of(
                row("logged", 10, true, true, 11L, true),
                row("closedInBulk", 20, true, true, 21L, false)));

        List<TimelineEventDTO> rows = service.followupEvents(List.of(LEAD), List.of(), "inst-1");

        assertEquals(1, rows.size());
        assertEquals("followup-closed-closedInBulk", rows.get(0).getId());
    }

    @Test
    void pagesRunOverEventsAndFollowupsNewestFirst() {
        // Events at 100, 80, 60, 40; follow-ups (scheduled only) at 90, 50.
        when(followups.findJourneyFollowups(anyList(), anyList(), any())).thenReturn(List.of(
                row("a", 90, false, false, null, false), row("b", 50, false, false, null, false)));
        List<TimelineEventDTO> events = List.of(event("e100", 100), event("e80", 80), event("e60", 60),
                event("e40", 40));
        when(timeline.getAllEventsForStudent(eq(LEAD), anyList(), any())).thenAnswer(inv -> {
            Pageable p = inv.getArgument(2);
            int to = (int) Math.min(p.getOffset() + p.getPageSize(), events.size());
            return new PageImpl<>(new ArrayList<>(events.subList((int) p.getOffset(), to)), p, events.size());
        });

        Page<TimelineEventDTO> first = service.allEventsForStudent(LEAD, List.of(RESPONSE), PageRequest.of(0, 3));
        Page<TimelineEventDTO> second = service.allEventsForStudent(LEAD, List.of(RESPONSE), PageRequest.of(1, 3));

        assertEquals(List.of("e100", "followup-a", "e80"), ids(first));
        assertEquals(List.of("e60", "followup-b", "e40"), ids(second));
        assertEquals(6, first.getTotalElements());
        assertEquals(2, first.getTotalPages());
        assertTrue(second.isLast());
    }

    @Test
    void followupLookupFailureKeepsTheJourneyAsBefore() {
        when(followups.findJourneyFollowups(anyList(), anyList(), any())).thenThrow(new RuntimeException("db"));
        Page<TimelineEventDTO> plain = new PageImpl<>(List.of(event("e1", 20)));
        when(timeline.getAllEventsForStudent(eq(LEAD), anyList(), any())).thenReturn(plain);

        assertSame(plain, service.allEventsForStudent(LEAD, List.of(RESPONSE), PageRequest.of(0, 50)));
    }

    @Test
    void namesFailureStillShowsTheFollowup() {
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenThrow(new RuntimeException("auth down"));
        when(followups.findJourneyFollowups(anyList(), anyList(), any()))
                .thenReturn(List.of(row("f1", 10, false, false, null, false)));

        List<TimelineEventDTO> rows = service.followupEvents(List.of(LEAD), List.of(), null);

        assertEquals(1, rows.size());
        assertNull(rows.get(0).getActorName());
        assertEquals("ADMIN", rows.get(0).getActorType());
    }

    @Test
    void noLeadNoLookup() {
        assertTrue(service.followupEvents(java.util.Collections.singletonList(null), List.of(" "), null).isEmpty());
        verifyNoInteractions(followups);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static List<String> ids(Page<TimelineEventDTO> page) {
        return page.getContent().stream().map(TimelineEventDTO::getId).toList();
    }

    private static Timestamp ts(long minutes) {
        return new Timestamp(1_700_000_000_000L + minutes * 60_000L);
    }

    private static TimelineEventDTO event(String id, long minutes) {
        return TimelineEventDTO.builder().id(id).actionType("NOTE").createdAt(ts(minutes)).build();
    }

    private static JourneyFollowupRow row(String id, long createdMinutes, boolean hasScheduledEvent,
            boolean closed, Long closedMinutes, boolean hasClosedEvent) {
        return new JourneyFollowupRow() {
            public String getId() { return id; }
            public String getResponseId() { return RESPONSE; }
            public String getLeadUserId() { return LEAD; }
            public String getCreatedBy() { return "counsellor-1"; }
            public Timestamp getScheduleTime() { return ts(createdMinutes + 2); }
            public String getStatus() { return closed ? "COMPLETED" : "PENDING"; }
            public Boolean getClosed() { return closed; }
            public String getContent() { return "note " + id; }
            public String getCloserReason() { return "closing note " + id; }
            public String getClosedBy() { return null; }
            public Timestamp getClosedAt() { return closedMinutes == null ? null : ts(closedMinutes); }
            public Timestamp getCreatedAt() { return ts(createdMinutes); }
            public Boolean getHasScheduledEvent() { return hasScheduledEvent; }
            public Boolean getHasClosedEvent() { return hasClosedEvent; }
        };
    }
}
