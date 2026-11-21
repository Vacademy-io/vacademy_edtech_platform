package vacademy.io.admin_core_service.features.commerce.security;

/**
 * The seven features of the {@code commerce} module in {@code capabilities/catalog.json}.
 * {@link #ACCOUNTS} and {@link #MIGRATION} are off until an institute is given them.
 */
public enum CommerceFeature {
    CATALOGUE("commerce.catalogue"),
    INVENTORY("commerce.stock"),
    ORDERS("commerce.orders"),
    POS("commerce.pos"),
    REPORTS("commerce.tax_reports"),
    ACCOUNTS("commerce.accounts"),
    /** Opening stock and switch-over from an old system: item-cost import, opening checks, parallel run. */
    MIGRATION("commerce.migration");

    private final String key;

    CommerceFeature(String key) {
        this.key = key;
    }

    /** The feature key in the capability catalogue. */
    public String key() {
        return key;
    }
}
