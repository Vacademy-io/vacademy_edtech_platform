package vacademy.io.admin_core_service.features.credits.util;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.dto.TaxBreakup;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.BuyerTaxIdentity;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.SaleKind;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.TaxException;
import vacademy.io.admin_core_service.features.platform_billing.enums.TaxHead;
import vacademy.io.common.institute.entity.Institute;

import static org.junit.jupiter.api.Assertions.*;

class TaxResolverTest {

    private static final String SUPPLIER = "23"; // Madhya Pradesh (Vidyayatan)
    private final TaxResolver resolver = new TaxResolver();

    // ── legacy credit-pack path: unchanged ──

    @Test
    void legacyPackPathIsUnchanged() {
        Institute mp = new Institute();
        mp.setStateCode("23");
        TaxBreakup intra = resolver.resolveTax(mp, "INR", 46_500L, SUPPLIER);
        assertEquals(4_185L, intra.getCgstAmountMinor());
        assertEquals(4_185L, intra.getSgstAmountMinor());
        assertEquals(54_870L, intra.getTotalAmountMinor());
        assertEquals("23", intra.getPlaceOfSupply());

        Institute none = new Institute();
        TaxBreakup missing = resolver.resolveTax(none, "INR", 46_500L, SUPPLIER);
        assertEquals(8_370L, missing.getIgstAmountMinor());
        assertEquals("23", missing.getPlaceOfSupply(), "legacy: no state -> IGST with supplier place of supply");

        TaxBreakup usd = resolver.resolveTax(mp, "USD", 2_500L, SUPPLIER);
        assertTrue(usd.isExport());
        assertEquals("96", usd.getPlaceOfSupply());
        assertEquals(2_500L, usd.getTotalAmountMinor());
    }

    // ── place of supply / tax head matrix ──

    @Test
    void sameStateIsCgstPlusSgst() {
        TaxBreakup t = sub(new BuyerTaxIdentity("23", null, "IN"), 500_000L, false);
        assertEquals(TaxHead.CGST_SGST, TaxResolver.taxHeadOf(t));
        assertEquals("23", t.getPlaceOfSupply());
        assertEquals(45_000L, t.getCgstAmountMinor());
        assertEquals(45_000L, t.getSgstAmountMinor());
        assertEquals(0L, t.getIgstAmountMinor());
        assertEquals(900, t.getCgstRateBps());
        assertEquals(590_000L, t.getTotalAmountMinor());
    }

    @Test
    void otherStateIsIgstWithBuyerPlaceOfSupply() {
        TaxBreakup t = sub(new BuyerTaxIdentity("27", null, null), 500_000L, false);
        assertEquals(TaxHead.IGST, TaxResolver.taxHeadOf(t));
        assertEquals("27", t.getPlaceOfSupply());
        assertEquals(90_000L, t.getIgstAmountMinor());
        assertEquals(1800, t.getIgstRateBps());
        assertEquals(590_000L, t.getTotalAmountMinor());
    }

    @Test
    void gstinPrefixDecidesTheState() {
        TaxBreakup t = sub(new BuyerTaxIdentity(null, "23AAYFV8247N1Z3", "IN"), 100_000L, false);
        assertEquals("23", t.getPlaceOfSupply());
        assertEquals(TaxHead.CGST_SGST, TaxResolver.taxHeadOf(t));
        TaxException ex = assertThrows(TaxException.class,
                () -> sub(new BuyerTaxIdentity("27", "23AAYFV8247N1Z3", "IN"), 100_000L, false));
        assertEquals(TaxResolver.STATE_GSTIN_MISMATCH, ex.getCode());
        assertEquals(TaxResolver.INVALID_GSTIN, assertThrows(TaxException.class,
                () -> sub(new BuyerTaxIdentity(null, "NOTAGSTIN", "IN"), 100_000L, false)).getCode());
        assertEquals(TaxResolver.INVALID_STATE, assertThrows(TaxException.class,
                () -> sub(new BuyerTaxIdentity("99", null, "IN"), 100_000L, false)).getCode());
    }

    @Test
    void missingStateIsRefusedForSubscriptionsAlways() {
        TaxException ex = assertThrows(TaxException.class, () -> resolver.resolveForBuyer(SaleKind.SUBSCRIPTION,
                new BuyerTaxIdentity(null, null, "IN"), "INR", 500_000L, false, SUPPLIER, false));
        assertEquals(TaxResolver.BUYER_STATE_REQUIRED, ex.getCode());
        assertEquals(422, ex.getStatus().value());
        assertThrows(TaxException.class, () -> resolver.resolveForBuyer(SaleKind.SUBSCRIPTION,
                null, "INR", 500_000L, false, SUPPLIER, false));
    }

