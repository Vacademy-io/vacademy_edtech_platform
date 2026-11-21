package vacademy.io.admin_core_service.features.commerce.order.cod;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Date;

/**
 * Cash a courier paid over for delivered cash-on-delivery orders (V688). One row per courier
 * statement ({@code reference}, unique per institute); each order it settles names it in
 * {@code commerce_order.cod_remittance_id}. Written once by
 * {@link CommerceCodRemittanceService}; never updated.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_cod_remittance")
public class CommerceCodRemittance {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "reference", nullable = false, updatable = false, length = 100)
    private String reference;

    @Column(name = "courier_name", updatable = false, length = 100)
    private String courierName;

    @Column(name = "received_on", nullable = false, updatable = false)
    private LocalDate receivedOn;

    @Column(name = "gross_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal grossAmount;

    @Column(name = "deductions", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal deductions;

    @Column(name = "net_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal netAmount;

    @Column(name = "orders_total", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal ordersTotal;

    @Column(name = "order_count", nullable = false, updatable = false)
    private Integer orderCount;

    @Column(name = "difference_reason", updatable = false, length = 500)
    private String differenceReason;

    @Column(name = "note", updatable = false, length = 500)
    private String note;

    @Column(name = "recorded_by", nullable = false, updatable = false, length = 36)
    private String recordedBy;

    @Column(name = "money_account_id", updatable = false, length = 36)
    private String moneyAccountId;

    @Column(name = "client_request_id", nullable = false, updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
