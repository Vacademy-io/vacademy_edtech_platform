package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;

import java.math.BigDecimal;
import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The fix-round rules of the sale: whose return credit a cashier may spend (D1), the refund limit
 * on an exchange's remainder (D2), and which database refusal is a paper bill number used twice.
 */
class PosSaleRulesTest {

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    @Test
    void d1_aCashierSpendsOnlyTheCreditOfAReturnTakenInTheirOwnSession() {
        PosSession mine = new PosSession();
        mine.setId("s-1");
        CommerceReturn here = new CommerceReturn();
        here.setPosSessionId("s-1");
        CommerceReturn earlier = new CommerceReturn();
        earlier.setPosSessionId("s-0");
        CommerceReturn online = new CommerceReturn();
        assertFalse(PosSaleService.exchangeNeedsApproval(false, here, mine));
        assertTrue(PosSaleService.exchangeNeedsApproval(false, earlier, mine), "another (older) session");
        assertTrue(PosSaleService.exchangeNeedsApproval(false, online, mine), "a return not taken at a counter");
        assertFalse(PosSaleService.exchangeNeedsApproval(true, online, mine), "a manager needs no PIN");
    }

    @Test
    void d2_theRemainderPaidBackIsUnderTheRefundLimitWhateverItsMethod() {
        assertEquals(0, money("750.00").compareTo(PosSaleService.remainder(money("1200.00"), money("450.00"))));
        assertEquals(0, PosSaleService.remainder(money("400.00"), money("450.00")).signum());
        assertTrue(PosSaleService.remainderNeedsApproval(false, money("1200.00"), money("450.00"), money("500.00")));
        assertFalse(PosSaleService.remainderNeedsApproval(false, money("950.00"), money("450.00"), money("500.00")),
                "at the limit");
        assertTrue(PosSaleService.remainderNeedsApproval(false, money("450.01"), money("450.00"), null),
                "an unset limit is 0");
        assertFalse(PosSaleService.remainderNeedsApproval(false, money("450.00"), money("450.00"), null),
                "nothing left over");
        assertFalse(PosSaleService.remainderNeedsApproval(true, money("9000.00"), money("1.00"), null));
    }

    @Test
    void b3_onlyTheInvoiceNumberConstraintIsABillNumberUsedTwice() {
        DataIntegrityViolationException number = new DataIntegrityViolationException("could not execute",
                new ConstraintViolationException("duplicate key", new SQLException("duplicate key value violates "
                        + "unique constraint \"uq_invoice_institute_number\""), "uq_invoice_institute_number"));
        DataIntegrityViolationException other = new DataIntegrityViolationException("could not execute",
                new ConstraintViolationException("duplicate key", new SQLException("duplicate key value violates "
                        + "unique constraint \"uq_commerce_order_line_ref\""), "uq_commerce_order_line_ref"));
        DataIntegrityViolationException byMessage = new DataIntegrityViolationException("x",
                new SQLException("ERROR: duplicate key value violates unique constraint \"uq_invoice_institute_number\""));
        assertTrue(PosSaleService.isConstraint(number, PosSaleService.INVOICE_NUMBER_CONSTRAINT));
        assertTrue(PosSaleService.isConstraint(byMessage, PosSaleService.INVOICE_NUMBER_CONSTRAINT));
        assertFalse(PosSaleService.isConstraint(other, PosSaleService.INVOICE_NUMBER_CONSTRAINT));
        assertFalse(PosSaleService.isConstraint(new DataIntegrityViolationException("no cause"),
                PosSaleService.INVOICE_NUMBER_CONSTRAINT));
    }
}
