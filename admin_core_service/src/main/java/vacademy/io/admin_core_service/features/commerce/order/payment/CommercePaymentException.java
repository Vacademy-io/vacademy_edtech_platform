package vacademy.io.admin_core_service.features.commerce.order.payment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.Date;

/**
 * Money that arrived and that the system could not use (V686): an order paid after its stock
 * was gone, or a second captured payment for an order that was already paid. Staff work from
 * these rows until the automatic refund (WP-32) exists. Rows are written by one INSERT that
 * does nothing on a repeat, never by an entity save.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_payment_exception")
public class CommercePaymentException {

    public static final String KIND_OVERSOLD_PAID = "OVERSOLD_PAID";
    public static final String KIND_DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT";
    /** Money of a paid order due back after a cancel, a line cancel or an RTO (V688). */
    public static final String KIND_REFUND_DUE = "REFUND_DUE";
    public static final String STATUS_OPEN = "OPEN";
    public static final String STATUS_RESOLVED = "RESOLVED";

    @Id
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "commerce_order_id", nullable = false)
    private String commerceOrderId;

    @Column(name = "order_number", length = 40)
    private String orderNumber;

    @Column(name = "kind", nullable = false, length = 32)
    private String kind;

    @Column(name = "gateway_order_id", length = 64)
    private String gatewayOrderId;

    /** Empty when the payment id is not known (an oversold order is one row per order). */
    @Column(name = "gateway_payment_id", nullable = false, length = 64)
    private String gatewayPaymentId = "";

    @Column(name = "amount", precision = 14, scale = 2)
    private BigDecimal amount;

    @Column(name = "currency", length = 8)
    private String currency;

    @Column(name = "status", nullable = false, length = 16)
    private String status = STATUS_OPEN;

    @Column(name = "detail", length = 500)
    private String detail;

    @Column(name = "resolved_at")
    private Date resolvedAt;

    @Column(name = "resolved_by", length = 36)
    private String resolvedBy;

    @Column(name = "resolution_note", length = 500)
    private String resolutionNote;

    /** The automatic refund made for an OVERSOLD_PAID or DUPLICATE_PAYMENT row (V710). */
    @Column(name = "refund_id", length = 36)
    private String refundId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
