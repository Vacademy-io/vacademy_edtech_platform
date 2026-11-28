package vacademy.io.notification_service.features.notification_log;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The reconciliation UPDATE itself. Status webhooks are not ordered and are retried, so the guard
 * that matters is monotonicity: a late SENT must never erase a DELIVERED, and nothing may erase a
 * FAILED — the one verdict a human has to see.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class DeliveryStatusReconcileQueryTest {

    @Autowired
    private NotificationLogRepository repository;

    private String wamid;

    @BeforeEach
    void setUp() {
        repository.deleteAll();
        wamid = "wamid." + UUID.randomUUID();
    }

    private NotificationLog outboundRow(String providerMessageId) {
        NotificationLog log = new NotificationLog();
        log.setId(UUID.randomUUID().toString());
        log.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        log.setChannelId("917999873846");
        log.setSourceId(providerMessageId);
        log.setSource("whatsapp-service");
        log.setBody("WhatsApp Template: whatsappenquirymsg | Provider: META | Status: SUCCESS | Params: {}");
        log.setNotificationDate(Instant.parse("2026-08-31T06:51:47Z"));
        return repository.saveAndFlush(log);
    }

    private NotificationLog reload(String id) {
        return repository.findById(id).orElseThrow();
    }

    @Test
    @DisplayName("a rejected send stops reading as a successful one")
    void failureIsStampedOnTheOutboundRow() {
        NotificationLog sent = outboundRow(wamid);

        int updated = repository.applyDeliveryStatusByProviderMessageId(
                wamid, "FAILED", "131042", "Business eligibility payment issue",
                Instant.parse("2026-08-31T06:51:48Z"));

        assertThat(updated).isEqualTo(1);
        NotificationLog row = reload(sent.getId());
        assertThat(row.getDeliveryStatus()).isEqualTo("FAILED");
        assertThat(row.getDeliveryErrorCode()).isEqualTo("131042");
        assertThat(row.getDeliveryErrorMessage()).isEqualTo("Business eligibility payment issue");
        assertThat(row.getDeliveryUpdatedAt()).isEqualTo(Instant.parse("2026-08-31T06:51:48Z"));
        // The send-time record is a separate fact and must survive untouched — other queries parse it.
        assertThat(row.getBody()).contains("Status: SUCCESS");
    }

    @Test
    @DisplayName("statuses only move forward: a re-delivered SENT cannot undo DELIVERED")
    void lateStatusesDoNotDowngrade() {
        NotificationLog sent = outboundRow(wamid);
        Instant at = Instant.parse("2026-08-31T06:51:48Z");

        repository.applyDeliveryStatusByProviderMessageId(wamid, "DELIVERED", null, null, at);
        int updated = repository.applyDeliveryStatusByProviderMessageId(wamid, "SENT", null, null, at);

        assertThat(updated).isZero();
        assertThat(reload(sent.getId()).getDeliveryStatus()).isEqualTo("DELIVERED");
    }

    @Test
    @DisplayName("READ still advances past DELIVERED")
    void readAdvancesPastDelivered() {
        NotificationLog sent = outboundRow(wamid);
        Instant at = Instant.parse("2026-08-31T06:51:48Z");

        repository.applyDeliveryStatusByProviderMessageId(wamid, "DELIVERED", null, null, at);
        repository.applyDeliveryStatusByProviderMessageId(wamid, "READ", null, null, at);

        assertThat(reload(sent.getId()).getDeliveryStatus()).isEqualTo("READ");
    }

    @Test
    @DisplayName("FAILED is terminal — no later status may paint over a message that never arrived")
    void failedIsNeverOverwritten() {
        NotificationLog sent = outboundRow(wamid);
        Instant at = Instant.parse("2026-08-31T06:51:48Z");

        repository.applyDeliveryStatusByProviderMessageId(
                wamid, "FAILED", "131042", "Business eligibility payment issue", at);
        int updated = repository.applyDeliveryStatusByProviderMessageId(wamid, "READ", null, null, at);

        assertThat(updated).isZero();
        NotificationLog row = reload(sent.getId());
        assertThat(row.getDeliveryStatus()).isEqualTo("FAILED");
        assertThat(row.getDeliveryErrorCode()).isEqualTo("131042");
    }

    @Test
    @DisplayName("only the outbound row is touched — status rows keep the raw webhook payload")
    void statusEventRowsAreNotReconciled() {
        NotificationLog unsaved = new NotificationLog();
        unsaved.setId(UUID.randomUUID().toString());
        unsaved.setNotificationType("WHATSAPP_STATUS_EVENT");
        unsaved.setChannelId("917999873846");
        unsaved.setSourceId(wamid);
        unsaved.setSource("META");
        unsaved.setNotificationDate(Instant.parse("2026-08-31T06:51:48Z"));
        NotificationLog statusRow = repository.saveAndFlush(unsaved);

        int updated = repository.applyDeliveryStatusByProviderMessageId(
                wamid, "FAILED", "131042", "Business eligibility payment issue",
                Instant.parse("2026-08-31T06:51:48Z"));

        assertThat(updated).isZero();
        assertThat(reload(statusRow.getId()).getDeliveryStatus()).isNull();
    }

    @Test
    @DisplayName("an unknown wamid updates nothing — a status can outrun its own send row")
    void unmatchedProviderMessageIdIsHarmless() {
        outboundRow(wamid);

        int updated = repository.applyDeliveryStatusByProviderMessageId(
                "wamid.NEVER_SENT", "DELIVERED", null, null, Instant.now());

        assertThat(updated).isZero();
    }
}
