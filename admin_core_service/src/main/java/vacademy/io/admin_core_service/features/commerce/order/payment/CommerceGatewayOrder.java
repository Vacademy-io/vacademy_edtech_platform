package vacademy.io.admin_core_service.features.commerce.order.payment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * One order created at the payment gateway for a commerce order (V686). It ties a payment to an
 * order: the amount and the commerce order of a payment are read from this row, found by the
 * gateway order id of the payment itself.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_gateway_order")
public class CommerceGatewayOrder {

    public static final String STATUS_CREATED = "CREATED";
    public static final String STATUS_AUTHORIZED = "AUTHORIZED";
    public static final String STATUS_PAID = "PAID";
    public static final String STATUS_FAILED = "FAILED";

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "commerce_order_id", nullable = false)
    private String commerceOrderId;

    @Column(name = "vendor", nullable = false, length = 32)
    private String vendor;

    @Column(name = "gateway_order_id", nullable = false, length = 64)
    private String gatewayOrderId;

    /** The public key id the storefront opens the gateway checkout with. Not a secret. */
    @Column(name = "key_id", length = 64)
    private String keyId;

    @Column(name = "amount_minor", nullable = false)
    private Long amountMinor;

    @Column(name = "currency", nullable = false, length = 8)
    private String currency;

    @Column(name = "receipt", length = 64)
    private String receipt;

    @Column(name = "status", nullable = false, length = 16)
    private String status = STATUS_CREATED;

    @Column(name = "gateway_payment_id", length = 64)
    private String gatewayPaymentId;

    @Column(name = "status_at")
    private Date statusAt;

    @Column(name = "settled_at")
    private Date settledAt;

    /** True on the one row whose payment claimed the payment logs of the order. */
    @Column(name = "paying", nullable = false)
    private Boolean paying = false;

    // The lost-webhook fetch (V687). Written only by the repository's fetch updates.
    @Column(name = "fetch_count", nullable = false, insertable = false, updatable = false)
    private Integer fetchCount = 0;

    @Column(name = "next_fetch_at", insertable = false, updatable = false)
    private Date nextFetchAt;

    @Column(name = "last_fetched_at", insertable = false, updatable = false)
    private Date lastFetchedAt;

    @Column(name = "final_fetched_at", insertable = false, updatable = false)
    private Date finalFetchedAt;

    @Column(name = "fetch_errors", nullable = false, insertable = false, updatable = false)
    private Integer fetchErrors = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
