package vacademy.io.admin_core_service.features.platform_billing.enums;

/**
 * Which brand an institute's platform-billing documents and emails may carry
 * (owner decisions D1/D2, 2026-10-16).
 *
 * <ul>
 *   <li>{@link #VACADEMY}: the institute uses a Vacademy-owned admin host. Storefront copy,
 *       invoices (trade name + logo next to the legal supplier) and billing emails may say
 *       "Vacademy".</li>
 *   <li>{@link #NEUTRAL}: the institute is white-labelled (a custom ADMIN domain). Nothing may say
 *       "Vacademy"; invoices still name the legal supplier and its GSTIN, as GST requires.</li>
 * </ul>
 *
 * Resolved server-side by {@code BrandModeService}; when in doubt the answer is NEUTRAL.
 */
public enum BrandMode {
    VACADEMY,
    NEUTRAL;

    /** Parses a stored value; anything unknown or blank gives {@code null}. */
    public static BrandMode parse(String raw) {
        if (raw == null) {
            return null;
        }
        String v = raw.trim().toUpperCase(java.util.Locale.ROOT);
        for (BrandMode m : values()) {
            if (m.name().equals(v)) {
                return m;
            }
        }
        return null;
    }
}
