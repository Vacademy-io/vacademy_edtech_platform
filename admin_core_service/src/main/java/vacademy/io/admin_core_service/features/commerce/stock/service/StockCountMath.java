package vacademy.io.admin_core_service.features.commerce.stock.service;

import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Agreement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.PieceStatus;
import vacademy.io.admin_core_service.features.commerce.stock.enums.UncountedChoice;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The arithmetic of a stock count, with no database. A count may be taken while the shop trades:
 * each quantity line remembers when it was counted, and the post adds what moved at the
 * location since then (ARCHITECTURE 4.8, gate 20):
 * <pre>
 * adjustment = counted + moved_since - on_hand_now
 * </pre>
 * so a sale after the count is not undone, and one before it was already off the shelf.
 * Pieces are compared as sets; the result never writes off a piece that arrived during the count
 * or one that is packed for an order.
 */
public final class StockCountMath {

    /** A blind recount passes when at least this share of its lines agree (MIGRATION 1.8). */
    public static final BigDecimal PASS_PERCENT = new BigDecimal("98");

    private StockCountMath() {
    }

    // ------------------------------------------------------------------ quantity

    /**
     * The correction a quantity line posts. It never takes the shelf below zero: when more left
     * after the count than was counted (a miscount), the result is "nothing left", not an
     * impossible negative quantity.
     */
    public static int adjustment(int counted, int movedSince, int onHandNow) {
        int adjustment = counted + movedSince - onHandNow;
        return Math.max(adjustment, -Math.max(onHandNow, 0));
    }

    /** What the ledger said was on the shelf at the moment the line was counted. */
    public static int expectedAtCount(int onHandNow, int movedSince) {
        return onHandNow - movedSince;
    }

    /** In-scope variants with stock and no line: what the uncounted choice decides about. */
    public static List<String> uncounted(Map<String, Integer> onHandByVariant, Collection<String> countedVariants) {
        Set<String> counted = new HashSet<>(countedVariants == null ? List.of() : countedVariants);
        List<String> out = new ArrayList<>();
        onHandByVariant.forEach((variant, onHand) -> {
            if (onHand != null && onHand > 0 && !counted.contains(variant)) {
                out.add(variant);
            }
        });
        out.sort(null);
        return out;
    }

    // ------------------------------------------------------------------ pieces

    /** What a scanned piece means for the count. */
    public enum ScannedOutcome {
        /** IN_STOCK or RESERVED at the counted location: nothing to do. */
        HERE,
        /** WRITTEN_OFF: back in stock here (ADJUSTMENT +1, reason FOUND). */
        FOUND,
        /** In stock elsewhere, packed elsewhere, or in transit: listed, not moved. */
        MISPLACED,
        /** Sold, voided or sent back to the supplier: listed, not moved. */
        NOT_IN_STOCK
    }

    public static ScannedOutcome classifyScanned(String status, String pieceLocationId, String countLocationId) {
        PieceStatus state = PieceStatus.valueOf(status);
        boolean here = countLocationId != null && countLocationId.equals(pieceLocationId);
        return switch (state) {
            case IN_STOCK, RESERVED -> here ? ScannedOutcome.HERE : ScannedOutcome.MISPLACED;
            case IN_TRANSIT -> ScannedOutcome.MISPLACED;
            case WRITTEN_OFF -> ScannedOutcome.FOUND;
            case SOLD, VOIDED, RETURNED_TO_SUPPLIER -> ScannedOutcome.NOT_IN_STOCK;
        };
    }

    /** A piece IN_STOCK or RESERVED at the counted location now. */
    public record PieceHere(String pieceId, String packageSessionId, String status, boolean arrivedDuringCount) {
    }

    /** The pieces at the location that nobody scanned, sorted out. Lists hold piece ids. */
    public record PieceSets(List<String> missing, List<String> reservedNotCounted, List<String> arrivedDuringCount) {
    }

    /**
     * @param scannedVariants variants with at least one scanned piece on this count
     * @param choice          SKIP (or null, before a choice is made): only variants with a scanned
     *                        piece lose their unscanned pieces; ZERO: every expected piece is missing
     */
    public static PieceSets pieceSets(List<PieceHere> here, Set<String> scannedPieceIds, Set<String> scannedVariants,
                                      UncountedChoice choice) {
        List<String> missing = new ArrayList<>();
        List<String> reserved = new ArrayList<>();
        List<String> arrived = new ArrayList<>();
        for (PieceHere piece : here) {
            if (scannedPieceIds.contains(piece.pieceId())) {
                continue;
            }
            if (PieceStatus.RESERVED.name().equals(piece.status())) {
                reserved.add(piece.pieceId());
            } else if (piece.arrivedDuringCount()) {
                arrived.add(piece.pieceId());
            } else if (choice == UncountedChoice.ZERO || scannedVariants.contains(piece.packageSessionId())) {
                missing.add(piece.pieceId());
            }
        }
        return new PieceSets(missing, reserved, arrived);
    }

    // ------------------------------------------------------------------ approval

    /**
     * Whether a correction of {@code units} worth {@code value} is above the limits of a single
     * adjustment. A null limit is no limit of that kind; a missing value (no cost yet) cannot be
     * shown to be under a value limit, so it is over. Zero units are never over.
     */
    public static boolean overLimit(int units, BigDecimal value, Integer limitQuantity, BigDecimal limitValue) {
        int quantity = Math.abs(units);
        if (quantity == 0) {
            return false;
        }
        return (limitQuantity != null && quantity > limitQuantity)
                || (limitValue != null && (value == null || value.abs().compareTo(limitValue) > 0));
    }

    /** {@code |units| x unitCost} in money, or null when there is no cost. */
    public static BigDecimal value(int units, BigDecimal unitCost) {
        return unitCost == null ? null
                : unitCost.multiply(BigDecimal.valueOf(units)).setScale(2, RoundingMode.HALF_UP);
    }

    // ------------------------------------------------------------------ blind recount

    /** One counted line, as the agreement compares it. */
    public record CountedLine(String packageSessionId, String pieceId, int counted) {
    }

    /**
     * Each recount line against the main count: a quantity line agrees when the main count has
     * the same quantity of that variant, a piece when the main count scanned it too.
     */
    public static Agreement agreement(List<CountedLine> main, List<CountedLine> recount) {
        Map<String, Integer> mainQuantities = new HashMap<>();
        Set<String> mainPieces = new HashSet<>();
        for (CountedLine line : main) {
            if (line.pieceId() != null) {
                mainPieces.add(line.pieceId());
            } else {
                mainQuantities.put(line.packageSessionId(), line.counted());
            }
        }
        int agreeing = 0;
        for (CountedLine line : recount) {
            boolean agrees = line.pieceId() != null ? mainPieces.contains(line.pieceId())
                    : Integer.valueOf(line.counted()).equals(mainQuantities.get(line.packageSessionId()));
            if (agrees) {
                agreeing++;
            }
        }
        int compared = recount.size();
        BigDecimal percent = compared == 0 ? BigDecimal.ZERO.setScale(1)
                : BigDecimal.valueOf(agreeing * 100L).divide(BigDecimal.valueOf(compared), 1, RoundingMode.HALF_UP);
        return new Agreement(compared, agreeing, percent, compared > 0 && percent.compareTo(PASS_PERCENT) >= 0);
    }
}
