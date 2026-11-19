package vacademy.io.admin_core_service.features.commerce.tax.calc;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The calculator, rule by rule.
 *
 * <p>Every rate, HSN code and slab limit here comes from {@link TestTaxData}: TEST placeholders,
 * not real rates.
 */
class CommerceTaxCalculatorTest {

    private static final String UP = "09";
    private static final String MH = "27";

    private final CommerceTaxCalculator calculator = new CommerceTaxCalculator();

    // ------------------------------------------------------------------ step 5: tax inside the price

    @Test
    void taxIsBackedOutOfATaxInclusivePrice() {
        TaxResult result = calculator.calculate(regular(item("a", "1050.00", 1, TestTaxData.slabbedClassTest())));

        TaxLineResult line = result.getLines().get(0);
        assertMoney("1050.00", line.getNet());
        assertMoney("1000.00", line.getTaxableValue());
        assertMoney("50.00", line.getTaxAmount());
        assertMoney("25.00", line.getCgst());
        assertMoney("25.00", line.getSgst());
        assertMoney("0.00", line.getIgst());
        assertEquals(0, new BigDecimal("5").compareTo(line.getRatePercent()));
        assertEquals(TaxHead.CGST_SGST, result.getTaxHead());
        assertMoney("1050.00", result.getTotal());
    }

    @Test
    void cgstAndSgstAreTheSameAmountEvenWhenTheTaxIsAnOddNumberOfPaise() {
        // 999.00 at 5%: the tax inside is 47.5714. Half is 23.7857 -> 23.79 each, and the
        // taxable value is what is left: 951.42. (Splitting 47.57 gave 23.79 and 23.78.)
        TaxLineResult line = calculator.calculate(regular(item("a", "999.00", 1, TestTaxData.slabbedClassTest())))
                .getLines().get(0);

        assertMoney("951.42", line.getTaxableValue());
        assertMoney("47.58", line.getTaxAmount());
        assertMoney("23.79", line.getCgst());
        assertMoney("23.79", line.getSgst());
        assertAddsUp(line);
    }

    @Test
    void cgstEqualsSgstOnEveryLineAndOnTheDocument() {
        // Amounts whose tax is an odd number of paise at 5%; each used to differ by one paisa.
        TaxResult result = calculator.calculate(regular(
                item("a", "500.00", 1, TestTaxData.slabbedClassTest()),
                item("b", "999.00", 1, TestTaxData.slabbedClassTest()),
                item("c", "333.34", 3, TestTaxData.slabbedClassTest()),
                item("d", "101.00", 7, TestTaxData.slabbedClassTest())));

        for (TaxLineResult line : result.getLines()) {
            assertEquals(0, line.getCgst().compareTo(line.getSgst()), "line " + line.getLineRef());
            assertTrue(line.getCgst().signum() > 0);
            assertAddsUp(line);
        }
        assertMoney("11.90", result.getLines().get(0).getCgst());
        assertMoney("476.20", result.getLines().get(0).getTaxableValue());
        assertEquals(0, result.getCgst().compareTo(result.getSgst()));
    }

    @Test
    void aSaleToAnotherStateCarriesIgstOnly() {
        TaxRequest request = regular(item("a", "1050.00", 1, TestTaxData.slabbedClassTest()));
        request.setPlaceOfSupplyState(MH);

        TaxResult result = calculator.calculate(request);

        assertEquals(TaxHead.IGST, result.getTaxHead());
        TaxLineResult line = result.getLines().get(0);
        assertMoney("50.00", line.getIgst());
        assertMoney("0.00", line.getCgst());
        assertMoney("0.00", line.getSgst());
        assertEquals(MH, result.getPlaceOfSupplyState());
    }

    @Test
    void aBlankPlaceOfSupplyIsTheSellerState() {
        TaxRequest request = regular(item("a", "1050.00", 1, TestTaxData.slabbedClassTest()));
        request.setPlaceOfSupplyState("  ");

        TaxResult result = calculator.calculate(request);

        assertEquals(TaxHead.CGST_SGST, result.getTaxHead());
        assertEquals(UP, result.getPlaceOfSupplyState());
    }

