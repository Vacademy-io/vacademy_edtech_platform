package vacademy.io.admin_core_service.features.commerce.stock.service;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * The weighted-average cost rules, as pure functions.
 * Q is the quantity on hand over all locations plus the quantity in transit. A unit cost has
 * four decimals, a variance two. A result below zero is never returned and never clamped: the
 * caller gets {@link NegativeAverageException} and leaves the average as it was.
 */
public final class StockCostMath {

    public static final int COST_SCALE = 4;
    public static final int MONEY_SCALE = 2;
    private static final RoundingMode ROUNDING = RoundingMode.HALF_UP;

    private StockCostMath() {
    }

    /** The outcome of one rule: the average to store and the amount that fell on units already gone. */
    public record Change(BigDecimal newAverage, BigDecimal variance) {
    }

    /** The rule would give an average below zero. */
    public static class NegativeAverageException extends RuntimeException {
        public NegativeAverageException(String message) {
            super(message);
        }
    }

    public static BigDecimal cost(BigDecimal value) {
        return value == null ? null : value.setScale(COST_SCALE, ROUNDING);
    }

    /**
     * A receipt (or a customer return) of {@code quantity} units at a known {@code unitCost}:
     * {@code (old x Q_before + c x q) / (Q_before + q)}; with no average yet, or nothing on
     * hand before, the cost itself.
     */
    public static BigDecimal afterInflow(BigDecimal oldAverage, long quantityBefore, BigDecimal unitCost,
                                         int quantity) {
        requirePositive(quantity);
        if (unitCost == null) {
            return cost(oldAverage);
        }
        if (oldAverage == null || quantityBefore <= 0) {
            return cost(unitCost);
        }
        BigDecimal total = oldAverage.multiply(BigDecimal.valueOf(quantityBefore))
                .add(unitCost.multiply(BigDecimal.valueOf(quantity)));
        return total.divide(BigDecimal.valueOf(quantityBefore + quantity), COST_SCALE, ROUNDING);
    }

    /**
     * The cost of {@code quantity} received units becomes known later (a bill is linked, a cost
     * is typed): {@code old + (c - p) x min(q, Q) / Q}, where p is the cost those units carry
     * now. With nothing on hand, or no average yet, the new cost itself. The part that falls on
     * units already gone, {@code (c - p) x (q - min(q, Q))}, is the variance.
     *
     * <p>Units received with no cost at all (p is null) carry the running average, because
     * that is what they have been valued at since.
     */
    public static Change costKnownLater(BigDecimal oldAverage, long quantityNow, BigDecimal stampedUnitCost,
                                        BigDecimal newUnitCost, int quantity) {
        requirePositive(quantity);
        if (newUnitCost == null || newUnitCost.signum() < 0) {
            throw new IllegalArgumentException("stock cost: the new unit cost must be zero or more");
        }
        BigDecimal carried = stampedUnitCost != null ? stampedUnitCost : oldAverage;
        BigDecimal difference = carried == null ? BigDecimal.ZERO : newUnitCost.subtract(carried);
        long stillHere = Math.max(0, Math.min(quantity, quantityNow));
        BigDecimal variance = money(difference.multiply(BigDecimal.valueOf(quantity - stillHere)));
        if (oldAverage == null || quantityNow <= 0) {
            return new Change(cost(newUnitCost), variance);
        }
        BigDecimal newAverage = oldAverage.add(difference.multiply(BigDecimal.valueOf(stillHere))
                .divide(BigDecimal.valueOf(quantityNow), COST_SCALE, ROUNDING));
        newAverage = cost(newAverage);
        if (newAverage.signum() < 0) {
            throw new NegativeAverageException("stock cost: the change would give an average of " + newAverage);
        }
        return new Change(newAverage, variance);
    }

    /**
     * {@code quantity} units leave at their own cost (a purchase return, or the reversal of a
     * receipt): {@code (old x Q - c x q) / (Q - q)}, only when something is left and the result
     * is above zero. Otherwise the average stays and {@code (c - old) x q} is the variance.
     *
     * @param quantityBefore Q before the units left
     */
    public static Change afterRemovalAtCost(BigDecimal oldAverage, long quantityBefore, BigDecimal unitCost,
                                            int quantity) {
        requirePositive(quantity);
        if (oldAverage == null || unitCost == null) {
            return new Change(cost(oldAverage), money(BigDecimal.ZERO));
        }
        long rest = quantityBefore - quantity;
        if (rest > 0) {
            BigDecimal candidate = oldAverage.multiply(BigDecimal.valueOf(quantityBefore))
                    .subtract(unitCost.multiply(BigDecimal.valueOf(quantity)))
                    .divide(BigDecimal.valueOf(rest), COST_SCALE, ROUNDING);
            if (candidate.signum() > 0) {
                return new Change(candidate, money(BigDecimal.ZERO));
            }
        }
        BigDecimal variance = unitCost.subtract(oldAverage).multiply(BigDecimal.valueOf(quantity));
        return new Change(cost(oldAverage), money(variance));
    }

    public static BigDecimal money(BigDecimal value) {
        return value.setScale(MONEY_SCALE, ROUNDING);
    }

    /** Same amount, whatever the scale: 100 and 100.0000 are equal here. */
    public static boolean same(BigDecimal a, BigDecimal b) {
        if (a == null || b == null) {
            return a == b;
        }
        return a.compareTo(b) == 0;
    }

    private static void requirePositive(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("stock cost: quantity must be above zero");
        }
    }
}
