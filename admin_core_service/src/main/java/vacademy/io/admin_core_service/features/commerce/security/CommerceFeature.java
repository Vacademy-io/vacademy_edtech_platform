package vacademy.io.admin_core_service.features.commerce.security;

/** The five features of the {@code commerce} module in {@code capabilities/catalog.json}. */
public enum CommerceFeature {
    CATALOGUE("commerce.catalogue"),
    INVENTORY("commerce.stock"),
    ORDERS("commerce.orders"),
    POS("commerce.pos"),
    REPORTS("commerce.tax_reports");

    private final String key;

    CommerceFeature(String key) {
        this.key = key;
    }

    /** The feature key in the capability catalogue. */
    public String key() {
        return key;
    }
}
