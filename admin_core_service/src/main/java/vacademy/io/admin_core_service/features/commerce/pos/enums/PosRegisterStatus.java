package vacademy.io.admin_core_service.features.commerce.pos.enums;

import java.util.Locale;

/** {@code pos_register.status}. */
public enum PosRegisterStatus {
    ACTIVE,
    INACTIVE;

    /** The value of a typed text, or null when it is not one. */
    public static PosRegisterStatus of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (PosRegisterStatus item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
