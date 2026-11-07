package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * Singleton table holding Vacademy's own Razorpay credentials and supplier
 * identity for the AI credit pack purchase flow. Only one row may ever exist
 * (enforced by the DB CHECK on {@code singleton_lock}).
 *
 * Distinct from {@code institute_payment_gateway_mapping} which holds
 * per-institute credentials for institute -> learner payments.
 *
 * Secrets ({@link #keySecretEncrypted}, {@link #webhookSecretEncrypted}) are
 * AES-256-GCM encrypted via TokenEncryptionService before persisting.
 */
@Entity
@Table(name = "platform_payment_config")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformPaymentConfig {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "singleton_lock", nullable = false)
    private Boolean singletonLock;

    @Column(name = "vendor", nullable = false, length = 32)
    private String vendor;

    @Column(name = "api_key", nullable = false, length = 255)
    private String apiKey;

    @Column(name = "key_secret_encrypted", nullable = false, columnDefinition = "TEXT")
    private String keySecretEncrypted;

    @Column(name = "webhook_secret_encrypted", nullable = false, columnDefinition = "TEXT")
    private String webhookSecretEncrypted;

    @Column(name = "supplier_legal_name", nullable = false, length = 255)
    private String supplierLegalName;

    @Column(name = "supplier_gstin", length = 15)
    private String supplierGstin;

    @Column(name = "supplier_state_code", nullable = false, length = 2)
    private String supplierStateCode;

    @Column(name = "supplier_address", nullable = false, columnDefinition = "TEXT")
    private String supplierAddress;

    @Column(name = "is_active", nullable = false)
    private Boolean isActive;

    // ── V590: document / email identity ──────────────────────────────
    /** Trade name shown next to the legal supplier in VACADEMY brand mode. */
    @Column(name = "trade_name", nullable = false, length = 120)
    private String tradeName = "Vacademy";

    /** Logo shown in VACADEMY brand mode (never in NEUTRAL). */
    @Column(name = "brand_logo_url", columnDefinition = "TEXT")
    private String brandLogoUrl;

    /** Short brand-free name for NEUTRAL surfaces (e.g. the Razorpay checkout name). */
    @Column(name = "neutral_display_name", nullable = false, length = 120)
    private String neutralDisplayName = "Vidyayatan Technologies";

    @Column(name = "billing_support_email", length = 255)
    private String billingSupportEmail;

    @Column(name = "billing_from_name", length = 120)
    private String billingFromName;

    @Column(name = "billing_from_email", length = 255)
    private String billingFromEmail;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private LocalDateTime updatedAt;
}
