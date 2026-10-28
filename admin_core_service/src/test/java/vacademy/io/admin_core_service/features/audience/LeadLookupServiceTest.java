package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadLookupResultDto;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadLookupService;
import vacademy.io.admin_core_service.features.audience.service.LeadLookupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadLookupSettingService.Fields;
import vacademy.io.admin_core_service.features.audience.service.LeadLookupSettingService.LookupSettings;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository.EnrolledStudentLookupRow;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Check Lead's access rules, per the client's spec: an admin and the lead's own
 * counsellor see every detail and the follow-up history; another counsellor sees
 * the lead details the institute shares and no follow-up history at all.
 */
class LeadLookupServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String CALLER = "counsellor-a";
    private static final String OTHER = "counsellor-b";
    private static final String PHONE = "9876543210";

    /** Name, source and assigned-to shared; email, phone and branch not. */
    private static final Fields SHARED = new Fields(true, false, false, true, true, true, true, true,
            false, true);

    private AudienceResponseRepository responses;
    private LeadFollowupRepository followUps;
    private CounsellorScopeService scope;
    private AuthService authService;
    private StudentSessionInstituteGroupMappingRepository enrolments;
    private LeadLookupService service;
    private CustomUserDetails caller;

    @BeforeEach
    void setUp() {
        responses = mock(AudienceResponseRepository.class);
        followUps = mock(LeadFollowupRepository.class);
        scope = mock(CounsellorScopeService.class);
        authService = mock(AuthService.class);
        enrolments = mock(StudentSessionInstituteGroupMappingRepository.class);
        LeadLookupSettingService settings = mock(LeadLookupSettingService.class);
        when(settings.get(INSTITUTE)).thenReturn(
                new LookupSettings(true, SHARED, "field-course", "field-branch", false));
        LeadDedupSettingService dedupSettings = mock(LeadDedupSettingService.class);
        when(dedupSettings.get(anyString())).thenReturn(LeadDedupSettingService.DEFAULTS);
        service = new LeadLookupService(responses, settings, scope, followUps, authService, dedupSettings,
                enrolments);

        caller = mock(CustomUserDetails.class);
        when(caller.getUserId()).thenReturn(CALLER);
        when(scope.scopedCounsellorUserIds(INSTITUTE, CALLER)).thenReturn(List.of(CALLER));
        when(responses.lookupMatchingResponseIds(anyString(), anyString(), any(), any(), eq(false), any()))
                .thenReturn(List.of("resp-1"));
        when(followUps.findByAudienceResponseIdInOrderByScheduleTimeDesc(anyList()))
                .thenReturn(List.of(followUp()));
        UserDTO enteredBy = new UserDTO();
        enteredBy.setId("staff-1");
        enteredBy.setFullName("Front Desk");
        UserDTO counsellor = new UserDTO();
        counsellor.setId(OTHER);
        counsellor.setFullName("Asha");
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(enteredBy, counsellor));
    }

    @Test
    void otherCounsellorGetsSharedDetailsButNoFollowUps() {
        lead(OTHER, "PENDING_KEY", "LEAD", "NONE");

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertTrue(result.isFound());
        assertEquals("Ravi", result.getLeadName());
        assertEquals("Asha", result.getCounsellorName());
        assertEquals("Front Desk", result.getEnquiredBy());
        assertNull(result.getLeadMobile(), "phone is not shared with other counsellors");
        assertNull(result.getBranch(), "branch is not shared with other counsellors");
        assertFalse(result.getFollowUpsVisible());
        assertNull(result.getFollowUps());
        assertNull(result.getNextFollowUpAt());
        assertNull(result.getInterestLevel());
        assertNull(result.getLeadCreatedAt());
        verify(followUps, never()).findByAudienceResponseIdInOrderByScheduleTimeDesc(anyList());
    }

    @Test
    void ownCounsellorGetsEverythingIncludingFollowUps() {
        lead(CALLER, "PENDING_KEY", "LEAD", "NONE");

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertEquals("9876543210", result.getLeadMobile());
        assertEquals("Pune", result.getBranch());
        assertTrue(result.getFollowUpsVisible());
        assertEquals("Hot", result.getInterestLevel());
        assertEquals(1, result.getFollowUps().size());
        LeadLookupResultDto.FollowUpEntry entry = result.getFollowUps().get(0);
        assertEquals("Asha", entry.getCounsellorName());
        assertEquals("Call back", entry.getActionLabel());
        assertEquals("Phone", entry.getMode());
        assertEquals("Interested", entry.getStudentResponse());
        assertEquals(Timestamp.valueOf("2026-10-20 10:00:00"), result.getNextFollowUpAt());
    }

    @Test
    void unassignedLeadStaysMaskedForCounsellors() {
        lead(null, "NEW", "LEAD", "NONE");

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertNull(result.getLeadMobile());
        assertFalse(result.getFollowUpsVisible());
        assertNull(result.getFollowUps());
    }

    @Test
    void adminGetsFollowUpsOnAnyonesLead() {
        when(scope.hasAdminRole(caller, INSTITUTE)).thenReturn(true);
        lead(OTHER, "PENDING_KEY", "LEAD", "NONE");

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertTrue(result.getFollowUpsVisible());
        assertEquals("Pune", result.getBranch());
        assertEquals(1, result.getFollowUps().size());
    }

    @Test
    void stageReflectsAdmissionAndEnrolment() {
        lead(OTHER, "CONVERTED", "CONVERTED", "ONGOING");
        assertEquals("ADMISSION_ONGOING", service.lookup(INSTITUTE, PHONE, null, null, caller).getStage());

        lead(OTHER, "NEW", "CONVERTED", "COMPLETED");
        assertEquals("ADMISSION_COMPLETED", service.lookup(INSTITUTE, PHONE, null, null, caller).getStage());

        lead(OTHER, "LOST", "LEAD", "NONE");
        assertEquals("DISCARDED", service.lookup(INSTITUTE, PHONE, null, null, caller).getStage());

        lead(OTHER, "NEW", "LEAD", "NONE");
        assertEquals("PENDING", service.lookup(INSTITUTE, PHONE, null, null, caller).getStage());
    }

    /**
     * The searched number is someone's profile (login) number but none of their enquiries
     * here: those people are passed to the lookup, after an exact re-check of the
     * substring auth search (a longer number that merely contains it is dropped).
     */
    @Test
    void profileNumberPassesOnlyExactProfileMatches() {
        lead(OTHER, "NEW", "LEAD", "NONE");
        when(authService.searchUserIdsByQuery(PHONE, null)).thenReturn(List.of("user-exact", "user-longer"));
        UserDTO exact = new UserDTO();
        exact.setId("user-exact");
        exact.setMobileNumber("+91 98765 43210");
        UserDTO longer = new UserDTO();
        longer.setId("user-longer");
        longer.setMobileNumber("98765432109");
        when(authService.getUsersFromAuthServiceByUserIds(argThat(ids -> ids != null && ids.contains("user-exact"))))
                .thenReturn(List.of(exact, longer));

        service.lookup(INSTITUTE, PHONE, null, null, caller);

        verify(responses).lookupByPhoneOrEmail(eq(INSTITUTE), eq(PHONE), isNull(), isNull(), any(), any(),
                eq("user-exact"));
    }

    /** Auth search down: the lookup still runs on enquiry numbers, exactly as before. */
    @Test
    void profileLookupFailureKeepsTheEnquiryMatch() {
        lead(OTHER, "NEW", "LEAD", "NONE");
        when(authService.searchUserIdsByQuery(PHONE, null)).thenThrow(new RuntimeException("auth down"));

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertTrue(result.isFound());
        verify(responses).lookupByPhoneOrEmail(eq(INSTITUTE), eq(PHONE), isNull(), isNull(), any(), any(), isNull());
    }

    /*
     * A student admitted without an enquiry here (migrated admission, direct enrolment)
     * is on the Contacts page, so Check Lead must not call them "not in the system".
     * In these tests no enquiry matches: the lead query is left unstubbed (empty).
     */

    @Test
    void enrolledStudentWithoutEnquiryIsFoundWithInstituteMasking() {
        profileMatch("student-1");
        EnrolledStudentLookupRow row = enrolled(OTHER, 1L);
        when(enrolments.findEnrolledStudentForLookup(INSTITUTE, "student-1")).thenReturn(Optional.of(row));

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertTrue(result.isFound());
        assertEquals("Meera", result.getLeadName());
        assertNull(result.getLeadMobile(), "phone is not shared with other counsellors");
        assertEquals("Asha", result.getCounsellorName());
        assertEquals("Admission Taken", result.getStatus());
        assertEquals("ADMISSION_ONGOING", result.getStage());
        assertEquals("Diploma in Cosmetology", result.getCourse());
        assertNull(result.getCampaignType(), "no enquiry, so no source");
        assertFalse(result.getFollowUpsVisible());
        assertNull(result.getFollowUps());
        verify(followUps, never()).findByAudienceResponseIdInOrderByScheduleTimeDesc(anyList());
    }

    @Test
    void ownStudentWithLapsedEnrolmentShowsEverythingAndNoHistory() {
        profileMatch("student-1");
        EnrolledStudentLookupRow row = enrolled(CALLER, 0L);
        when(enrolments.findEnrolledStudentForLookup(INSTITUTE, "student-1")).thenReturn(Optional.of(row));

        LeadLookupResultDto result = service.lookup(INSTITUTE, PHONE, null, null, caller);

        assertTrue(result.isFound());
        assertEquals(PHONE, result.getLeadMobile());
        assertEquals("ADMISSION_COMPLETED", result.getStage());
        assertTrue(result.getFollowUpsVisible());
        assertEquals("Hot", result.getInterestLevel());
        assertTrue(result.getFollowUps().isEmpty());
        assertNull(result.getLeadCreatedAt(), "no enquiry, so no lead-created date");
        verify(followUps, never()).findByAudienceResponseIdInOrderByScheduleTimeDesc(anyList());
    }

    @Test
    void profileMatchWithoutEnrolmentIsStillNotInTheSystem() {
        profileMatch("student-1");
        when(enrolments.findEnrolledStudentForLookup(INSTITUTE, "student-1")).thenReturn(Optional.empty());

        assertFalse(service.lookup(INSTITUTE, PHONE, null, null, caller).isFound());
    }

    @Test
    void noProfileMatchSkipsTheEnrolmentCheck() {
        when(authService.searchUserIdsByQuery(PHONE, null)).thenReturn(List.of());

        assertFalse(service.lookup(INSTITUTE, PHONE, null, null, caller).isFound());
        verify(enrolments, never()).findEnrolledStudentForLookup(any(), any());
    }

    @Test
    void enrolmentLookupFailureFallsBackToNotFound() {
        profileMatch("student-1");
        when(enrolments.findEnrolledStudentForLookup(any(), any())).thenThrow(new RuntimeException("db down"));

        assertFalse(service.lookup(INSTITUTE, PHONE, null, null, caller).isFound());
    }

    @Test
    void aMatchingEnquiryStillAnswersWithoutTheEnrolmentCheck() {
        lead(OTHER, "PENDING_KEY", "LEAD", "NONE");

        assertTrue(service.lookup(INSTITUTE, PHONE, null, null, caller).isFound());
        verify(enrolments, never()).findEnrolledStudentForLookup(any(), any());
    }

    /** The searched phone is the profile number of {@code userId}. */
    private void profileMatch(String userId) {
        when(authService.searchUserIdsByQuery(PHONE, null)).thenReturn(List.of(userId));
        UserDTO student = new UserDTO();
        student.setId(userId);
        student.setFullName("Meera");
        student.setMobileNumber(PHONE);
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(student));
    }

    private EnrolledStudentLookupRow enrolled(String counsellorId, long activeCount) {
        EnrolledStudentLookupRow row = mock(EnrolledStudentLookupRow.class);
        when(row.getUserId()).thenReturn("student-1");
        when(row.getCounsellorId()).thenReturn(counsellorId);
        when(row.getCounsellorName()).thenReturn("Asha");
        when(row.getInterestLevel()).thenReturn("Hot");
        when(row.getCourseValue()).thenReturn("Diploma in Cosmetology");
        when(row.getConvertedLabel()).thenReturn("Admission Taken");
        when(row.getActiveCount()).thenReturn(activeCount);
        return row;
    }

    private void lead(String assignee, String statusKey, String conversion, String enrolment) {
        AudienceResponseRepository.LeadLookupRow row = mock(AudienceResponseRepository.LeadLookupRow.class);
        when(row.getResponseId()).thenReturn("resp-1");
        when(row.getUserId()).thenReturn("lead-user");
        when(row.getLeadName()).thenReturn("Ravi");
        when(row.getLeadMobile()).thenReturn("9876543210");
        when(row.getCounsellorId()).thenReturn(assignee);
        when(row.getCounsellorName()).thenReturn("Asha");
        when(row.getCreatedByUserId()).thenReturn("staff-1");
        when(row.getStatusLabel()).thenReturn("Some status");
        when(row.getStatusKey()).thenReturn(statusKey);
        when(row.getConversionStatus()).thenReturn(conversion);
        when(row.getEnrolmentState()).thenReturn(enrolment);
        when(row.getBranchValue()).thenReturn("Pune");
        when(row.getInterestLevel()).thenReturn("Hot");
        when(row.getCreatedAt()).thenReturn(Timestamp.valueOf("2026-10-01 09:00:00"));
        when(responses.lookupByPhoneOrEmail(anyString(), anyString(), any(), any(), any(), any(), any()))
                .thenReturn(Optional.of(row));
    }

    private static LeadFollowup followUp() {
        LeadFollowup f = new LeadFollowup();
        f.setAudienceResponseId("resp-1");
        f.setCreatedBy(OTHER);
        f.setScheduleTime(Timestamp.valueOf("2026-10-20 10:00:00"));
        f.setStatus("PENDING");
        f.setIsClosed(false);
        f.setNextAction("Call back");
        f.setFollowUpMode("Phone");
        f.setStudentResponse("Interested");
        f.setContent("Asked for fee details");
        return f;
    }
}
