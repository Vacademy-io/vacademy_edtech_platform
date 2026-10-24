package vacademy.io.admin_core_service.features.platform_billing.enums;

/**
 * {@code platform_payment_item.item_kind} (V590). Existing rows are all CREDIT_PACK.
 */
public enum PlatformPaymentItemKind {
    CREDIT_PACK,
    AI_SUBSCRIPTION;

    /** Null or unknown values are treated as CREDIT_PACK, the column default. */
    public static PlatformPaymentItemKind parse(String raw) {
        if (raw != null && AI_SUBSCRIPTION.name().equalsIgnoreCase(raw.trim())) {
            return AI_SUBSCRIPTION;
        }
        return CREDIT_PACK;
    }
}
