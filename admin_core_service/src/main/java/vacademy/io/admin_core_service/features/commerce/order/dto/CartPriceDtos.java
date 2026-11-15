package vacademy.io.admin_core_service.features.commerce.order.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Value;

import java.math.BigDecimal;
import java.util.List;

/**
 * The public answer of {@code POST /open/commerce/v1/cart/price} and
 * {@code GET /open/commerce/v1/pincode/{pin}}. Like the catalogue
 * views these classes are the whole public surface: no cost, no tax class id, no stock count
 * above the low threshold, no rule or location id. {@code CartPriceDtosTest} lists the fields.
 */
public final class CartPriceDtos {

    private CartPriceDtos() {
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Line {
        String lineRef;
        String variantId;
        String sku;
        String slug;
        String name;
        /** What tells this variant apart from the others of its product ("Red / M"); null for a product without variants. */
        String variantLabel;
        int quantity;
        int qtyScale;
        /** The quantity moves in steps of this many base units. */
        int qtyStep;
        /** A one-of-a-kind piece: the quantity is always one and the cart shows no stepper. */
        boolean piece;
        String unit;
        /** Tax-inclusive price of one base unit. */
        BigDecimal unitPrice;
        BigDecimal compareAtPrice;
        BigDecimal gross;
        /** This line's share of every discount. */
        BigDecimal discount;
        BigDecimal net;
        String hsnCode;
        BigDecimal taxRatePercent;
        BigDecimal taxableValue;
        BigDecimal taxAmount;
    }

    /** A line that cannot be bought as asked. It is left out of every total. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UnavailableLine {
        String lineRef;
        String variantId;
        String sku;
        /**
         * NOT_FOUND, NO_PRICE, OUT_OF_STOCK, INSUFFICIENT_STOCK, QUANTITY_INVALID, QUANTITY_STEP,
         * QUANTITY_ABOVE_MAX, CURRENCY_MISMATCH.
         */
        String reason;
        /** How many base units can be bought; only when that number is at or below the low threshold. */
        Integer availableQuantity;
        Integer qtyStep;
        /** With QUANTITY_ABOVE_MAX: the most of one variant the shop sells in one order, in base units. */
        Integer maxQuantity;
    }

    /** Something that differs from what the cart showed. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Change {
        String lineRef;
        String variantId;
        /** PRICE_CHANGED or UNAVAILABLE. */
        String type;
        String reason;
        BigDecimal oldUnitPrice;
        BigDecimal newUnitPrice;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Discount {
        /** BASKET, OFFER or COUPON. */
        String kind;
        String label;
        String code;
        BigDecimal amount;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Coupon {
        String code;
        boolean applied;
        /** The coupon validation code (COUPON_APPLIED, INVALID_COUPON, COUPON_EXPIRED, ...). */
        String reason;
        BigDecimal discount;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Shipping {
        /** FLAT, ORDER_VALUE, WEIGHT; null when the seller charges no delivery. */
        String basis;
        BigDecimal charge;
        BigDecimal chargeBeforeFree;
        boolean free;
        BigDecimal freeAbove;
        BigDecimal remainingForFree;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Cod {
        boolean eligible;
        /** COD_DISABLED, CART_EMPTY, PINCODE_INVALID, PINCODE_BLOCKED, ORDER_ABOVE_COD_LIMIT; null when eligible. */
        String reason;
        BigDecimal charge;
        BigDecimal maxOrderValue;
        BigDecimal totalWithCod;
        /** The order would be placed as "we will call to confirm". */
        boolean needsStaffConfirmation;
        boolean otpRequired;
        /** False while no pincode is known: the pincode rule has not been applied yet. */
        boolean pincodeChecked;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TaxRow {
        BigDecimal ratePercent;
        BigDecimal taxableValue;
        BigDecimal cgst;
        BigDecimal sgst;
        BigDecimal igst;
        BigDecimal cess;
        BigDecimal taxAmount;
    }

    /** Prices are tax-inclusive: this is the tax inside the total, not on top of it. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Tax {
        /** CGST_SGST, IGST or NONE. */
        String head;
        String placeOfSupplyState;
        /** False while neither a state nor a pincode with a known state was given: the split is the seller's state. */
        boolean placeOfSupplyKnown;
        BigDecimal taxableValue;
        BigDecimal cgst;
        BigDecimal sgst;
        BigDecimal igst;
        BigDecimal cess;
        BigDecimal taxAmount;
        List<TaxRow> rows;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        BigDecimal subtotal;
        BigDecimal discount;
        BigDecimal shipping;
        BigDecimal codCharge;
        BigDecimal roundOff;
        BigDecimal total;
        int lineCount;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CartPrice {
        String currency;
        /** The method the totals are for: COD only when it was asked for and the cart qualifies. */
        String paymentMethod;
        List<Line> lines;
        List<UnavailableLine> unavailable;
        List<Change> changes;
        List<Discount> discounts;
        Coupon coupon;
        Shipping shipping;
        Cod cod;
        Tax tax;
        Totals totals;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PincodeInfo {
        String pincode;
        String city;
        String stateCode;
        String stateName;
        /** DIRECTORY, PIN_PREFIX or UNKNOWN. */
        String stateSource;
        boolean codAllowed;
        String codReason;
        String dispatchPromise;
    }
}
