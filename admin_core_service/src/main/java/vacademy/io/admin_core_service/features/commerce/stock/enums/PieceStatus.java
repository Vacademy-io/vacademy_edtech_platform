package vacademy.io.admin_core_service.features.commerce.stock.enums;

/** Life of one piece. IN_STOCK and RESERVED pieces at a location make up its on-hand quantity. */
public enum PieceStatus {
    IN_STOCK,
    RESERVED,
    SOLD,
    IN_TRANSIT,
    WRITTEN_OFF,
    VOIDED,
    RETURNED_TO_SUPPLIER
}
