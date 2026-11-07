package vacademy.io.admin_core_service.features.suborg.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.manager.LearnerTerminationWorkflowHelper;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkDeassignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.service.BulkDeassignmentService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.suborg.entity.SubOrgMemberCascade;
import vacademy.io.admin_core_service.features.suborg.repository.SubOrgMemberCascadeRepository;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SubOrgExitServiceTest {

    private static final String INSTITUTE = "inst";
    private static final String SUB_ORG = "practice";
    private static final String COURSE = "course";
    private static final String ADMIN = "admin";
    private static final String STAFF = "staff";

    @Mock private StudentSessionInstituteGroupMappingRepository mappingRepository;
    @Mock private SubOrgMemberCascadeRepository cascadeRepository;
    @Mock private InstituteSettingService instituteSettingService;
    @Mock private InstituteRepository instituteRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private WorkflowTriggerService workflowTriggerService;
    @Mock private LearnerTerminationWorkflowHelper learnerTerminationWorkflowHelper;
    @Mock private AuthService authService;
    @Mock private BulkDeassignmentService bulkDeassignmentService;

    private SubOrgExitService service;

    @BeforeEach
    void setUp() {
        service = new SubOrgExitService(mappingRepository, cascadeRepository, instituteSettingService,
                instituteRepository, packageSessionRepository, workflowTriggerService,
                learnerTerminationWorkflowHelper, authService);
        ReflectionTestUtils.setField(service, "bulkDeassignmentService", bulkDeassignmentService);
        when(instituteRepository.findById(SUB_ORG)).thenReturn(Optional.empty());
        when(packageSessionRepository.findById(COURSE)).thenReturn(Optional.empty());
        UserDTO user = new UserDTO();
        user.setId(STAFF);
        when(authService.getUsersFromAuthServiceByUserIds(any())).thenReturn(List.of(user));
    }

    private void cascade(boolean enabled) {
        when(instituteSettingService.getSettingByInstituteIdAndKey(INSTITUTE, SubOrgExitService.CASCADE_SETTING_KEY))
                .thenReturn(enabled ? Map.of("enabled", true) : null);
    }

    private static SubOrgExitService.Membership admin(Date accessEnd) {
        return new SubOrgExitService.Membership(SUB_ORG, true, accessEnd);
    }

    private static SubOrgMemberCascade due(boolean terminateAdmin, Timestamp effectiveAt) {
        return SubOrgMemberCascade.builder().id("row").instituteId(INSTITUTE).subOrgId(SUB_ORG)
                .packageSessionId(COURSE).adminUserId(ADMIN).effectiveAt(effectiveAt)
                .terminateAdmin(terminateAdmin).adminNotified(!terminateAdmin).build();
    }

    private void dueRows(SubOrgMemberCascade row) {
        when(cascadeRepository.findDue(any())).thenReturn(List.of(row));
    }

    @Test
    void switchOffQueuesNothingButStillTellsTheAdmin() {
        cascade(false);
        service.onHardExit(ADMIN, COURSE, INSTITUTE, "actor", admin(null));
        verify(workflowTriggerService).handleTriggerEvents(eq("SUB_ORG_ADMIN_TERMINATED"), eq(COURSE), eq(INSTITUTE), any());
        verify(cascadeRepository, never()).save(any());
    }

    @Test
    void removingOneStaffMemberNeverQueuesTheRest() {
        cascade(true);
        service.onHardExit(STAFF, COURSE, INSTITUTE, "actor", new SubOrgExitService.Membership(SUB_ORG, false, null));
        verify(workflowTriggerService).handleTriggerEvents(eq("SUB_ORG_STAFF_REMOVED"), eq(COURSE), eq(INSTITUTE), any());
        verify(cascadeRepository, never()).save(any());
    }

    @Test
    void softCancelWaitsForTheLastAccessDateAndSendsNothingYet() {
        cascade(true);
        Date lastAccess = new Date(System.currentTimeMillis() + 86_400_000L);
        service.onSoftCancel(ADMIN, COURSE, INSTITUTE, "actor", admin(null), lastAccess);
        ArgumentCaptor<SubOrgMemberCascade> saved = ArgumentCaptor.forClass(SubOrgMemberCascade.class);
        verify(cascadeRepository).save(saved.capture());
        assertEquals(lastAccess.getTime(), saved.getValue().getEffectiveAt().getTime());
        assertTrue(saved.getValue().isTerminateAdmin());
        verify(workflowTriggerService, never()).handleTriggerEvents(anyString(), anyString(), anyString(), any());
    }

    @Test
    void staffStayWhenAnotherAdminIsStillActive() {
        dueRows(due(false, Timestamp.from(Instant.now())));
        when(mappingRepository.countOtherActiveSubOrgAdmins(SUB_ORG, COURSE, ADMIN)).thenReturn(1L);
        service.processDue();
        verify(bulkDeassignmentService, never()).terminateForSubOrgExit(any(), any(), any(), any());
    }

    @Test
    void staffAreTerminatedAndTold() {
        SubOrgMemberCascade row = due(false, Timestamp.from(Instant.now()));
        dueRows(row);
        when(mappingRepository.findActiveNonAdminUserIdsOfSubOrg(SUB_ORG, COURSE, INSTITUTE)).thenReturn(List.of(STAFF));
        when(bulkDeassignmentService.terminateForSubOrgExit(eq(List.of(STAFF)), eq(COURSE), eq(INSTITUTE), any()))
                .thenReturn(List.of(BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                        .userId(STAFF).status("SUCCESS").build()));
        service.processDue();
        verify(workflowTriggerService).handleTriggerEvents(eq("SUB_ORG_STAFF_CASCADE_TERMINATED"), eq(COURSE), eq(INSTITUTE), any());
        assertEquals(SubOrgMemberCascade.STATUS_DONE, row.getStatus());
        assertEquals(1, row.getTerminatedCount());
    }

    @Test
    void aFailedTerminationStaysPendingForRetry() {
        SubOrgMemberCascade row = due(false, Timestamp.from(Instant.now()));
        dueRows(row);
        when(mappingRepository.findActiveNonAdminUserIdsOfSubOrg(SUB_ORG, COURSE, INSTITUTE)).thenReturn(List.of(STAFF));
        when(bulkDeassignmentService.terminateForSubOrgExit(any(), any(), any(), any()))
                .thenReturn(List.of(BulkDeassignResponseDTO.DeassignResultItemDTO.builder()
                        .userId(STAFF).status("FAILED").build()));
        service.processDue();
        assertEquals(SubOrgMemberCascade.STATUS_PENDING, row.getStatus());
        assertEquals(1, row.getAttempts());
    }

    @Test
    void adminWhoseAccessWasExtendedBeforeTheDateKeepsTheirStaff() {
        cascade(true);
        Timestamp date = Timestamp.from(Instant.now());
        SubOrgMemberCascade row = due(true, date);
        dueRows(row);
        StudentSessionInstituteGroupMappingRepository.SubOrgMembershipSnapshot extended =
                org.mockito.Mockito.mock(StudentSessionInstituteGroupMappingRepository.SubOrgMembershipSnapshot.class);
        when(extended.getSubOrgId()).thenReturn(SUB_ORG);
        when(extended.getOrgRoles()).thenReturn("ADMIN,LEARNER");
        when(extended.getAccessEnd()).thenReturn(new Date(date.getTime() + 86_400_000L));
        when(mappingRepository.findActiveSubOrgMembership(ADMIN, COURSE, INSTITUTE)).thenReturn(Optional.of(extended));
        service.processDue();
        assertEquals(SubOrgMemberCascade.STATUS_REINSTATED, row.getStatus());
        verify(bulkDeassignmentService, never()).terminateForSubOrgExit(any(), any(), any(), any());
    }

    @Test
    void switchTurnedOffBeforeTheDateCancelsTheSoftExit() {
        cascade(false);
        SubOrgMemberCascade row = due(true, Timestamp.from(Instant.now()));
        dueRows(row);
        service.processDue();
        assertEquals(SubOrgMemberCascade.STATUS_SETTING_OFF, row.getStatus());
        assertFalse(row.isAdminNotified());
    }
}
