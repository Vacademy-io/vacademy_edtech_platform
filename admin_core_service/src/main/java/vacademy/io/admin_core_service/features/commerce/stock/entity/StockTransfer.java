package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.DynamicUpdate;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A move of stock between two own locations (V730). Its state changes only under
 * {@code StockTransferRepository.lockForUpdate}; the stock itself moves through the ledger.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@DynamicUpdate
@Table(name = "stock_transfer")
public class StockTransfer extends CommerceCatalogueEntity {

    @Column(name = "transfer_number", nullable = false, updatable = false, length = 32)
    private String transferNumber;

    @Column(name = "from_location_id", nullable = false, updatable = false, length = 36)
    private String fromLocationId;

    @Column(name = "to_location_id", nullable = false, length = 36)
    private String toLocationId;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "document_type", length = 32)
    private String documentType;

    @Column(name = "document_number", length = 64)
    private String documentNumber;

    @Column(name = "document_series_id", length = 36)
    private String documentSeriesId;

    @Column(name = "document_date")
    private LocalDate documentDate;

    @Column(name = "from_gstin", length = 15)
    private String fromGstin;

    @Column(name = "to_gstin", length = 15)
    private String toGstin;

    @Column(name = "eway_bill_no", length = 32)
    private String ewayBillNo;

    @Column(name = "note", length = 500)
    private String note;

    @Column(name = "receive_note", length = 500)
    private String receiveNote;

    @Column(name = "created_by", updatable = false, length = 36)
    private String createdBy;

    @Column(name = "dispatched_at")
    private LocalDateTime dispatchedAt;

    @Column(name = "dispatched_by", length = 36)
    private String dispatchedBy;

    @Column(name = "received_at")
    private LocalDateTime receivedAt;

    @Column(name = "received_by", length = 36)
    private String receivedBy;

    @Column(name = "cancelled_at")
    private LocalDateTime cancelledAt;

    @Column(name = "cancelled_by", length = 36)
    private String cancelledBy;

    @Column(name = "client_request_id", updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", updatable = false, length = 64)
    private String requestHash;
}
