package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** The state of a return: REQUESTED, then APPROVED or REJECTED; APPROVED, then RECEIVED or REJECTED; RECEIVED, then CLOSED. */
public enum ReturnStatus {
    REQUESTED,
    APPROVED,
    REJECTED,
    RECEIVED,
    CLOSED;

    /** The value of a typed text, or null when it is not one. */
    public static ReturnStatus of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (ReturnStatus item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
