package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** PENDING, IN_PROGRESS (gateway only), then PROCESSED or FAILED; the last two are final. */
public enum RefundStatus {
    PENDING,
    IN_PROGRESS,
    PROCESSED,
    FAILED;

    /** The value of a typed text, or null when it is not one. */
    public static RefundStatus of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (RefundStatus item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