    @Test
    void cessIsSplitOutOfTheTax() {
        // 140.00 / 1.40 = 100.00; cess 12.00; GST 28.00 in two halves.
        TaxLineResult line = calculator.calculate(regular(item("a", "140.00", 1, TestTaxData.cessClassTest())))
                .getLines().get(0);

        assertMoney("100.00", line.getTaxableValue());
        assertMoney("12.00", line.getCess());
        assertMoney("14.00", line.getCgst());
        assertMoney("14.00", line.getSgst());
        assertAddsUp(line);
    }

    @Test
    void aZeroRateLeavesThePriceAsTheTaxableValue() {
        TaxLineResult line = calculator.calculate(regular(item("a", "250.00", 2, TestTaxData.zeroClassTest())))
                .getLines().get(0);

        assertMoney("500.00", line.getTaxableValue());
        assertMoney("0.00", line.getTaxAmount());
    }

    // ------------------------------------------------------------------ step 4: the slab

    @Test
    void slabEdgeComparedWithoutTax() {
        // 1050.00 without 5% tax is exactly 1000.00: still the lower slab.
        TaxLineResult atLimit = calculator.calculate(regular(item("a", "1050.00", 1, TestTaxData.slabbedClassTest())))
                .getLines().get(0);
        assertEquals(0, new BigDecimal("5").compareTo(atLimit.getRatePercent()));

        // One paisa more is 1000.01 without 5% tax: above the lower slab, so the higher rate
        // applies even though the value without 12% tax (937.51) is below the upper slab's start.
        TaxLineResult above = calculator.calculate(regular(item("a", "1050.01", 1, TestTaxData.slabbedClassTest())))
                .getLines().get(0);
        assertEquals(0, new BigDecimal("12").compareTo(above.getRatePercent()));
        assertMoney("937.51", above.getTaxableValue());
        assertMoney("112.50", above.getTaxAmount());
        assertAddsUp(above);
    }

    @Test
    void slabEdgeComparedWithTax() {
        TaxRequest atLimit = regular(item("a", "1000.00", 1, TestTaxData.slabbedClassTest()));
        atLimit.setSlabCompare(SlabCompare.TAX_INCLUSIVE);
        assertEquals(0, new BigDecimal("5").compareTo(
                calculator.calculate(atLimit).getLines().get(0).getRatePercent()));

        TaxRequest above = regular(item("a", "1000.01", 1, TestTaxData.slabbedClassTest()));
        above.setSlabCompare(SlabCompare.TAX_INCLUSIVE);
        assertEquals(0, new BigDecimal("12").compareTo(
                calculator.calculate(above).getLines().get(0).getRatePercent()));
    }

    @Test
    void theSlabIsTestedPerUnitNotPerLine() {
        // Two pieces at 600.00: the line is 1200.00 but each piece is in the lower slab.
        TaxLineResult line = calculator.calculate(regular(item("a", "600.00", 2, TestTaxData.slabbedClassTest())))
                .getLines().get(0);

        assertEquals(0, new BigDecimal("5").compareTo(line.getRatePercent()));
        assertMoney("1200.00", line.getNet());
    }

    @Test
    void measuredGoodsAreTestedPerUnitOfTheTaxClass() {
        // 45.00 for each 10 cm, 25 base units = 2.5 m: 1125.00 for the line, 450.00 a metre.
        TaxLineInput fabric = item("a", "45.00", 25, TestTaxData.measuredClassTest());
        fabric.setQtyScale(10);
        TaxRequest request = regular(fabric);
        request.setSlabCompare(SlabCompare.TAX_INCLUSIVE);

        TaxLineResult line = calculator.calculate(request).getLines().get(0);

        assertMoney("1125.00", line.getGross());
        assertMoney("450.00", line.getSlabUnitValue());
        assertEquals(0, new BigDecimal("5").compareTo(line.getRatePercent()));
    }

