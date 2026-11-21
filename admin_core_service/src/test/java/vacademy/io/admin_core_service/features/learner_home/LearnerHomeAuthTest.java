package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeAnalyticsService;
import vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeEventService;
import vacademy.io.admin_core_service.features.learner_home.controller.LearnerHomeAdminController;
import vacademy.io.admin_core_service.features.learner_home.controller.LearnerHomeLearnerController;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeLayoutService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Admin endpoints: ADMIN of that institute only, no root bypass. Learner endpoints: members of the
 * institute named by the clientId header only, and always as the token's own user.
 */
class LearnerHomeAuthTest {

    static final String INST = "inst-1";

    LearnerHomeGate gate;
    LearnerHomeLayoutService layoutService;
    LearnerHomeResolver resolver;
    LearnerHomeEventService events;
    LearnerHomeAdminController admin;
    LearnerHomeLearnerController learner;

    @BeforeEach
    void setUp() {
        clientId(INST);
        gate = mock(LearnerHomeGate.class);
        when(gate.moduleEnabled(INST)).thenReturn(true);
        layoutService = mock(LearnerHomeLayoutService.class);
        resolver = mock(LearnerHomeResolver.class);
        events = mock(LearnerHomeEventService.class);
        InstituteAccessValidator validator = new InstituteAccessValidator();
        admin = new LearnerHomeAdminController(validator, gate, layoutService, mock(LearnerHomeAnalyticsService.class));
        learner = new LearnerHomeLearnerController(validator, resolver, events);
    }

    @AfterEach
    void reset() {
        RequestContextHolder.resetRequestAttributes();
    }

    static void clientId(String id) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (id != null) request.addHeader("clientId", id);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    static CustomUserDetails user(String id, boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    /** Every admin endpoint, called as {@code u}. */
    List<Executable> adminCalls(CustomUserDetails u) {
        return List.of(
                () -> admin.getDraft(u, INST),
                () -> admin.createDraft(u, INST, "{}"),
                () -> admin.createFromPublished(u, INST),
                () -> admin.saveDraft(u, INST, "{}"),
                () -> admin.deleteDraft(u, INST),
                () -> admin.publishChecks(u, INST),
                () -> admin.publish(u, INST, "{\"revision\":1}"),
                () -> admin.unpublish(u, INST),
                () -> admin.versions(u, INST),
                () -> admin.restore(u, INST, 1, false),
                () -> admin.preview(u, INST, "{}"),
                () -> admin.analytics(u, INST, "2026-11-01", "2026-11-16"),
                () -> admin.acks(u, INST, "b", 0, 50));
    }

    void allForbidden(CustomUserDetails u) {
        for (Executable call : adminCalls(u)) {
            assertThrows(ForbiddenException.class, call);
        }
        verifyNoInteractions(layoutService);
    }

    @Test
    void studentIsRejected() {
        allForbidden(user("s", false, "STUDENT"));
    }

    @Test
    void teacherIsRejected() {
        allForbidden(user("t", false, "TEACHER"));
    }

    @Test
    void rootLearnerWithoutAdminIsRejected() {
        allForbidden(user("r", true, "STUDENT"));
    }

    @Test
    void customRoleAndCounsellorAreRejected() {
        allForbidden(user("c", false, "COUNSELLOR", "MANAGE_LEADS"));
    }

    @Test
    void adminOfAnotherInstituteIsRejected() {
        clientId("inst-2");
        allForbidden(user("a", false, "ADMIN"));
        clientId(null);
        allForbidden(user("a", true, "ADMIN"));
    }

    @Test
    void adminOfTheInstituteIsAllowed() {
        CustomUserDetails a = user("a", true, "ADMIN");
        when(layoutService.draftView(eq(INST), anyBoolean(), anyBoolean())).thenReturn(null);
        assertEquals(HttpStatus.OK, admin.getDraft(a, INST).getStatusCode());
        assertEquals(HttpStatus.OK, admin.versions(a, INST).getStatusCode());
        assertEquals(HttpStatus.NO_CONTENT, admin.unpublish(a, INST).getStatusCode());
    }

    @Test
    void moduleOffBlocksEverythingButGetDraft() {
        when(gate.moduleEnabled(INST)).thenReturn(false);
        CustomUserDetails a = user("a", false, "ADMIN");
        assertEquals(HttpStatus.OK, admin.getDraft(a, INST).getStatusCode());
        List<Executable> calls = adminCalls(a);
        for (Executable call : calls.subList(1, calls.size())) {
            LearnerHomeException e = assertThrows(LearnerHomeException.class, call);
            assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
            assertEquals("MODULE_OFF", e.getCode());
        }
    }

    @Test
    void holisticInstituteCannotStartOrPublish() {
        when(gate.isHolistic(INST)).thenReturn(true);
        CustomUserDetails a = user("a", false, "ADMIN");
        for (Executable call : List.<Executable>of(() -> admin.createDraft(a, INST, "{}"),
                () -> admin.createFromPublished(a, INST), () -> admin.publish(a, INST, "{\"revision\":1}"),
                () -> admin.restore(a, INST, 1, true))) {
            assertEquals("HOLISTIC_LAYOUT", assertThrows(LearnerHomeException.class, call).getCode());
        }
    }

    // ── Learner ─────────────────────────────────────────────────────────────

    @Test
    void learnerWithAnotherInstitutesClientIdIsRejected() {
        clientId("inst-2");
        CustomUserDetails s = user("s", true, "STUDENT");
        assertThrows(ForbiddenException.class, () -> learner.resolved(s, INST));
        assertThrows(ForbiddenException.class, () -> learner.events(s, INST, null));
        assertThrows(ForbiddenException.class, () -> learner.dismiss(s, INST, "b"));
        assertThrows(ForbiddenException.class, () -> learner.acknowledge(s, INST, "b"));
        verifyNoInteractions(resolver, events);
    }

    @Test
    void rootFlagWithoutMembershipIsRejected() {
        clientId(INST);
        assertThrows(ForbiddenException.class, () -> learner.resolved(user("r", true), INST));
    }

    @Test
    void learnerResolvesAsTheTokenUserWithNoStore() {
        CustomUserDetails s = user("learner-9", false, "STUDENT");
        when(resolver.resolve(INST, "learner-9")).thenReturn(LearnerHomeResolver.legacy());
        ResponseEntity<?> r = learner.resolved(s, INST);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        String cc = r.getHeaders().getCacheControl();
        assertNotNull(cc);
        assertTrue(cc.contains("no-store") && cc.contains("private"), cc);
        verify(resolver).resolve(INST, "learner-9");
        assertEquals(HttpStatus.NO_CONTENT, learner.events(s, INST, null).getStatusCode());
        verify(events).record(INST, "learner-9", null);
    }
}
