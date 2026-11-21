package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;

/**
 * Per-pack line item under a {@link PlatformPayment}. Snapshot fields preserve
 * the pack's identity + price + tax rate at purchase time so later catalog
 * edits cannot mutate historical orders.
 *
 * tax_rate_bps is in basis points (1800 = 18.00%).
 *
 * <p>V590: {@link #itemKind} CREDIT_PACK (pack_id required, DB CHECK
 * ck_ppi_pack_required) or AI_SUBSCRIPTION (pack_id NULL, {@link #subscriptionChargeId}
 * set, pack_code_snapshot 'AI_SUB:&lt;plan_key&gt;', credits 0). The line
 * description is {@link #descriptionSnapshot} for pack-less items.
 */
@Entity
@Table(name = "platform_payment_item")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformPaymentItem {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "platform_payment_id", nullable = false)
    private String platformPaymentId;

    /** NULL for AI_SUBSCRIPTION items (V590). */
    @Column(name = "pack_id")
    private String packId;

    @Column(name = "pack_code_snapshot", nullable = false, length = 64)
    private String packCodeSnapshot;

    @Column(name = "credits", nullable = false, precision = 12, scale = 2)
    private BigDecimal credits;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "base_amount_minor", nullable = false)
    private Long baseAmountMinor;

    @Column(name = "tax_rate_bps", nullable = false)
    private Integer taxRateBps;

    @Column(name = "tax_amount_minor", nullable = false)
    private Long taxAmountMinor;

    @Column(name = "total_amount_minor", nullable = false)
    private Long totalAmountMinor;

    @Column(name = "hsn_sac_snapshot", nullable = false, length = 8)
    private String hsnSacSnapshot;

    @Enumerated(EnumType.STRING)
    @Column(name = "item_kind", nullable = false, length = 16)
    private PlatformPaymentItemKind itemKind = PlatformPaymentItemKind.CREDIT_PACK;

    /** ai_subscription_charge.id (UUID text) for AI_SUBSCRIPTION items. */
    @Column(name = "subscription_charge_id", length = 36)
    private String subscriptionChargeId;

    @Column(name = "description_snapshot", length = 255)
    private String descriptionSnapshot;

    @Column(name = "service_period_start")
    private Instant servicePeriodStart;

    @Column(name = "service_period_end")
    private Instant servicePeriodEnd;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
