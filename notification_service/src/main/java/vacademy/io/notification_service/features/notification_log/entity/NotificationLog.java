package vacademy.io.notification_service.features.notification_log.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;

@Entity
@Table(name = "notification_log")
@Getter
@Setter
public class NotificationLog {

    @Id
    @Column(length = 255, nullable = false)
    @UuidGenerator
    private String id;

    // 50, matching the column: the real values are longer than the 20 this used to declare
    // ("WHATSAPP_MESSAGE_OUTGOING" is 25), so any schema generated from the entity rejected the
    // service's own writes.
    @Column(name = "notification_type", length = 50, nullable = false)
    private String notificationType;

    @Column(name = "channel_id", length = 255, nullable = false)
    private String channelId;

    @Column(name = "body")
    private String body;

    @Column(name = "source", length = 255)
    private String source;

    @Column(name = "source_id", length = 255)
    private String sourceId;

    @Column(name = "user_id", length = 255)
    private String userId;

    @Column(name = "notification_date")
    private Instant notificationDate;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "sender_business_channel_id")
    private String senderBusinessChannelId;

    @Column(name = "message_payload", columnDefinition = "TEXT")
    private String messagePayload;

    @Column(name = "sender_name")
    private String senderName;

    @Column(name = "institute_id", length = 255)
    private String instituteId;

    /**
     * Caller-supplied correlation key (e.g. an Engagement Engine action id) stamped at send time
     * and copied onto the status/read rows the webhooks write for the same message. Distinct from
     * source_id, which carries the provider message id (WhatsApp wamid / email Message-ID) that
     * webhook joins depend on — the two must never share a column. Added V31.
     */
    @Column(name = "correlation_id", length = 255)
    private String correlationId;

    /**
     * What the provider actually DID with an outbound message — SENT, DELIVERED, READ or FAILED —
     * copied onto this row by the status webhook via source_id (wamid). Distinct from the send-time
     * record in {@link #body}, which only says the provider accepted the request: a 2xx from Meta is
     * a queue receipt, not a delivery.
     * <p>
     * NULL means no status webhook has been seen for this message (not yet, never subscribed, or a
     * provider that does not report). Readers must keep their pre-V33 behaviour for NULL instead of
     * treating it as a failure. Added V33.
     */
    @Column(name = "delivery_status", length = 20)
    private String deliveryStatus;

    /**
     * Provider error code when deliveryStatus is FAILED (e.g. Meta 131042). 50, not 6: WATI reports
     * codes as free text, and a value that overflowed would abort the whole reconciliation. Added V33.
     */
    @Column(name = "delivery_error_code", length = 50)
    private String deliveryErrorCode;

    /** Human-readable provider failure reason when deliveryStatus is FAILED. Added V33. */
    @Column(name = "delivery_error_message", length = 500)
    private String deliveryErrorMessage;

    /** When the status webhook that set deliveryStatus was reported by the provider. Added V33. */
    @Column(name = "delivery_updated_at")
    private Instant deliveryUpdatedAt;

    /*
     * Meta's pricing for an outbound WhatsApp message, copied from the `pricing` object on its
     * status webhook by WhatsAppPricingRecorder (matched by wamid in source_id). Meta sends no
     * amount: type is regular / free_customer_service / free_entry_point / ..., category is
     * marketing / utility / authentication / service / ..., model is CBP or PMP. NULL = no pricing
     * seen. Read-only here (insertable/updatable = false): only that recorder's UPDATE writes them,
     * so an entity loaded before the webhook and saved after it can never wipe them. Added V39.
     */
    @Column(name = "pricing_billable", insertable = false, updatable = false)
    private Boolean pricingBillable;

    @Column(name = "pricing_type", length = 40, insertable = false, updatable = false)
    private String pricingType;

    @Column(name = "pricing_category", length = 40, insertable = false, updatable = false)
    private String pricingCategory;

    @Column(name = "pricing_model", length = 10, insertable = false, updatable = false)
    private String pricingModel;

    @Column(name = "pricing_updated_at", insertable = false, updatable = false)
    private Instant pricingUpdatedAt;
}
