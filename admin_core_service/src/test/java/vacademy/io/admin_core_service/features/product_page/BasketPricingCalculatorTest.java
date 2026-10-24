package vacademy.io.admin_core_service.features.product_page;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import vacademy.io.admin_core_service.features.product_page.service.BasketPricingCalculator;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The authoritative half of the pricing contract. basket-pricing.ts mirrors it
 * for display, and basket-pricing.test.ts asserts the SAME cases — if these two
 * files ever disagree, a parent is shown one price and charged another.
 */
class BasketPricingCalculatorTest {

    private final BasketPricingCalculator calculator = new BasketPricingCalculator();

    private static final double PRICE = 349; // one subject, on its enroll invite

    private static final String GROUPS = "\"groups\":[{\"label\":\"Class 5\",\"levels\":[\"Class 5\"]}]";

    /** The iThinkers B2C price card, as absolute prices per count. */
    private static final String FLAT = "{\"basketPricing\":{\"enabled\":true,"
            + "\"ladder\":{\"prices\":[349,599,799],\"perExtra\":150}," + GROUPS + "}}";

    /** The same card, as discounts off what the courses cost on their invites. */
    private static final String DISCOUNT = "{\"basketPricing\":{\"enabled\":true,"
            + "\"pricingBasis\":\"DISCOUNT\",\"ladder\":{\"prices\":[],\"perExtra\":0},"
            + "\"tiers\":[{\"minCourses\":2,\"type\":\"AMOUNT\",\"value\":99},"
            + "{\"minCourses\":3,\"type\":\"AMOUNT\",\"value\":248},"
            + "{\"minCourses\":4,\"type\":\"AMOUNT\",\"value\":447},"
            + "{\"minCourses\":5,\"type\":\"AMOUNT\",\"value\":646}]," + GROUPS + "}}";

