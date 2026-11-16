package vacademy.io.admin_core_service.features.commerce.document.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;

/** One line of a credit note. It copies the HSN code, rate and tax split of the invoice line it credits. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_credit_note_line")
public class CommerceCreditNoteLine extends CommerceCatalogueEntity {

    @Column(name = "credit_note_id", nullable = false, updatable = false, length = 36)
    private String creditNoteId;

    @Column(name = "invoice_line_item_id", nullable = false, updatable = false, length = 255)
    private String invoiceLineItemId;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "hsn_code", length = 16)
    private String hsnCode;

    @Column(name = "unit", length = 32)
    private String unit;

    /** Base units credited. */
    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    @Column(name = "unit_price", precision = 12, scale = 2)
    private BigDecimal unitPrice;

    @Column(name = "tax_rate", nullable = false, precision = 6, scale = 3)
    private BigDecimal taxRate;

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

    /** Tax-inclusive value credited on this line. */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    /** Cost of the goods coming back; copied from the order line on a return. */
    @Column(name = "cost_total", precision = 12, scale = 2)
    private BigDecimal costTotal;

    @Column(name = "package_session_id", length = 255)
    private String packageSessionId;

    @Column(name = "piece_id", length = 36)
    private String pieceId;
}
