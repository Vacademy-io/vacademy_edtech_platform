package vacademy.io.admin_core_service.features.commerce.order.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRequest;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;

import java.math.BigDecimal;
import java.util.List;

/**
 * The priced cart as an order stores it (documents never recompute from live
 * settings). Checkout calls {@code priceCart} again, writes this object as JSON on the order
 * and hands {@link #tax} to the invoice issuer unchanged, so the price a shopper saw, the order
 * and the invoice are one calculation. {@link #taxRequest} is everything the tax calculator was
 * given: {@code CommerceTaxCalculator.calculate(taxRequest)} always returns {@link #tax} again.
 *
 * <p>Internal: it carries tax class rules and the fulfilment location, and is never sent to a
 * shopper.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CartPriceSnapshot {

    public static final int CURRENT_VERSION = 1;

    private int version;
    private String instituteId;
    /** ISO-8601 instant, UTC. */
    private String pricedAt;
    private String currency;
    private String locale;
    /** PREPAID or COD, as applied. */
    private String paymentMethod;
    private String pincode;
    /** GST state code of the delivery address, or null when not known at pricing time. */
    private String placeOfSupplyState;
    /** REQUEST, DIRECTORY, PIN_PREFIX or null. */
    private String placeOfSupplySource;
    /** The location whose seller details were used, or null for the institute. */
    private String fulfilmentLocationId;
    private List<Line> lines;
    private List<Discount> discounts;
    private Shipping shipping;
    private BigDecimal codCharge;
    private TaxRequest taxRequest;
    private TaxResult tax;
    private BigDecimal total;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Line {
        /** Equals the {@code line_ref} of the tax lines. */
        private String lineRef;
        private String packageSessionId;
        private String packageId;
        private String sku;
        private String name;
        /** The option values of the variant ("Red / M"); already part of {@code name}. */
        private String variantLabel;
        private int quantity;
        private int qtyScale;
        private String unit;
        private BigDecimal unitPrice;
        private BigDecimal mrp;
        private String taxClassId;
        private Integer weightGrams;
        /** The catalogue price of one unit when staff typed another {@link #unitPrice}; else null. */
        private BigDecimal listUnitPrice;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Discount {
        /** BASKET, OFFER or COUPON. */
        private String kind;
        private String label;
        private String code;
        private BigDecimal amount;
        /** For a coupon: the rows checkout redeems. */
        private String couponCodeId;
        private String appliedCouponDiscountId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Shipping {
        private String ruleId;
        private String basis;
        private BigDecimal baseCharge;
        private BigDecimal charge;
        private BigDecimal freeAbove;
        private long weightGrams;
    }
}
