package vacademy.io.admin_core_service.features.commerce.pos.enums;

import java.util.Locale;

/** {@code pos_session.status}: a counter session is OPEN until it is closed with a cash count. */
public enum PosSessionStatus {
    OPEN,
    CLOSED;

    /** The value of a typed text, or null when it is not one. */
    public static PosSessionStatus of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (PosSessionStatus item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
