package vacademy.io.admin_core_service.features.commerce.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;

/**
 * One line of an order, frozen at placement. An ITEM line owns
 * one {@code user_plan} and one {@code payment_log}; a SHIPPING line owns neither.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_order_line")
public class CommerceOrderLine extends CommerceCatalogueEntity {

    public static final String TYPE_ITEM = "ITEM";
    public static final String TYPE_SHIPPING = "SHIPPING";
    public static final String TYPE_COD_CHARGE = "COD_CHARGE";

    @Column(name = "order_id", nullable = false, updatable = false, length = 36)
    private String orderId;

    @Column(name = "line_no", nullable = false, updatable = false)
    private Integer lineNo;

    @Column(name = "line_ref", updatable = false, length = 64)
    private String lineRef;

    @Column(name = "user_plan_id", length = 36)
    private String userPlanId;

    @Column(name = "payment_log_id", length = 36)
    private String paymentLogId;

    @Column(name = "package_session_id", updatable = false, length = 36)
    private String packageSessionId;

    @Column(name = "package_id", updatable = false, length = 36)
    private String packageId;

    @Column(name = "piece_id", length = 36)
    private String pieceId;

    @Column(name = "line_type", nullable = false, updatable = false, length = 16)
    private String lineType;

    @Column(name = "name_snapshot", updatable = false, length = 500)
    private String nameSnapshot;

    @Column(name = "sku_snapshot", updatable = false, length = 100)
    private String skuSnapshot;

    @Column(name = "variant_label", updatable = false, length = 300)
    private String variantLabel;

    @Column(name = "unit", updatable = false, length = 32)
    private String unit;

    @Column(name = "qty_scale", nullable = false, updatable = false)
    private Integer qtyScale;

    @Column(name = "quantity", nullable = false, updatable = false)
    private Integer quantity;

    @Column(name = "unit_price", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal unitPrice;

    @Column(name = "mrp", updatable = false, precision = 12, scale = 2)
    private BigDecimal mrp;

    @Column(name = "gross", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal gross;

    @Column(name = "discount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal discount;

    @Column(name = "price_override_by", length = 36)
    private String priceOverrideBy;

    @Column(name = "tax_class_id", updatable = false, length = 36)
    private String taxClassId;

    @Column(name = "hsn_code", updatable = false, length = 16)
    private String hsnCode;

    @Column(name = "tax_rate", updatable = false, precision = 6, scale = 3)
    private BigDecimal taxRate;

    @Column(name = "taxable_value", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal taxableValue;

    @Column(name = "tax_amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal taxAmount;

    @Column(name = "line_total", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal lineTotal;

    /** What the line's payment log carries; the logs of an order sum to the order total. */
    @Column(name = "log_amount", precision = 12, scale = 2)
    private BigDecimal logAmount;

    @Column(name = "weight_grams", updatable = false)
    private Integer weightGrams;

    @Column(name = "qty_cancelled", nullable = false)
    private Integer qtyCancelled = 0;

    @Column(name = "qty_shipped", nullable = false)
    private Integer qtyShipped = 0;

    @Column(name = "qty_returned", nullable = false)
    private Integer qtyReturned = 0;

    @Column(name = "cost_total", precision = 12, scale = 2)
    private BigDecimal costTotal;

    // -- Order desk (V688) --

    /** Open units of this line that are no longer on the shelf; cleared by ship, cancel or staff. */
    @Column(name = "stock_short_qty", nullable = false)
    private Integer stockShortQty = 0;

    /** The catalogue price of one unit when staff typed another price (price_override_by set). */
    @Column(name = "list_unit_price", updatable = false, precision = 12, scale = 2)
    private BigDecimal listUnitPrice;

    /** What the cancelled units of this line took off the order total (tax included). */
    @Column(name = "cancelled_value", nullable = false, precision = 12, scale = 2)
    private BigDecimal cancelledValue = BigDecimal.ZERO.setScale(2);

    /** What the credit notes of this line's returns gave back (V710). */
    @Column(name = "returned_value", nullable = false, precision = 12, scale = 2)
    private BigDecimal returnedValue = BigDecimal.ZERO.setScale(2);

    /** Units still to ship or ship again: quantity less cancelled and shipped. */
    public int openQuantity() {
        return quantity - (qtyCancelled == null ? 0 : qtyCancelled) - (qtyShipped == null ? 0 : qtyShipped);
    }

    /** Units not cancelled. */
    public int liveQuantity() {
        return quantity - (qtyCancelled == null ? 0 : qtyCancelled);
    }
}