    private static List<BasketPricingCalculator.BasketItem> items(int n, double price) {
        List<BasketPricingCalculator.BasketItem> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            out.add(new BasketPricingCalculator.BasketItem("Class 5", "Subject " + i, price));
        }
        return out;
    }

    private static List<BasketPricingCalculator.BasketItem> items(int n) {
        return items(n, PRICE);
    }

    @Nested
    @DisplayName("the published price card")
    class PriceCard {

        @ParameterizedTest(name = "{0} subject(s) cost {1} on a FLAT page")
        @CsvSource({ "1,349", "2,599", "3,799", "4,949", "5,1099" })
        void flatChargesTheCardPrice(int count, double expected) {
            assertEquals(expected, calculator.price(FLAT, items(count)).getTotal());
        }

        @ParameterizedTest(name = "{0} subject(s) cost {1} on a DISCOUNT page")
        @CsvSource({ "1,349", "2,599", "3,799", "4,949", "5,1099" })
        void discountChargesTheSame(int count, double expected) {
            assertEquals(expected, calculator.price(DISCOUNT, items(count)).getTotal());
        }

        @Test
        @DisplayName("reports what the courses cost apart, so the saving can be shown")
        void reportsTheBase() {
            BasketPricingCalculator.BasketPrice priced = calculator.price(DISCOUNT, items(3));
            assertEquals(1047, priced.getItemTotal());
            assertEquals(799, priced.getTotal());
        }
    }

    @Nested
    @DisplayName("percentage tiers")
    class Percentages {

        private static final String PCT = "{\"basketPricing\":{\"enabled\":true,"
                + "\"pricingBasis\":\"DISCOUNT\",\"ladder\":{\"prices\":[],\"perExtra\":0},"
                + "\"tiers\":[{\"minCourses\":2,\"type\":\"PERCENT\",\"value\":15},"
                + "{\"minCourses\":4,\"type\":\"PERCENT\",\"value\":25}]," + GROUPS + "}}";

        @Test
        @DisplayName("keep scaling past the last rung, which a flat ladder cannot")
        void scaleWithoutARungPerCount() {
            assertEquals(593, calculator.price(PCT, items(2)).getTotal());
            assertEquals(1571, calculator.price(PCT, items(6)).getTotal());
        }

        @Test
        @DisplayName("follow the courses when the invite reprices them")
        void followTheInvite() {
            assertEquals(850, calculator.price(PCT, items(2, 500)).getTotal());
        }
    }

    @Nested
    @DisplayName("amount-gated tiers")
    class AmountGates {

        /** A DISCOUNT page whose tiers are the argument, as raw settings JSON. */
        private String spend(String tiers) {
            return "{\"basketPricing\":{\"enabled\":true,\"pricingBasis\":\"DISCOUNT\","
                    + "\"ladder\":{\"prices\":[],\"perExtra\":0},\"tiers\":[" + tiers + "],"
                    + GROUPS + "}}";
        }

        /** n courses priced so the group's base lands exactly on `total`. */
        private List<BasketPricingCalculator.BasketItem> worth(double total, int n) {
            return items(n, total / n);
        }

        @Test
        @DisplayName("apply once the basket is worth enough, whatever the count")
        void byAmountAlone() {
            String s = spend("{\"minAmount\":1000,\"type\":\"PERCENT\",\"value\":10}");
            assertEquals(900, calculator.price(s, worth(900, 5)).getTotal());
            assertEquals(900, calculator.price(s, worth(1000, 1)).getTotal());
            assertEquals(1800, calculator.price(s, worth(2000, 2)).getTotal());
        }

        @Test
        @DisplayName("require BOTH conditions when both are set")
        void bothConditions() {
            String s = spend("{\"minCourses\":3,\"minAmount\":1000,\"type\":\"PERCENT\",\"value\":10}");
            assertEquals(1200, calculator.price(s, worth(1200, 2)).getTotal());
            assertEquals(800, calculator.price(s, worth(800, 4)).getTotal());
            assertEquals(1080, calculator.price(s, worth(1200, 3)).getTotal());
        }

        @Test
        @DisplayName("cap a percentage at maxDiscount")
        void capped() {
            String s = spend("{\"minAmount\":1000,\"type\":\"PERCENT\",\"value\":50,\"maxDiscount\":300}");
            assertEquals(700, calculator.price(s, worth(1000, 3)).getTotal());
        }

        @Test
        @DisplayName("treat a zero cap as no cap")
        void zeroCapIsNoCap() {
            String s = spend("{\"minAmount\":1000,\"type\":\"PERCENT\",\"value\":50,\"maxDiscount\":0}");
            assertEquals(500, calculator.price(s, worth(1000, 2)).getTotal());
        }

        @Test
        @DisplayName("close a band at the top so two rules do not fight")
        void closedBand() {
            String s = spend("{\"minAmount\":500,\"maxAmount\":999,\"type\":\"PERCENT\",\"value\":10},"
                    + "{\"minAmount\":1000,\"type\":\"PERCENT\",\"value\":20}");
            assertEquals(540, calculator.price(s, worth(600, 2)).getTotal());
            assertEquals(1200, calculator.price(s, worth(1500, 4)).getTotal());
        }

        @Test
        @DisplayName("ignore a tier with no condition rather than firing on everything")
        void unconditionalIsIgnored() {
            String s = spend("{\"type\":\"PERCENT\",\"value\":50}");
            assertEquals(1000, calculator.price(s, worth(1000, 3)).getTotal());
        }

        @Test
        @DisplayName("never discount more than the courses cost")
        void neverBelowZero() {
            assertEquals(0, calculator.price(spend("{\"minAmount\":1,\"type\":\"AMOUNT\",\"value\":99999}"),
                    worth(500, 2)).getTotal());
            assertEquals(0, calculator.price(spend("{\"minAmount\":1,\"type\":\"PERCENT\",\"value\":300}"),
                    worth(500, 2)).getTotal());
        }

        @Test
        @DisplayName("ignore negative and zero values")
        void ignoresNonPositiveValues() {
            assertEquals(500, calculator.price(spend("{\"minAmount\":1,\"type\":\"AMOUNT\",\"value\":-100}"),
                    worth(500, 2)).getTotal());
            assertEquals(500, calculator.price(spend("{\"minAmount\":1,\"type\":\"PERCENT\",\"value\":0}"),
                    worth(500, 2)).getTotal());
        }

        @Test
        @DisplayName("take the best of a count tier and an amount tier")
        void bestOfBoth() {
            String s = spend("{\"minCourses\":2,\"type\":\"AMOUNT\",\"value\":99},"
                    + "{\"minAmount\":600,\"type\":\"PERCENT\",\"value\":25}");
            // 698 qualifies for both: 99 flat vs 174.5 percent — the better wins.
            assertEquals(Math.round(698 - 174.5), calculator.price(s, worth(698, 2)).getTotal());
        }
    }

    @Nested
    @DisplayName("guardrails")
    class Guardrails {

        @Test
        @DisplayName("an unconfigured page keeps summing item prices")
        void unconfiguredReturnsNull() {
            assertNull(calculator.price("{\"basketPricing\":{\"enabled\":false}}", items(3)));
            assertNull(calculator.price(null, items(3)));
        }

        @Test
        @DisplayName("a free course stays free under DISCOUNT")
        void freeStaysFree() {
            assertEquals(0, calculator.price(DISCOUNT, items(1, 0)).getTotal());
        }

        @Test
        @DisplayName("FLAT pages with free courses are exactly as they were")
        void flatIsUntouched() {
            assertEquals(599, calculator.price(FLAT, items(2, 0)).getTotal());
            assertEquals(1099, calculator.price(FLAT, items(5, 0)).getTotal());
        }

        @Test
        @DisplayName("a DISCOUNT tier cannot charge more than the courses cost apart")
        void neverAboveTheBase() {
            String bad = "{\"basketPricing\":{\"enabled\":true,\"pricingBasis\":\"DISCOUNT\","
                    + "\"ladder\":{\"prices\":[],\"perExtra\":0},"
                    + "\"tiers\":[{\"minCourses\":1,\"type\":\"AMOUNT\",\"value\":-500}]," + GROUPS + "}}";
            assertEquals(349, calculator.price(bad, items(1)).getTotal());
        }

        @Test
        @DisplayName("a discount is never taken away for adding another subject")
        void tiersNeverRegress() {
            // Under a highest-threshold rule this would punish the fifth subject.
            String backwards = "{\"basketPricing\":{\"enabled\":true,\"pricingBasis\":\"DISCOUNT\","
                    + "\"ladder\":{\"prices\":[],\"perExtra\":0},"
                    + "\"tiers\":[{\"minCourses\":2,\"type\":\"AMOUNT\",\"value\":500},"
                    + "{\"minCourses\":5,\"type\":\"AMOUNT\",\"value\":100}]," + GROUPS + "}}";
            assertEquals(698 - 500, calculator.price(backwards, items(2)).getTotal());
            assertEquals(1745 - 500, calculator.price(backwards, items(5)).getTotal());
        }

        @Test
        @DisplayName("a full pack still wins when it is cheaper")
        void packStillWins() {
            String withPack = DISCOUNT.replace(GROUPS,
                    "\"groups\":[{\"label\":\"Class 5\",\"levels\":[\"Class 5\"],\"packPrice\":499}]");
            assertEquals(499, calculator.price(withPack, items(3)).getTotal());
        }
    }

    @Nested
    @DisplayName("a combo the basket has outgrown")
    class OutgrownCombo {

        /**
         * iThinkers sells English+Maths+Science together for 749 while the plain
         * three-subject price is 799 — a 50 saving. The reported bug: adding a
         * fourth subject to that trio charged 200, not the 150 the page
         * advertises, because the combo simply stopped applying.
         */
        private static final String COMBO =
                "\"combos\":[{\"label\":\"EMS combo\",\"price\":749,"
                        + "\"packages\":[\"English\",\"Maths\",\"Science\"]}]";

        private String withCombo(String settings) {
            return settings.replace(GROUPS, COMBO + "," + GROUPS);
        }

        private List<BasketPricingCalculator.BasketItem> subjects(String... names) {
            List<BasketPricingCalculator.BasketItem> out = new ArrayList<>();
            for (String name : names) {
                out.add(new BasketPricingCalculator.BasketItem("Class 5", name, PRICE));
            }
            return out;
        }

        @Test
        @DisplayName("prices the combo itself unchanged")
        void comboUnchanged() {
            var picked = subjects("English", "Maths", "Science");
            assertEquals(749, calculator.price(withCombo(FLAT), picked).getTotal());
            assertEquals(749, calculator.price(withCombo(DISCOUNT), picked).getTotal());
        }

        @Test
        @DisplayName("charges the ladder step, not 200, for the fourth subject")
        void fourthSubjectCostsTheLadderStep() {
            var picked = subjects("English", "Maths", "Science", "G.K.");
            // 749 + (949 - 799)
            assertEquals(899, calculator.price(withCombo(FLAT), picked).getTotal());
            assertEquals(899, calculator.price(withCombo(DISCOUNT), picked).getTotal());
        }

        @Test
        @DisplayName("keeps the combo saving as the basket grows")
        void savingRidesAlong() {
            var picked = subjects("English", "Maths", "Science", "G.K.", "Cyber AI");
            assertEquals(1099 - 50, calculator.price(withCombo(DISCOUNT), picked).getTotal());
        }

        @Test
        @DisplayName("ignores a combo the basket only partly holds")
        void partialComboIgnored() {
            assertEquals(599,
                    calculator.price(withCombo(DISCOUNT), subjects("English", "Maths")).getTotal());
        }

        @Test
        @DisplayName("names the rule that priced each course, in the order they came in")
        void itemLabelsNameTheAdminsOwnRule() {
            // The label reaches the learner's invoice as the reason their price
            // was reduced, so it has to be the admin's configured combo label —
            // not a phrase this codebase chose.
            var picked = subjects("English", "Maths", "Science", "G.K.");
            var labels = calculator.price(withCombo(DISCOUNT), picked).getItemLabels();
            assertEquals(picked.size(), labels.size());
            for (String label : labels) {
                assertEquals("Class 5 — EMS combo + 1 more", label);
            }

            // Rename the combo in config and the label follows it.
            String renamed = withCombo(DISCOUNT).replace("EMS combo", "Trio pack");
            assertEquals("Class 5 — Trio pack + 1 more",
                    calculator.price(renamed, picked).getItemLabels().get(0));

            // No combo matched — the label states how the price WAS reached.
            assertEquals("Class 5 — 2 subjects",
                    calculator.price(withCombo(DISCOUNT), subjects("English", "Maths"))
                            .getItemLabels().get(0));
        }

        @Test
        @DisplayName("never charges more than the plain price")
        void overpricedComboLoses() {
            String overpriced = withCombo(DISCOUNT).replace("\"price\":749", "\"price\":900");
            assertEquals(799,
                    calculator.price(overpriced, subjects("English", "Maths", "Science")).getTotal());
            assertEquals(949,
                    calculator.price(overpriced, subjects("English", "Maths", "Science", "G.K."))
                            .getTotal());
        }
    }
}
