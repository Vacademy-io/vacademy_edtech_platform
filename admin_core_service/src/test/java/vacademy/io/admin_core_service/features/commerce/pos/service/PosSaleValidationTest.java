package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The 400 rules of a sale body, the piece rule and the request hash. */
class PosSaleValidationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 18);
    private static final String KEY = "pos-lz3k1-9f2c6a1b7d3e";

    private static PosDtos.SaleLine line(String ref, String variant, int quantity) {
        return new PosDtos.SaleLine(ref, variant, quantity, null, null, new BigDecimal("450.00"));
    }

    private static PosDtos.SaleRequest body(List<PosDtos.SaleLine> lines, PosDtos.BillDiscount discount,
                                            PosDtos.Customer customer, List<PosDtos.Tender> tenders) {
        return new PosDtos.SaleRequest(KEY, "s-1", lines, discount, customer, tenders, null, null, null, null, null);
    }

    private static PosDtos.SaleRequest simple(List<PosDtos.Tender> tenders) {
        return body(List.of(line("l1", "ps-bottle", 2)), null, null, tenders);
    }

    private static PosDtos.Tender cash(String amount, String handed) {
        return new PosDtos.Tender("CASH", new BigDecimal(amount), handed == null ? null : new BigDecimal(handed), null);
    }

    private static String code(Runnable call) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, call::run);
        String message = e.getMessage();
        return message.substring(0, message.indexOf(':'));
    }

    private static PosSaleService.Clean validate(PosDtos.SaleRequest body) {
        return PosSaleService.validate(body, PosSaleService.Kind.SALE, TODAY);
    }

    @Test
    void aPlainCashSaleIsValidAndAWalkIn() {
        PosSaleService.Clean clean = validate(simple(List.of(cash("900.00", "1000.00"))));
        assertTrue(clean.walkIn());
        assertTrue(clean.notifyBuyer());
        assertEquals(0, new BigDecimal("900.00").compareTo(clean.received()));
        assertEquals(0, new BigDecimal("1000.00").compareTo(clean.tenders().get(0).cashTendered()));
    }

    @Test
    void linesAreOneToFiftyWithDistinctRefsAndVariants() {
        assertEquals("VALIDATION", code(() -> validate(body(List.of(), null, null, List.of()))));
        List<PosDtos.SaleLine> many = new ArrayList<>();
        for (int i = 0; i < 51; i++) {
            many.add(line("l" + i, "ps-" + i, 1));
        }
        assertEquals("VALIDATION", code(() -> validate(body(many, null, null, List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-a", 1), line("l1", "ps-b", 1)),
                null, null, List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-a", 1), line("l2", "ps-a", 1)),
                null, null, List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-a", 0)), null, null, List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-a", 100_001)), null, null,
                List.of()))));
    }

    @Test
    void pieceIdsAreOnePerUnitAndDistinct() {
        PosDtos.SaleLine short1 = new PosDtos.SaleLine("l1", "ps-scarf", 2, List.of("p-1"), null, null);
        assertEquals("PIECE_SCAN_REQUIRED", code(() -> validate(body(List.of(short1), null, null, List.of()))));
        PosDtos.SaleLine twice = new PosDtos.SaleLine("l1", "ps-scarf", 2, List.of("p-1", "p-1"), null, null);
        assertEquals("VALIDATION", code(() -> validate(body(List.of(twice), null, null, List.of()))));
    }

    @Test
    void thePieceRuleFollowsTheVariant() {
        CartVariant piece = variant("ps-scarf", true, true);
        CartVariant quantity = variant("ps-bottle", false, true);
        PosSaleService.Clean noPieces = validate(body(List.of(line("l1", "ps-scarf", 1)), null, null, List.of()));
        assertEquals("PIECE_SCAN_REQUIRED", code(() -> PosSaleService.requirePieces(noPieces.lines(),
                Map.of("ps-scarf", piece))));
        PosSaleService.Clean withPieces = validate(body(List.of(new PosDtos.SaleLine("l1", "ps-bottle", 1,
                List.of("p-1"), null, null)), null, null, List.of()));
        assertEquals("VALIDATION", code(() -> PosSaleService.requirePieces(withPieces.lines(),
                Map.of("ps-bottle", quantity))));
        PosSaleService.Clean ok = validate(body(List.of(new PosDtos.SaleLine("l1", "ps-scarf", 1, List.of("p-1"),
                null, null)), null, null, List.of()));
        assertDoesNotThrow(() -> PosSaleService.requirePieces(ok.lines(), Map.of("ps-scarf", piece)));
        // An untracked one-of-a-kind item is sold without its pieces.
        assertDoesNotThrow(() -> PosSaleService.requirePieces(noPieces.lines(),
                Map.of("ps-scarf", variant("ps-scarf", true, false))));
    }

    @Test
    void aDiscountNeedsAReasonAndAValidKind() {
        PosDtos.SaleLine discounted = new PosDtos.SaleLine("l1", "ps-bottle", 1, null, new BigDecimal("10.00"), null);
        assertEquals("VALIDATION", code(() -> validate(body(List.of(discounted), null, null, List.of()))));
        assertDoesNotThrow(() -> validate(body(List.of(discounted),
                new PosDtos.BillDiscount("AMOUNT", null, "Regular customer"), null, List.of())));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-bottle", 1)),
                new PosDtos.BillDiscount("AMOUNT", new BigDecimal("50.00"), null), null, List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-bottle", 1)),
                new PosDtos.BillDiscount("PERCENT", new BigDecimal("100.01"), "x"), null, List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-bottle", 1)),
                new PosDtos.BillDiscount("FREE", new BigDecimal("1"), "x"), null, List.of()))));
        PosDtos.SaleLine negative = new PosDtos.SaleLine("l1", "ps-bottle", 1, null, new BigDecimal("-1"), null);
        assertEquals("VALIDATION", code(() -> validate(body(List.of(negative),
                new PosDtos.BillDiscount("AMOUNT", null, "x"), null, List.of()))));
    }

    @Test
    void aPercentBillDiscountIsTakenOnTheGoodsAfterLineDiscounts() {
        PosDtos.SaleLine discounted = new PosDtos.SaleLine("l1", "ps-bottle", 2, null, new BigDecimal("100.00"), null);
        PosSaleService.Clean clean = validate(body(List.of(discounted),
                new PosDtos.BillDiscount("PERCENT", new BigDecimal("10"), "Festival"), null, List.of()));
        BigDecimal amount = PosSaleService.billDiscountAmount(clean, Map.of("ps-bottle", variant("ps-bottle", false,
                true)));
        // (2 x 450 - 100) x 10 % = 80
        assertEquals(0, new BigDecimal("80.00").compareTo(amount));
    }

    @Test
    void theCustomerIsNormalisedAndABusinessBillNeedsItsLegalName() {
        PosSaleService.Clean named = validate(body(List.of(line("l1", "ps-bottle", 1)), null,
                new PosDtos.Customer("98765 43210", "Test Buyer", null, null), List.of()));
        assertEquals("919876543210", named.phone());
        assertFalse(named.walkIn());
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-bottle", 1)), null,
                new PosDtos.Customer("12345", null, null, null), List.of()))));
        assertEquals("VALIDATION", code(() -> validate(body(List.of(line("l1", "ps-bottle", 1)), null,
                new PosDtos.Customer(null, null, "NOT-A-GSTIN", "Test Traders"), List.of()))));
    }

    @Test
    void tenderRules() {
        assertEquals("CASH_TENDERED_SHORT", code(() -> validate(simple(List.of(cash("900.00", "899.99"))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(cash("400.00", null), cash("500.00", null))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(new PosDtos.Tender("UPI",
                new BigDecimal("900.00"), null, null))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(new PosDtos.Tender("UPI",
                new BigDecimal("900.00"), new BigDecimal("900.00"), "ref 1"))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(new PosDtos.Tender("CARD",
                new BigDecimal("900.00"), null, "ref<1>"))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(new PosDtos.Tender("GATEWAY",
                new BigDecimal("900.00"), null, null))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(cash("0.00", null))))));
        assertEquals("VALIDATION", code(() -> validate(simple(List.of(cash("10.001", null))))));
        assertDoesNotThrow(() -> validate(simple(List.of(new PosDtos.Tender("CHEQUE", new BigDecimal("900.00"),
                null, null)))));
        assertDoesNotThrow(() -> validate(simple(List.of(new PosDtos.Tender("UPI", new BigDecimal("900.00"), null,
                "UPI ref 4411")))));
    }

    @Test
    void theClientKeyIsRequiredForASaleButNotForAQuote() {
        PosDtos.SaleRequest noKey = new PosDtos.SaleRequest(null, "s-1", List.of(line("l1", "ps-bottle", 1)), null,
                null, null, null, null, null, null, null);
        assertEquals("VALIDATION", code(() -> validate(noKey)));
        assertDoesNotThrow(() -> PosSaleService.validate(noKey, PosSaleService.Kind.QUOTE, TODAY));
    }

    @Test
    void aBillBookEntryNeedsItsNumberAndADateOfTheLastThreeDays() {
        PosDtos.SaleRequest ok = new PosDtos.SaleRequest(KEY, "s-1", List.of(line("l1", "ps-bottle", 1)), null, null,
                List.of(), null, null, null, "123", "2026-11-17");
        PosSaleService.Clean clean = PosSaleService.validate(ok, PosSaleService.Kind.BILL_BOOK, TODAY);
        assertEquals("123", clean.bookNumber());
        assertEquals(LocalDate.of(2026, 11, 17), clean.documentDate());
        assertFalse(clean.notifyBuyer());
        assertEquals(LocalDate.of(2026, 11, 15), PosSaleService.billDate("2026-11-15", TODAY));
        assertEquals("BILL_DATE_INVALID", code(() -> PosSaleService.billDate("2026-11-14", TODAY)));
        assertEquals("BILL_DATE_INVALID", code(() -> PosSaleService.billDate("2026-11-19", TODAY)));
        assertEquals("BILL_DATE_INVALID", code(() -> PosSaleService.billDate("yesterday", TODAY)));
        PosDtos.SaleRequest badNumber = new PosDtos.SaleRequest(KEY, "s-1", List.of(line("l1", "ps-bottle", 1)), null,
                null, List.of(), null, null, null, "12A", "2026-11-17");
        assertEquals("VALIDATION", code(() -> PosSaleService.validate(badNumber, PosSaleService.Kind.BILL_BOOK,
                TODAY)));
        PosDtos.SaleRequest numberOnASale = new PosDtos.SaleRequest(KEY, "s-1", List.of(line("l1", "ps-bottle", 1)),
                null, null, List.of(), null, null, null, "123", null);
        assertEquals("VALIDATION", code(() -> validate(numberOnASale)));
    }

    @Test
    void theRequestHashIgnoresTheApproval() {
        PosDtos.SaleRequest plain = simple(List.of(cash("900.00", "1000.00")));
        PosDtos.SaleRequest withPin = new PosDtos.SaleRequest(KEY, "s-1", plain.lines(), null, null, plain.tenders(),
                null, new PosDtos.Approval("manager-1", "1234", "ok"), null, null, null);
        assertEquals(CommerceRequestGuard.hash("POS_SALE", plain.withoutApproval()),
                CommerceRequestGuard.hash("POS_SALE", withPin.withoutApproval()));
        assertNull(withPin.withoutApproval().approval());
        PosDtos.SaleRequest otherTender = simple(List.of(cash("900.00", "2000.00")));
        assertFalse(CommerceRequestGuard.hash("POS_SALE", plain.withoutApproval())
                .equals(CommerceRequestGuard.hash("POS_SALE", otherTender.withoutApproval())));
    }

    static CartVariant variant(String id, boolean piece, boolean tracked) {
        return new CartVariant(id, "pkg-" + id, id.toUpperCase(), "slug-" + id, true, true, tracked, piece, "tc-1",
                "PCS", 1, 1, null, 5, null, Map.of("en", "Steel bottle"), new BigDecimal("450.00"), null, "INR");
    }
}
