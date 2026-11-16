package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** How money goes back: through the gateway, paid out by staff, or as credit on an exchange order. */
public enum RefundMethod {
    GATEWAY,
    BANK_TRANSFER,
    UPI,
    CASH,
    EXCHANGE_CREDIT;

    /** The value of a typed text, or null when it is not one. */
    public static RefundMethod of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (RefundMethod item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
