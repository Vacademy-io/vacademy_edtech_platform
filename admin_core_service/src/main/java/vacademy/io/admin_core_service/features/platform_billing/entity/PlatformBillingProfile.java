package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * The buyer's GST identity for bills from the platform (V590 {@code platform_billing_profile},
 * critique #2). One row per institute, keyed by {@code institute_id}.
 *
 * <p>Replaces writing {@code institutes.gstin} / {@code institutes.state_code}, which also feed
 * the institute's own learner receipts. An order copies these fields onto
 * {@link PlatformPayment} (buyer snapshot) and the invoice is built from that snapshot only.
 *
 * <p>DB checks: GSTIN {@code ^[0-9]{2}[A-Z0-9]{13}$} (upper-case it first), state code two digits,
 * and when both are set the GSTIN prefix equals the state code.
 */
@Entity
@Table(name = "platform_billing_profile")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformBillingProfile {

    @Id
    @Column(name = "institute_id", nullable = false, length = 255)
    private String instituteId;

    @Column(name = "legal_name", length = 255)
    private String legalName;

    @Column(name = "gstin", length = 15)
    private String gstin;

    /** Two-digit GST state code ("23" = Madhya Pradesh). */
    @Column(name = "state_code", length = 2)
    private String stateCode;

    @Column(name = "address", columnDefinition = "TEXT")
    private String address;

    @Column(name = "billing_email", length = 255)
    private String billingEmail;

    @Column(name = "updated_by", length = 255)
    private String updatedBy;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    /** Set by the writer on every change (the DB default only covers the insert). */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();
}
