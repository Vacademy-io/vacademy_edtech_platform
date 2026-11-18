package vacademy.io.admin_core_service.features.commerce.stock.service;

import lombok.Builder;
import lombok.Getter;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;

import java.math.BigDecimal;

/** One movement to post. The sign of {@code quantityDelta} is the direction: plus in, minus out. */
@Getter
@Builder(toBuilder = true)
public class StockPosting {

    /** How the cost of the units is treated; null picks the rule for the type and direction. */
    public enum CostTreatment {
        /** Units come in at a stated cost and the average is recomputed. */
        KNOWN,
        /** Units come in with no stated cost: stamped at the running average, flagged provisional. */
        PROVISIONAL,
        /** Stamped at the cost in force; the average does not change. */
        AT_AVERAGE,
        /** Units leave at their own stated cost (purchase return, receipt reversal). */
        REMOVE_AT_COST
    }

    private final String instituteId;
    private final String locationId;
    private final String packageSessionId;
    /** Required for one-of-a-kind stock, refused for quantity stock. */
    private final String pieceId;
    private final StockMovementType type;
    private final int quantityDelta;
    private final String reason;
    private final String note;
    private final String referenceType;
    private final String referenceId;
    private final String transferId;
    /** Set on a correction: the movement this one undoes. */
    private final String reversesMovementId;
    private final String actorUserId;
    /** Unique per institute, for example {@code RECEIPT:<stock_receipt_line.id>}. A repeat posts nothing. */
    private final String idempotencyKey;
    /** Cost per base unit, when the caller states one. */
    private final BigDecimal unitCost;
    private final CostTreatment costTreatment;
    /**
     * Only a counter sale keyed from a paper bill (POS_SALE, out): when the units at an online
     * location are already promised online, the sale is still posted (it happened) and the
     * shortfall is returned instead of the 409 SOLD_ONLINE.
     */
    private final boolean allowShortfall;
}
