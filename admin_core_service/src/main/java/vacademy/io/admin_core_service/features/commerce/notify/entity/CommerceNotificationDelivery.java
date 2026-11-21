package vacademy.io.admin_core_service.features.commerce.notify.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Date;

/**
 * One channel of one event: the dedupe key of "one message per order, trigger, ref and
 * channel". The address itself is never stored: only an HMAC of it and a masked form.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_notification_delivery")
public class CommerceNotificationDelivery {

    public static final String EMAIL = "EMAIL";
    public static final String WHATSAPP = "WHATSAPP";
    public static final String WORKFLOW = "WORKFLOW";

    public static final String PENDING = "PENDING";
    public static final String SENDING = "SENDING";
    public static final String SENT = "SENT";
    public static final String FAILED = "FAILED";
    public static final String SKIPPED = "SKIPPED";
    public static final String UNKNOWN = "UNKNOWN";
    public static final String EXPIRED = "EXPIRED";

    @Id
    @Column(name = "id", length = 36, nullable = false)
    private String id;

    @Column(name = "event_id", length = 36, nullable = false)
    private String eventId;

    @Column(name = "institute_id", length = 36, nullable = false)
    private String instituteId;

    @Column(name = "order_id", length = 36, nullable = false)
    private String orderId;

    @Column(name = "trigger_code", length = 32, nullable = false)
    private String triggerCode;

    @Column(name = "channel", length = 16, nullable = false)
    private String channel;

    @Column(name = "locale", length = 8, nullable = false)
    private String locale;

    @Column(name = "status", length = 16, nullable = false)
    private String status = PENDING;

    @Column(name = "recipient_hash", length = 64)
    private String recipientHash;

    @Column(name = "recipient_masked", length = 64)
    private String recipientMasked;

    @Column(name = "template_name", length = 100)
    private String templateName;

    @Column(name = "attempts", nullable = false)
    private Short attempts = 0;

    @Column(name = "next_attempt_at", nullable = false)
    private Date nextAttemptAt;

    @Column(name = "claimed_at")
    private Date claimedAt;

    @Column(name = "sent_at")
    private Date sentAt;

    @Column(name = "provider_message_id", length = 128)
    private String providerMessageId;

    @Column(name = "error_code", length = 48)
    private String errorCode;

    @Column(name = "error_detail", length = 300)
    private String errorDetail;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", nullable = false)
    private Date updatedAt;
}
