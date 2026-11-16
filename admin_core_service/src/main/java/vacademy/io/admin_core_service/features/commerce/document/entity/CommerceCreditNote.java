package vacademy.io.admin_core_service.features.commerce.document.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDate;

/** A credit note against a commerce invoice. Amounts are positive; the document itself is the credit. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_credit_note")
public class CommerceCreditNote extends CommerceCatalogueEntity {

    @Column(name = "credit_note_number", nullable = false, updatable = false, length = 100)
    private String creditNoteNumber;

    @Column(name = "series_id", nullable = false, updatable = false, length = 36)
    private String seriesId;

    @Column(name = "invoice_id", nullable = false, updatable = false, length = 255)
    private String invoiceId;

    @Column(name = "commerce_order_id", length = 36)
    private String commerceOrderId;

    @Column(name = "return_id", length = 36)
    private String returnId;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Column(name = "document_date", nullable = false)
    private LocalDate documentDate;

    @Column(name = "seller_gstin", length = 15)
    private String sellerGstin;

    @Column(name = "seller_state_code", length = 8)
    private String sellerStateCode;

    @Column(name = "buyer_gstin", length = 15)
    private String buyerGstin;

    @Column(name = "place_of_supply_state", length = 8)
    private String placeOfSupplyState;

    @Column(name = "tax_head", nullable = false, length = 32)
    private String taxHead;

    @Column(name = "taxable_value", nullable = false, precision = 12, scale = 2)
    private BigDecimal taxableValue;

    @Column(name = "cgst", nullable = false, precision = 12, scale = 2)
    private BigDecimal cgst;

    @Column(name = "sgst", nullable = false, precision = 12, scale = 2)
    private BigDecimal sgst;

    @Column(name = "igst", nullable = false, precision = 12, scale = 2)
    private BigDecimal igst;

    @Column(name = "cess", nullable = false, precision = 12, scale = 2)
    private BigDecimal cess;

    @Column(name = "tax_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal taxAmount;

    @Column(name = "round_off", nullable = false, precision = 12, scale = 2)
    private BigDecimal roundOff;

    @Column(name = "total", nullable = false, precision = 12, scale = 2)
    private BigDecimal total;

    @Column(name = "currency", nullable = false, length = 10)
    private String currency;

    @Column(name = "pdf_file_id", length = 255)
    private String pdfFileId;

    @Column(name = "created_by", length = 36)
    private String createdBy;

    /** The caller's request key; unique per institute, so a repeated request issues one note. */
    @Column(name = "client_request_id", nullable = false, updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;
}
