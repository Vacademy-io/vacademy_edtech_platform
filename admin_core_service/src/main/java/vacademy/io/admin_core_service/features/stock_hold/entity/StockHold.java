package vacademy.io.admin_core_service.features.stock_hold.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** One stock movement a checkout made on a stock-tracked package session (V640). */
@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "stock_hold")
public class StockHold {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "package_session_id", nullable = false)
    private String packageSessionId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "institute_id")
    private String instituteId;

    /** The plan that owns this hold; for RENT_PREFERENCE, the membership plan. */
    @Column(name = "user_plan_id")
    private String userPlanId;

    /** The order's gateway payment log — shared by every hold of a multi-item order. */
    @Column(name = "payment_log_id")
    private String paymentLogId;

    /** {@link vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind} name. */
    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    /** {@link vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldStatus} name. */
    @Column(name = "status", nullable = false)
    private String status;

    /** RENT_PREFERENCE only: the admin assignment plan that took this book. */
    @Column(name = "claimed_by_user_plan_id")
    private String claimedByUserPlanId;

    /** Paid after the hold was released and the stock was gone — fulfilled anyway. */
    @Column(name = "oversold", nullable = false)
    private Boolean oversold = false;

    @Column(name = "expires_at")
    private Date expiresAt;

    /** SHA-256 (hex) of the token the public release call must present. Never the token. */
    @Column(name = "release_token_hash", length = 64)
    private String releaseTokenHash;

    /** Commerce: the stock location this hold will be fulfilled from. */
    @Column(name = "fulfilment_location_id", length = 36)
    private String fulfilmentLocationId;

    /** Why a hold ended: EXPIRED, SHOPPER, or the reason a commerce flow gave. */
    @Column(name = "release_reason", length = 32)
    private String releaseReason;

    /**
     * The raw release token, present only on the objects {@code StockHoldService.hold} returns
     * so the checkout can hand it to the storefront. It is not stored.
     */
    @Transient
    private String releaseToken;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
