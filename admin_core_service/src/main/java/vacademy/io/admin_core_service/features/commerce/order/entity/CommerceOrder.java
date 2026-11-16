package vacademy.io.admin_core_service.features.commerce.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Date;

/**
 * One header per checkout. Money and status columns are changed
 * only by the conditional UPDATEs of {@code CommerceOrderRepository} or while the row is locked
 * FOR UPDATE; {@link DynamicUpdate} keeps a save from writing back columns it did not change.
 */
@Getter
@Setter
@NoArgsConstructor
@DynamicUpdate
@Entity
@Table(name = "commerce_order")
public class CommerceOrder extends CommerceCatalogueEntity {

    @Column(name = "order_number", nullable = false, updatable = false, length = 32)
    private String orderNumber;

    @Column(name = "payment_group_id", nullable = false, updatable = false, length = 36)
    private String paymentGroupId;

    @Column(name = "channel", nullable = false, updatable = false, length = 16)
    private String channel;

    @Column(name = "user_id", length = 36)
    private String userId;

    @Column(name = "customer_id", length = 36)
    private String customerId;

    @Column(name = "customer_name", length = 200)
    private String customerName;

    @Column(name = "customer_phone", length = 20)
    private String customerPhone;

    @Column(name = "customer_email", length = 320)
    private String customerEmail;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "shipping_address_json", columnDefinition = "jsonb")
    private String shippingAddressJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "billing_address_json", columnDefinition = "jsonb")
    private String billingAddressJson;

    @Column(name = "buyer_gstin", length = 15)
    private String buyerGstin;

    @Column(name = "place_of_supply_state", length = 8)
    private String placeOfSupplyState;

    @Column(name = "subtotal", nullable = false, precision = 12, scale = 2)
    private BigDecimal subtotal;

    @Column(name = "discount", nullable = false, precision = 12, scale = 2)
    private BigDecimal discount;

    @Column(name = "shipping", nullable = false, precision = 12, scale = 2)
    private BigDecimal shipping;

    @Column(name = "cod_charge", nullable = false, precision = 12, scale = 2)
    private BigDecimal codCharge;

    @Column(name = "tax", nullable = false, precision = 12, scale = 2)
    private BigDecimal tax;

    @Column(name = "round_off", nullable = false, precision = 12, scale = 2)
    private BigDecimal roundOff;

    @Column(name = "total", nullable = false, precision = 12, scale = 2)
    private BigDecimal total;

    @Column(name = "amount_paid", nullable = false, precision = 12, scale = 2)
    private BigDecimal amountPaid;

    @Column(name = "currency", nullable = false, length = 8)
    private String currency;

    @Column(name = "payment_method", nullable = false, length = 16)
    private String paymentMethod;

    @Column(name = "payment_status", nullable = false, length = 24)
    private String paymentStatus;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "cancel_reason", length = 32)
    private String cancelReason;

    @Column(name = "cod_amount", precision = 12, scale = 2)
    private BigDecimal codAmount;

    @Column(name = "cod_collected_at")
    private Date codCollectedAt;

    @Column(name = "cod_remittance_id", length = 36)
    private String codRemittanceId;

    @Column(name = "fulfilment_location_id", length = 36)
    private String fulfilmentLocationId;

    @Column(name = "pos_session_id", length = 36)
    private String posSessionId;

    @Column(name = "document_date")
    private LocalDate documentDate;

    @Column(name = "exchange_of_order_id", length = 36)
    private String exchangeOfOrderId;

    @Column(name = "customer_note", length = 500)
    private String customerNote;

    @Column(name = "gift_note", length = 500)
    private String giftNote;

    @Column(name = "client_request_id", updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", updatable = false, length = 64)
    private String requestHash;

    @Column(name = "locale", length = 16)
    private String locale;

    @Column(name = "created_by", updatable = false, length = 36)
    private String createdBy;

    /** The {@code CartPriceSnapshot} of the placement, as JSON. Never recomputed. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "price_snapshot_json", columnDefinition = "jsonb", updatable = false)
    private String priceSnapshotJson;

    @Column(name = "coupon_code", length = 64)
    private String couponCode;

    @Column(name = "applied_coupon_discount_id", length = 36)
    private String appliedCouponDiscountId;

    @Column(name = "primary_payment_log_id", length = 36)
    private String primaryPaymentLogId;

    @Column(name = "gateway_vendor", length = 32)
    private String gatewayVendor;

    @Column(name = "gateway_order_id", length = 64)
    private String gatewayOrderId;

    @Column(name = "gateway_key_id", length = 64)
    private String gatewayKeyId;

    @Column(name = "gateway_attempt_at")
    private Date gatewayAttemptAt;

    @Column(name = "hold_expires_at")
    private Date holdExpiresAt;

    @Column(name = "confirmed_at")
    private Date confirmedAt;

    @Column(name = "cancelled_at")
    private Date cancelledAt;

    /** True when the buyer proved the phone of the order (OTP or shopper session) (V687). */
    @Column(name = "phone_verified", nullable = false)
    private Boolean phoneVerified = false;

    // -- Order desk (V688) --

    /** Money of a paid order that is due back (cancel, line cancel, RTO); never above amount_paid. */
    @Column(name = "refund_due", nullable = false, precision = 12, scale = 2)
    private BigDecimal refundDue = BigDecimal.ZERO.setScale(2);

    /** Open units of the order left the shelf (damage, count, receipt reversal); see stock_short_qty. */
    @Column(name = "stock_short", nullable = false)
    private Boolean stockShort = false;

    @Column(name = "stock_short_at")
    private Date stockShortAt;

    @Column(name = "packed_at")
    private Date packedAt;

    @Column(name = "shipped_at")
    private Date shippedAt;

    @Column(name = "delivered_at")
    private Date deliveredAt;

    /** A COD order above the confirmation amount is cancelled when staff have not confirmed it by then. */
    @Column(name = "cod_confirm_due_at")
    private Date codConfirmDueAt;

    // -- Returns and refunds (V710) --

    /** Sum of the order's ORDER-kind refunds that did not fail; open due = refund_due less this. */
    @Column(name = "refund_committed", nullable = false, precision = 12, scale = 2)
    private BigDecimal refundCommitted = BigDecimal.ZERO.setScale(2);

    /** Sum of the order's ORDER-kind refunds that were paid out (PROCESSED). */
    @Column(name = "amount_refunded", nullable = false, precision = 12, scale = 2)
    private BigDecimal amountRefunded = BigDecimal.ZERO.setScale(2);
}
