package vacademy.io.admin_core_service.features.commerce.order.enums;

import java.util.EnumSet;
import java.util.Locale;
import java.util.Set;

/** How money of an order is (to be) paid: {@code commerce_order_tender.mode}. */
public enum TenderMode {
    CASH,
    UPI,
    CARD,
    BANK_TRANSFER,
    CHEQUE,
    GATEWAY,
    COD,
    CREDIT,
    CREDIT_NOTE;

    /** What staff may record as received money on a staff order or a receipt. */
    public static final Set<TenderMode> STAFF_RECEIVED = EnumSet.of(CASH, UPI, CARD, BANK_TRANSFER, CHEQUE);

    /** The mode of a typed value, or null when it is not one. */
    public static TenderMode of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (TenderMode mode : values()) {
            if (mode.name().equals(v)) {
                return mode;
            }
        }
        return null;
    }
}