    @Test
    void aCouponCanTakeAnItemAcrossASlab() {
        // 1100.00 with 100.00 off. On the net unit price (default) the piece is worth 1000.00:
        // the lower slab. On the list unit price it stays in the upper slab.
        TaxRequest onNet = regular(item("a", "1100.00", 1, TestTaxData.slabbedClassTest()));
        onNet.setOrderDiscount(new BigDecimal("100.00"));
        onNet.setSlabCompare(SlabCompare.TAX_INCLUSIVE);
        TaxLineResult net = calculator.calculate(onNet).getLines().get(0);
        assertEquals(0, new BigDecimal("5").compareTo(net.getRatePercent()));
        assertMoney("952.38", net.getTaxableValue());
        assertMoney("47.62", net.getTaxAmount());

        TaxRequest onList = regular(item("a", "1100.00", 1, TestTaxData.slabbedClassTest()));
        onList.setOrderDiscount(new BigDecimal("100.00"));
        onList.setSlabCompare(SlabCompare.TAX_INCLUSIVE);
        onList.setSlabBasis(SlabBasis.LIST_UNIT_PRICE);
        TaxLineResult list = calculator.calculate(onList).getLines().get(0);
        assertEquals(0, new BigDecimal("12").compareTo(list.getRatePercent()));
        assertMoney("892.86", list.getTaxableValue());
        assertMoney("107.14", list.getTaxAmount());
    }

    @Test
    void theRateInForceOnTheDocumentDateIsUsed() {
        TaxRequest before = regular(item("a", "112.00", 1, TestTaxData.datedClassTest()));
        before.setDate(LocalDate.of(2026, 9, 30));
        assertMoney("100.00", calculator.calculate(before).getLines().get(0).getTaxableValue());

        TaxRequest after = regular(item("a", "105.00", 1, TestTaxData.datedClassTest()));
        after.setDate(LocalDate.of(2026, 10, 1));
        assertMoney("100.00", calculator.calculate(after).getLines().get(0).getTaxableValue());

        TaxRequest tooEarly = regular(item("a", "105.00", 1, TestTaxData.datedClassTest()));
        tooEarly.setDate(LocalDate.of(2026, 3, 31));
        CommerceTaxException refused = assertThrows(CommerceTaxException.class, () -> calculator.calculate(tooEarly));
        assertEquals(CommerceTaxException.NO_RATE_IN_FORCE, refused.getCode());
    }

    // ------------------------------------------------------------------ steps 1 to 3: discounts

    @Test
    void anOrderDiscountIsSpreadOverItemsWithTheRemainderOnTheLargest() {
        TaxRequest request = regular(
                item("a", "100.00", 1, TestTaxData.zeroClassTest()),
                item("b", "100.00", 1, TestTaxData.zeroClassTest()),
                item("c", "100.00", 1, TestTaxData.zeroClassTest()));
        request.setOrderDiscount(new BigDecimal("100.00"));

        TaxResult result = calculator.calculate(request);

        // 33.33 each leaves one paisa; it goes to the largest line, the first of equals.
        assertMoney("33.34", result.getLines().get(0).getOrderDiscount());
        assertMoney("33.33", result.getLines().get(1).getOrderDiscount());
        assertMoney("33.33", result.getLines().get(2).getOrderDiscount());
        assertMoney("200.00", result.getTotal());
        assertMoney("300.00", result.getSubtotal());
        assertMoney("100.00", result.getDiscount());
    }

    @Test
    void anOrderDiscountFollowsTheValueAfterLineDiscounts() {
        TaxLineInput big = item("big", "1000.00", 1, TestTaxData.zeroClassTest());
        big.setLineDiscount(new BigDecimal("400.00"));
        TaxRequest request = regular(big, item("small", "200.00", 1, TestTaxData.zeroClassTest()));
        request.setOrderDiscount(new BigDecimal("80.00"));

        TaxResult result = calculator.calculate(request);

        // After the line discount the values are 600.00 and 200.00: shares 60.00 and 20.00.
        assertMoney("60.00", result.getLines().get(0).getOrderDiscount());
        assertMoney("20.00", result.getLines().get(1).getOrderDiscount());
        assertMoney("540.00", result.getLines().get(0).getNet());
        assertMoney("180.00", result.getLines().get(1).getNet());
    }

