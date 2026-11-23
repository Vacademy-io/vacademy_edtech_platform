package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** Why the buyer sends goods back (commerce_return.reason). */
public enum ReturnReason {
    DEFECTIVE,
    WRONG_ITEM,
    DAMAGED_IN_TRANSIT,
    SIZE,
    CHANGED_MIND,
    OTHER;

    /** The value of a typed text, or null when it is not one. */
    public static ReturnReason of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (ReturnReason item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
