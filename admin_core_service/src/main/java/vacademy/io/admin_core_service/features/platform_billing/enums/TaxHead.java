package vacademy.io.admin_core_service.features.platform_billing.enums;

/**
 * How the GST on a platform sale is split, frozen on {@code platform_payment.tax_head} at order
 * time so the invoice and any credit note use exactly what was charged.
 */
public enum TaxHead {
    /** Intra-state: CGST + SGST, each half of the rate. */
    CGST_SGST,
    /** Inter-state: IGST at the full rate. */
    IGST,
    /** Zero-rated export of services (packs only; subscriptions are domestic INR in v1). */
    EXPORT;

    public static TaxHead parse(String raw) {
        if (raw == null) {
            return null;
        }
        String v = raw.trim().toUpperCase(java.util.Locale.ROOT);
        for (TaxHead h : values()) {
            if (h.name().equals(v)) {
                return h;
            }
        }
        return null;
    }
}
