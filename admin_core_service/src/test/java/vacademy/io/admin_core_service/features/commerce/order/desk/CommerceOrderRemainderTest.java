package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The money of line cancels: the cancels of a line add up to the line whatever their sizes,
 * cancels plus what remains is the placement total to the paisa, a set taxed in parts is
 * cancelled part by part, and the log split always sums to its target.
 */
class CommerceOrderRemainderTest {

    private static BigDecimal m(String v) {
        return new BigDecimal(v);
    }

    /** A 5 % line, tax inside the price, CGST and SGST: net = taxable + cgst + sgst. */
    private static TaxLineResult item(String ref, int quantity, String gross, String orderDiscount, String taxable,
                                      String cgst, String sgst) {
        BigDecimal net = m(gross).subtract(m(orderDiscount));
        BigDecimal check = m(taxable).add(m(cgst)).add(m(sgst));
        assertEquals(0, net.compareTo(check), "test line " + ref + " must hold the invariant");
        return TaxLineResult.builder().lineRef(ref).lineType(TaxLineType.ITEM).description(ref).hsnCode("5208")
                .quantity(quantity).qtyScale(1).unitPrice(m(gross).divide(BigDecimal.valueOf(quantity), 2, java.math.RoundingMode.HALF_UP))
                .gross(m(gross)).lineDiscount(m("0.00")).orderDiscount(m(orderDiscount)).net(net)
                .ratePercent(m("5")).cessPercent(BigDecimal.ZERO).taxableValue(m(taxable)).cgst(m(cgst)).sgst(m(sgst))
                .igst(m("0.00")).cess(m("0.00")).taxAmount(m(cgst).add(m(sgst))).build();
    }

    private static TaxLineResult shipping(String net, String taxable, String cgst, String sgst) {
        return TaxLineResult.builder().lineRef("SHIPPING").lineType(TaxLineType.SHIPPING).quantity(1).qtyScale(1)
                .gross(m(net)).lineDiscount(m("0.00")).orderDiscount(m("0.00")).net(m(net)).ratePercent(m("5"))
                .cessPercent(BigDecimal.ZERO).taxableValue(m(taxable)).cgst(m(cgst)).sgst(m(sgst)).igst(m("0.00"))
                .cess(m("0.00")).taxAmount(m(cgst).add(m(sgst))).build();
    }

    /** Three units of 333.33 with 10.00 off, two of 500, a set of 2 parts per unit, delivery 60, round-off. */
    private static TaxResult placement() {
        List<TaxLineResult> lines = List.of(
                item("A", 3, "999.99", "10.00", "942.85", "23.57", "23.57"),
                item("B", 2, "1000.00", "0.00", "952.38", "23.81", "23.81"),
                item("S", 4, "401.00", "0.00", "381.90", "9.55", "9.55"),
                shipping("60.00", "57.14", "1.43", "1.43"));
        BigDecimal net = lines.stream().map(TaxLineResult::getNet).reduce(BigDecimal.ZERO, BigDecimal::add);
        return TaxResult.builder().mode(TaxMode.REGULAR).taxHead(TaxHead.CGST_SGST).lines(lines)
                .roundOff(m("0.01")).total(net.add(m("0.01"))).build();
    }

    @Test
    void theCancelsOfALineAddUpToTheLineWhateverTheirSizes() {
        TaxResult placement = placement();
        List<TaxLineResult> a = CommerceOrderRemainder.taxLinesOf(placement, "A");
        BigDecimal oneByOne = BigDecimal.ZERO;
        for (int before = 0; before < 3; before++) {
            oneByOne = oneByOne.add(CommerceOrderRemainder.cancelValue(a, 3, before, 1, TaxHead.CGST_SGST).net());
        }
        BigDecimal twoThenOne = CommerceOrderRemainder.cancelValue(a, 3, 0, 2, TaxHead.CGST_SGST).net()
                .add(CommerceOrderRemainder.cancelValue(a, 3, 2, 1, TaxHead.CGST_SGST).net());
        BigDecimal all = CommerceOrderRemainder.cancelValue(a, 3, 0, 3, TaxHead.CGST_SGST).net();
        assertEquals(m("989.99"), all, "the whole line is its own net to the paisa");
        assertEquals(all, oneByOne);
        assertEquals(all, twoThenOne);
    }

