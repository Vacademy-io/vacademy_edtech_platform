package vacademy.io.admin_core_service.features.commerce.stock.enums;

/** Where the cost on a receipt line came from. */
public enum CostSource {
    NONE,
    PROVISIONAL,
    STANDARD,
    TYPED,
    BILL;

    /** A cost somebody stated, as opposed to none or the running average used as a stand-in. */
    public boolean isKnown() {
        return this == STANDARD || this == TYPED || this == BILL;
    }
}
