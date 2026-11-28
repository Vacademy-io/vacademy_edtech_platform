package vacademy.io.admin_core_service.features.commerce.order.checkout;

import java.util.Locale;

/**
 * How a shop decides who the buyer of an order is ({@code COMMERCE_SETTING.buyerIdentity}).
 * The phone is always collected (the courier needs it); the mode decides the account.
 * <ul>
 *   <li>{@link #PHONE_OTP}: every order needs a phone proved by OTP (or a shopper session);
 *       the buyer is the holder account of that phone. The e-mail is only a contact.</li>
 *   <li>{@link #EMAIL}: the e-mail is required and the buyer is its account.</li>
 *   <li>{@link #EITHER}: a proved phone makes the buyer the holder of that phone; without one
 *       the e-mail is required and the buyer is its account.</li>
 * </ul>
 */
public enum BuyerIdentity {
    PHONE_OTP,
    EMAIL,
    EITHER;

    public static final BuyerIdentity DEFAULT = EITHER;

    /** The mode of a stored value; case is ignored, anything unknown is {@link #DEFAULT}. */
    public static BuyerIdentity parse(String value) {
        BuyerIdentity mode = strict(value);
        return mode == null ? DEFAULT : mode;
    }

    /** The mode a staff member typed, or null when it is not one. */
    public static BuyerIdentity strict(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (BuyerIdentity mode : values()) {
            if (mode.name().equals(v)) {
                return mode;
            }
        }
        return null;
    }
}
