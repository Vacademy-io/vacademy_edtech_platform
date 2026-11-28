package vacademy.io.admin_core_service.features.commerce.order.shipping;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * The delivery charge of a cart from the institute's shipping rule. It needs no address: a
 * flat charge, a charge by the value of the goods, or a
 * charge by the weight of the cart, and free delivery from a threshold. The same call prices the
 * cart page, the checkout and the order, so the charge a shopper saw is the charge on the order.
 *
 * <p>No database access happens here.
 */
public final class CommerceShippingCalculator {

    public enum Basis {
        FLAT,
        ORDER_VALUE,
        WEIGHT
    }

    /** {@code upTo} inclusive; null = no upper end (rupees for ORDER_VALUE, grams for WEIGHT). */
    public record Tier(BigDecimal upTo, BigDecimal charge) {
    }

    public record Rule(String id, Basis basis, List<Tier> tiers, BigDecimal freeAbove, BigDecimal codCharge,
                       String taxClassId) {
    }

    /**
     * {@code baseCharge} is the charge of the tier; {@code charge} is what the shopper pays (0
     * when the free threshold is reached). {@code remainingForFree} is how much more in goods
     * makes delivery free; null when the seller set no threshold.
     */
    public record Quote(String ruleId, Basis basis, BigDecimal baseCharge, BigDecimal charge, boolean free,
                        BigDecimal freeAbove, BigDecimal remainingForFree, long weightGrams) {
    }

    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);
    public static final int MAX_TIERS = 50;

    private CommerceShippingCalculator() {
    }

    /**
     * @param rule        the institute's ACTIVE rule; null = the seller charges no delivery
     * @param goodsValue  what the shopper pays for the goods, after every discount
     * @param weightGrams the weight of the cart; a variant with no weight counts as 0
     */
    public static Quote quote(Rule rule, BigDecimal goodsValue, long weightGrams) {
        BigDecimal goods = goodsValue == null ? ZERO : goodsValue.setScale(2, RoundingMode.HALF_UP);
        long weight = Math.max(0, weightGrams);
        if (rule == null) {
            return new Quote(null, null, ZERO, ZERO, false, null, null, weight);
        }
        BigDecimal measure = switch (rule.basis()) {
            case FLAT -> BigDecimal.ZERO;
            case ORDER_VALUE -> goods;
            case WEIGHT -> BigDecimal.valueOf(weight);
        };
        BigDecimal base = tierCharge(rule.tiers(), measure);
        BigDecimal freeAbove = rule.freeAbove() == null ? null : rule.freeAbove().setScale(2, RoundingMode.HALF_UP);
        boolean free = freeAbove != null && goods.compareTo(freeAbove) >= 0;
        BigDecimal remaining = freeAbove == null ? null : freeAbove.subtract(goods).max(ZERO);
        return new Quote(rule.id(), rule.basis(), base, free ? ZERO : base, free && base.signum() > 0, freeAbove,
                remaining, weight);
    }

    /**
     * The first tier whose {@code upTo} holds the measure, lowest first. A measure above every
     * tier takes the last one (a rule saved through the service always ends in an open tier).
     */
    static BigDecimal tierCharge(List<Tier> tiers, BigDecimal measure) {
        if (tiers == null || tiers.isEmpty()) {
            return ZERO;
        }
        List<Tier> sorted = new ArrayList<>(tiers);
        sorted.sort(Comparator.comparing(Tier::upTo, Comparator.nullsLast(Comparator.naturalOrder())));
        for (Tier tier : sorted) {
            if (tier.upTo() == null || measure.compareTo(tier.upTo()) <= 0) {
                return money(tier.charge());
            }
        }
        return money(sorted.get(sorted.size() - 1).charge());
    }

    /**
     * Reads {@code tiers_json}. Throws {@link IllegalArgumentException} with a message for the
     * admin when a tier is malformed: a charge below zero or with more than two decimals, a
     * limit that is not above zero, two tiers with the same limit, no open last tier, or a FLAT
     * rule with more than its one tier.
     */
    public static List<Tier> parseTiers(Basis basis, List<Map<String, Object>> raw) {
        if (raw == null || raw.isEmpty()) {
            throw new IllegalArgumentException("a shipping rule needs at least one tier");
        }
        if (raw.size() > MAX_TIERS) {
            throw new IllegalArgumentException("a shipping rule has at most " + MAX_TIERS + " tiers");
        }
        List<Tier> out = new ArrayList<>();
        int open = 0;
        for (Map<String, Object> row : raw) {
            if (row == null) {
                throw new IllegalArgumentException("a tier is empty");
            }
            BigDecimal charge = number(row.get("charge"));
            if (charge == null || charge.signum() < 0 || charge.stripTrailingZeros().scale() > 2) {
                throw new IllegalArgumentException("a tier charge must be an amount of zero or more");
            }
            BigDecimal upTo = number(row.get("up_to"));
            if (row.get("up_to") != null && upTo == null) {
                throw new IllegalArgumentException("a tier limit must be a number");
            }
            if (upTo == null) {
                open++;
            } else if (upTo.signum() <= 0) {
                throw new IllegalArgumentException("a tier limit must be above zero");
            }
            for (Tier other : out) {
                if (other.upTo() != null && upTo != null && other.upTo().compareTo(upTo) == 0) {
                    throw new IllegalArgumentException("two tiers have the same limit");
                }
            }
            out.add(new Tier(upTo, charge.setScale(2, RoundingMode.UNNECESSARY)));
        }
        if (open != 1) {
            throw new IllegalArgumentException("exactly one tier must have no limit (the last one)");
        }
        if (basis == Basis.FLAT && out.size() != 1) {
            throw new IllegalArgumentException("a flat rule has exactly one tier");
        }
        out.sort(Comparator.comparing(Tier::upTo, Comparator.nullsLast(Comparator.naturalOrder())));
        return out;
    }

    private static BigDecimal money(BigDecimal value) {
        return value == null ? ZERO : value.setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal number(Object value) {
        if (value instanceof BigDecimal b) {
            return b;
        }
        if (value instanceof Number n) {
            return new BigDecimal(n.toString());
        }
        if (value instanceof String s && !s.isBlank()) {
            try {
                return new BigDecimal(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }
}
