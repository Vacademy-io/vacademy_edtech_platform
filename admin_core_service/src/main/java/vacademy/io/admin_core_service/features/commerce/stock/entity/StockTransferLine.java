package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;

/**
 * One item of a transfer (V730): a quantity of one variant, or one piece. unit_value, hsn_code,
 * sku and item_name are copied at dispatch so the challan reads the same whenever it is printed.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_transfer_line")
public class StockTransferLine extends CommerceCatalogueEntity {

    @Column(name = "transfer_id", nullable = false, updatable = false, length = 36)
    private String transferId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "piece_id", updatable = false, length = 36)
    private String pieceId;

    @Column(name = "qty_sent", nullable = false, updatable = false)
    private Integer qtySent;

    @Column(name = "qty_received")
    private Integer qtyReceived;

    @Column(name = "shortfall_reason", length = 32)
    private String shortfallReason;

    @Column(name = "unit_value", precision = 14, scale = 4)
    private BigDecimal unitValue;

    @Column(name = "hsn_code", length = 16)
    private String hsnCode;

    @Column(name = "sku", length = 64)
    private String sku;

    @Column(name = "item_name", length = 255)
    private String itemName;

    @Column(name = "note", length = 200)
    private String note;
}
