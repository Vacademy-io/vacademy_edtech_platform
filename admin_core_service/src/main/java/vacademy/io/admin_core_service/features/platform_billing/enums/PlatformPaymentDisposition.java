package vacademy.io.admin_core_service.features.platform_billing.enums;

/**
 * {@code platform_payment.disposition} (V590, critique #7). Every existing row is NORMAL.
 *
 * <ul>
 *   <li>{@link #NORMAL}: the payment fulfils its order and is invoiced.</li>
 *   <li>{@link #DUPLICATE}: a second payment for something already paid (for example a second
 *       Payment Link payment for the same charge). Refunded automatically, never invoiced, never
 *       credit-noted, and its refund never touches the charge the other payment paid.</li>
 *   <li>{@link #LATE}: paid after the order could no longer be fulfilled (link superseded, charge
 *       voided, subscription expired). Same handling as DUPLICATE.</li>
 * </ul>
 */
public enum PlatformPaymentDisposition {
    NORMAL,
    DUPLICATE,
    LATE;

    /** True when the payment may be invoiced / credit-noted (only NORMAL). */
    public boolean isInvoiceable() {
        return this == NORMAL;
    }
}
