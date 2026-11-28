package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** Header of a goods receipt (V681). Status changes are compare-and-set UPDATEs. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_receipt")
public class StockReceipt extends CommerceCatalogueEntity {

    @Column(name = "receipt_number", nullable = false, updatable = false, length = 32)
    private String receiptNumber;

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "source_kind", nullable = false, updatable = false, length = 32)
    private String sourceKind;

    @Column(name = "source_location_id", updatable = false, length = 36)
    private String sourceLocationId;

    @Column(name = "supplier_id", updatable = false, length = 36)
    private String supplierId;

    @Column(name = "supplier_challan_number", updatable = false, length = 64)
    private String supplierChallanNumber;

    @Column(name = "supplier_challan_date", updatable = false)
    private LocalDate supplierChallanDate;

    @Column(name = "eway_bill_no", updatable = false, length = 32)
    private String ewayBillNo;

    @Column(name = "eway_bill_date", updatable = false)
    private LocalDate ewayBillDate;

    @Column(name = "received_date", nullable = false, updatable = false)
    private LocalDate receivedDate;

    @Column(name = "status", nullable = false, updatable = false, length = 32)
    private String status;

    @Column(name = "bill_status", nullable = false, updatable = false, length = 32)
    private String billStatus;

    @Column(name = "no_bill_reason", updatable = false, length = 32)
    private String noBillReason;

    @Column(name = "note", updatable = false, columnDefinition = "TEXT")
    private String note;

    @Column(name = "received_by", updatable = false, length = 36)
    private String receivedBy;

    @Column(name = "posted_at", updatable = false)
    private LocalDateTime postedAt;

    @Column(name = "reversed_by", updatable = false, length = 36)
    private String reversedBy;

    @Column(name = "reversed_at", updatable = false)
    private LocalDateTime reversedAt;

    @Column(name = "client_request_id", updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", updatable = false, length = 64)
    private String requestHash;
}
