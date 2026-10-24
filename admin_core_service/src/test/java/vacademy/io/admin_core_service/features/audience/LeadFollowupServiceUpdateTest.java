package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadFollowupDto;
import vacademy.io.admin_core_service.features.audience.dto.UpdateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupSettingService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.counsellor_workbench.repository.WorkbenchLeadRepository;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityCounsellorRecorder;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Editing a follow-up. Open follow-ups keep the old, unchecked path (the
 * reminder's snooze runs through it); only editing a CLOSED one is new, and
 * only that applies the lead-scope rule.
 */
class LeadFollowupServiceUpdateTest {

    private static final String INSTITUTE = "inst-1";
    private static final String RESPONSE = "ar-1";
    private static final String LEAD_USER = "lead-user-1";
    private static final String CREATOR = "counsellor-a";
    private static final String OTHER = "counsellor-b";
    private static final String OUTSIDE_ASSIGNEE = "counsellor-z";

    private LeadFollowupRepository followups;
    private CounsellorScopeService scope;
    private WorkbenchLeadRepository workbench;
    private LeadFollowupSettingService settings;
    private LeadFollowupService service;

    @BeforeEach
    void setUp() {
        followups = mock(LeadFollowupRepository.class);
        scope = mock(CounsellorScopeService.class);
        workbench = mock(WorkbenchLeadRepository.class);
        settings = mock(LeadFollowupSettingService.class);
        // The institute turned on "Allow editing past follow-ups" unless a test says otherwise.
        when(settings.allowEditing(INSTITUTE)).thenReturn(true);
        AudienceResponseRepository responses = mock(AudienceResponseRepository.class);
        AudienceResponse response = mock(AudienceResponse.class);
        when(response.getUserId()).thenReturn(LEAD_USER);
        when(responses.findById(RESPONSE)).thenReturn(Optional.of(response));
        when(followups.save(any(LeadFollowup.class))).thenAnswer(inv -> inv.getArgument(0));
        // A counsellor-role caller whose scope does NOT contain the lead's assignee.
        when(scope.isScopedCaller(anyString(), any(CustomUserDetails.class))).thenReturn(true);
        when(scope.scopedCounsellorUserIds(anyString(), anyString())).thenReturn(List.of(OTHER));
        when(workbench.currentAssigneeForLead(INSTITUTE, LEAD_USER)).thenReturn(OUTSIDE_ASSIGNEE);

        service = new LeadFollowupService(followups, mock(LiveActivityCounsellorRecorder.class),
                mock(TimelineEventService.class), mock(AuthService.class), responses,
                mock(AudienceRepository.class), scope, workbench, mock(UserLeadProfileRepository.class),
                mock(LeadStatusRepository.class), mock(CustomFieldValuesRepository.class),
                mock(CustomFieldRepository.class), settings,
                mock(vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver.class));
    }

    private LeadFollowup followup(boolean closed) {
        LeadFollowup f = LeadFollowup.builder()
                .id("f-1")
                .audienceResponseId(RESPONSE)
                .instituteId(INSTITUTE)
                .createdBy(CREATOR)
                .scheduleTime(new Timestamp(1_000L))
                .content("original note")
                .build();
        if (closed) {
            f.setIsClosed(true);
            f.setStatus("COMPLETED");
            f.setCloserReason("original closing note");
        }
        when(followups.findById("f-1")).thenReturn(Optional.of(f));
        return f;
    }

    private static CustomUserDetails user(String id) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(id);
        return u;
    }

    @Test
    void snoozeOnAnOpenFollowUpStillWorksForAnyCallerWithoutAScopeCheck() {
        followup(false);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setScheduleTime(new Timestamp(9_000L));

        LeadFollowupDto out = service.update("f-1", req, user(OTHER));

        assertEquals(new Timestamp(9_000L), out.getScheduleTime());
        assertEquals("original note", out.getContent());
        verifyNoInteractions(scope, workbench);
    }

    @Test
    void editingTheNoteOfAnOpenFollowUpBehavesAsBefore() {
        followup(false);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setContent("new note");

        LeadFollowupDto out = service.update("f-1", req, user(OTHER));

        assertEquals("new note", out.getContent());
        assertEquals(new Timestamp(1_000L), out.getScheduleTime());
        verifyNoInteractions(scope, workbench);
    }

    @Test
    void aClosedFollowUpCannotBeRescheduled() {
        followup(true);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setScheduleTime(new Timestamp(9_000L));

        assertThrows(VacademyException.class, () -> service.update("f-1", req, user(CREATOR)));
        verify(followups, never()).save(any());
    }

    @Test
    void theCreatorCanCorrectAClosedFollowUp() {
        followup(true);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setContent("corrected note");
        req.setCloserReason("corrected closing note");
        req.setInterestLevel("Warm");

        LeadFollowupDto out = service.update("f-1", req, user(CREATOR));

        assertEquals("corrected note", out.getContent());
        assertEquals("corrected closing note", out.getCloserReason());
        assertEquals("Warm", out.getInterestLevel());
        assertEquals(true, out.getIsClosed());
        verifyNoInteractions(scope, workbench);
    }

    @Test
    void anOutOfScopeCounsellorCannotEditSomeoneElsesClosedFollowUp() {
        followup(true);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setContent("rewritten");

        assertThrows(VacademyException.class, () -> service.update("f-1", req, user(OTHER)));
        verify(followups, never()).save(any());
    }

    @Test
    void anAdminCanEditAClosedFollowUpAndBlankInterestClearsIt() {
        LeadFollowup f = followup(true);
        f.setInterestLevel("Hot");
        when(scope.isScopedCaller(anyString(), any(CustomUserDetails.class))).thenReturn(false);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setInterestLevel("");

        LeadFollowupDto out = service.update("f-1", req, user(OTHER));

        assertNull(out.getInterestLevel());
        // Fields not sent stay as they were.
        assertEquals("original note", out.getContent());
        assertEquals("original closing note", out.getCloserReason());
    }

    @Test
    void anOpenFollowUpIgnoresAClosingNoteAsBefore() {
        followup(false);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setCloserReason("note");

        LeadFollowupDto out = service.update("f-1", req, user(CREATOR));

        assertNull(out.getCloserReason());
        assertEquals("original note", out.getContent());
    }

    @Test
    void withEditingSwitchedOffAClosedFollowUpIsReadOnlyExactlyAsBefore() {
        followup(true);
        when(settings.allowEditing(INSTITUTE)).thenReturn(false);
        UpdateLeadFollowupRequest req = new UpdateLeadFollowupRequest();
        req.setContent("rewritten");

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.update("f-1", req, user(CREATOR)));
        assertEquals("Cannot update a closed follow-up", e.getMessage());
        verify(followups, never()).save(any());
        verifyNoInteractions(scope, workbench);
    }
}
