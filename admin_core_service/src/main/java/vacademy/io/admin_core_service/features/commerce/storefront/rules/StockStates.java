package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import java.util.List;

/**
 * Stock as the public API shows it:
 * a state, and an exact number only at or below the low threshold. A raw count above the
 * threshold never leaves this class.
 */
public final class StockStates {

    public enum State {
        IN_STOCK,
        LOW,
        OUT,
        MADE_TO_ORDER
    }

    /**
     * {@code left} is set only for LOW and counts base units (divide by the product's qty scale
     * for metres). {@code oneOfAKind}: a PIECE product with exactly one left.
     */
    public record Stock(State state, Integer left, boolean purchasable, boolean oneOfAKind, Integer leadTimeDays) {
    }

    /** What the stock columns of one variant say; {@code available} null on a tracked variant counts as 0. */
    public record Level(boolean tracked, Integer available, Integer leadTimeDays) {
    }

    private StockStates() {
    }

    /**
     * @param threshold the low-stock threshold in whole units (0 = never show a number)
     * @param qtyScale  base units in one unit; the threshold is compared in units
     * @param piece     the product is sold piece by piece
     */
    public static Stock ofVariant(Level level, int threshold, int qtyScale, boolean piece) {
        if (!level.tracked()) {
            return new Stock(State.MADE_TO_ORDER, null, true, false, level.leadTimeDays());
        }
        return tracked(level.available() == null ? 0 : level.available(), threshold, qtyScale, piece);
    }

    /**
     * The state of a product on a card: the tracked variants are added up; with nothing left in
     * any of them, a made-to-order variant still makes the product buyable.
     */
    public static Stock ofProduct(List<Level> levels, int threshold, int qtyScale, boolean piece) {
        long total = 0;
        Integer leadTime = null;
        boolean untracked = false;
        boolean anyTracked = false;
        for (Level level : levels) {
            if (level.tracked()) {
                anyTracked = true;
                total += Math.max(0, level.available() == null ? 0 : level.available());
            } else {
                untracked = true;
                if (level.leadTimeDays() != null && (leadTime == null || level.leadTimeDays() > leadTime)) {
                    leadTime = level.leadTimeDays();
                }
            }
        }
        if (anyTracked && total > 0) {
            return tracked((int) Math.min(Integer.MAX_VALUE, total), threshold, qtyScale, piece);
        }
        if (untracked) {
            return new Stock(State.MADE_TO_ORDER, null, true, false, leadTime);
        }
        return new Stock(State.OUT, null, false, false, null);
    }

    private static Stock tracked(int available, int threshold, int qtyScale, boolean piece) {
        if (available <= 0) {
            return new Stock(State.OUT, null, false, false, null);
        }
        long lowLimit = (long) Math.max(0, threshold) * Math.max(1, qtyScale);
        if (available <= lowLimit) {
            return new Stock(State.LOW, available, true, piece && available == 1, null);
        }
        return new Stock(State.IN_STOCK, null, true, false, null);
    }
}
