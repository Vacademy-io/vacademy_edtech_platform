package vacademy.io.admin_core_service.features.commerce.common;

/** Package types that belong to the Commerce module: a shop product, never a course. */
public final class CommercePackageTypes {

    public static final String PRODUCT = "PRODUCT";

    private CommercePackageTypes() {
    }

    /**
     * Null-safe type test. Necessary but not sufficient: bulk course creation can also type a
     * course PRODUCT, so "is this a shop product" is decided by {@link CommerceLegacyGuard}
     * (a {@code commerce_product} row). Use this only to skip that lookup.
     */
    public static boolean isCommerce(String packageType) {
        return packageType != null && PRODUCT.equalsIgnoreCase(packageType.trim());
    }
}
