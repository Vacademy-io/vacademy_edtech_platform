package vacademy.io.notification_service.features.notification_log.repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.time.Instant;

/**
 * Writes Meta's per-message pricing onto the outbound WhatsApp row (V39 columns). Kept apart from
 * NotificationLogRepository, which other features own.
 */
public interface WhatsAppPricingRepository extends Repository<NotificationLog, String> {

    /**
     * Copy a status webhook's pricing onto the WHATSAPP_MESSAGE_OUTGOING row that sent the message,
     * matched by wamid (source_id) like applyDeliveryStatusByProviderMessageId, and riding the same
     * partial index idx_nl_source_id_outgoing.
     * <p>
     * A null argument keeps what the row already has: pricing arrives on more than one status
     * (sent, then delivered or read), in any order, and a status that carried only part of it must
     * not blank out the rest. LEFT() keeps an unexpectedly long value from failing the statement,
     * which would otherwise abort the webhook's transaction on the Com.bot path.
     * <p>
     * Returns rows updated; 0 is normal (the send row is not written yet, or the message was sent
     * by a path that stores no wamid).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE notification_log
            SET pricing_billable = COALESCE(CAST(:billable AS boolean), pricing_billable),
                pricing_type = COALESCE(LEFT(CAST(:type AS varchar), 40), pricing_type),
                pricing_category = COALESCE(LEFT(CAST(:category AS varchar), 40), pricing_category),
                pricing_model = COALESCE(LEFT(CAST(:model AS varchar), 10), pricing_model),
                pricing_updated_at = :reportedAt
            WHERE source_id = :providerMessageId
              AND notification_type = 'WHATSAPP_MESSAGE_OUTGOING'
            """, nativeQuery = true)
    int applyPricingByProviderMessageId(
            @Param("providerMessageId") String providerMessageId,
            @Param("billable") Boolean billable,
            @Param("type") String type,
            @Param("category") String category,
            @Param("model") String model,
            @Param("reportedAt") Instant reportedAt);
}
