package vacademy.io.admin_core_service.features.commerce.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.util.Date;

/** How an order is (to be) paid; every order has at least one row. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_order_tender")
public class CommerceOrderTender extends CommerceCatalogueEntity {

    public static final String MODE_GATEWAY = "GATEWAY";
    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_RECEIVED = "RECEIVED";
    public static final String STATUS_VOID = "VOID";

    @Column(name = "order_id", nullable = false, updatable = false, length = 36)
    private String orderId;

    @Column(name = "pos_session_id", length = 36)
    private String posSessionId;

    @Column(name = "mode", nullable = false, length = 32)
    private String mode;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "reference", length = 100)
    private String reference;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "received_at")
    private Date receivedAt;

    @Column(name = "recorded_by", length = 36)
    private String recordedBy;

    @Column(name = "money_account_id", length = 36)
    private String moneyAccountId;
}
