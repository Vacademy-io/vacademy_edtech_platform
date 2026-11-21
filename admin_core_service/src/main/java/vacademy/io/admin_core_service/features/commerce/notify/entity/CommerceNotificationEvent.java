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
 * One order event worth a message to the buyer (the outbox). Written in the same transaction
 * as the order change by a native insert; ids only, no personal data.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_notification_event")
public class CommerceNotificationEvent {

    public static final String PENDING = "PENDING";
    public static final String PLANNED = "PLANNED";
    public static final String SKIPPED = "SKIPPED";

    @Id
    @Column(name = "id", length = 36, nullable = false)
    private String id;

    @Column(name = "institute_id", length = 36, nullable = false)
    private String instituteId;

    @Column(name = "order_id", length = 36, nullable = false)
    private String orderId;

    @Column(name = "trigger_code", length = 32, nullable = false)
    private String triggerCode;

    @Column(name = "ref_id", length = 36, nullable = false)
    private String refId = "";

    @Column(name = "status", length = 16, nullable = false)
    private String status = PENDING;

    @Column(name = "skip_reason", length = 32)
    private String skipReason;

    @Column(name = "attempts", nullable = false)
    private Short attempts = 0;

    @Column(name = "next_attempt_at", nullable = false)
    private Date nextAttemptAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "planned_at")
    private Date plannedAt;
}