    @Test
    void shippingAndCodChargeTakeNoShareOfAnOrderDiscount() {
        TaxRequest request = regular(
                item("a", "500.00", 1, TestTaxData.zeroClassTest()),
                line("ship", TaxLineType.SHIPPING, "118.00", TestTaxData.flatClassTest()),
                line("cod", TaxLineType.COD_CHARGE, "59.00", TestTaxData.flatClassTest()));
        request.setOrderDiscount(new BigDecimal("50.00"));

        TaxResult result = calculator.calculate(request);

        assertMoney("50.00", result.getLines().get(0).getOrderDiscount());
        assertMoney("0.00", result.getLines().get(1).getOrderDiscount());
        assertMoney("0.00", result.getLines().get(2).getOrderDiscount());
        // Shipping and the COD charge are lines of their own with their own class (18% here).
        assertMoney("100.00", result.getLines().get(1).getTaxableValue());
        assertMoney("50.00", result.getLines().get(2).getTaxableValue());
        assertMoney("118.00", result.getShipping());
        assertMoney("59.00", result.getCodCharge());
        assertMoney("627.00", result.getTotal());
    }

    @Test
    void freeShippingIsALineDiscountOnTheShippingLine() {
        TaxLineInput shipping = line("ship", TaxLineType.SHIPPING, "118.00", TestTaxData.flatClassTest());
        shipping.setLineDiscount(new BigDecimal("118.00"));

        TaxResult result = calculator.calculate(regular(item("a", "500.00", 1, TestTaxData.zeroClassTest()), shipping));

        assertMoney("0.00", result.getShipping());
        assertMoney("0.00", result.getLines().get(1).getTaxAmount());
        assertMoney("500.00", result.getTotal());
    }

    @Test
    void aDiscountLargerThanTheGoodsIsRefused() {
        TaxRequest request = regular(
                item("a", "100.00", 1, TestTaxData.zeroClassTest()),
                line("ship", TaxLineType.SHIPPING, "118.00", TestTaxData.flatClassTest()));
        request.setOrderDiscount(new BigDecimal("100.01"));

        assertThrows(CommerceTaxException.class, () -> calculator.calculate(request));
    }

    @Test
    void aSetIsSplitByPriceShareBeforeTax() {
        TaxLineInput set = item("set", "2000.00", 1, null);
        set.setComponents(List.of(
                TaxComponentInput.builder().componentRef("kurta").description("Kurta")
                        .priceSharePercent(new BigDecimal("60")).taxClass(TestTaxData.slabbedClassTest()).build(),
                TaxComponentInput.builder().componentRef("dupatta").description("Dupatta")
                        .priceSharePercent(new BigDecimal("40")).taxClass(TestTaxData.slabbedClassTest()).build()));
        TaxRequest request = regular(set);
        request.setSlabCompare(SlabCompare.TAX_INCLUSIVE);

        TaxResult result = calculator.calculate(request);

        assertEquals(2, result.getLines().size());
        TaxLineResult kurta = result.getLines().get(0);
        TaxLineResult dupatta = result.getLines().get(1);
        assertMoney("1200.00", kurta.getNet());
        assertEquals(0, new BigDecimal("12").compareTo(kurta.getRatePercent()));
        assertMoney("800.00", dupatta.getNet());
        assertEquals(0, new BigDecimal("5").compareTo(dupatta.getRatePercent()));
        assertEquals("set", kurta.getLineRef());
        assertEquals("kurta", kurta.getComponentRef());
        assertMoney("2000.00", result.getTotal());
    }

    // ------------------------------------------------------------------ step 7 and the sums