    @Test
    void missingStateForPacksFollowsTheFlag() {
        // flag off (default): legacy fallback, IGST at the supplier's place of supply
        TaxBreakup t = resolver.resolveForBuyer(SaleKind.CREDIT_PACK, new BuyerTaxIdentity(null, null, null),
                "INR", 46_500L, false, SUPPLIER, false);
        assertEquals(TaxHead.IGST, TaxResolver.taxHeadOf(t));
        assertEquals("23", t.getPlaceOfSupply());
        assertEquals(8_370L, t.getTaxAmountMinor());
        // flag on: refused
        assertEquals(TaxResolver.BUYER_STATE_REQUIRED, assertThrows(TaxException.class,
                () -> resolver.resolveForBuyer(SaleKind.CREDIT_PACK, new BuyerTaxIdentity(" ", "", null),
                        "INR", 46_500L, false, SUPPLIER, true)).getCode());
    }

    @Test
    void subscriptionsAreInrAndDomesticOnly() {
        assertEquals(TaxResolver.CURRENCY_NOT_SUPPORTED, assertThrows(TaxException.class,
                () -> resolver.resolveForBuyer(SaleKind.SUBSCRIPTION, new BuyerTaxIdentity("23", null, "IN"),
                        "USD", 500_000L, false, SUPPLIER, true)).getCode());
        assertEquals(TaxResolver.EXPORT_NOT_SUPPORTED, assertThrows(TaxException.class,
                () -> resolver.resolveForBuyer(SaleKind.SUBSCRIPTION, new BuyerTaxIdentity("23", null, "AE"),
                        "INR", 500_000L, false, SUPPLIER, true)).getCode());
    }

    @Test
    void exportIsDecidedByBuyerCountryNotCurrency() {
        // Indian buyer paying USD: still a taxable domestic supply
        TaxBreakup indianUsd = resolver.resolveForBuyer(SaleKind.CREDIT_PACK,
                new BuyerTaxIdentity("27", null, "India"), "USD", 2_500L, false, SUPPLIER, false);
        assertFalse(indianUsd.isExport());
        assertEquals(450L, indianUsd.getIgstAmountMinor());
        // foreign buyer: zero-rated export, place of supply 96
        TaxBreakup foreign = resolver.resolveForBuyer(SaleKind.CREDIT_PACK,
                new BuyerTaxIdentity(null, null, "AE"), "USD", 2_500L, false, SUPPLIER, false);
        assertTrue(foreign.isExport());
        assertEquals(TaxHead.EXPORT, TaxResolver.taxHeadOf(foreign));
        assertEquals("96", foreign.getPlaceOfSupply());
        assertEquals(2_500L, foreign.getTotalAmountMinor());
    }

    // ── inclusive math ──

    @Test
    void inclusivePriceIsKeptExactlyAndTaxIsTotalMinusBase() {
        TaxBreakup t = sub(new BuyerTaxIdentity("27", null, "IN"), 590_000L, true);
        assertEquals(500_000L, t.getBaseAmountMinor());
        assertEquals(90_000L, t.getTaxAmountMinor());
        assertEquals(590_000L, t.getTotalAmountMinor());

        // every inclusive price from Rs 1 to Rs 200 (step 1 paisa band) keeps its total to the paisa,
        // under both heads, and the head never changes the total
        for (long total = 100; total <= 20_000; total += 7) {
            TaxBreakup inter = sub(new BuyerTaxIdentity("27", null, "IN"), total, true);
            TaxBreakup intra = sub(new BuyerTaxIdentity("23", null, "IN"), total, true);
            assertEquals(total, inter.getTotalAmountMinor());
            assertEquals(total, intra.getTotalAmountMinor());
            assertEquals(inter.getTotalAmountMinor() - inter.getBaseAmountMinor(), inter.getTaxAmountMinor());
            assertEquals(intra.getTaxAmountMinor(), intra.getCgstAmountMinor() + intra.getSgstAmountMinor());
            assertTrue(intra.getSgstAmountMinor() - intra.getCgstAmountMinor() <= 1);
            assertEquals(inter.getBaseAmountMinor(), intra.getBaseAmountMinor());
        }
    }

    @Test
    void exclusiveTotalDoesNotDependOnTheHead() {
        for (long base = 1; base <= 5_000; base += 3) {
            TaxBreakup inter = sub(new BuyerTaxIdentity("27", null, "IN"), base, false);
            TaxBreakup intra = sub(new BuyerTaxIdentity("23", null, "IN"), base, false);
            assertEquals(inter.getTotalAmountMinor(), intra.getTotalAmountMinor(), "base " + base);
        }
    }

    @Test
    void singleDigitStateCodeIsPadded() {
        assertEquals("07", TaxResolver.resolveBuyerState(null, "7"));
        assertNull(TaxResolver.resolveBuyerState(" ", null));
    }

    private TaxBreakup sub(BuyerTaxIdentity buyer, long amount, boolean inclusive) {
        return resolver.resolveForBuyer(SaleKind.SUBSCRIPTION, buyer, "INR", amount, inclusive, SUPPLIER, true);
    }
}
