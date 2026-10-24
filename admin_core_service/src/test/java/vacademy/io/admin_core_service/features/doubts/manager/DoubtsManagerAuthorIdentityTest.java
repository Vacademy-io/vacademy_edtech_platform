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

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@code POST /institute/v1/doubts/create} used to store the body's {@code user_id} as-is, so any
 * logged-in user could raise a doubt as anyone else. These tests pin who the doubt is raised as:
 * <ul>
 *   <li>a learner is always raised as themselves, whatever id the body carries;</li>
 *   <li>staff of the doubt's institute may raise it on a learner's behalf (body id kept);</li>
 *   <li>staff of ANOTHER institute, a STUDENT + TEACHER self-signup learner, and a root-flagged
 *       learner are raised as themselves;</li>
 *   <li>a doubt whose institute can't be resolved falls back to the caller.</li>
 * </ul>
 * The real {@link InstituteAccessValidator} decides staff; the clientId header is set per test.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DoubtsManagerAuthorIdentityTest {

    private static final String PS = "ps-1";
    private static final String INST = "inst-1";
    private static final String OTHER_INST = "inst-2";
    private static final String LEARNER = "learner-1";
    private static final String VICTIM = "learner-2";
    private static final String TEACHER = "teacher-1";

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

    @BeforeEach
    void wireCreation() {
        when(facultyMappingRepository.findInstituteIdByPackageSessionId(PS)).thenReturn(Optional.of(INST));
        when(doubtService.updateOrCreateDoubt(any(Doubts.class))).thenAnswer(inv -> {
            Doubts d = inv.getArgument(0);
            d.setId("doubt-1");
            return d;
        });
        when(slideMetaDataService.getSlideMetadataForAdmin(any())).thenReturn(Optional.empty());
        when(subOrgStaffLookupService.resolveLearnerSubOrgIds(any(), any(), any())).thenReturn(List.of());
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** auth_service mints the authorities for the institute in the clientId header. */
    private static void clientIdHeader(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails principal(String userId, boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName(userId);
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static DoubtsDto slideDoubtAs(String userId) {
        return DoubtsDto.builder()
                .source("SLIDE").sourceId("slide-1").type("DOUBT").userId(userId).batchId(PS)
                .htmlText("help")
                .build();
    }

    private String savedAuthor() {
        ArgumentCaptor<Doubts> captor = ArgumentCaptor.forClass(Doubts.class);
        verify(doubtService, atLeastOnce()).updateOrCreateDoubt(captor.capture());
        return captor.getAllValues().get(0).getUserId();
    }

    @Test
    @DisplayName("a learner sending another learner's user_id is raised as themselves")
    void learnerSpoofIsForcedToSelf() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(LEARNER, false, "STUDENT"), null, slideDoubtAs(VICTIM));
        assertEquals(LEARNER, savedAuthor());
    }

    @Test
    @DisplayName("a learner sending their own user_id keeps it")
    void learnerOwnIdKept() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(LEARNER, false, "STUDENT"), null, slideDoubtAs(LEARNER));
        assertEquals(LEARNER, savedAuthor());
    }

    @Test
    @DisplayName("a blank user_id is filled with the caller's id")
    void blankIdIsCaller() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(TEACHER, false, "TEACHER"), null, slideDoubtAs(""));
        assertEquals(TEACHER, savedAuthor());
    }

    @Test
    @DisplayName("STUDENT + TEACHER (self-signup learner) is still a learner -> forced to self")
    void studentTeacherIsForcedToSelf() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(LEARNER, false, "STUDENT", "TEACHER"), null, slideDoubtAs(VICTIM));
        assertEquals(LEARNER, savedAuthor());
    }

    @Test
    @DisplayName("a root-flagged learner gets no bypass -> forced to self")
    void rootLearnerIsForcedToSelf() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(LEARNER, true, "STUDENT"), null, slideDoubtAs(VICTIM));
        assertEquals(LEARNER, savedAuthor());
    }

    @Test
    @DisplayName("staff of the doubt's institute may raise it on a learner's behalf")
    void staffOfInstituteKeepsBodyId() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(TEACHER, false, "TEACHER"), null, slideDoubtAs(LEARNER));
        assertEquals(LEARNER, savedAuthor());
    }

    @Test
    @DisplayName("a COUNSELLOR also enrolled as STUDENT is staff -> body id kept")
    void counsellorEnrolledAsStudentKeepsBodyId() {
        clientIdHeader(INST);
        manager.updateOrCreateDoubt(principal(TEACHER, false, "STUDENT", "COUNSELLOR"), null, slideDoubtAs(LEARNER));
        assertEquals(LEARNER, savedAuthor());
    }

    @Test
    @DisplayName("staff of a DIFFERENT institute is raised as themselves")
    void staffOfOtherInstituteIsForcedToSelf() {
        clientIdHeader(OTHER_INST);
        manager.updateOrCreateDoubt(principal(TEACHER, false, "ADMIN"), null, slideDoubtAs(LEARNER));
        assertEquals(TEACHER, savedAuthor());
    }

    @Test
    @DisplayName("a reply whose parent (and so institute) can't be resolved falls back to the caller")
    void unresolvedInstituteIsCaller() {
        clientIdHeader(INST);
        when(doubtService.getDoubtById("missing-parent")).thenReturn(Optional.empty());
        DoubtsDto reply = DoubtsDto.builder()
                .source("SLIDE").sourceId("slide-1").userId(LEARNER).parentId("missing-parent").parentLevel(1)
                .htmlText("re")
                .build();
        manager.updateOrCreateDoubt(principal(TEACHER, false, "ADMIN"), null, reply);
        assertEquals(TEACHER, savedAuthor());
    }

    @Test
    @DisplayName("resolveAuthorUserId: staff of the institute with no institute id is refused the body id")
    void noInstituteIdIsCaller() {
        clientIdHeader(INST);
        assertEquals(TEACHER, manager.resolveAuthorUserId(principal(TEACHER, false, "ADMIN"), LEARNER, null));
    }
}
