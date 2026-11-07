package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A member who EXITED because their goal was met (a booked meeting) is still answered when they write
 * about that meeting; an opted-out one never is, and every other send keeps the strict check.
 */
class EngagementDispatcherExitedMemberTest {

    private EngagementMemberRepository members;
    private NotificationService notifications;
    private EngagementDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        notifications = mock(NotificationService.class);
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        members = mock(EngagementMemberRepository.class);
        ContactResolver contacts = mock(ContactResolver.class);
        dispatcher = new EngagementDispatcher(notifications, actions, members, mock(TimelineEventService.class),
                contacts, mock(EngagementInternalClients.class), mock(EngagementEngineRepository.class), mock(PolicyGate.class));
        when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder()
                .memberId("m1").audienceResponseId("r1").email("lead@test.local").build()));
        when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private void member(String status) {
        EngagementMember m = new EngagementMember();
        m.setId("m1");
        m.setInstituteId("i1");
        m.setStatus(status);
        m.setAudienceResponseId("r1");
        when(members.findById("m1")).thenReturn(Optional.of(m));
    }

    private static EngagementAction reply() {
        EngagementAction a = new EngagementAction();
        a.setId("a1");
        a.setEngineId("e1");
        a.setMemberId("m1");
        a.setInstituteId("i1");
        a.setKind("REPLY");
        a.setStatus("DISPATCHING");
        a.setChannel("EMAIL");
        a.setDraftBody("Your meeting is now on Mon 2 Nov.");
        return a;
    }

    @Test
    @DisplayName("an exited member is refused by default")
    void exitedRefused() {
        member("EXITED");
        EngagementAction a = reply();
        assertThrows(VacademyException.class, () -> dispatcher.dispatchClaimed(a, null, "x"));
        assertEquals("OPEN", a.getStatus());
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("an exited member is answered when answering their own message about a meeting")
    void exitedAnswered() {
        member("EXITED");
        EngagementAction a = reply();
        dispatcher.dispatchClaimed(a, null, "x", true);
        assertNotEquals("OPEN", a.getStatus(), "it went through the send path: " + a.getErrorMessage());
        assertTrue(a.getErrorMessage() == null || !a.getErrorMessage().contains("opted out or left the audience"),
                String.valueOf(a.getErrorMessage()));
    }

    @Test
    @DisplayName("an opted-out member is never sent to, even when answering")
    void optedOutNeverSent() {
        member("OPTED_OUT");
        EngagementAction a = reply();
        assertThrows(VacademyException.class, () -> dispatcher.dispatchClaimed(a, null, "x", true));
        assertEquals("OPEN", a.getStatus());
        verifyNoInteractions(notifications);
    }
}
