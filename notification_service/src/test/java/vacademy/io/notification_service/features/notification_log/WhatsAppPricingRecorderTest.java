package vacademy.io.notification_service.features.notification_log;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.notification_service.features.notification_log.repository.WhatsAppPricingRepository;
import vacademy.io.notification_service.features.notification_log.service.WhatsAppPricingRecorder;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Meta's per-message pricing lands on the outbound row (V39), from both webhook shapes, never
 * inside the webhook's own transaction, and never breaks the webhook when it cannot be saved.
 */
class WhatsAppPricingRecorderTest {

    private final WhatsAppPricingRepository repo = mock(WhatsAppPricingRepository.class);
    private final WhatsAppPricingRecorder recorder = new WhatsAppPricingRecorder(repo, new ObjectMapper());

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void savesComBotStatusPricingDirectlyOutsideATransaction() {
        recorder.record("wamid.1", Map.of("billable", true, "pricing_model", "PMP",
                "type", "regular", "category", "utility"));

        verify(repo).applyPricingByProviderMessageId(eq("wamid.1"), eq(true), eq("regular"), eq("utility"),
                eq("PMP"), any());
    }

    @Test
    void readsMetaPayloadStatusAndSkipsAnotherMessagesStatus() {
        Map<String, Object> payload = Map.of("entry", List.of(Map.of("changes", List.of(Map.of("value",
                Map.of("statuses", List.of(Map.of("id", "wamid.2", "status", "delivered",
                        "pricing", Map.of("type", "free_customer_service", "category", "service")))))))));

        recorder.recordFromMetaPayload("wamid.2", payload);
        recorder.recordFromMetaPayload("wamid.other", payload);

        verify(repo).applyPricingByProviderMessageId(eq("wamid.2"), isNull(), eq("free_customer_service"),
                eq("service"), isNull(), any());
        verify(repo, never()).applyPricingByProviderMessageId(eq("wamid.other"), any(), any(), any(), any(), any());
    }

    @Test
    void ignoresStatusesWithoutPricing() {
        recorder.record("wamid.3", null);
        recorder.record("wamid.3", Map.of());
        recorder.record("wamid.3", "not an object");

        verify(repo, never()).applyPricingByProviderMessageId(anyString(), any(), any(), any(), any(), any());
    }

    @Test
    void insideATransactionWritesOnlyAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();
        recorder.record("wamid.4", Map.of("type", "regular", "category", "marketing"));

        verify(repo, never()).applyPricingByProviderMessageId(anyString(), any(), any(), any(), any(), any());

        for (TransactionSynchronization s : TransactionSynchronizationManager.getSynchronizations()) {
            s.afterCommit();
        }
        verify(repo, timeout(2000)).applyPricingByProviderMessageId(eq("wamid.4"), isNull(), eq("regular"),
                eq("marketing"), isNull(), any());
    }

    @Test
    void aFailingSaveNeverReachesTheWebhook() {
        when(repo.applyPricingByProviderMessageId(anyString(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("db down"));

        assertDoesNotThrow(() -> recorder.record("wamid.5", Map.of("type", "regular", "category", "utility")));
    }
}
