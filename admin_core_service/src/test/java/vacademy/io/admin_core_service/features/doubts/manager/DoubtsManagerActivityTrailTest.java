package vacademy.io.admin_core_service.features.doubts.manager;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsDto;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtActivity;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtAssignee;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsAssigneeRepository;
import vacademy.io.admin_core_service.features.doubts.service.DoubtService;
import vacademy.io.admin_core_service.features.doubts.service.DoubtStatusCatalog;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto.WorkflowStatusConfig;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.slide.service.SlideMetaDataService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgStaffLookupService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins the audit trail + configurable-status behaviour of {@link DoubtsManager}:
 * <ul>
 *   <li>auto-assignment at creation is recorded as a RULE actor naming the routing rule, while an
 *       id the caller picked by hand is a USER actor;</li>
 *   <li>moving to a configured workflow status derives the coarse ACTIVE/RESOLVED status from the
 *       status's kind, logs STATUS_CHANGED with the remark, and fires the resolved notification only
 *       on the actual flip;</li>
 *   <li>the legacy status toggle (admin switch / learner app) snaps the workflow key to the built-in
 *       PENDING/RESOLVED so both views stay consistent;</li>
 *   <li>a remark alone is logged on the current status; assign/unassign are logged with user ids;</li>
 *   <li>an unknown status key is rejected, and learners cannot read the trail.</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DoubtsManagerActivityTrailTest {

    private static final String PS = "ps-1";
    private static final String INST = "inst-1";
    private static final String LEARNER = "learner-1";
    private static final String ADMIN = "admin-1";
    private static final String TEACHER = "teacher-1";
    private static final String DOUBT_ID = "doubt-1";
    private static final String SETTING_KEY = "DOUBT_MANAGEMENT_SETTING";

    @Mock private DoubtService doubtService;
    @Mock private FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    @Mock private InstituteSettingService instituteSettingService;
    @Mock private SlideMetaDataService slideMetaDataService;
    @Mock private DoubtNotificationService doubtNotificationService;
    @Mock private DoubtsAssigneeRepository doubtsAssigneeRepository;
    @Mock private AuthService authService;
    @Mock private WorkflowTriggerService workflowTriggerService;
    @Mock private SubOrgStaffLookupService subOrgStaffLookupService;
    @Spy private InstituteAccessValidator instituteAccessValidator = new InstituteAccessValidator();

    @InjectMocks private DoubtsManager manager;

    /** Staff principals act from the doubt's institute (clientId header), as the admin app sends it. */
    @BeforeEach
    void clientIdHeaderIsDoubtInstitute() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails principal(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName(userId);
        dto.setRootUser(false);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private Doubts existingDoubt(String status, String workflow) {
        return Doubts.builder()
                .id(DOUBT_ID).userId(LEARNER).source("SLIDE").sourceId("slide-1").type("DOUBT")
                .instituteId(INST).packageSessionId(PS).status(status).workflowStatus(workflow)
                .htmlText("q").parentLevel(0)
                .build();
    }

    private static DoubtAssignee activeAssignee(String rowId, String userId) {
        return DoubtAssignee.builder().id(rowId).source("USER").sourceId(userId).status("ACTIVE").build();
    }

    /** Catalog with one custom status on top of the built-ins. */
    private static List<WorkflowStatusConfig> catalogWithInProgress() {
        List<WorkflowStatusConfig> list = new ArrayList<>(DoubtStatusCatalog.defaults());
        list.add(1, WorkflowStatusConfig.builder().key("IN_PROGRESS").label("In progress")
                .learnerLabel("Being looked into").kind("IN_PROGRESS").enabled(true).build());
        return list;
    }

    private void wireUpdate(Doubts doubt, List<DoubtAssignee> existing) {
        when(doubtService.getDoubtById(DOUBT_ID)).thenReturn(Optional.of(doubt));
        when(doubtsAssigneeRepository.findByDoubtIdAndStatusNotIn(eq(DOUBT_ID), anyList())).thenReturn(existing);
        when(doubtService.getStatusCatalog(INST)).thenReturn(catalogWithInProgress());
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private List<DoubtActivity> recordedActivity() {
        ArgumentCaptor<DoubtActivity> captor = ArgumentCaptor.forClass(DoubtActivity.class);
        verify(doubtService, atLeastOnce()).recordActivity(captor.capture());
        return captor.getAllValues();
    }

    private static DoubtActivity only(List<DoubtActivity> rows, String action) {
        List<DoubtActivity> hits = rows.stream().filter(r -> action.equals(r.getAction())).toList();
        assertEquals(1, hits.size(), "expected exactly one " + action + " row, got " + rows);
        return hits.get(0);
    }

    // ---------------------------------------------------------------- creation

    @Test
    @DisplayName("creation: rule-routed assignees are RULE rows naming the rule; a hand-picked id is a USER row")
    void creationRecordsRuleAndManualAssignments() {
        when(facultyMappingRepository.findInstituteIdByPackageSessionId(PS)).thenReturn(Optional.of(INST));
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> {
            Doubts d = inv.getArgument(0);
            d.setId(DOUBT_ID);
            return d;
        });
        when(slideMetaDataService.getSlideMetadataForAdmin(any())).thenReturn(Optional.empty());
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(LEARNER, INST, PS)).thenReturn(List.of());
        // TECHNICAL routes to the ADMIN role.
        Map<String, Object> assignee = new HashMap<>();
        assignee.put("source", "ROLE");
        assignee.put("role", "ADMIN");
        Map<String, Object> type = new HashMap<>();
        type.put("key", "TECHNICAL");
        type.put("assignee", assignee);
        Map<String, Object> setting = new HashMap<>();
        setting.put("query_types", List.of(type));
        when(instituteSettingService.getSettingByInstituteIdAndKey(INST, SETTING_KEY)).thenReturn(setting);
        when(authService.getUserIdsByRole(INST, "ADMIN")).thenReturn(List.of(ADMIN));

        DoubtsDto request = DoubtsDto.builder()
                .source("SLIDE").sourceId("slide-1").type("TECHNICAL").userId(LEARNER).batchId(PS)
                .htmlText("help")
                .doubtAssigneeRequestUserIds(List.of(TEACHER))
                .build();
        manager.updateOrCreateDoubt(principal(LEARNER, "STUDENT"), null, request);

        List<DoubtActivity> rows = recordedActivity();
        DoubtActivity created = only(rows, "CREATED");
        assertEquals("USER", created.getActorType());
        assertEquals(LEARNER, created.getActorUserId());
        assertEquals(DoubtStatusCatalog.PENDING, created.getToValue());

        List<DoubtActivity> assigned = rows.stream().filter(r -> "ASSIGNED".equals(r.getAction())).toList();
        assertEquals(2, assigned.size());
        DoubtActivity byRule = assigned.stream().filter(r -> ADMIN.equals(r.getTargetUserId())).findFirst().orElseThrow();
        assertEquals("RULE", byRule.getActorType());
        assertEquals("TYPE:TECHNICAL:ROLE:ADMIN", byRule.getRuleSource());
        assertNull(byRule.getActorUserId());
        DoubtActivity byHand = assigned.stream().filter(r -> TEACHER.equals(r.getTargetUserId())).findFirst().orElseThrow();
        assertEquals("USER", byHand.getActorType());
        assertEquals(LEARNER, byHand.getActorUserId());
        assertNull(byHand.getRuleSource());
    }

    // ---------------------------------------------------------------- status

    @Test
    @DisplayName("moving to a custom IN_PROGRESS status keeps the doubt ACTIVE and logs STATUS_CHANGED with the remark")
    void customStatusChangeIsLoggedWithRemark() {
        Doubts doubt = existingDoubt("ACTIVE", null);
        wireUpdate(doubt, List.of());

        DoubtsDto request = DoubtsDto.builder().workflowStatus("in_progress").remark("Waiting on the lab file").build();
        manager.updateOrCreateDoubt(principal(TEACHER, "TEACHER"), DOUBT_ID, request);

        assertEquals("IN_PROGRESS", doubt.getWorkflowStatus());
        assertEquals("ACTIVE", doubt.getStatus());
        DoubtActivity row = only(recordedActivity(), "STATUS_CHANGED");
        assertEquals(DoubtStatusCatalog.PENDING, row.getFromValue());
        assertEquals("IN_PROGRESS", row.getToValue());
        assertEquals("Waiting on the lab file", row.getRemark());
        assertEquals(TEACHER, row.getActorUserId());
        verify(doubtNotificationService, never()).notifyDoubtResolved(any(), any());
    }

    @Test
    @DisplayName("moving to the RESOLVED-kind status flips the coarse status, stamps resolved_time and notifies once")
    void resolvedKindStatusResolvesTheDoubt() {
        Doubts doubt = existingDoubt("ACTIVE", "IN_PROGRESS");
        wireUpdate(doubt, List.of());

        manager.updateOrCreateDoubt(principal(ADMIN, "ADMIN"), DOUBT_ID,
                DoubtsDto.builder().workflowStatus("RESOLVED").build());

        assertEquals("RESOLVED", doubt.getStatus());
        assertEquals("RESOLVED", doubt.getWorkflowStatus());
        assertTrue(doubt.getResolvedTime() != null);
        verify(doubtNotificationService).notifyDoubtResolved(eq(doubt), eq(INST));
        DoubtActivity row = only(recordedActivity(), "STATUS_CHANGED");
        assertEquals("IN_PROGRESS", row.getFromValue());
        assertEquals("RESOLVED", row.getToValue());
    }

    @Test
    @DisplayName("legacy status toggle (learner app / admin switch) snaps the workflow key to the built-in")
    void legacyStatusToggleSnapsWorkflowKey() {
        Doubts doubt = existingDoubt("ACTIVE", "IN_PROGRESS");
        wireUpdate(doubt, List.of());

        // The learner app echoes the whole doubt back — workflow_status unchanged, status flipped.
        manager.updateOrCreateDoubt(principal(LEARNER, "STUDENT"), DOUBT_ID,
                DoubtsDto.builder().workflowStatus("IN_PROGRESS").status("RESOLVED").build());
        assertEquals("RESOLVED", doubt.getWorkflowStatus());
        assertEquals("RESOLVED", doubt.getStatus());

        manager.updateOrCreateDoubt(principal(LEARNER, "STUDENT"), DOUBT_ID,
                DoubtsDto.builder().status("ACTIVE").build());
        assertEquals(DoubtStatusCatalog.PENDING, doubt.getWorkflowStatus());
        assertEquals("ACTIVE", doubt.getStatus());
    }

    @Test
    @DisplayName("echoing the current status is a no-op: no STATUS_CHANGED row, no notification")
    void unchangedStatusLogsNothing() {
        Doubts doubt = existingDoubt("ACTIVE", "IN_PROGRESS");
        wireUpdate(doubt, List.of());

        manager.updateOrCreateDoubt(principal(ADMIN, "ADMIN"), DOUBT_ID,
                DoubtsDto.builder().workflowStatus("IN_PROGRESS").status("ACTIVE").htmlText("edited").build());

        verify(doubtService, never()).recordActivity(any());
        assertEquals("edited", doubt.getHtmlText());
    }

    @Test
    @DisplayName("an unknown status key is rejected")
    void unknownStatusRejected() {
        Doubts doubt = existingDoubt("ACTIVE", null);
        wireUpdate(doubt, List.of());

        assertThrows(VacademyException.class, () -> manager.updateOrCreateDoubt(
                principal(ADMIN, "ADMIN"), DOUBT_ID, DoubtsDto.builder().workflowStatus("ESCALATED").build()));
        verify(doubtService, never()).recordActivity(any());
    }

    // ---------------------------------------------------------------- remarks + assignment

    @Test
    @DisplayName("a remark without a status move is logged as REMARK on the current status")
    void remarkAloneIsLogged() {
        Doubts doubt = existingDoubt("ACTIVE", "IN_PROGRESS");
        wireUpdate(doubt, List.of());

        manager.updateOrCreateDoubt(principal(TEACHER, "TEACHER"), DOUBT_ID,
                DoubtsDto.builder().remark("  Called the parent  ").build());

        DoubtActivity row = only(recordedActivity(), "REMARK");
        assertEquals("Called the parent", row.getRemark());
        assertEquals("IN_PROGRESS", row.getToValue());
        assertEquals(TEACHER, row.getActorUserId());
    }

    @Test
    @DisplayName("manual assign / unassign are logged with the actor and the affected user ids")
    void assignAndUnassignAreLogged() {
        Doubts doubt = existingDoubt("ACTIVE", null);
        wireUpdate(doubt, List.of(activeAssignee("row-teacher", TEACHER)));

        manager.updateOrCreateDoubt(principal(ADMIN, "ADMIN"), DOUBT_ID, DoubtsDto.builder()
                .doubtAssigneeRequestUserIds(List.of("teacher-2"))
                .deleteAssigneeRequest(List.of("row-teacher"))
                .build());

        List<DoubtActivity> rows = recordedActivity();
        DoubtActivity assigned = only(rows, "ASSIGNED");
        assertEquals("teacher-2", assigned.getTargetUserId());
        assertEquals(ADMIN, assigned.getActorUserId());
        assertEquals("USER", assigned.getActorType());
        DoubtActivity unassigned = only(rows, "UNASSIGNED");
        assertEquals(TEACHER, unassigned.getTargetUserId());
        assertEquals(ADMIN, unassigned.getActorUserId());
    }

    @Test
    @DisplayName("a learner can still flip ACTIVE ⇄ RESOLVED but cannot set a custom status or leave a remark")
    void learnerKeepsLegacyToggleOnly() {
        Doubts doubt = existingDoubt("ACTIVE", null);
        wireUpdate(doubt, List.of());

        // Custom status from a learner account is refused outright.
        assertThrows(VacademyException.class, () -> manager.updateOrCreateDoubt(
                principal(LEARNER, "STUDENT"), DOUBT_ID, DoubtsDto.builder().workflowStatus("IN_PROGRESS").build()));
        assertEquals("ACTIVE", doubt.getStatus());

        // Built-in via workflow_status or via the legacy status field both still work, and a
        // learner-supplied remark is dropped rather than written into the staff trail.
        manager.updateOrCreateDoubt(principal(LEARNER, "STUDENT"), DOUBT_ID,
                DoubtsDto.builder().workflowStatus("RESOLVED").remark("learner note").build());
        assertEquals("RESOLVED", doubt.getStatus());
        DoubtActivity row = only(recordedActivity(), "STATUS_CHANGED");
        assertNull(row.getRemark());
        verify(doubtNotificationService).notifyDoubtResolved(eq(doubt), eq(INST));
    }

    @Test
    @DisplayName("a custom-role staff member (no ADMIN/TEACHER role) can set custom statuses and remarks")
    void customRoleStaffIsStaff() {
        Doubts doubt = existingDoubt("ACTIVE", null);
        wireUpdate(doubt, List.of());

        manager.updateOrCreateDoubt(principal("eval-1", "EVALUATOR"), DOUBT_ID,
                DoubtsDto.builder().workflowStatus("IN_PROGRESS").remark("checking").build());

        assertEquals("IN_PROGRESS", doubt.getWorkflowStatus());
        assertEquals("checking", only(recordedActivity(), "STATUS_CHANGED").getRemark());
        assertEquals(200, manager.getDoubtActivity(principal("eval-1", "EVALUATOR"), DOUBT_ID).getStatusCode().value());
    }

    // ---------------------------------------------------------------- visibility

    @Test
    @DisplayName("learners cannot read the activity trail; teachers can")
    void activityTrailIsStaffOnly() {
        when(doubtService.getDoubtById(DOUBT_ID)).thenReturn(Optional.of(existingDoubt("ACTIVE", null)));
        when(doubtService.getActivity(DOUBT_ID)).thenReturn(List.of());

        assertThrows(VacademyException.class,
                () -> manager.getDoubtActivity(principal(LEARNER, "STUDENT"), DOUBT_ID));
        assertEquals(200, manager.getDoubtActivity(principal(TEACHER, "TEACHER"), DOUBT_ID).getStatusCode().value());
    }
}
