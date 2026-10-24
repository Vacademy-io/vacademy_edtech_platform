package vacademy.io.admin_core_service.features.regional_pricing.enums;

/**
 * Where a regional price came from. AUTO rows follow the base price and the exchange
 * rate; MANUAL rows are what an admin typed and are never overwritten by the system.
 */
public enum RegionalPriceSource {
    AUTO,
    MANUAL
}
