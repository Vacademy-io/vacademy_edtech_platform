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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers the admin-fallback leg of doubt routing — the one that decides whether an institute on
 * {@code default_assignee_source=NONE} actually gets its doubt emails.
 *
 * <p>Two settings share the word "NONE" and behave in opposite ways; both are pinned here:</p>
 * <ul>
 *   <li>global {@code default_assignee_source=NONE} → skip teachers, assign + notify the ADMINs;</li>
 *   <li>per-type {@code query_types[].assignee.source=NONE} → assign nobody, notify nobody.</li>
 * </ul>
 *
 * <p>Also guards the retry added after a prod incident: the ADMIN role lookup is the ONLY recipient
 * source under NONE routing, and {@link AuthService#getUserIdsByRole} reports a transport failure and
 * a genuinely-empty role identically (empty list). Without the retry a single blip silently cost the
 * doubt every recipient — no email, no push, no bell.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DoubtsManagerAdminFallbackTest {

    private static final String PS = "ps-1";
    private static final String INST = "inst-1";
    private static final String LEARNER = "learner-1";
    private static final String DOUBT_ID = "doubt-1";
    private static final String SETTING_KEY = "DOUBT_MANAGEMENT_SETTING";
    private static final String ADMIN_ROLE = "ADMIN";
    private static final String ADMIN_A = "admin-a";
    private static final String ADMIN_B = "admin-b";
    /** Mirrors DoubtsManager.ROLE_LOOKUP_ATTEMPTS — the retry budget for one role lookup. */
    private static final int ROLE_LOOKUP_ATTEMPTS = 2;

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

    /** Institute derived from the batch; save echoes the entity back with an id; raiser has no sub-org. */
    private void wireCommon() {
        when(facultyMappingRepository.findInstituteIdByPackageSessionId(PS))
                .thenReturn(Optional.of(INST));
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> {
            Doubts d = inv.getArgument(0);
            d.setId(DOUBT_ID);
            return d;
        });
        when(slideMetaDataService.getSlideMetadataForAdmin(any())).thenReturn(Optional.empty());
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(LEARNER, INST, PS)).thenReturn(List.of());
    }

    /** Stores a DOUBT_MANAGEMENT_SETTING blob with the given global source and optional per-type routing. */
    private void wireSetting(String defaultSource, List<Map<String, Object>> queryTypes) {
        Map<String, Object> setting = new HashMap<>();
        if (defaultSource != null) setting.put("default_assignee_source", defaultSource);
        if (queryTypes != null) setting.put("query_types", queryTypes);
        when(instituteSettingService.getSettingByInstituteIdAndKey(INST, SETTING_KEY)).thenReturn(setting);
    }

    private static Map<String, Object> queryType(String key, String assigneeSource) {
        Map<String, Object> assignee = new HashMap<>();
        assignee.put("source", assigneeSource);
        Map<String, Object> type = new HashMap<>();
        type.put("key", key);
        type.put("assignee", assignee);
        return type;
    }

    private static Map<String, Object> queryTypeWithRole(String key, String role) {
        Map<String, Object> type = queryType(key, "ROLE");
        @SuppressWarnings("unchecked")
        Map<String, Object> assignee = (Map<String, Object>) type.get("assignee");
        assignee.put("role", role);
        return type;
    }

    @SuppressWarnings("unchecked")
    private List<String> captureRaisedRecipients() {
        ArgumentCaptor<List<String>> captor = ArgumentCaptor.forClass(List.class);
        verify(doubtNotificationService).notifyDoubtRaised(any(Doubts.class), captor.capture(), eq(INST));
        return captor.getValue();
    }

    @Test
    @DisplayName("global NONE: teachers skipped, every institute ADMIN assigned and notified")
    void globalNoneRoutesToAdmins() {
        wireCommon();
        wireSetting("NONE", null);
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of(ADMIN_A, ADMIN_B));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(ADMIN_A, ADMIN_B), captureRaisedRecipients());
        // NONE means "skip teachers" — the faculty cascade must not run at all.
        verify(facultyMappingRepository, never()).findRealTeachersByPackageSessionId(any());
    }

    @Test
    @DisplayName("transient auth failure on the admin lookup is retried, so admins still get notified")
    void adminLookupRetriedAfterTransientFailure() {
        wireCommon();
        wireSetting("NONE", null);
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE))
                .thenThrow(new RuntimeException("auth_service timeout"))
                .thenReturn(List.of(ADMIN_A));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(ADMIN_A), captureRaisedRecipients());
        verify(authService, times(2)).getUserIdsByRole(INST, ADMIN_ROLE);
    }

    @Test
    @DisplayName("an empty first result is retried too (a failed lookup is indistinguishable from an empty role)")
    void emptyAdminLookupIsRetried() {
        wireCommon();
        wireSetting("NONE", null);
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE))
                .thenReturn(List.of())
                .thenReturn(List.of(ADMIN_A));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        assertEquals(List.of(ADMIN_A), captureRaisedRecipients());
        verify(authService, times(2)).getUserIdsByRole(INST, ADMIN_ROLE);
    }

    @Test
    @DisplayName("admin lookup empty on every attempt: nobody notified, and it is not retried forever")
    void exhaustedAdminLookupNotifiesNobody() {
        wireCommon();
        wireSetting("NONE", null);
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of());

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("DOUBT"));

        verify(doubtNotificationService, never()).notifyDoubtRaised(any(), any(), any());
        verify(authService, times(2)).getUserIdsByRole(INST, ADMIN_ROLE);
    }

    @Test
    @DisplayName("per-type NONE: nobody assigned, nobody notified, admin lookup never attempted")
    void perTypeNoneNotifiesNobody() {
        wireCommon();
        wireSetting("BATCH_TEACHER", List.of(queryType("TECHNICAL", "NONE")));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("TECHNICAL"));

        verify(doubtNotificationService, never()).notifyDoubtRaised(any(), any(), any());
        // Unlike the global NONE, this path deliberately skips the admin safety net entirely.
        verify(authService, never()).getUserIdsByRole(any(), any());
    }

    @Test
    @DisplayName("per-type ROLE resolving to nobody still falls back to admins")
    void perTypeRoleFallsBackToAdmins() {
        wireCommon();
        wireSetting("BATCH_TEACHER", List.of(queryTypeWithRole("SUPPORT", "EVALUATOR")));
        when(authService.getUserIdsByRole(INST, "EVALUATOR")).thenReturn(List.of());
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of(ADMIN_A));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("SUPPORT"));

        assertEquals(List.of(ADMIN_A), captureRaisedRecipients());
    }

    @Test
    @DisplayName("per-type ROLE=ADMIN empty: admin fallback not re-run, so the lookup is not doubled")
    void perTypeAdminRoleDoesNotDoubleTheLookup() {
        wireCommon();
        // EduStream's real config for TECHNICAL/PAYMENT: {source: ROLE, role: ADMIN}.
        wireSetting("BATCH_TEACHER", List.of(queryTypeWithRole("PAYMENT", ADMIN_ROLE)));
        when(authService.getUserIdsByRole(INST, ADMIN_ROLE)).thenReturn(List.of());

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest("PAYMENT"));

        verify(doubtNotificationService, never()).notifyDoubtRaised(any(), any(), any());
        // ROLE=ADMIN + resolveAdminFallback would be the same call twice; with retries that is 4
        // requests for one doubt. Capped at the retry budget instead.
        verify(authService, times(ROLE_LOOKUP_ATTEMPTS)).getUserIdsByRole(INST, ADMIN_ROLE);
    }
}
