package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
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

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** An address on the bounce blocklist stops getting engine email; its other channels keep working. */
class EngagementBouncedEmailTest {

    private final ObjectMapper om = new ObjectMapper();

    private static Subject subject(String memberId, String email) {
        return Subject.builder().memberId(memberId).email(email).build();
    }

    private EngagementEmailSuppression suppressionBlocking(String... blocked) throws Exception {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        when(clients.blockedEmails(anyList())).thenReturn(om.valueToTree(Map.of("blocked", List.of(blocked))));
        return new EngagementEmailSuppression(clients);
    }

    @Test
    @DisplayName("subjects on the blocklist are flagged, in any case, and keep their address for the ledger")
    void marksBouncedSubjects() throws Exception {
        Subject bounced = subject("m1", " Dead@Test.Local ");
        Subject fine = subject("m2", "live@test.local");
        Subject none = subject("m3", null);

        suppressionBlocking("dead@test.local").markBounced(List.of(bounced, fine, none));

        assertTrue(bounced.isEmailUndeliverable());
        assertEquals(" Dead@Test.Local ", bounced.getEmail());
        assertFalse(fine.isEmailUndeliverable());
        assertFalse(none.isEmailUndeliverable());
    }

    @Test
    @DisplayName("a failed lookup blocks nobody, so an outage cannot stall the sweep")
    void lookupFailureFailsOpen() {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        when(clients.blockedEmails(anyList())).thenThrow(new IllegalStateException("404"));
        var suppression = new EngagementEmailSuppression(clients);

        assertTrue(suppression.blocked(List.of("a@test.local")).isEmpty());
        assertFalse(suppression.isBlocked("a@test.local"));
    }

    @Test
    @DisplayName("a big cohort is looked up in pages the endpoint accepts, each address once")
    void pagesTheLookup() throws Exception {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        when(clients.blockedEmails(anyList())).thenReturn(om.readTree("{\"blocked\":[]}"));
        List<String> emails = new java.util.ArrayList<>();
        for (int i = 0; i < 1200; i++) emails.add("p" + i + "@test.local");
        emails.add("P0@TEST.LOCAL");

        new EngagementEmailSuppression(clients).blocked(emails);

        var page = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(clients, times(3)).blockedEmails(page.capture());
        assertEquals(1200, page.getAllValues().stream().mapToInt(List::size).sum());
        assertTrue(page.getAllValues().stream().allMatch(p -> p.size() <= 500));
    }

