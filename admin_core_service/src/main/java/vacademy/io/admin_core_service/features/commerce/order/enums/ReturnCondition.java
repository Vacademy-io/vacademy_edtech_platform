package vacademy.io.admin_core_service.features.commerce.order.enums;

import java.util.Locale;

/** The state a unit comes back in (an RTO parcel; later a customer return). */
public enum ReturnCondition {
    /** Back on the shelf: a RETURN movement puts it on sale again. */
    RESALEABLE,
    /** Back but not sellable: a RETURN then a DAMAGE movement write it off. */
    DAMAGED;

    /** The condition of a typed value, or null when it is not one. */
    public static ReturnCondition of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (ReturnCondition condition : values()) {
            if (condition.name().equals(v)) {
                return condition;
            }
        }
        return null;
    }
}
