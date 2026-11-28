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

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Drives {@link DoubtsManager#updateOrCreateDoubt} through the sub-org routing branches and asserts
 * the FINAL recipient list handed to {@link DoubtNotificationService#notifyDoubtRaised} — i.e. who
 * actually gets the email/push/bell. Guards the business rules:
 *   • exclusive mode notifies ONLY sub-org staff and SKIPS the parent cascade;
 *   • additive (default) mode notifies parent staff AND sub-org staff;
 *   • a non-sub-org learner behaves exactly as before (parent only, no sub-org lookups);
 *   • the master switch (enabled=false) disables sub-org routing entirely.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DoubtsManagerSubOrgRoutingTest {

    private static final String PS = "ps-1";
    private static final String INST = "inst-1";
    private static final String LEARNER = "learner-1";
    private static final String DOUBT_ID = "doubt-1";
    private static final String SETTING_KEY = "DOUBT_MANAGEMENT_SETTING";
    private static final String PARENT_TEACHER = "parent-teacher-1";

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

    private DoubtsDto slideDoubtRequest() {
        return DoubtsDto.builder()
                .source("SLIDE").sourceId("slide-1")
                .userId(LEARNER).batchId(PS).htmlText("please help")
                .build();
    }

    /** Common stubs: institute derived from the batch, save echoes the entity back with an id. */
    private void wireCommon() {
        when(facultyMappingRepository.findInstituteIdByPackageSessionId(PS))
                .thenReturn(Optional.of(INST));
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> {
            Doubts d = inv.getArgument(0);
            d.setId(DOUBT_ID);
            return d;
        });
        // Non-slide-subject metadata is irrelevant here; empty means "no subject narrowing".
        when(slideMetaDataService.getSlideMetadataForAdmin(any())).thenReturn(Optional.empty());
    }

    private void wireParentBatchTeacher() {
        FacultySubjectPackageSessionMapping m = new FacultySubjectPackageSessionMapping();
        m.setUserId(PARENT_TEACHER);
        m.setStatus("ACTIVE");
        when(facultyMappingRepository.findRealTeachersByPackageSessionId(PS))
                .thenReturn(List.of(m));
    }

    private void wireSetting(Boolean enabled, String recipients, Boolean notifyParentStaff) {
        Map<String, Object> subOrg = new HashMap<>();
        if (enabled != null) subOrg.put("enabled", enabled);
        if (recipients != null) subOrg.put("recipients", recipients);
        if (notifyParentStaff != null) subOrg.put("notify_parent_staff", notifyParentStaff);
        Map<String, Object> setting = new HashMap<>();
        setting.put("sub_org_notifications", subOrg);
        when(instituteSettingService.getSettingByInstituteIdAndKey(INST, SETTING_KEY))
                .thenReturn(setting);
    }

    @SuppressWarnings("unchecked")
    private List<String> captureRaisedRecipients() {
        ArgumentCaptor<List<String>> captor = ArgumentCaptor.forClass(List.class);
        verify(doubtNotificationService).notifyDoubtRaised(any(Doubts.class), captor.capture(), eq(INST));
        return captor.getValue();
    }

    @Test
    @DisplayName("exclusive mode: only sub-org staff notified, parent cascade skipped")
    void exclusiveModeNotifiesOnlySubOrgStaff() {
        wireCommon();
        wireSetting(true, "ADMINS_ONLY", /* notify_parent_staff */ false);
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(LEARNER, INST, PS))
                .thenReturn(List.of("so-1"));
        when(subOrgStaffLookupService.resolveStaffUserIds(List.of("so-1"),
                SubOrgStaffLookupService.Audience.ADMINS_ONLY))
                .thenReturn(new ArrayList<>(List.of("so-admin-1")));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest());

        assertEquals(List.of("so-admin-1"), captureRaisedRecipients());
        // The whole point of exclusive mode: the parent institute's batch cascade must NOT run.
        verify(facultyMappingRepository, never()).findRealTeachersByPackageSessionId(any());
        verify(subOrgStaffLookupService).resolveStaffUserIds(any(),
                eq(SubOrgStaffLookupService.Audience.ADMINS_ONLY));
    }

    @Test
    @DisplayName("additive mode (default): parent staff AND sub-org staff notified")
    void additiveModeNotifiesBoth() {
        wireCommon();
        wireParentBatchTeacher();
        wireSetting(true, "ALL_TEAM", /* notify_parent_staff */ true);
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(LEARNER, INST, PS))
                .thenReturn(List.of("so-1"));
        when(subOrgStaffLookupService.resolveStaffUserIds(List.of("so-1"),
                SubOrgStaffLookupService.Audience.ALL_TEAM))
                .thenReturn(new ArrayList<>(List.of("so-staff-1")));

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest());

        List<String> recipients = captureRaisedRecipients();
        assertTrue(recipients.contains(PARENT_TEACHER), "parent teacher must still be notified");
        assertTrue(recipients.contains("so-staff-1"), "sub-org staff must be added");
        assertEquals(2, recipients.size());
        verify(facultyMappingRepository).findRealTeachersByPackageSessionId(PS);
    }

    @Test
    @DisplayName("non-sub-org learner: parent only, no sub-org staff lookup at all")
    void nonSubOrgLearnerParentOnly() {
        wireCommon();
        wireParentBatchTeacher();
        // No stored setting → defaults; learner belongs to no sub-org.
        when(instituteSettingService.getSettingByInstituteIdAndKey(INST, SETTING_KEY)).thenReturn(null);
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(LEARNER, INST, PS))
                .thenReturn(List.of());

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest());

        assertEquals(List.of(PARENT_TEACHER), captureRaisedRecipients());
        // Never resolves sub-org staff when the raiser has no sub-org linkage.
        verify(subOrgStaffLookupService, never()).resolveStaffUserIds(any(), any());
    }

    @Test
    @DisplayName("master switch off (enabled=false): sub-org routing fully disabled, parent only")
    void masterSwitchOffDisablesSubOrgRouting() {
        wireCommon();
        wireParentBatchTeacher();
        wireSetting(/* enabled */ false, "ALL_TEAM", false);

        manager.updateOrCreateDoubt(learner(), null, slideDoubtRequest());

        assertEquals(List.of(PARENT_TEACHER), captureRaisedRecipients());
        // enabled=false short-circuits before any sub-org lookup runs.
        verify(subOrgStaffLookupService, never()).resolveLearnerSubOrgIds(any(), any(), any());
        verify(subOrgStaffLookupService, never()).resolveStaffUserIds(any(), any());
    }
}
