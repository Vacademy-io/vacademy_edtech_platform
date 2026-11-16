package vacademy.io.admin_core_service.features.commerce.shipment.enums;

/** The states of a shipment (V688). Only one shipment of an order is not CANCELLED at a time. */
public enum CommerceShipmentStatus {
    PACKED,
    SHIPPED,
    DELIVERED,
    RTO,
    RTO_RECEIVED,
    CANCELLED;

    /** The status of a stored name, or null for a name this code does not know. */
    public static CommerceShipmentStatus of(String name) {
        if (name == null) {
            return null;
        }
        for (CommerceShipmentStatus status : values()) {
            if (status.name().equals(name.trim())) {
                return status;
            }
        }
        return null;
    }
}
