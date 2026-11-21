package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.InvoiceFact;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.MovementFact;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.OrderFact;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.RefundFact;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository.TenderFact;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The day report from fixed rows. */
class PosZReportTest {

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    @Test
    void theDayReportCountsBillsVoidedAndPaperBillsApart() {
        PosSession session = new PosSession();
        session.setId("s-1");
        session.setCashierUserId("cashier-1");
        session.setOpeningCash(money("500.00"));
        session.setOpenedAt(new Date(0));
        PosRegister register = new PosRegister();
        register.setCode("R1");
        register.setName("Front counter");
        Date now = new Date();
        PosSessionService.Facts facts = new PosSessionService.Facts(
                List.of(new OrderFact("o1", "ORD-1", "DELIVERED", money("1000.00"), money("50.00"), now),
                        new OrderFact("o2", "ORD-2", "CANCELLED", money("300.00"), money("0.00"), now),
                        new OrderFact("o3", "ORD-3", "DELIVERED", money("450.00"), money("0.00"), now),
                        new OrderFact("o4", "ORD-4", "DELIVERED", money("200.00"), money("10.00"), now)),
                List.of(new InvoiceFact("i1", "o1", "R1/26-27/1", null, false, now),
                        new InvoiceFact("i2", "o2", "R1/26-27/2", null, true, now),
                        new InvoiceFact("i3", "o3", "R1/26-27/3", null, false, now),
                        new InvoiceFact("i4", "o4", "BB/26-27/123", "123", false, now)),
                List.of(new TenderFact("o1", "CASH", money("600.00"), "RECEIVED"),
                        new TenderFact("o1", "UPI", money("400.00"), "RECEIVED"),
                        new TenderFact("o2", "CASH", money("300.00"), "VOID"),
                        new TenderFact("o3", "CARD", money("450.00"), "RECEIVED"),
                        new TenderFact("o4", "CASH", money("200.00"), "RECEIVED")),
                List.of(new RefundFact("CASH", money("100.00"), "PROCESSED")),
                List.of(new MovementFact("CASH_IN", money("50.00")), new MovementFact("CASH_OUT", money("20.00"))),
                List.of(new PosDtos.TaxRow(money("5"), money("1571.43"), money("39.29"), money("39.28"),
                        money("0.00"), money("0.00"))),
                new PosDtos.ReturnsTotal(1, money("100.00")));

        PosDtos.ZReport z = PosSessionService.zReport(session, register, "Main store", facts, now, money("1230.00"),
                money("0.00"), Map.of("500", 2));

        assertEquals(2, z.bills().count());
        assertEquals(0, money("1450.00").compareTo(z.bills().total()));
        assertEquals(1, z.voided().count());
        assertEquals(0, money("300.00").compareTo(z.voided().total()));
        assertEquals(1, z.billBook().count());
        assertEquals(0, money("200.00").compareTo(z.billBook().total()));
        assertEquals(0, money("60.00").compareTo(z.discounts()));
        assertEquals(List.of("CARD", "CASH", "UPI"), z.byMode().stream().map(PosDtos.ModeTotal::mode).toList());
        assertEquals(0, money("800.00").compareTo(z.byMode().get(1).amount()));
        assertEquals(2, z.byMode().get(1).count());
        // 500 + 600 + 200 + 50 - 20 - 100
        assertEquals(0, money("1230.00").compareTo(z.expectedCash()));
        assertEquals(0, money("50.00").compareTo(z.cashIn()));
        assertEquals(0, money("20.00").compareTo(z.cashOut()));
        assertEquals("R1/26-27/1", z.firstInvoiceNumber());
        assertEquals("R1/26-27/3", z.lastInvoiceNumber());
        assertEquals(1, z.refunds().size());
        assertEquals("R1", z.register().code());
        assertEquals("Main store", z.location().name());
    }

    @Test
    void m6_refundsCountOnlyWhatWasPaidAndPendingIsShownApart() {
        PosSession session = new PosSession();
        session.setId("s-2");
        session.setOpeningCash(money("0.00"));
        PosRegister register = new PosRegister();
        register.setCode("R1");
        PosSessionService.Facts facts = new PosSessionService.Facts(List.of(), List.of(), List.of(),
                List.of(new RefundFact("CASH", money("450.00"), "PROCESSED"),
                        new RefundFact("UPI", money("750.00"), "PENDING"),
                        new RefundFact("UPI", money("100.00"), "PROCESSED"),
                        new RefundFact("BANK_TRANSFER", money("20.00"), "FAILED")),
                List.of(), List.of(), new PosDtos.ReturnsTotal(0, money("0.00")));
        PosDtos.ZReport z = PosSessionService.zReport(session, register, "Main store", facts, null, null, null, null);
        assertEquals(List.of("CASH", "UPI"), z.refunds().stream().map(PosDtos.MethodTotal::method).toList());
        assertEquals(0, money("100.00").compareTo(z.refunds().get(1).amount()), "only the paid UPI refund");
        assertEquals(1, z.refundsPending().size());
        assertEquals("UPI", z.refundsPending().get(0).method());
        assertEquals(0, money("750.00").compareTo(z.refundsPending().get(0).amount()));
        assertEquals(0, money("-450.00").compareTo(z.expectedCash()), "the drawer: cash refunds paid only");
    }

    @Test
    void d4_aDifferenceOfThePaiseOfTheExpectedCashNeedsNoNoteOrPin() {
        // A partial return paid 449.73 in cash: expected 550.27, the drawer is counted in rupees.
        assertEquals(0, PosSessionService.ruleVariance(money("550.27"), money("-0.27")).signum());
        assertEquals(0, PosSessionService.ruleVariance(money("550.27"), money("0.73")).signum());
        assertEquals(0, money("-1.27").compareTo(PosSessionService.ruleVariance(money("550.27"), money("-1.27"))),
                "a rupee or more is a difference");
        assertEquals(0, money("-0.50").compareTo(PosSessionService.ruleVariance(money("550.00"), money("-0.50"))),
                "with a whole-rupee expected cash every paisa counts");
    }

    @Test
    void s3_anotherCashierSeesWhoHoldsTheRegisterButNoMoney() {
        PosDtos.SessionView full = new PosDtos.SessionView("s-1", "OPEN", new PosDtos.Ref("r1", "R1", "Front"),
                new PosDtos.Ref("loc-1", null, "Main"), "cashier-1", "First Cashier", false, new Date(0),
                money("500.00"), "Float", money("500.00"), null, null, null, null, null, null, null,
                List.of(new PosDtos.CashMovementView("m-1", "CASH_IN", money("100.00"), "Float", "manager-1", null)),
                null, null, List.of("CLOSE"));
        PosDtos.SessionView seen = PosSessionService.withoutMoney(full);
        assertEquals("cashier-1", seen.cashierUserId());
        assertEquals("First Cashier", seen.cashierName());
        assertEquals("R1", seen.register().code());
        assertEquals(null, seen.openingCash());
        assertEquals(null, seen.openingNote());
        assertEquals(null, seen.summary());
        assertEquals(List.of(), seen.cashMovements());
        assertEquals(List.of(), seen.nextActions());
    }
}
