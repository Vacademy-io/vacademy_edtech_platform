package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.learner.dto.v2.MultiPackageLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * auth-service answers a get-or-create (and a lookup by id) with every role name the account
 * holds in any institute. The enrol code posts that user to auth-service again for the
 * enrolling institute, which saved those names there: an account that is ADMIN of its own
 * institute became ADMIN of any institute it enrolled in through a public route. The role
 * list that is posted again is now the one that was asked for, never the one that came back.
 */
class EnrollKeepsRolesOfOtherInstitutesOutTest {

    private static final String VICTIM = "inst-victim";

    private static UserDTO user(String id, String... roles) {
        UserDTO user = new UserDTO();
        user.setId(id);
        user.setEmail("owner@example.com");
        user.setFullName("Asha Rao");
        user.setUsername("asha");
        user.setMobileNumber("9999999999");
        user.setRootUser(true);
        user.setRoles(roles == null ? null : new ArrayList<>(Arrays.asList(roles)));
        return user;
    }

    private static <T> T withMocks(T service) throws Exception {
        for (Class<?> c = service.getClass(); c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()
                        && !Modifier.isFinal(f.getType().getModifiers())) {
                    f.setAccessible(true);
                    f.set(service, mock(f.getType()));
                }
            }
        }
        return service;
    }

    private static Object field(Object service, String name) throws Exception {
        Field f = service.getClass().getDeclaredField(name);
        f.setAccessible(true);
        return f.get(service);
    }

    // ── the rule ────────────────────────────────────────────────────────────

    @Test
    void whatWasAskedForReplacesWhatCameBack() {
        assertEquals(List.of("STUDENT"), PublicEnrollRoleGuard.askedRolesOnly(
                List.of("STUDENT"), List.of("ADMIN", "STUDENT"), VICTIM));
        assertEquals(List.of("STUDENT", "TEACHER"), PublicEnrollRoleGuard.askedRolesOnly(
                List.of("STUDENT", "TEACHER"), List.of("STUDENT", "TEACHER", "EVALUATOR"), VICTIM));
        // a sub-org invite's own list, which the server chose
        assertEquals(List.of("ADMIN"), PublicEnrollRoleGuard.askedRolesOnly(
                List.of("ADMIN"), List.of("ADMIN", "STUDENT"), VICTIM));
    }

    @Test
    void whenNothingWasAskedForAnAccountWithRolesElsewhereEnrolsAsALearner() {
        assertEquals(List.of("STUDENT"), PublicEnrollRoleGuard.askedRolesOnly(null, List.of("ADMIN"), VICTIM));
        assertEquals(List.of("STUDENT"), PublicEnrollRoleGuard.askedRolesOnly(
                List.of(), List.of("TEACHER", "STUDENT", "ADMIN"), VICTIM));
        // the usual learner: nothing changes
        assertEquals(List.of("STUDENT"), PublicEnrollRoleGuard.askedRolesOnly(
                List.of(), List.of("STUDENT", "STUDENT"), VICTIM));
        // an account with no role anywhere gains none
        assertEquals(List.of(), PublicEnrollRoleGuard.askedRolesOnly(List.of(), List.of(), VICTIM));
        assertNull(PublicEnrollRoleGuard.askedRolesOnly(null, null, VICTIM));
    }

    @Test
    void aCopyDiffersFromTheOriginalInItsRoleListOnly() {
        UserDTO original = user("user-1", "ADMIN", "STUDENT");
        original.setPassword("kept");
        original.setLinkedParentId("parent-1");

        UserDTO copy = PublicEnrollRoleGuard.copyWithRoles(original, List.of("STUDENT"));

        assertNotSame(original, copy);
        assertEquals(List.of("ADMIN", "STUDENT"), original.getRoles());
        assertEquals(List.of("STUDENT"), copy.getRoles());
        copy.setRoles(original.getRoles());
        assertEquals(original, copy);
        assertNull(PublicEnrollRoleGuard.copyWithRoles(null, List.of("STUDENT")));
    }

    // ── v1 enrol: the answer to get-or-create ───────────────────────────────

    /** Runs a v1 enrol up to the step after the user is created, which is made to stop it. */
    private UserDTO userAfterGetOrCreate(EnrollInvite invite, UserDTO sent, UserDTO answered) throws Exception {
        LearnerEnrollRequestService service = withMocks(new LearnerEnrollRequestService());
        when(((EnrollInviteService) field(service, "enrollInviteService")).findById("invite-1")).thenReturn(invite);
        when(((AuthService) field(service, "authService"))
                .createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), any(), anyBoolean(), any()))
                .thenReturn(answered);
        doThrow(new IllegalStateException("stop here"))
                .when((LearnerCouponService) field(service, "learnerCouponService"))
                .generateCouponCodeForLearner(any(), any(), any());

        LearnerPackageSessionsEnrollDTO enroll = new LearnerPackageSessionsEnrollDTO();
        enroll.setEnrollInviteId("invite-1");
        LearnerEnrollRequestDTO request = new LearnerEnrollRequestDTO();
        request.setInstituteId(VICTIM);
        request.setUser(sent);
        request.setLearnerPackageSessionEnroll(enroll);

        IllegalStateException stop = assertThrows(IllegalStateException.class,
                () -> service.recordLearnerRequest(request, Map.of()));
        assertEquals("stop here", stop.getMessage());
        // this is the user the payment step posts to auth-service again
        return request.getUser();
    }

    private static EnrollInvite invite() {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("invite-1");
        invite.setInstituteId(VICTIM);
        return invite;
    }

    @Test
    void v1AnAdminOfAnotherInstituteIsPostedAgainAsALearnerOnly() throws Exception {
        UserDTO again = userAfterGetOrCreate(invite(), user(null, "STUDENT"), user("user-1", "ADMIN", "STUDENT"));

        assertEquals("user-1", again.getId());
        assertEquals(List.of("STUDENT"), again.getRoles());
    }

    @Test
    void v1ARequestThatNamesNoRoleDoesNotCarryTheAccountsStaffRoles() throws Exception {
        UserDTO again = userAfterGetOrCreate(invite(), user(null), user("user-1", "ADMIN", "TEACHER"));

        assertEquals(List.of("STUDENT"), again.getRoles());
    }

    @Test
    void v1ASubOrgInvitesOwnRolesAreStillPostedAgain() throws Exception {
        EnrollInvite subOrg = invite();
        subOrg.setTag("SUB_ORG");
        subOrg.setSettingJson("{\"setting\":{\"SUB_ORG_SETTING\":{\"AUTH_ROLES\":[\"SUB_ORG_ADMIN\",\"STUDENT\"]}}}");

        UserDTO again = userAfterGetOrCreate(subOrg, user(null, "STUDENT"),
                user("user-1", "ADMIN", "SUB_ORG_ADMIN", "STUDENT"));

        assertEquals(List.of("SUB_ORG_ADMIN", "STUDENT"), again.getRoles());
    }

    // ── v2 enrol ────────────────────────────────────────────────────────────

    @Test
    void v2ByUserIdAnAdminOfAnotherInstituteEnrolsAsALearnerOnly() throws Exception {
        MultiPackageLearnerEnrollService service = withMocks(new MultiPackageLearnerEnrollService());
        UserDTO lookedUp = user("user-1", "ADMIN");
        when(((AuthService) field(service, "authService")).getUsersFromAuthServiceByUserIds(List.of("user-1")))
                .thenReturn(List.of(lookedUp));
        MultiPackageLearnerEnrollRequestDTO request = new MultiPackageLearnerEnrollRequestDTO();
        request.setInstituteId(VICTIM);
        request.setUserId("user-1");

        // no course lines: the request stops right after the user is resolved
        assertThrows(VacademyException.class, () -> service.enrollMultiPackage(request));

        assertEquals("user-1", request.getUser().getId());
        assertEquals("owner@example.com", request.getUser().getEmail());
        assertEquals(List.of("STUDENT"), request.getUser().getRoles());
        assertEquals(List.of("ADMIN"), lookedUp.getRoles());
    }

    @Test
    void v2TheNextCourseLinesCarryTheFirstLinesRolesAndTheResponseIsLeftAlone() {
        UserDTO inResponse = user("user-1", "ADMIN", "STUDENT");
        UserDTO firstLine = user("user-1", "STUDENT");

        UserDTO next = MultiPackageLearnerEnrollService.userForNextLines(inResponse, firstLine);

        assertEquals("user-1", next.getId());
        assertEquals(List.of("STUDENT"), next.getRoles());
        assertEquals(List.of("ADMIN", "STUDENT"), inResponse.getRoles());
        assertNull(MultiPackageLearnerEnrollService.userForNextLines(null, firstLine));
    }

    // ── the credential mail after a paid enrolment ──────────────────────────

    @Test
    void theMailAfterAPaidEnrolmentPostsALearnerOnly() throws Exception {
        UserPlanService service = withMocks(new UserPlanService());
        UserDTO lookedUp = user("user-1", "ADMIN", "STUDENT");
        when(((AuthService) field(service, "authService")).getUsersFromAuthServiceByUserIds(List.of("user-1")))
                .thenReturn(List.of(lookedUp));
        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        plan.setUserId("user-1");

        Method send = UserPlanService.class.getDeclaredMethod("sendEnrollmentNotificationsAfterPayment",
                UserPlan.class, EnrollInvite.class, List.class);
        send.setAccessible(true);
        send.invoke(service, plan, invite(), List.of("ps-1"));

        ArgumentCaptor<UserDTO> posted = ArgumentCaptor.forClass(UserDTO.class);
        verify((AsyncEnrollmentEmailService) field(service, "asyncEnrollmentEmailService"))
                .sendCredentialEmailForPaidEnrollment(posted.capture(), eq(VICTIM), any());
        assertEquals("user-1", posted.getValue().getId());
        assertEquals(List.of("STUDENT"), posted.getValue().getRoles());
        assertEquals(List.of("ADMIN", "STUDENT"), lookedUp.getRoles());
    }
}
