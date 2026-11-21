package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** Who made the refund row: staff, the oversold-order or duplicate-payment hook, or an exchange. */
public enum RefundSource {
    STAFF,
    OVERSOLD_PAID,
    DUPLICATE_PAYMENT,
    EXCHANGE;

    /** The value of a typed text, or null when it is not one. */
    public static RefundSource of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (RefundSource item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
