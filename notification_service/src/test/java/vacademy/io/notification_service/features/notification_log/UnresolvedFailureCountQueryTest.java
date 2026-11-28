package vacademy.io.notification_service.features.notification_log;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The "Not delivered" count behind the conversation badge and the tab.
 *
 * <p>It used to count every failure a conversation had ever seen, so one rejected message badged
 * the chat for good. Production had a conversation whose Sunday free-form reply was refused
 * (131047) and whose next five messages were all READ — still badged "Not delivered" three days
 * later, with nothing for anyone to do about it. The count now asks whether the failure is still
 * the latest news.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class UnresolvedFailureCountQueryTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919555622068";

    @Autowired
    private NotificationLogRepository repository;

    @BeforeEach
    void setUp() {
        repository.deleteAll();
    }

    /** @param status WhatsApp's verdict, or null for a message it never reported on. */
    private void outgoing(String phone, String at, String status) {
        NotificationLog log = new NotificationLog();
        log.setId(UUID.randomUUID().toString());
        log.setInstituteId(INSTITUTE);
        log.setChannelId(phone);
        log.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        log.setNotificationDate(Instant.parse(at));
        log.setDeliveryStatus(status);
        repository.saveAndFlush(log);
    }

    /** A send the provider refused outright: no webhook ever follows, only the payload marker. */
    private void refusedOnSend(String phone, String at) {
        NotificationLog log = new NotificationLog();
        log.setId(UUID.randomUUID().toString());
        log.setInstituteId(INSTITUTE);
        log.setChannelId(phone);
        log.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        log.setNotificationDate(Instant.parse(at));
        log.setMessagePayload("{\"deliveryStatus\":\"FAILED\",\"error\":\"Re-engagement message (131047)\"}");
        repository.saveAndFlush(log);
    }

    private Map<String, Long> counts(String... phones) {
        return repository
                .batchCountFailedMessages(INSTITUTE, List.of(phones),
                        WhatsAppSendFailureService.FAILED_PAYLOAD_LIKE)
                .stream()
                .collect(Collectors.toMap(row -> (String) row[0], row -> ((Number) row[1]).longValue()));
    }

    @Test
    @DisplayName("a failure later messages recovered from is history, not a problem to badge")
    void deliveredMessagesAfterAFailureClearIt() {
        outgoing(PHONE, "2026-09-06T13:48:00Z", "READ");
        outgoing(PHONE, "2026-09-06T13:51:00Z", "FAILED");
        outgoing(PHONE, "2026-09-06T23:30:00Z", "READ");
        outgoing(PHONE, "2026-09-07T16:00:00Z", "DELIVERED");

        assertThat(counts(PHONE)).doesNotContainKey(PHONE);
    }

    @Test
    @DisplayName("a failure nothing has got past since still counts — that is the work list")
    void failureAsTheLatestNewsCounts() {
        outgoing(PHONE, "2026-09-05T12:12:00Z", "READ");
        outgoing(PHONE, "2026-09-05T12:22:00Z", "FAILED");

        assertThat(counts(PHONE)).containsEntry(PHONE, 1L);
    }

    @Test
    @DisplayName("every failure since the last delivered message counts, not just the newest")
    void countsEveryFailureSinceTheLastDelivery() {
        outgoing(PHONE, "2026-09-05T12:00:00Z", "DELIVERED");
        outgoing(PHONE, "2026-09-05T12:13:00Z", "FAILED");
        outgoing(PHONE, "2026-09-05T12:21:00Z", "FAILED");

        assertThat(counts(PHONE)).containsEntry(PHONE, 2L);
    }

    @Test
    @DisplayName("a conversation where nothing was ever delivered counts all of its failures")
    void noDeliveryAtAllCountsEverything() {
        outgoing(PHONE, "2026-09-05T12:13:00Z", "FAILED");
        outgoing(PHONE, "2026-09-05T12:21:00Z", "FAILED");

        assertThat(counts(PHONE)).containsEntry(PHONE, 2L);
    }

    @Test
    @DisplayName("a message WhatsApp never reported on does not count as a recovery")
    void anUnreportedMessageDoesNotClearAFailure() {
        outgoing(PHONE, "2026-09-05T12:21:00Z", "FAILED");
        // Sent, but the status webhook never matched it back — silence is not a delivery.
        outgoing(PHONE, "2026-09-05T13:00:00Z", null);

        assertThat(counts(PHONE)).containsEntry(PHONE, 1L);
    }

    @Test
    @DisplayName("a send the provider refused outright follows the same rule")
    void refusedSendsClearTheSameWay() {
        refusedOnSend(PHONE, "2026-09-05T12:21:00Z");
        assertThat(counts(PHONE)).containsEntry(PHONE, 1L);

        outgoing(PHONE, "2026-09-05T13:00:00Z", "DELIVERED");
        assertThat(counts(PHONE)).doesNotContainKey(PHONE);
    }

    @Test
    @DisplayName("a healthy conversation is absent from the result, not present with a zero")
    void healthyConversationsAreAbsent() {
        outgoing(PHONE, "2026-09-05T12:00:00Z", "READ");

        assertThat(counts(PHONE)).isEmpty();
    }

    @Test
    @DisplayName("conversations are counted independently of each other")
    void countsArePerConversation() {
        String other = "919205105065";
        outgoing(PHONE, "2026-09-06T13:51:00Z", "FAILED");
        outgoing(PHONE, "2026-09-06T23:30:00Z", "READ");
        outgoing(other, "2026-09-05T12:21:00Z", "FAILED");

        Map<String, Long> counts = counts(PHONE, other);

        assertThat(counts).doesNotContainKey(PHONE);
        assertThat(counts).containsEntry(other, 1L);
    }
}
