package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** ORDER counts against the order's amount paid; EXTRA_PAYMENT gives back a second payment that never counted. */
public enum RefundKind {
    ORDER,
    EXTRA_PAYMENT;

    /** The value of a typed text, or null when it is not one. */
    public static RefundKind of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (RefundKind item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
