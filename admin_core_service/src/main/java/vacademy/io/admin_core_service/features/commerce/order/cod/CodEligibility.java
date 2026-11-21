package vacademy.io.admin_core_service.features.commerce.order.cod;

import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

import java.math.BigDecimal;

/**
 * Whether a cart may be paid on delivery, with a stable reason code when it may not
 * (the storefront turns the code into one line of copy). Rules of
 * Phase 1: the seller switched COD on, the order is not above the seller's maximum, and the
 * pincode is not on the seller's blocked list. A COD order always needs the phone OTP; above
 * the "we call to confirm" amount it is placed as COD_PENDING_CONFIRMATION.
 *
 * <p>The limit on open COD orders per phone needs the order tables and is checked at checkout
 * with {@link #OPEN_COD_ORDERS}; it cannot be answered for a cart.
 */
public final class CodEligibility {

    public static final String COD_DISABLED = "COD_DISABLED";
    public static final String CART_EMPTY = "CART_EMPTY";
    public static final String PINCODE_INVALID = "PINCODE_INVALID";
    public static final String PINCODE_BLOCKED = "PINCODE_BLOCKED";
    public static final String ORDER_ABOVE_COD_LIMIT = "ORDER_ABOVE_COD_LIMIT";
    /** Reserved for checkout. */
    public static final String OPEN_COD_ORDERS = "OPEN_COD_ORDERS";

    /**
     * {@code pincodeChecked} is false when no pincode was given: the answer then says only that
     * the amount qualifies, and the blocked list is applied once the shopper types a pincode.
     */
    public record Result(boolean eligible, String reasonCode, boolean needsStaffConfirmation,
                         boolean pincodeChecked, BigDecimal charge, BigDecimal maxOrderValue,
                         BigDecimal totalWithCod) {
    }

    private CodEligibility() {
    }

    /**
     * @param totalWithCod what the shopper would pay on delivery, COD charge included
     * @param pincode      the delivery pincode; null or blank when not known yet
     * @param codCharge    the seller's COD charge (zero when none)
     */
    public static Result check(StorefrontSettings.Cod cod, BigDecimal totalWithCod, String pincode,
                               BigDecimal codCharge) {
        BigDecimal charge = codCharge == null ? BigDecimal.ZERO.setScale(2) : codCharge;
        BigDecimal total = totalWithCod == null ? BigDecimal.ZERO : totalWithCod;
        String pin = pincode == null || pincode.isBlank() ? null : pincode.replace(" ", "");
        boolean pinKnown = pin != null;
        boolean pinValid = pinKnown && pin.matches("[1-9][0-9]{5}");
        String reason = null;
        if (cod == null || !cod.enabled()) {
            reason = COD_DISABLED;
        } else if (total.signum() <= 0) {
            reason = CART_EMPTY;
        } else if (pinKnown && !pinValid) {
            reason = PINCODE_INVALID;
        } else if (pinKnown && cod.blockedPincodes().contains(pin)) {
            reason = PINCODE_BLOCKED;
        } else if (total.compareTo(cod.maxOrderValue()) > 0) {
            reason = ORDER_ABOVE_COD_LIMIT;
        }
        boolean eligible = reason == null;
        boolean confirm = eligible && total.compareTo(cod.staffConfirmThreshold()) > 0;
        return new Result(eligible, reason, confirm, pinValid, charge, cod == null ? null : cod.maxOrderValue(), total);
    }
}
