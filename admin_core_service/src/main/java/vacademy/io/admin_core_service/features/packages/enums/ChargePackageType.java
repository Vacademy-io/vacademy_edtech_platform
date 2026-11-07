package vacademy.io.admin_core_service.features.packages.enums;

/** Package types that are a charge on an order (shipping, a deposit), never something a learner studies or owns. */
public enum ChargePackageType {
    DELIVERY_CHARGE,
    SECURITY_DEPOSIT;

    public static boolean isCharge(String packageType) {
        if (packageType == null) {
            return false;
        }
        String type = packageType.trim();
        return DELIVERY_CHARGE.name().equalsIgnoreCase(type) || SECURITY_DEPOSIT.name().equalsIgnoreCase(type);
    }
}
