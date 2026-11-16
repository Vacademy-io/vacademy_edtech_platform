package vacademy.io.admin_core_service.features.commerce.order.enums;

/** The states of an order. Returns do not change the status. */
public enum CommerceOrderStatus {
    PENDING_PAYMENT,
    COD_PENDING_CONFIRMATION,
    CONFIRMED,
    PACKED,
    SHIPPED,
    DELIVERED,
    RTO,
    CANCELLED;

    /** The status of a stored name, or null for a name this code does not know. */
    public static CommerceOrderStatus of(String name) {
        if (name == null) {
            return null;
        }
        for (CommerceOrderStatus status : values()) {
            if (status.name().equals(name)) {
                return status;
            }
        }
        return null;
    }
}
