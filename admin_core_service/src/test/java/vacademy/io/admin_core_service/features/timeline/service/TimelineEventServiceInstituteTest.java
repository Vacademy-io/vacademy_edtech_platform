package vacademy.io.admin_core_service.features.timeline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventRequestDTO;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.repository.TimelineEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Timeline events carry the institute they belong to, and reads made for an institute skip
 * other institutes' events: a person is shared across institutes, so a note written about
 * them in one must not show in another.
 */
class TimelineEventServiceInstituteTest {

    private TimelineEventService service;
    private TimelineEventRepository repository;
    private final Pageable page = PageRequest.of(0, 20);

    @BeforeEach
    void setUp() throws Exception {
        service = new TimelineEventService();
        repository = mock(TimelineEventRepository.class);
        set("timelineEventRepository", repository);
        set("objectMapper", new ObjectMapper());
        when(repository.save(any(TimelineEvent.class))).thenAnswer(inv -> inv.getArgument(0));
        when(repository.findInstituteIdOfResponse(anyString())).thenReturn(Optional.empty());
        when(repository.findInstituteIdOfLeadProfile(anyString())).thenReturn(Optional.empty());
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void set(String field, Object value) throws Exception {
        Field f = TimelineEventService.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(service, value);
    }

    private void requestFor(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (instituteId != null) request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private TimelineEvent saved() {
        ArgumentCaptor<TimelineEvent> captor = ArgumentCaptor.forClass(TimelineEvent.class);
        verify(repository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void noteOnAPersonBelongsToTheInstituteItIsWrittenIn() {
        requestFor("inst-a");
        TimelineEventRequestDTO request = new TimelineEventRequestDTO();
        request.setType("STUDENT");
        request.setTypeId("user-1");
        request.setActionType("NOTE");
        request.setTitle("Note");
        request.setStudentUserId("user-1");
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("staff-1");

        service.createManualEvent(request, user);

        assertEquals("inst-a", saved().getInstituteId());
    }

    /** An enquiry's own institute wins over the request's, whoever writes the event. */
    @Test
    void leadEventTakesTheInstituteOfItsEnquiry() {
        requestFor("inst-b");
        when(repository.findInstituteIdOfResponse("resp-1")).thenReturn(Optional.of("inst-a"));

        service.logEvent("LEAD", "resp-1", "STATUS_CHANGED", "SYSTEM", null, null, "t", null, null);

        assertEquals("inst-a", saved().getInstituteId());
    }

    @Test
    void leadProfileEventTakesTheInstituteOfTheProfile() {
        when(repository.findInstituteIdOfLeadProfile("ulp-1")).thenReturn(Optional.of("inst-a"));

        service.logJourneyEvent("USER_LEAD_PROFILE", "ulp-1", LeadJourneyActionType.values()[0], "SYSTEM",
                null, null, "t", null, null, "user-1");

        assertEquals("inst-a", saved().getInstituteId());
    }

    /** A background job writing a person-keyed event: no institute, so it shows everywhere as before. */
    @Test
    void personEventOutsideARequestHasNoInstitute() {
        service.logEvent("STUDENT", "user-1", "NOTE", "SYSTEM", null, null, "t", null, null, "user-1");

        assertNull(saved().getInstituteId());
    }

    @Test
    void ownerLookupFailureFallsBackToTheRequestAndStillSaves() {
        requestFor("inst-a");
        when(repository.findInstituteIdOfResponse("resp-1")).thenThrow(new RuntimeException("db blip"));

        service.logEvent("LEAD", "resp-1", "NOTE", "USER", "staff-1", "Staff", "t", null, null);

        assertEquals("inst-a", saved().getInstituteId());
    }

    @Test
    void readsForAnInstituteUseTheScopedQueries() {
        requestFor("inst-a");
        when(repository.findForInstituteByTypeAndTypeId(any(), any(), any(), any())).thenReturn(Page.empty());
        when(repository.findForInstituteByStudentUserIdPinnedFirst(any(), any(), any())).thenReturn(Page.empty());
        when(repository.findRecentPerStudentForInstitute(any(), any(), anyInt())).thenReturn(List.of());
        when(repository.countByStudentUserIdsForInstitute(any(), any())).thenReturn(List.of());
        when(repository.findJourneyRowsForUsersForInstitute(any(), any(), anyInt())).thenReturn(List.of());

        service.getTimelineEvents("STUDENT", "user-1", page);
        service.getCrossStageTimeline("user-1", page);
        service.getLatestNotesForStudents(List.of("user-1"));
        service.getJourneyBatch(List.of("user-1"));

        verify(repository).findForInstituteByTypeAndTypeId("STUDENT", "user-1", "inst-a", page);
        verify(repository).findForInstituteByStudentUserIdPinnedFirst("user-1", "inst-a", page);
        verify(repository).findRecentPerStudentForInstitute(eq(List.of("user-1")), eq("inst-a"), anyInt());
        verify(repository).countByStudentUserIdsForInstitute(List.of("user-1"), "inst-a");
        verify(repository).findJourneyRowsForUsersForInstitute(eq(List.of("user-1")), eq("inst-a"), anyInt());
        verify(repository, never()).findByTypeAndTypeIdOrderByCreatedAtDesc(any(), any(), any());
        verify(repository, never()).findRecentPerStudent(any(), anyInt());
    }

    /** No institute on the request (internal callers): the unscoped queries, exactly as before. */
    @Test
    void readsWithoutAnInstituteAreUnchanged() {
        requestFor(null);
        when(repository.findByTypeAndTypeIdOrderByCreatedAtDesc(any(), any(), any())).thenReturn(Page.empty());
        when(repository.findRecentPerStudent(any(), anyInt())).thenReturn(List.of());
        when(repository.countByStudentUserIds(any())).thenReturn(List.of());

        service.getTimelineEvents("STUDENT", "user-1", page);
        service.getLatestNotesForStudents(List.of("user-1"));

        verify(repository).findByTypeAndTypeIdOrderByCreatedAtDesc("STUDENT", "user-1", page);
        verify(repository).findRecentPerStudent(eq(List.of("user-1")), anyInt());
        verify(repository, never()).findForInstituteByTypeAndTypeId(any(), any(), any(), any());
    }
}
