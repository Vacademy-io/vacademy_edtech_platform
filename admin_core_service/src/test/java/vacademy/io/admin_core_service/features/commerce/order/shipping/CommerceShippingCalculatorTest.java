package vacademy.io.admin_core_service.features.commerce.order.shipping;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Basis;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Quote;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Rule;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Tier;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Flat, by value, by weight slab, and free from a threshold; none of it needs an address. */
class CommerceShippingCalculatorTest {

    private static BigDecimal bd(String value) {
        return new BigDecimal(value);
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertEquals(0, bd(expected).compareTo(actual), "expected " + expected + " but was " + actual);
    }

    private static Rule rule(Basis basis, BigDecimal freeAbove, Tier... tiers) {
        return new Rule("rule-1", basis, List.of(tiers), freeAbove, bd("40.00"), null);
    }

    private static Map<String, Object> tier(Object upTo, Object charge) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("up_to", upTo);
        row.put("charge", charge);
        return row;
    }

    @Test
    void aFlatRuleChargesTheSameWhateverTheCart() {
        Rule flat = rule(Basis.FLAT, null, new Tier(null, bd("80.00")));
        assertMoney("80.00", CommerceShippingCalculator.quote(flat, bd("10.00"), 0).charge());
        assertMoney("80.00", CommerceShippingCalculator.quote(flat, bd("99999.00"), 50_000).charge());
        assertNull(CommerceShippingCalculator.quote(flat, bd("10.00"), 0).remainingForFree());
    }

    @Test
    void aWeightRuleTakesTheSlabThatHoldsTheWeightWithTheLimitIncluded() {
        Rule byWeight = rule(Basis.WEIGHT, null, new Tier(bd("500"), bd("50.00")), new Tier(bd("2000"), bd("90.00")),
                new Tier(null, bd("150.00")));
        assertMoney("50.00", CommerceShippingCalculator.quote(byWeight, bd("100.00"), 0).charge());
        assertMoney("50.00", CommerceShippingCalculator.quote(byWeight, bd("100.00"), 500).charge());
        assertMoney("90.00", CommerceShippingCalculator.quote(byWeight, bd("100.00"), 501).charge());
        assertMoney("90.00", CommerceShippingCalculator.quote(byWeight, bd("100.00"), 2000).charge());
        assertMoney("150.00", CommerceShippingCalculator.quote(byWeight, bd("100.00"), 2001).charge());
        assertEquals(2001, CommerceShippingCalculator.quote(byWeight, bd("100.00"), 2001).weightGrams());
    }

    @Test
    void aValueRuleTakesTheSlabOfTheGoodsValueWhateverTheOrderOfTheTiers() {
        Rule byValue = rule(Basis.ORDER_VALUE, null, new Tier(null, bd("0.00")), new Tier(bd("499.99"), bd("99.00")),
                new Tier(bd("1499.99"), bd("49.00")));
        assertMoney("99.00", CommerceShippingCalculator.quote(byValue, bd("499.99"), 0).charge());
        assertMoney("49.00", CommerceShippingCalculator.quote(byValue, bd("500.00"), 0).charge());
        assertMoney("0.00", CommerceShippingCalculator.quote(byValue, bd("1500.00"), 0).charge());
    }

    @Test
    void deliveryIsFreeFromTheThresholdAndTheAmountMissingIsGiven() {
        Rule flat = rule(Basis.FLAT, bd("999"), new Tier(null, bd("80.00")));

        Quote below = CommerceShippingCalculator.quote(flat, bd("998.99"), 0);
        assertMoney("80.00", below.charge());
        assertFalse(below.free());
        assertMoney("0.01", below.remainingForFree());
        assertMoney("999.00", below.freeAbove());

        Quote at = CommerceShippingCalculator.quote(flat, bd("999.00"), 0);
        assertMoney("0.00", at.charge());
        assertMoney("80.00", at.baseCharge());
        assertTrue(at.free());
        assertMoney("0.00", at.remainingForFree());
    }

    @Test
    void noRuleMeansNoCharge() {
        Quote none = CommerceShippingCalculator.quote(null, bd("500.00"), 700);
        assertMoney("0.00", none.charge());
        assertNull(none.basis());
        assertNull(none.ruleId());
        assertFalse(none.free());
    }

    @Test
    void storedTiersAreReadAndSorted() {
        List<Map<String, Object>> raw = new ArrayList<>();
        raw.add(tier(null, 150));
        raw.add(tier(2000, "90.50"));
        raw.add(tier(500.0, 50));
        List<Tier> tiers = CommerceShippingCalculator.parseTiers(Basis.WEIGHT, raw);
        assertEquals(3, tiers.size());
        assertMoney("500", tiers.get(0).upTo());
        assertMoney("90.50", tiers.get(1).charge());
        assertNull(tiers.get(2).upTo());
    }

    @Test
    void malformedTiersAreRefused() {
        // No open last tier.
        assertThrows(IllegalArgumentException.class,
                () -> CommerceShippingCalculator.parseTiers(Basis.WEIGHT, List.of(tier(500, 50))));
        // Two open tiers.
        assertThrows(IllegalArgumentException.class,
                () -> CommerceShippingCalculator.parseTiers(Basis.WEIGHT, List.of(tier(null, 50), tier(null, 60))));
        // The same limit twice.
        assertThrows(IllegalArgumentException.class, () -> CommerceShippingCalculator.parseTiers(Basis.WEIGHT,
                List.of(tier(500, 50), tier(500, 60), tier(null, 70))));
        // A negative charge, a charge with three decimals, a limit of zero, a limit that is no number.
        assertThrows(IllegalArgumentException.class,
                () -> CommerceShippingCalculator.parseTiers(Basis.FLAT, List.of(tier(null, -1))));
        assertThrows(IllegalArgumentException.class,
                () -> CommerceShippingCalculator.parseTiers(Basis.FLAT, List.of(tier(null, "1.005"))));
        assertThrows(IllegalArgumentException.class, () -> CommerceShippingCalculator.parseTiers(Basis.WEIGHT,
                List.of(tier(0, 50), tier(null, 70))));
        assertThrows(IllegalArgumentException.class, () -> CommerceShippingCalculator.parseTiers(Basis.WEIGHT,
                List.of(tier("heavy", 50), tier(null, 70))));
        // A flat rule has one tier; an empty rule is no rule.
        assertThrows(IllegalArgumentException.class, () -> CommerceShippingCalculator.parseTiers(Basis.FLAT,
                List.of(tier(500, 50), tier(null, 70))));
        assertThrows(IllegalArgumentException.class, () -> CommerceShippingCalculator.parseTiers(Basis.FLAT, List.of()));
    }
}