    @Test
    @DisplayName("sending to a bounced address is refused before it reaches the sender")
    void dispatcherRefuses() throws Exception {
        NotificationService notifications = mock(NotificationService.class);
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        ContactResolver contacts = mock(ContactResolver.class);
        var dispatcher = new EngagementDispatcher(notifications, actions, members, mock(TimelineEventService.class),
                contacts, mock(EngagementInternalClients.class), mock(EngagementEngineRepository.class),
                mock(PolicyGate.class));
        ReflectionTestUtils.setField(dispatcher, "emailSuppression", suppressionBlocking("dead@test.local"));

        when(contacts.resolve(anyList())).thenReturn(List.of(subject("m1", "dead@test.local")));
        when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
        EngagementMember m = new EngagementMember();
        m.setId("m1");
        m.setInstituteId("i1");
        m.setStatus("ACTIVE");
        when(members.findById("m1")).thenReturn(Optional.of(m));

        EngagementAction a = new EngagementAction();
        a.setId("a1");
        a.setEngineId("e1");
        a.setMemberId("m1");
        a.setInstituteId("i1");
        a.setKind("TASK");
        a.setChannel("EMAIL");
        a.setStatus("DISPATCHING");
        a.setDraftBody("Hello");

        var ex = assertThrows(VacademyException.class, () -> dispatcher.dispatchClaimed(a, null, "tester"));
        assertEquals(EngagementEmailSuppression.BOUNCED_REASON, ex.getMessage());
        assertEquals("OPEN", a.getStatus());
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("the sweep cancels unsent emails of bounced addresses only")
    void sweepCancelsOnlyBounced() throws Exception {
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        ContactResolver contacts = mock(ContactResolver.class);
        when(actions.memberIdsWithUnsentEmails("i1")).thenReturn(List.of("m1", "m2"));
        when(contacts.resolve(any())).thenReturn(List.of(subject("m1", "dead@test.local"), subject("m2", "live@test.local")));
        when(actions.cancelUnsentEmails(any(), any(), any())).thenReturn(1);
        var job = new EngagementBouncedEmailJob(members, actions, contacts, suppressionBlocking("dead@test.local"));

        assertEquals(1, job.sweepInstitute("i1", Instant.now()));
        verify(actions).cancelUnsentEmails(eq(List.of("m1")), eq(EngagementEmailSuppression.BOUNCED_REASON), any());
    }

    @Test
    @DisplayName("the sweep cancels nothing when nobody bounced or the lookup is down")
    void sweepLeavesOthersAlone() {
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        ContactResolver contacts = mock(ContactResolver.class);
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        when(clients.blockedEmails(anyList())).thenThrow(new IllegalStateException("down"));
        when(actions.memberIdsWithUnsentEmails("i1")).thenReturn(List.of("m1"));
        when(contacts.resolve(any())).thenReturn(List.of(subject("m1", "a@test.local")));
        var job = new EngagementBouncedEmailJob(mock(EngagementMemberRepository.class), actions, contacts,
                new EngagementEmailSuppression(clients));

        assertEquals(0, job.sweepInstitute("i1", Instant.now()));
        verify(actions, never()).cancelUnsentEmails(any(), any(), any());
    }

    @Test
    @DisplayName("the decision parks a person only when email is the engine's sole way to act")
    void parkingRule() {
        Subject bounced = subject("m1", "dead@test.local");
        bounced.setEmailUndeliverable(true);
        var menuWithActions = new EngagementBrainClient.ActionMenu(List.of("ADD_NOTE"), List.of(), null);
        var emptyMenu = new EngagementBrainClient.ActionMenu(List.of(), List.of(), null);

        assertTrue(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL"), emptyMenu, bounced));
        assertTrue(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL"), null, bounced));
        assertFalse(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL", "AI_CALL"), emptyMenu, bounced));
        assertFalse(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL"), menuWithActions, bounced));
        assertFalse(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL"), emptyMenu, subject("m2", "a@test.local")));
    }

    @Test
    @DisplayName("the brain is told first, and only about a bounced person")
    void brainBlock() {
        Subject bounced = subject("m1", "dead@test.local");
        bounced.setEmailUndeliverable(true);
        Map<String, String> blocks = Map.of("profile", "{}");

        Map<String, String> told = EngagementDecisionService.withEmailUnavailable(bounced, blocks);
        assertEquals("emailUnavailable", told.keySet().iterator().next());
        assertTrue(told.get("emailUnavailable").contains("Do NOT choose EMAIL"));
        assertEquals("{}", told.get("profile"));

        assertSame(blocks, EngagementDecisionService.withEmailUnavailable(subject("m2", "a@test.local"), blocks));
        assertSame(blocks, EngagementDecisionService.withEmailUnavailable(null, blocks));
    }

    @Test
    @DisplayName("a draft a failed auto-send handed back is not promoted again, which would reset its expiry")
    void promoteSkipsRejectedDrafts() throws Exception {
        Method promote = EngagementActionRepository.class.getMethod("promoteTasksToAutoSends",
                String.class, String.class, boolean.class, Instant.class, Instant.class);
        String sql = promote.getAnnotation(org.springframework.data.jpa.repository.Query.class).value();
        assertTrue(sql.contains("error_message IS NULL"), sql);
    }

    @Test
    @DisplayName("the sweep also cancels unsent emails of people with no address, with its own reason")
    void sweepCancelsNoAddress() throws Exception {
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        ContactResolver contacts = mock(ContactResolver.class);
        when(actions.memberIdsWithUnsentEmails("i1")).thenReturn(List.of("m1", "m2"));
        when(contacts.resolve(any())).thenReturn(List.of(subject("m1", null), subject("m2", "live@test.local")));
        when(actions.cancelUnsentEmails(any(), any(), any())).thenReturn(1);
        var job = new EngagementBouncedEmailJob(mock(EngagementMemberRepository.class), actions, contacts, suppressionBlocking());

        assertEquals(1, job.sweepInstitute("i1", Instant.now()));
        verify(actions).cancelUnsentEmails(eq(List.of("m1")), eq(EngagementBouncedEmailJob.NO_ADDRESS_REASON), any());
    }

    @Test
    @DisplayName("no address counts like a bounce for the decision; a null subject stays unknown")
    void noAddressIsUnreachable() {
        var none = new EngagementBrainClient.ActionMenu(List.of(), List.of(), null);
        assertTrue(EngagementDecisionService.cannotGetEmail(subject("m1", null)));
        assertTrue(EngagementDecisionService.cannotGetEmail(subject("m1", " ")));
        assertFalse(EngagementDecisionService.cannotGetEmail(subject("m1", "a@test.local")));
        assertFalse(EngagementDecisionService.cannotGetEmail(null));
        assertTrue(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL"), none, subject("m1", null)));
        assertFalse(EngagementDecisionService.emailOnlyAndUnreachable(Set.of("EMAIL", "WHATSAPP"), none, subject("m1", null)));
        assertTrue(EngagementDecisionService.withEmailUnavailable(subject("m1", null), Map.of())
                .get("emailUnavailable").contains("no email address"));
    }

}
