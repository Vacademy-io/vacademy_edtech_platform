package vacademy.io.notification_service.service;

import com.amazonaws.services.s3.AmazonS3;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.notification_log.entity.EmailAddressMapping;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Which institute's inbox an inbound email lands in, including an address several institutes share. */
class InboundEmailMailboxOwnerTest {

    private static final String LEAD = "lead@example.com";
    private static final String SHARED = "sales@academy.in";
    private static final String ONLY_A = "admissions@inst-a.in";
    private static final String OUR_ID = EmailService.messageIdOf("ref");
    private static final String SES_ID = "010901a1a4ec06a4-48dab309-7917-4ee5-b73a-59a8c15281bd-000000";
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 20, 10, 0);

    private NotificationLogRepository logs;
    private EmailAddressMappingRepository mappings;
    private InboundEmailService service;

    @BeforeEach
    void setUp() {
        logs = mock(NotificationLogRepository.class);
        mappings = mock(EmailAddressMappingRepository.class);
        service = new InboundEmailService(mock(AmazonS3.class), logs, mappings, new ObjectMapper());
        when(mappings.findAllByEmailAddressIgnoreCaseAndIsActiveTrue(anyString())).thenReturn(List.of());
        when(logs.findBySourceIdAndNotificationType(any(), eq("EMAIL"))).thenReturn(List.of());
        when(logs.findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc(eq("EMAIL_EVENT"), any()))
                .thenReturn(Optional.empty());
        when(logs.findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                any(), any(), eq("EMAIL"))).thenReturn(Optional.empty());
    }

    private static EmailAddressMapping mapping(String address, String instituteId, LocalDateTime createdAt,
                                               LocalDateTime updatedAt) {
        EmailAddressMapping m = new EmailAddressMapping();
        m.setEmailAddress(address);
        m.setInstituteId(instituteId);
        m.setIsActive(true);
        m.setCreatedAt(createdAt);
        m.setUpdatedAt(updatedAt);
        return m;
    }

    /** inst-a added the shared address first; inst-b added it later and re-saved it most recently. */
    private void sharedByAThenB() {
        when(mappings.findAllByEmailAddressIgnoreCaseAndIsActiveTrue(SHARED)).thenReturn(List.of(
                mapping(SHARED, "inst-a", NOW.minusDays(30), NOW.minusDays(30)),
                mapping(SHARED, "inst-b", NOW.minusDays(5), NOW)));
    }

    private static NotificationLog sent(String id, String instituteId) {
        NotificationLog log = new NotificationLog();
        log.setId(id);
        log.setInstituteId(instituteId);
        return log;
    }

    private static NotificationLog eventOf(String emailLogId) {
        NotificationLog event = new NotificationLog();
        event.setId("event-of-" + emailLogId);
        event.setSource(emailLogId);
        return event;
    }

    private Optional<String> owner(List<String> to, String inReplyTo) {
        return service.findMailboxOwner(to, inReplyTo, LEAD).map(EmailAddressMapping::getInstituteId);
    }

    @Test
    @DisplayName("An address only one institute has goes to that institute")
    void singleOwner() {
        when(mappings.findAllByEmailAddressIgnoreCaseAndIsActiveTrue(ONLY_A))
                .thenReturn(List.of(mapping(ONLY_A, "inst-a", NOW, NOW)));

        assertThat(owner(List.of(ONLY_A), null)).contains("inst-a");
    }

    @Test
    @DisplayName("The first mapped address still wins when it has one owner, as before")
    void firstSingleOwnerAddressWins() {
        sharedByAThenB();
        when(mappings.findAllByEmailAddressIgnoreCaseAndIsActiveTrue(ONLY_A))
                .thenReturn(List.of(mapping(ONLY_A, "inst-a", NOW, NOW)));

        assertThat(owner(List.of(ONLY_A, SHARED), null)).contains("inst-a");
    }

    @Test
    @DisplayName("Shared address: a reply goes to the institute whose email it answers (our Message-ID)")
    void replyByMessageIdGoesToTheSender() {
        sharedByAThenB();
        when(logs.findBySourceIdAndNotificationType(OUR_ID, "EMAIL")).thenReturn(List.of(sent("email-b", "inst-b")));

        assertThat(owner(List.of(SHARED), OUR_ID)).contains("inst-b");
    }

    @Test
    @DisplayName("Shared address: a reply to the id SES sent it under goes to that email's institute")
    void replyBySesIdGoesToTheSender() {
        sharedByAThenB();
        when(logs.findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc("EMAIL_EVENT", SES_ID))
                .thenReturn(Optional.of(eventOf("email-b")));
        when(logs.findById("email-b")).thenReturn(Optional.of(sent("email-b", "inst-b")));

        assertThat(owner(List.of(SHARED), "<" + SES_ID + "@ap-south-1.amazonses.com>")).contains("inst-b");
    }

    @Test
    @DisplayName("Shared address: a new email (no In-Reply-To) goes to the institute that last emailed this sender")
    void newEmailGoesToTheInstituteThatContactedTheSender() {
        sharedByAThenB();
        when(logs.findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                LEAD, SHARED, "EMAIL")).thenReturn(Optional.of(sent("email-b", "inst-b")));

        assertThat(owner(List.of(SHARED), null)).contains("inst-b");
    }

    @Test
    @DisplayName("Shared address, nobody emailed the sender: the oldest mapping keeps it, a later re-save does not move it")
    void unknownSenderGoesToTheOldestMapping() {
        sharedByAThenB();

        assertThat(owner(List.of(SHARED), null)).contains("inst-a");
        assertThat(owner(List.of(SHARED), OUR_ID)).contains("inst-a");
    }

    @Test
    @DisplayName("Shared To but a CC only one institute has: the CC decides")
    void unambiguousCcBeatsTheOldestGuess() {
        sharedByAThenB();
        when(mappings.findAllByEmailAddressIgnoreCaseAndIsActiveTrue("cc@inst-b.in"))
                .thenReturn(List.of(mapping("cc@inst-b.in", "inst-b", NOW, NOW)));

        assertThat(owner(List.of(SHARED, "cc@inst-b.in"), null)).contains("inst-b");
    }

    @Test
    @DisplayName("Answered email from an institute that does not share the address: fall back to who emailed the sender")
    void answeredEmailFromNonOwnerIsIgnored() {
        sharedByAThenB();
        when(logs.findBySourceIdAndNotificationType(OUR_ID, "EMAIL")).thenReturn(List.of(sent("email-c", "inst-c")));
        when(logs.findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                LEAD, SHARED, "EMAIL")).thenReturn(Optional.of(sent("email-b", "inst-b")));

        assertThat(owner(List.of(SHARED), OUR_ID)).contains("inst-b");
    }

    @Test
    @DisplayName("Answered email with no institute on it: the oldest mapping, never a failure")
    void answeredEmailWithoutInstitute() {
        sharedByAThenB();
        when(logs.findBySourceIdAndNotificationType(OUR_ID, "EMAIL")).thenReturn(List.of(sent("otp", null)));

        assertThat(owner(List.of(SHARED), OUR_ID)).contains("inst-a");
    }

    @Test
    @DisplayName("No mapped address: no owner")
    void unmappedAddress() {
        assertThat(owner(List.of("nobody@example.org"), OUR_ID)).isEmpty();
    }
}
