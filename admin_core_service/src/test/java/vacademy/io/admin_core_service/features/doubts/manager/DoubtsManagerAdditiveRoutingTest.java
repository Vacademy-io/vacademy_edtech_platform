package vacademy.io.admin_core_service.features.doubts.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsDto;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsAssigneeRepository;
import vacademy.io.admin_core_service.features.doubts.service.DoubtService;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.slide.service.SlideMetaDataService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgStaffLookupService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Per-type routing used to pick a single winner: choosing "subject teacher" meant the institute
 * could not ALSO pin a fixed set of handlers on the type. {@code also_user_ids} / {@code also_roles}
 * make the result a union of the base route plus those handlers, which is what these tests pin.
 *
 * <p>The subtle part is the admin safety net. It exists so a doubt is never dropped, but once an
 * admin has named explicit additional handlers, widening to every admin would notify exactly the
 * people they routed around — so the net only fires when the whole union is empty.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DoubtsManagerAdditiveRoutingTest {

    private static final String PS = "ps-1";
    private static final String INST = "inst-1";
    private static final String LEARNER = "learner-1";
    private static final String DOUBT_ID = "doubt-1";
    private static final String SETTING_KEY = "DOUBT_MANAGEMENT_SETTING";
    private static final String ADMIN_ROLE = "ADMIN";
    private static final String TEACHER = "teacher-1";
    private static final String STAFF_A = "staff-a";
    private static final String STAFF_B = "staff-b";
    private static final String ADMIN_A = "admin-a";

    @Mock private DoubtService doubtService;
    @Mock private FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    @Mock private InstituteSettingService instituteSettingService;
    @Mock private SlideMetaDataService slideMetaDataService;
    @Mock private DoubtNotificationService doubtNotificationService;
    @Mock private DoubtsAssigneeRepository doubtsAssigneeRepository;
    @Mock private AuthService authService;
    @Mock private WorkflowTriggerService workflowTriggerService;
    @Mock private SubOrgStaffLookupService subOrgStaffLookupService;

    @InjectMocks private DoubtsManager manager;

    /** The learner raising the doubt — doubts/create raises it as the authenticated caller. */
    private static CustomUserDetails learner() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(LEARNER);
        dto.setUsername(LEARNER);
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private DoubtsDto slideDoubtRequest(String type) {
        return DoubtsDto.builder()
                .source("SLIDE").sourceId("slide-1").type(type)
                .userId(LEARNER).batchId(PS).htmlText("please help")
                .build();
    }

    private void wireCommon() {
        when(facultyMappingRepository.findInstituteIdByPackageSessionId(PS)).thenReturn(Optional.of(INST));
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> {
            Doubts d = inv.getArgument(0);
            d.setId(DOUBT_ID);
            return d;
        });
        when(slideMetaDataService.getSlideMetadataForAdmin(any())).thenReturn(Optional.empty());
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(LEARNER, INST, PS)).thenReturn(List.of());
    }

    private void wireSetting(String defaultSource, List<Map<String, Object>> queryTypes) {
        Map<String, Object> setting = new HashMap<>();
        if (defaultSource != null) setting.put("default_assignee_source", defaultSource);
        if (queryTypes != null) setting.put("query_types", queryTypes);
        when(instituteSettingService.getSettingByInstituteIdAndKey(INST, SETTING_KEY)).thenReturn(setting);
    }

    /** A query type whose assignee block carries any mix of source / also_user_ids / also_roles. */
    private static Map<String, Object> queryType(String key, String source,
                                                 List<String> alsoUserIds, List<String> alsoRoles) {
        Map<String, Object> assignee = new HashMap<>();
        if (source != null) assignee.put("source", source);
        if (alsoUserIds != null) assignee.put("also_user_ids", alsoUserIds);
        if (alsoRoles != null) assignee.put("also_roles", alsoRoles);
        Map<String, Object> type = new HashMap<>();
        type.put("key", key);
        type.put("assignee", assignee);
        return type;
    }

    private void wireBatchTeacher() {
        FacultySubjectPackageSessionMapping mapping = new FacultySubjectPackageSessionMapping();
        mapping.setUserId(TEACHER);
        mapping.setStatus("ACTIVE");
        when(facultyMappingRepository.findRealTeachersByPackageSessionId(PS)).thenReturn(List.of(mapping));
    }

    @SuppressWarnings("unchecked")
    private List<String> captureRaisedRecipients() {
        ArgumentCaptor<List<String>> captor = ArgumentCaptor.forClass(List.class);
        verify(doubtNotificationService).notifyDoubtRaised(any(Doubts.class), captor.capture(), eq(INST));
        return captor.getValue();
    }

    @Test
    @DisplayName("batch teacher AND the named staff are both assigned")
    void facultyCascadeUnionsWithNamedStaff() {
        wireCommon();
        wireBatchTeacher();
        wireSetting("SUBJECT_TEACHER",
                List.of(queryType("DOUBT", "BATCH_TEACHER", List.of(STAFF_A, STAFF_B), null)));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(TEACHER, STAFF_A, STAFF_B), captureRaisedRecipients());
    }

    @Test
    @DisplayName("also_roles adds everyone holding that role on top of the base route")
    void roleHoldersAreAddedOnTop() {
        wireCommon();
        wireBatchTeacher();
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of(ADMIN_A));
        wireSetting("BATCH_TEACHER",
                List.of(queryType("TECHNICAL", "BATCH_TEACHER", null, List.of(ADMIN_ROLE))));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("TECHNICAL"));

        assertEquals(List.of(TEACHER, ADMIN_A), captureRaisedRecipients());
    }

    @Test
    @DisplayName("a person named both explicitly and via a role is assigned once")
    void duplicatesCollapse() {
        wireCommon();
        wireBatchTeacher();
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of(STAFF_A, ADMIN_A));
        wireSetting("BATCH_TEACHER",
                List.of(queryType("DOUBT", "BATCH_TEACHER", List.of(STAFF_A), List.of(ADMIN_ROLE))));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(TEACHER, STAFF_A, ADMIN_A), captureRaisedRecipients());
    }

    @Test
    @DisplayName("no faculty mapped: the named staff carry it alone, admins are NOT pulled in")
    void namedStaffSuppressTheAdminSafetyNet() {
        wireCommon();
        when(facultyMappingRepository.findRealTeachersByPackageSessionId(PS)).thenReturn(List.of());
        wireSetting("BATCH_TEACHER",
                List.of(queryType("DOUBT", "BATCH_TEACHER", List.of(STAFF_A), null)));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(STAFF_A), captureRaisedRecipients());
        verify(authService, never()).getUserIdsByRole(any(), any());
    }

    @Test
    @DisplayName("a blank source keeps the institute default as the base and adds the staff to it")
    void blankSourceKeepsGlobalDefaultAsBase() {
        wireCommon();
        wireBatchTeacher();
        wireSetting("BATCH_TEACHER", List.of(queryType("DOUBT", null, List.of(STAFF_A), null)));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(TEACHER, STAFF_A), captureRaisedRecipients());
    }

    @Test
    @DisplayName("SPECIFIC_USERS still means only those users when nothing additive is configured")
    void legacySpecificUsersUnchanged() {
        wireCommon();
        wireBatchTeacher();
        Map<String, Object> type = queryType("PAYMENT", "SPECIFIC_USERS", null, null);
        @SuppressWarnings("unchecked")
        Map<String, Object> assignee = (Map<String, Object>) type.get("assignee");
        assignee.put("user_ids", List.of(STAFF_A));
        wireSetting("BATCH_TEACHER", List.of(type));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("PAYMENT"));

        // The teacher must NOT leak in — the union only widens when also_* is configured.
        assertEquals(List.of(STAFF_A), captureRaisedRecipients());
        verify(authService, never()).getUserIdsByRole(any(), any());
    }

    @Test
    @DisplayName("an unknown key written by a newer frontend does not cost the institute its routing")
    void unknownSettingKeyIsIgnored() {
        wireCommon();
        wireBatchTeacher();
        Map<String, Object> type = queryType("DOUBT", "BATCH_TEACHER", List.of(STAFF_A), null);
        type.put("some_future_flag", true);
        Map<String, Object> setting = new HashMap<>();
        setting.put("default_assignee_source", "BATCH_TEACHER");
        setting.put("query_types", List.of(type));
        setting.put("another_future_block", Map.of("x", 1));
        when(instituteSettingService.getSettingByInstituteIdAndKey(INST, SETTING_KEY)).thenReturn(setting);

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        // Strict Jackson would throw here, the caller would swallow it as "no setting", and the
        // whole per-type config would vanish — the named handler is the proof it survived.
        assertEquals(List.of(TEACHER, STAFF_A), captureRaisedRecipients());
    }

    @Test
    @DisplayName("everything resolves to nobody: the admin safety net still fires")
    void emptyUnionFallsBackToAdmins() {
        wireCommon();
        when(facultyMappingRepository.findRealTeachersByPackageSessionId(PS)).thenReturn(List.of());
        when(authService.getUserIdsByRole(INST, "EVALUATOR")).thenReturn(List.of());
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of(ADMIN_A));
        wireSetting("BATCH_TEACHER",
                List.of(queryType("DOUBT", "BATCH_TEACHER", null, List.of("EVALUATOR"))));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(ADMIN_A), captureRaisedRecipients());
    }
}
