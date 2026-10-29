package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.controller.EngagementTaskController;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The inbox shows who each task is for (GET /tasks/people), and Done / Skip can be undone
 * (POST /tasks/{id}/restore).
 */
class EngagementTaskInboxPeopleRestoreTest {

    private static final String INST = "inst-1";

    private EngagementActionRepository actions;
    private EngagementMemberRepository members;
    private ContactResolver resolver;
    private EngagementAccessGuard guard;
    private EngagementTaskController controller;
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() {
        actions = mock(EngagementActionRepository.class);
        members = mock(EngagementMemberRepository.class);
        resolver = mock(ContactResolver.class);
        guard = mock(EngagementAccessGuard.class);
        controller = new EngagementTaskController(actions, guard, mock(EngagementDispatcher.class),
                members, resolver);
    }

    private static EngagementMember member(String id, String institute) {
        EngagementMember m = new EngagementMember();
        m.setId(id);
        m.setInstituteId(institute);
        return m;
    }

    @Test
    @DisplayName("people: resolves only this institute's members, admin-checked")
    void peopleScopedToInstitute() {
        when(members.findAllById(any())).thenReturn(List.of(member("m1", INST), member("m2", "other-inst")));
        Subject s = Subject.builder().memberId("m1").name("Asha").phone("9000000001").build();
        when(resolver.resolve(argThat(l -> l != null && l.size() == 1 && "m1".equals(l.get(0).getId()))))
                .thenReturn(List.of(s));

        List<Subject> out = controller.people(INST, " m1 ,m2,,m1", user).getBody();

        verify(guard).requireAdmin(user, INST);
        verify(members).findAllById(eq(List.of("m1", "m2")));
        assertEquals(1, out.size());
        assertEquals("Asha", out.get(0).getName());
    }

    @Test
    @DisplayName("people: no ids means no lookup")
    void peopleEmpty() {
        assertTrue(controller.people(INST, " , ", user).getBody().isEmpty());
        verifyNoInteractions(members, resolver);
    }

    @Test
    @DisplayName("restore: a done / skipped task goes back to OPEN")
    void restoreOk() {
        when(actions.restoreHandled(eq("t1"), eq(INST), any(), any())).thenReturn(1);
        assertEquals(200, controller.restore("t1", INST, user).getStatusCode().value());
        verify(guard).requireAdmin(user, INST);
    }

    @Test
    @DisplayName("restore: anything not DONE / DISMISSED (or a SEND row) is refused")
    void restoreRefused() {
        when(actions.restoreHandled(eq("t2"), eq(INST), any(), any())).thenReturn(0);
        assertThrows(VacademyException.class, () -> controller.restore("t2", INST, user));
        verify(actions, never()).reopenFailed(any(), any(), any(), any());
    }
}