    @Test
    void lineTotalsPlusRoundOffEqualTheDocumentTotal() {
        TaxRequest request = regular(
                item("a", "999.00", 1, TestTaxData.slabbedClassTest()),
                item("b", "333.33", 3, TestTaxData.slabbedClassTest()),
                line("ship", TaxLineType.SHIPPING, "150.50", TestTaxData.flatClassTest()));
        request.setOrderDiscount(new BigDecimal("77.77"));
        request.setRoundTotalTo(RoundTotalTo.RUPEE);

        TaxResult result = calculator.calculate(request);

        BigDecimal net = BigDecimal.ZERO;
        BigDecimal parts = BigDecimal.ZERO;
        for (TaxLineResult line : result.getLines()) {
            assertAddsUp(line);
            assertEquals(0, line.getGross().subtract(line.getLineDiscount()).subtract(line.getOrderDiscount())
                    .compareTo(line.getNet()));
            net = net.add(line.getNet());
            parts = parts.add(line.getTaxableValue()).add(line.getTaxAmount());
        }
        assertEquals(0, net.add(result.getRoundOff()).compareTo(result.getTotal()));
        assertEquals(0, parts.compareTo(net));
        assertEquals(0, result.getTaxableValue().add(result.getTaxAmount()).compareTo(net));
        assertEquals(0, result.getSubtotal().subtract(result.getDiscount()).add(result.getShipping())
                .add(result.getCodCharge()).add(result.getRoundOff()).compareTo(result.getTotal()));
        // 999.00 + 999.99 + 150.50 - 77.77 = 2071.72 -> 2072.00, round-off 0.28.
        assertMoney("2072.00", result.getTotal());
        assertMoney("0.28", result.getRoundOff());
        // The tax rows add up to the lines: one row per rate.
        BigDecimal rowTax = result.getRateRows().stream().map(TaxRateRow::getTaxAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertEquals(0, rowTax.compareTo(result.getTaxAmount()));
    }

    @Test
    void roundingToTheRupeeGoesHalfUpAndNoneLeavesThePaise() {
        TaxRequest half = regular(item("a", "100.50", 1, TestTaxData.zeroClassTest()));
        half.setRoundTotalTo(RoundTotalTo.RUPEE);
        assertMoney("101.00", calculator.calculate(half).getTotal());
        assertMoney("0.50", calculator.calculate(half).getRoundOff());

        TaxRequest down = regular(item("a", "100.49", 1, TestTaxData.zeroClassTest()));
        down.setRoundTotalTo(RoundTotalTo.RUPEE);
        assertMoney("100.00", calculator.calculate(down).getTotal());
        assertMoney("-0.49", calculator.calculate(down).getRoundOff());

        TaxRequest none = regular(item("a", "100.49", 1, TestTaxData.zeroClassTest()));
        assertMoney("100.49", calculator.calculate(none).getTotal());
        assertMoney("0.00", calculator.calculate(none).getRoundOff());
    }

    @Test
    void oneTaxRowPerRateAndOneHsnRowPerCodeAndRate() {
        TaxRequest request = regular(
                item("a", "525.00", 1, TestTaxData.slabbedClassTest()),
                item("b", "210.00", 1, TestTaxData.slabbedClassTest()),
                item("c", "2240.00", 1, TestTaxData.slabbedClassTest()),
                line("ship", TaxLineType.SHIPPING, "118.00", TestTaxData.flatClassTest()));

        TaxResult result = calculator.calculate(request);

        assertEquals(3, result.getRateRows().size());
        assertEquals(0, new BigDecimal("5").compareTo(result.getRateRows().get(0).getRatePercent()));
        assertMoney("700.00", result.getRateRows().get(0).getTaxableValue());
        assertEquals(0, new BigDecimal("12").compareTo(result.getRateRows().get(1).getRatePercent()));
        assertMoney("2000.00", result.getRateRows().get(1).getTaxableValue());
        assertEquals(0, new BigDecimal("18").compareTo(result.getRateRows().get(2).getRatePercent()));
        assertNull(result.getRateRows().get(0).getHsnCode());
        assertEquals(3, result.getHsnRows().size());
        assertEquals("0000", result.getHsnRows().get(0).getHsnCode());
    }

    // ------------------------------------------------------------------ the three modes

    @Test
    void compositionModeHasNoTaxLines() {
        TaxRequest request = regular(item("a", "1050.00", 1, TestTaxData.slabbedClassTest()));
        request.setMode(TaxMode.COMPOSITION);

        TaxResult result = calculator.calculate(request);

        assertEquals(TaxHead.NONE, result.getTaxHead());
        assertMoney("1050.00", result.getLines().get(0).getTaxableValue());
        assertMoney("0.00", result.getTaxAmount());
        assertTrue(result.getRateRows().isEmpty());
        assertTrue(result.getHsnRows().isEmpty());
        assertMoney("1050.00", result.getTotal());
    }

    @Test
    void unregisteredModeNeedsNoTaxClassNoSellerStateAndNoDate() {
        TaxRequest request = TaxRequest.builder()
                .mode(TaxMode.UNREGISTERED)
                .lines(List.of(item("a", "1050.00", 2, null)))
                .build();

        TaxResult result = calculator.calculate(request);

        assertEquals(TaxHead.NONE, result.getTaxHead());
        assertMoney("2100.00", result.getTaxableValue());
        assertMoney("0.00", result.getTaxAmount());
        assertMoney("2100.00", result.getTotal());
    }

    @Test
    void regularModeRefusesALineWithoutATaxClassAndASaleWithoutASellerState() {
        CommerceTaxException noClass = assertThrows(CommerceTaxException.class,
                () -> calculator.calculate(regular(item("a", "100.00", 1, null))));
        assertEquals(CommerceTaxException.TAX_CLASS_MISSING, noClass.getCode());

        TaxRequest noState = regular(item("a", "100.00", 1, TestTaxData.zeroClassTest()));
        noState.setSellerStateCode(null);
        CommerceTaxException refused = assertThrows(CommerceTaxException.class, () -> calculator.calculate(noState));
        assertEquals(CommerceTaxException.SELLER_STATE_MISSING, refused.getCode());
    }

    @Test
    void theSameRequestAlwaysGivesTheSameResult() {
        TaxRequest request = regular(
                item("a", "999.00", 1, TestTaxData.slabbedClassTest()),
                item("b", "333.33", 3, TestTaxData.slabbedClassTest()));
        request.setOrderDiscount(new BigDecimal("10.01"));

        assertEquals(calculator.calculate(request), calculator.calculate(request));
    }

    @Test
    void badAmountsAreRefused() {
        assertThrows(CommerceTaxException.class,
                () -> calculator.calculate(regular(item("a", "10.001", 1, TestTaxData.zeroClassTest()))));
        assertThrows(CommerceTaxException.class,
                () -> calculator.calculate(regular(item("a", "10.00", 0, TestTaxData.zeroClassTest()))));
        TaxLineInput overDiscounted = item("a", "10.00", 1, TestTaxData.zeroClassTest());
        overDiscounted.setLineDiscount(new BigDecimal("10.01"));
        assertThrows(CommerceTaxException.class, () -> calculator.calculate(regular(overDiscounted)));
    }

    // ------------------------------------------------------------------ credit notes

    @Test
    void aFullCreditNoteMirrorsTheInvoiceToThePaisa() {
        TaxRequest request = regular(
                item("a", "999.00", 1, TestTaxData.slabbedClassTest()),
                item("b", "333.33", 3, TestTaxData.slabbedClassTest()),
                line("ship", TaxLineType.SHIPPING, "150.50", TestTaxData.flatClassTest()));
        request.setOrderDiscount(new BigDecimal("77.77"));
        request.setRoundTotalTo(RoundTotalTo.RUPEE);
        TaxResult invoice = calculator.calculate(request);

        List<CreditLineInput> lines = new ArrayList<>();
        for (TaxLineResult line : invoice.getLines()) {
            lines.add(creditLine(line, 0, null, line.getQuantity()));
        }
        CreditResult credit = calculator.credit(lines, invoice.getTaxHead(), invoice.getRoundOff(), BigDecimal.ZERO);

        assertTrue(credit.isCompletesInvoice());
        assertEquals(0, invoice.getTotal().compareTo(credit.getTotal()));
        assertEquals(0, invoice.getTaxableValue().compareTo(credit.getTaxableValue()));
        assertEquals(0, invoice.getCgst().compareTo(credit.getCgst()));
        assertEquals(0, invoice.getSgst().compareTo(credit.getSgst()));
        assertEquals(0, invoice.getTaxAmount().compareTo(credit.getTaxAmount()));
        assertEquals(0, invoice.getRoundOff().compareTo(credit.getRoundOff()));
    }

    @Test
    void partCreditNotesAddUpToTheInvoiceLine() {
        // Three pieces for 1000.00 in all at 5%: one piece is 333.33, and the last note takes what is left.
        TaxLineInput three = item("a", "333.34", 3, TestTaxData.slabbedClassTest());
        three.setLineDiscount(new BigDecimal("0.02"));
        TaxLineResult invoiceLine = calculator.calculate(regular(three)).getLines().get(0);
        assertMoney("1000.00", invoiceLine.getNet());

        CreditResult first = calculator.credit(List.of(creditLine(invoiceLine, 0, null, 2)),
                TaxHead.CGST_SGST, BigDecimal.ZERO, BigDecimal.ZERO);
        CreditLineResult firstLine = first.getLines().get(0);
        assertFalse(first.isCompletesInvoice());
        assertMoney("666.67", firstLine.getNet());
        assertMoney("634.93", firstLine.getTaxableValue());
        assertEquals(0, firstLine.getCgst().compareTo(firstLine.getSgst()));
        assertEquals(0, firstLine.getTaxableValue().add(firstLine.getTaxAmount()).compareTo(firstLine.getNet()));
        assertMoney("0.00", first.getRoundOff());

        CreditResult second = calculator.credit(List.of(creditLine(invoiceLine, 2, firstLine, 1)),
                TaxHead.CGST_SGST, BigDecimal.ZERO, BigDecimal.ZERO);
        CreditLineResult secondLine = second.getLines().get(0);
        assertTrue(second.isCompletesInvoice());
        assertEquals(0, invoiceLine.getNet().compareTo(firstLine.getNet().add(secondLine.getNet())));
        assertEquals(0, invoiceLine.getTaxableValue()
                .compareTo(firstLine.getTaxableValue().add(secondLine.getTaxableValue())));
        assertEquals(0, invoiceLine.getCgst().compareTo(firstLine.getCgst().add(secondLine.getCgst())));
        assertEquals(0, invoiceLine.getSgst().compareTo(firstLine.getSgst().add(secondLine.getSgst())));
        assertEquals(0, secondLine.getCgst().compareTo(secondLine.getSgst()), "the last note mirrors equal halves");
    }

    @Test
    void aPartCreditNoteCarriesNoRoundOffAndTheLastOneCarriesAllOfIt() {
        TaxRequest request = regular(
                item("a", "100.25", 1, TestTaxData.zeroClassTest()),
                item("b", "100.25", 1, TestTaxData.zeroClassTest()));
        request.setRoundTotalTo(RoundTotalTo.RUPEE);
        TaxResult invoice = calculator.calculate(request);
        assertMoney("201.00", invoice.getTotal());
        TaxLineResult a = invoice.getLines().get(0);
        TaxLineResult b = invoice.getLines().get(1);

        CreditResult first = calculator.credit(List.of(creditLine(a, 0, null, 1), creditLine(b, 0, null, 0)),
                invoice.getTaxHead(), invoice.getRoundOff(), BigDecimal.ZERO);
        assertMoney("100.25", first.getTotal());

        CreditResult second = calculator.credit(
                List.of(creditLine(a, 1, first.getLines().get(0), 0), creditLine(b, 0, null, 1)),
                invoice.getTaxHead(), invoice.getRoundOff(), first.getRoundOff());
        assertMoney("100.75", second.getTotal());
        assertEquals(0, invoice.getTotal().compareTo(first.getTotal().add(second.getTotal())));
    }

    @Test
    void creditingMoreThanWasInvoicedIsRefused() {
        TaxLineResult line = calculator.calculate(regular(item("a", "100.00", 2, TestTaxData.zeroClassTest())))
                .getLines().get(0);

        assertThrows(CommerceTaxException.class, () -> calculator.credit(List.of(creditLine(line, 0, null, 3)),
                TaxHead.CGST_SGST, BigDecimal.ZERO, BigDecimal.ZERO));
        assertThrows(CommerceTaxException.class, () -> calculator.credit(List.of(creditLine(line, 0, null, 0)),
                TaxHead.CGST_SGST, BigDecimal.ZERO, BigDecimal.ZERO));
    }

    /**
     * W1: a measured line prints its own unit, not the tax class's. 3.4 m of cloth on a class
     * quoted per piece (or per kg) is still 3.4 m on the invoice; a counted line keeps the class unit.
     */
    @Test
    void aMeasuredLineCarriesItsOwnUnitWhateverTheTaxClassSays() {
        TaxClassRef kilos = TestTaxData.flatClassTest();
        kilos.setUnit("KGS");
        TaxLineInput clothOnPieces = TaxLineInput.builder().lineRef("cloth").lineType(TaxLineType.ITEM)
                .description("Cotton cloth").unitPrice(new BigDecimal("12.34")).quantity(34).qtyScale(10)
                .unit("MTR").taxClass(TestTaxData.flatClassTest()).build();
        TaxLineInput clothOnKilos = TaxLineInput.builder().lineRef("linen").lineType(TaxLineType.ITEM)
                .description("Linen cloth").unitPrice(new BigDecimal("20.00")).quantity(25).qtyScale(10)
                .unit("MTR").taxClass(kilos).build();
        TaxLineInput bag = TaxLineInput.builder().lineRef("bag").lineType(TaxLineType.ITEM).description("Bag")
                .unitPrice(new BigDecimal("100.00")).quantity(2).qtyScale(1).unit("NOS")
                .taxClass(TestTaxData.flatClassTest()).build();
        TaxLineInput noUnit = TaxLineInput.builder().lineRef("old").lineType(TaxLineType.ITEM).description("Old")
                .unitPrice(new BigDecimal("12.34")).quantity(10).qtyScale(10)
                .taxClass(TestTaxData.flatClassTest()).build();

        TaxResult result = calculator.calculate(regular(clothOnPieces, clothOnKilos, bag, noUnit));

        assertEquals("MTR", result.getLines().get(0).getUnit(), "PCS class: the cloth's own unit");
        assertEquals("MTR", result.getLines().get(1).getUnit(), "KGS class: the cloth's own unit");
        assertEquals("PCS", result.getLines().get(2).getUnit(), "a counted line keeps the tax class unit");
        assertEquals("PCS", result.getLines().get(3).getUnit(), "no unit given: the tax class unit as before");
        assertMoney("419.56", result.getLines().get(0).getNet());
    }

    // ------------------------------------------------------------------ helpers

    private static TaxRequest regular(TaxLineInput... lines) {
        return TaxRequest.builder()
                .mode(TaxMode.REGULAR)
                .sellerStateCode(UP)
                .placeOfSupplyState(UP)
                .date(TestTaxData.DATE_TEST)
                .lines(List.of(lines))
                .build();
    }

    private static TaxLineInput item(String ref, String unitPrice, int quantity, TaxClassRef taxClass) {
        return TaxLineInput.builder().lineRef(ref).lineType(TaxLineType.ITEM).description("Item " + ref)
                .unitPrice(new BigDecimal(unitPrice)).quantity(quantity).taxClass(taxClass).build();
    }

    private static TaxLineInput line(String ref, TaxLineType type, String price, TaxClassRef taxClass) {
        return TaxLineInput.builder().lineRef(ref).lineType(type).description(type.name())
                .unitPrice(new BigDecimal(price)).quantity(1).taxClass(taxClass).build();
    }

    private static CreditLineInput creditLine(TaxLineResult line, int quantityBefore, CreditLineResult before,
                                              int quantityNow) {
        return CreditLineInput.builder()
                .lineRef(line.getLineRef())
                .quantity(line.getQuantity())
                .net(line.getNet())
                .taxableValue(line.getTaxableValue())
                .cgst(line.getCgst()).sgst(line.getSgst()).igst(line.getIgst()).cess(line.getCess())
                .ratePercent(line.getRatePercent()).cessPercent(line.getCessPercent())
                .quantityCreditedBefore(quantityBefore)
                .netCreditedBefore(before == null ? null : before.getNet())
                .taxableCreditedBefore(before == null ? null : before.getTaxableValue())
                .cgstCreditedBefore(before == null ? null : before.getCgst())
                .sgstCreditedBefore(before == null ? null : before.getSgst())
                .igstCreditedBefore(before == null ? null : before.getIgst())
                .cessCreditedBefore(before == null ? null : before.getCess())
                .quantityToCredit(quantityNow)
                .build();
    }

    private static void assertAddsUp(TaxLineResult line) {
        assertEquals(0, line.getTaxableValue().add(line.getCgst()).add(line.getSgst()).add(line.getIgst())
                .add(line.getCess()).compareTo(line.getNet()), "taxable + taxes = net on line " + line.getLineRef());
        assertEquals(0, line.getNet().subtract(line.getTaxableValue()).compareTo(line.getTaxAmount()));
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertEquals(0, new BigDecimal(expected).compareTo(actual), "expected " + expected + " but was " + actual);
    }
}
