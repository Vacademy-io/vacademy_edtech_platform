package vacademy.io.admin_core_service.features.commerce.tax.enums;

/** Institute tax mode. Decides the document and whether tax lines exist. */
public enum TaxMode {
    /** GSTIN required; tax invoice with tax lines. */
    REGULAR,
    /** Bill of supply; no tax lines. */
    COMPOSITION,
    /** Plain invoice; no GSTIN, no tax lines. */
    UNREGISTERED
}
