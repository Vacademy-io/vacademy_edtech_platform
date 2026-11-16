package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.institute.entity.Institute;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The public enrol door decides TEACHER from the institute id in the request. The enrolment
 * is written in the institute its invite belongs to, so when the two differ the invite's
 * institute has the last word, before the user is passed to auth-service.
 */
class EnrollInviteInstituteDecidesTeacherTest {

    private static final String LEARNERS_CREATE_COURSES =
            "{\"setting\":{\"COURSE_SETTING\":{\"data\":{\"permissions\":{\"allowLearnersToCreateCourses\":true}}}}}";

    private LearnerEnrollRequestService service;
    private EnrollInviteService enrollInviteService;
    private InstituteRepository instituteRepository;

    @BeforeEach
    void setUp() throws Exception {
        service = new LearnerEnrollRequestService();
        for (Field f : LearnerEnrollRequestService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()
                    && !java.lang.reflect.Modifier.isFinal(f.getType().getModifiers())) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        enrollInviteService = (EnrollInviteService) get("enrollInviteService");
        instituteRepository = (InstituteRepository) get("instituteRepository");

        Institute plain = new Institute();
        plain.setSetting("{\"setting\":{}}");
        Institute authors = new Institute();
        authors.setSetting(LEARNERS_CREATE_COURSES);
        when(instituteRepository.findById("inst-plain")).thenReturn(Optional.of(plain));
        when(instituteRepository.findById("inst-authors")).thenReturn(Optional.of(authors));
    }

    private Object get(String field) throws Exception {
        Field f = LearnerEnrollRequestService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(service);
    }

    /** Runs the request up to the availability check, which is made to stop it. */
    private List<String> rolesAfterTheInstituteCheck(String requestInstituteId, String inviteInstituteId) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("invite-1");
        invite.setInstituteId(inviteInstituteId);
        when(enrollInviteService.findById("invite-1")).thenReturn(invite)
                .thenThrow(new IllegalStateException("stop here"));

        UserDTO user = new UserDTO();
        user.setEmail("new@example.com");
        user.setRoles(new ArrayList<>(List.of("STUDENT", "TEACHER")));
        LearnerPackageSessionsEnrollDTO enroll = new LearnerPackageSessionsEnrollDTO();
        enroll.setEnrollInviteId("invite-1");
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setInstituteId(requestInstituteId);
        request.setUser(user);
        request.setLearnerPackageSessionEnroll(enroll);

        IllegalStateException stop = assertThrows(IllegalStateException.class, () -> service.recordLearnerRequest(
                request, Map.of(LearnerEnrollRequestService.ENFORCE_INVITE_AVAILABILITY, true)));
        assertEquals("stop here", stop.getMessage());
        assertEquals(inviteInstituteId, request.getInstituteId());
        return request.getUser().getRoles();
    }

    @Test
    void teacherAllowedByAnotherInstituteIsNotWrittenInTheInvitesInstitute() {
        assertEquals(List.of("STUDENT"), rolesAfterTheInstituteCheck("inst-authors", "inst-plain"));
    }

    @Test
    void teacherIsKeptWhenTheInvitesOwnInstituteGivesItToLearners() {
        assertEquals(List.of("STUDENT", "TEACHER"), rolesAfterTheInstituteCheck("inst-plain", "inst-authors"));
    }

    @Test
    void aRequestForTheInvitesOwnInstituteIsLeftAsThePublicDoorSentIt() {
        assertEquals(List.of("STUDENT", "TEACHER"), rolesAfterTheInstituteCheck("inst-authors", "inst-authors"));
    }

    /**
     * A sub-org invite carries its own role list, written by the institute, not by the caller.
     * It still replaces whatever the public door left, and is passed to auth-service as stored.
     */
    @Test
    void subOrgInviteRolesStillReplaceTheBodysRolesAfterThePublicDoor() throws Exception {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("invite-1");
        invite.setInstituteId("inst-plain");
        invite.setTag("SUB_ORG");
        invite.setSettingJson("{\"setting\":{\"SUB_ORG_SETTING\":{\"AUTH_ROLES\":[\"SUB_ORG_ADMIN\",\"STUDENT\"]}}}");
        when(enrollInviteService.findById("invite-1")).thenReturn(invite);
        vacademy.io.admin_core_service.features.auth_service.service.AuthService auth =
                (vacademy.io.admin_core_service.features.auth_service.service.AuthService) get("authService");
        org.mockito.ArgumentCaptor<UserDTO> relayed = org.mockito.ArgumentCaptor.forClass(UserDTO.class);
        when(auth.createUserFromAuthServiceForLearnerEnrollment(relayed.capture(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyBoolean(), org.mockito.ArgumentMatchers.any()))
                .thenThrow(new IllegalStateException("stop here"));

        UserDTO user = new UserDTO();
        user.setEmail("new@example.com");
        user.setRoles(new ArrayList<>(List.of("ADMIN", "STUDENT")));
        LearnerPackageSessionsEnrollDTO enroll = new LearnerPackageSessionsEnrollDTO();
        enroll.setEnrollInviteId("invite-1");
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setInstituteId("inst-plain");
        request.setUser(user);
        request.setLearnerPackageSessionEnroll(enroll);

        // the public door first, exactly as the controller does
        PublicEnrollRoleGuard guard = new PublicEnrollRoleGuard();
        Field repo = PublicEnrollRoleGuard.class.getDeclaredField("instituteRepository");
        repo.setAccessible(true);
        repo.set(guard, instituteRepository);
        guard.restrictToLearnerRoles(request.getUser(), request.getInstituteId());
        assertEquals(List.of("STUDENT"), request.getUser().getRoles());

        IllegalStateException stop = assertThrows(IllegalStateException.class,
                () -> service.recordLearnerRequest(request, Map.of()));
        assertEquals("stop here", stop.getMessage());
        assertEquals(List.of("SUB_ORG_ADMIN", "STUDENT"), relayed.getValue().getRoles());
    }
}
