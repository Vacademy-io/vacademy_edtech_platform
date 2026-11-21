package vacademy.io.admin_core_service.features.commerce.security;

/**
 * The six features of the {@code commerce} module in {@code capabilities/catalog.json}.
 * {@link #ACCOUNTS} is the only one that is off until an institute is given it.
 */
public enum CommerceFeature {
    CATALOGUE("commerce.catalogue"),
    INVENTORY("commerce.stock"),
    ORDERS("commerce.orders"),
    POS("commerce.pos"),
    REPORTS("commerce.tax_reports"),
    ACCOUNTS("commerce.accounts");

    private final String key;

    CommerceFeature(String key) {
        this.key = key;
    }

    /** The feature key in the capability catalogue. */
    public String key() {
        return key;
    }
}
