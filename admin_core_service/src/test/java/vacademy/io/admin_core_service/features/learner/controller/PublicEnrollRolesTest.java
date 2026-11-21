package vacademy.io.admin_core_service.features.learner.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.enroll_invite.controller.OpenEnrollmentFormController;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitDTO;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollmentFormService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.learner.controller.v2.MultiPackageLearnerEnrollController;
import vacademy.io.admin_core_service.features.learner.dto.OpenLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.MultiPackageLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.service.AdditionalChargeValidator;
import vacademy.io.admin_core_service.features.learner.service.LearnerEnrollRequestService;
import vacademy.io.admin_core_service.features.learner.service.MultiPackageLearnerEnrollService;
import vacademy.io.admin_core_service.features.learner.service.OpenLearnerEnrollService;
import vacademy.io.admin_core_service.features.learner.service.PublicEnrollRoleGuard;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The enrol routes that need no login hand their body's user to auth-service, which saves the
 * role names it carries. Whatever the body names, only learner roles leave each of the four
 * public doors.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PublicEnrollRolesTest {

    private static final String PLAIN = "inst-plain";
    private static final String AUTHORS = "inst-learner-authors";
    private static final String LEARNERS_CREATE_COURSES =
            "{\"setting\":{\"COURSE_SETTING\":{\"data\":{\"permissions\":{\"allowLearnersToCreateCourses\":true}}}}}";

    @Mock InstituteRepository instituteRepository;
    @Mock LearnerEnrollRequestService learnerEnrollRequestService;
    @Mock OpenLearnerEnrollService openLearnerEnrollService;
    @Mock AdditionalChargeValidator additionalChargeValidator;
    @Mock MultiPackageLearnerEnrollService multiPackageLearnerEnrollService;
    @Mock EnrollmentFormService enrollmentFormService;

    PublicEnrollRoleGuard guard;

    @BeforeEach
    void setUp() {
        guard = new PublicEnrollRoleGuard();
        ReflectionTestUtils.setField(guard, "instituteRepository", instituteRepository);
        Institute plain = new Institute();
        plain.setSetting("{\"setting\":{}}");
        Institute authors = new Institute();
        authors.setSetting(LEARNERS_CREATE_COURSES);
        when(instituteRepository.findById(PLAIN)).thenReturn(Optional.of(plain));
        when(instituteRepository.findById(AUTHORS)).thenReturn(Optional.of(authors));
    }

    private static UserDTO user(String... roles) {
        UserDTO user = new UserDTO();
        user.setEmail("new@example.com");
        user.setFullName("Asha Rao");
        user.setRoles(roles == null ? null : new ArrayList<>(Arrays.asList(roles)));
        return user;
    }

    private List<String> reduced(String instituteId, String... roles) {
        UserDTO user = user(roles);
        guard.restrictToLearnerRoles(user, instituteId);
        return user.getRoles();
    }

    // ── the rule ────────────────────────────────────────────────────────────

    @Test
    void staffSystemAndCustomRoleNamesAreDropped() {
        assertEquals(List.of(), reduced(PLAIN, "ADMIN"));
        assertEquals(List.of("STUDENT"), reduced(PLAIN, "ADMIN", "STUDENT", "EVALUATOR", "My Custom Role"));
        assertEquals(List.of("STUDENT"), reduced(PLAIN, " admin ", "Student", "ＡＤＭＩＮ", null));
    }

    @Test
    void teacherIsKeptOnlyWhereTheInstituteLetsLearnersCreateCourses() {
        assertEquals(List.of("STUDENT", "TEACHER"), reduced(AUTHORS, "STUDENT", "TEACHER"));
        assertEquals(List.of("STUDENT"), reduced(PLAIN, "STUDENT", "TEACHER"));
        assertEquals(List.of("STUDENT"), reduced("no-such-institute", "STUDENT", "TEACHER"));
        assertEquals(List.of("STUDENT"), reduced(null, "STUDENT", "TEACHER"));
    }

    @Test
    void whatRealCallersSendIsUnchanged() {
        assertEquals(List.of("STUDENT"), reduced(PLAIN, "STUDENT"));
        assertEquals(List.of(), reduced(PLAIN));
        assertNull(reduced(PLAIN, (String[]) null));
        guard.restrictToLearnerRoles(null, PLAIN);
    }

    // ── each public door uses it before anything else sees the body ─────────

    @Test
    void v1EnrollReducesTheBodyBeforeTheService() {
        LearnerEnrollRequestController controller = new LearnerEnrollRequestController();
        ReflectionTestUtils.setField(controller, "learnerEnrollRequestService", learnerEnrollRequestService);
        ReflectionTestUtils.setField(controller, "openLearnerEnrollService", openLearnerEnrollService);
        ReflectionTestUtils.setField(controller, "additionalChargeValidator", additionalChargeValidator);
        ReflectionTestUtils.setField(controller, "publicEnrollRoleGuard", guard);
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setInstituteId(PLAIN);
        request.setUser(user("ADMIN", "STUDENT"));

        controller.enrollLearner(request);

        ArgumentCaptor<LearnerEnrollRequestDTO> sent = ArgumentCaptor.forClass(LearnerEnrollRequestDTO.class);
        verify(learnerEnrollRequestService).recordLearnerRequest(sent.capture(), anyMap());
        assertEquals(List.of("STUDENT"), sent.getValue().getUser().getRoles());
    }

    @Test
    void v1EnrollDetailReducesTheBodyBeforeTheService() {
        LearnerEnrollRequestController controller = new LearnerEnrollRequestController();
        ReflectionTestUtils.setField(controller, "openLearnerEnrollService", openLearnerEnrollService);
        ReflectionTestUtils.setField(controller, "publicEnrollRoleGuard", guard);
        OpenLearnerEnrollRequestDTO request = new OpenLearnerEnrollRequestDTO();
        request.setUserDTO(user("ADMIN"));

        controller.enrollLearnerDetail(request, PLAIN);

        ArgumentCaptor<OpenLearnerEnrollRequestDTO> sent = ArgumentCaptor.forClass(OpenLearnerEnrollRequestDTO.class);
        verify(openLearnerEnrollService).enrollUserInPackageSession(sent.capture(), eq(PLAIN));
        assertEquals(List.of(), sent.getValue().getUserDTO().getRoles());
    }

    @Test
    void v2EnrollReducesTheBodyBeforeTheService() {
        MultiPackageLearnerEnrollController controller = new MultiPackageLearnerEnrollController();
        ReflectionTestUtils.setField(controller, "multiPackageLearnerEnrollService", multiPackageLearnerEnrollService);
        ReflectionTestUtils.setField(controller, "publicEnrollRoleGuard", guard);
        MultiPackageLearnerEnrollRequestDTO request = new MultiPackageLearnerEnrollRequestDTO();
        request.setInstituteId(AUTHORS);
        request.setUser(user("TEACHER", "ADMIN", "STUDENT"));

        controller.enrollMultiPackage(request);

        ArgumentCaptor<MultiPackageLearnerEnrollRequestDTO> sent =
                ArgumentCaptor.forClass(MultiPackageLearnerEnrollRequestDTO.class);
        verify(multiPackageLearnerEnrollService).enrollMultiPackage(sent.capture());
        assertEquals(List.of("TEACHER", "STUDENT"), sent.getValue().getUser().getRoles());
    }

    @Test
    void enrollmentFormReducesTheBodyBeforeTheService() {
        OpenEnrollmentFormController controller = new OpenEnrollmentFormController();
        ReflectionTestUtils.setField(controller, "enrollmentFormService", enrollmentFormService);
        ReflectionTestUtils.setField(controller, "publicEnrollRoleGuard", guard);
        EnrollmentFormSubmitDTO request = new EnrollmentFormSubmitDTO();
        request.setInstituteId(PLAIN);
        request.setUserDetails(user("ADMIN", "STUDENT"));

        controller.submitEnrollmentForm(request);

        ArgumentCaptor<EnrollmentFormSubmitDTO> sent = ArgumentCaptor.forClass(EnrollmentFormSubmitDTO.class);
        verify(enrollmentFormService).submitEnrollmentForm(sent.capture());
        assertEquals(List.of("STUDENT"), sent.getValue().getUserDetails().getRoles());
    }

    // ── a lead form grants no staff role ────────────────────────────────────

    @Test
    void aLeadKeepsTheLearnerRoleOnly() {
        UserDTO lead = user("ADMIN", "STUDENT", "TEACHER", "COUNSELLOR");
        PublicEnrollRoleGuard.keepLearnerRoleOnly(lead);
        assertEquals(List.of("STUDENT"), lead.getRoles());

        UserDTO asFormsSendIt = user();
        PublicEnrollRoleGuard.keepLearnerRoleOnly(asFormsSendIt);
        assertEquals(List.of(), asFormsSendIt.getRoles());

        UserDTO noList = user((String[]) null);
        PublicEnrollRoleGuard.keepLearnerRoleOnly(noList);
        assertNull(noList.getRoles());
        PublicEnrollRoleGuard.keepLearnerRoleOnly(null);
    }

    // ── TEACHER follows the institute the enrolment is written in ───────────

    @Test
    void teacherIsDroppedWhenTheInvitesInstituteDoesNotGiveItToLearners() {
        UserDTO learner = user("STUDENT", "TEACHER");
        PublicEnrollRoleGuard.dropTeacherUnlessInstituteAllows(learner, PLAIN, instituteRepository);
        assertEquals(List.of("STUDENT"), learner.getRoles());

        UserDTO unknownInstitute = user("STUDENT", " teacher ");
        PublicEnrollRoleGuard.dropTeacherUnlessInstituteAllows(unknownInstitute, "no-such-institute",
                instituteRepository);
        assertEquals(List.of("STUDENT"), unknownInstitute.getRoles());
    }

    @Test
    void teacherStaysWhereTheInvitesInstituteAllowsItAndOtherNamesAreNotTouched() {
        UserDTO author = user("STUDENT", "TEACHER");
        PublicEnrollRoleGuard.dropTeacherUnlessInstituteAllows(author, AUTHORS, instituteRepository);
        assertEquals(List.of("STUDENT", "TEACHER"), author.getRoles());

        UserDTO serverBuilt = user("STUDENT", "PARENT");
        PublicEnrollRoleGuard.dropTeacherUnlessInstituteAllows(serverBuilt, PLAIN, instituteRepository);
        assertEquals(List.of("STUDENT", "PARENT"), serverBuilt.getRoles());
    }
}
