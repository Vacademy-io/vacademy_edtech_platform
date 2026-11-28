package vacademy.io.admin_core_service.features.one_off_due.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * A single extra charge staff raised for one learner.
 *
 * <p>The money side lives on an ordinary admin invoice (source ADMIN_MANUAL): that is what the
 * learner pays online through the institute's gateway, what the fee screens and the account
 * ledger already show, and what staff can mark paid offline. This row adds what an invoice has no
 * place for: the batch it relates to, a staff note, and where it came from (manual or a feature
 * such as a re-entry bridge class). Its status is read from the invoice.
 */
@Entity
@Table(name = "one_off_due")
@Getter
@Setter
@NoArgsConstructor
public class OneOffDue {

    public static final String SOURCE_MANUAL = "MANUAL";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    /** The admin invoice that carries the charge. Null only if that invoice was deleted. */
    @Column(name = "invoice_id")
    private String invoiceId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "title", nullable = false)
    private String title;

    /** Staff-only note; never printed on the invoice. */
    @Column(name = "note")
    private String note;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount;

    @Column(name = "currency")
    private String currency;

    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    @Column(name = "source_type", nullable = false)
    private String sourceType;

    @Column(name = "source_id")
    private String sourceId;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "cancelled_by")
    private String cancelledBy;

    @Column(name = "cancelled_at")
    private LocalDateTime cancelledAt;

    @Column(name = "cancel_reason")
    private String cancelReason;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID().toString();
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