    @Test
    void cancelsPlusWhatRemainsIsThePlacementTotalToThePaisa() {
        TaxResult placement = placement();
        Map<String, Integer> quantity = Map.of("A", 3, "B", 2, "S", 2);
        for (int a = 0; a <= 3; a++) {
            for (int b = 0; b <= 2; b++) {
                for (int s = 0; s <= 2; s++) {
                    Map<String, Integer> cancelled = new LinkedHashMap<>();
                    cancelled.put("A", a);
                    cancelled.put("B", b);
                    cancelled.put("S", s);
                    TaxResult left = CommerceOrderRemainder.remainingTax(placement, cancelled, quantity);
                    BigDecimal gone = CommerceOrderRemainder.cumulative(
                                    CommerceOrderRemainder.taxLinesOf(placement, "A"), 3, a, TaxHead.CGST_SGST).net()
                            .add(CommerceOrderRemainder.cumulative(
                                    CommerceOrderRemainder.taxLinesOf(placement, "B"), 2, b, TaxHead.CGST_SGST).net())
                            .add(CommerceOrderRemainder.cumulative(
                                    CommerceOrderRemainder.taxLinesOf(placement, "S"), 2, s, TaxHead.CGST_SGST).net());
                    assertEquals(placement.getTotal(), left.getTotal().add(gone), a + "/" + b + "/" + s);
                    // Every remaining line still holds its invariants.
                    for (TaxLineResult line : left.getLines()) {
                        assertEquals(0, line.getNet().compareTo(line.getTaxableValue().add(line.getCgst())
                                .add(line.getSgst()).add(line.getIgst()).add(line.getCess())), line.getLineRef());
                        assertEquals(0, line.getNet().compareTo(line.getGross().subtract(line.getLineDiscount())
                                .subtract(line.getOrderDiscount())), line.getLineRef());
                    }
                    assertEquals(left.getTaxableValue().add(left.getTaxAmount()), left.getTotal()
                            .subtract(left.getRoundOff()));
                }
            }
        }
    }

    @Test
    void aFullyCancelledLineIsLeftOutAndDeliveryAndRoundOffStay() {
        TaxResult left = CommerceOrderRemainder.remainingTax(placement(), Map.of("B", 2), Map.of("A", 3, "B", 2,
                "S", 2));
        assertTrue(left.getLines().stream().noneMatch(line -> "B".equals(line.getLineRef())));
        assertEquals(m("60.00"), left.getShipping());
        assertEquals(m("0.01"), left.getRoundOff());
        assertEquals(m("1451.00"), left.getTotal(), "989.99 + 401.00 + 60.00 + 0.01");
        assertEquals(1, left.getRateRows().size(), "one rate: one rate row");
        assertEquals(2, left.getHsnRows().size(), "the cloth code and the delivery line");
    }

    @Test
    void aSetTaxedInPartsIsCancelledByItsParts() {
        // Line S: 2 sets of 2 parts each, taxed as one tax line of 4 parts.
        TaxLineResult parts = CommerceOrderRemainder.taxLinesOf(placement(), "S").get(0);
        assertEquals(2, CommerceOrderRemainder.unitsPerLineUnit(parts, 2));
        BigDecimal one = CommerceOrderRemainder.cancelValue(List.of(parts), 2, 0, 1, TaxHead.CGST_SGST).net();
        assertEquals(m("200.50"), one, "one set is two of the four parts");
        TaxResult left = CommerceOrderRemainder.remainingTax(placement(), Map.of("S", 1), Map.of("S", 2));
        TaxLineResult rest = left.getLines().stream().filter(l -> "S".equals(l.getLineRef())).findFirst().orElseThrow();
        assertEquals(2, rest.getQuantity());
        assertEquals(m("200.50"), rest.getNet());
    }

    @Test
    void roundingNeverLosesAPaisa() {
        // 100.00 over 3 units: 33.33 + 33.33 + 33.34 in whichever order.
        TaxLineResult odd = item("X", 3, "100.00", "0.00", "95.24", "2.38", "2.38");
        BigDecimal sum = BigDecimal.ZERO;
        for (int before = 0; before < 3; before++) {
            BigDecimal value = CommerceOrderRemainder.cancelValue(List.of(odd), 3, before, 1, TaxHead.CGST_SGST).net();
            assertTrue(value.compareTo(m("33.33")) >= 0 && value.compareTo(m("33.34")) <= 0, value.toPlainString());
            sum = sum.add(value);
        }
        assertEquals(m("100.00"), sum);
        assertThrows(IllegalArgumentException.class,
                () -> CommerceOrderRemainder.cumulative(List.of(odd), 3, 4, TaxHead.CGST_SGST));
    }

    @Test
    void theLogSplitSumsToItsTargetAndPutsTheRestOnTheLargestLine() {
        Map<String, BigDecimal> remaining = new LinkedHashMap<>();
        remaining.put("l1", m("659.99"));
        remaining.put("l2", m("1000.00"));
        Map<String, BigDecimal> split = CommerceOrderRemainder.splitLogs(m("1720.00"), remaining);
        assertEquals(m("659.99"), split.get("l1"));
        assertEquals(m("1060.01"), split.get("l2"), "delivery and round-off ride on the largest line");
        assertEquals(m("1720.00"), split.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add));
        // Paid more than the smaller order now costs: the extra stays on the logs.
        Map<String, BigDecimal> over = CommerceOrderRemainder.splitLogs(m("2000.00"), remaining);
        assertEquals(m("2000.00"), over.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add));
        assertThrows(IllegalStateException.class, () -> CommerceOrderRemainder.splitLogs(m("100.00"), remaining));
        assertTrue(CommerceOrderRemainder.splitLogs(m("10.00"), Map.of()).isEmpty());
    }
}
