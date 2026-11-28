package vacademy.io.admin_core_service.features.commerce.order.enums;

import java.util.Locale;

/** Why a parcel is coming back to the seller ({@code commerce_shipment.rto_reason}). */
public enum RtoReason {
    REFUSED,
    UNREACHABLE,
    ADDRESS_ISSUE,
    DAMAGED,
    OTHER;

    /** The reason of a typed value, or null when it is not one. */
    public static RtoReason of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (RtoReason reason : values()) {
            if (reason.name().equals(v)) {
                return reason;
            }
        }
        return null;
    }
}
