package vacademy.io.admin_core_service.features.commerce.pos.enums;

import java.util.Locale;

/** {@code pos_cash_movement.type}: cash put into or taken out of the drawer. */
public enum CashMovementType {
    CASH_IN,
    CASH_OUT;

    /** The value of a typed text, or null when it is not one. */
    public static CashMovementType of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (CashMovementType item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
