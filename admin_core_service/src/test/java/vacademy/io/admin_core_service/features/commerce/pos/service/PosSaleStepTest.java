package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceExchangeService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * D4: a counter line that is not a whole number of the item's sale step (2.3 m of a cloth cut in
 * 0.5 m) is refused with 400 QUANTITY_STEP naming the line and the step in metres, before anything
 * is priced or written. A line on the step passes the rule.
 */
@SuppressWarnings("unchecked")
class PosSaleStepTest {

    private static final String INST = "inst-1";

    private final PosAccess access = mock(PosAccess.class);
    private final CommerceOrderService orderService = mock(CommerceOrderService.class);
    private final CommerceOrderWriter writer = mock(CommerceOrderWriter.class);
    private final CommerceOrderRepository orderRepository = mock(CommerceOrderRepository.class);
    private final StorefrontSnapshotLoader variantLoader = mock(StorefrontSnapshotLoader.class);
    private final StockLedgerService ledger = mock(StockLedgerService.class);
    private final StockHoldService holds = mock(StockHoldService.class);
    private final CommerceInvoiceService invoices = mock(CommerceInvoiceService.class);
    private final CommerceCounterService counters = mock(CommerceCounterService.class);
    private PosSaleService service;

    static CartVariant linen() {
        return new CartVariant("ps-linen", "pkg-linen", "LINEN-1", "linen-cloth", true, true, true, false, "tc-1",
                "MTR", 10, 5, null, 100, null, Map.of("en", "Linen cloth"), new BigDecimal("20.00"), null, "INR");
    }

    @BeforeEach
    void setUp() {
        service = new PosSaleService(access, mock(PosSessionRepository.class), mock(PosReadRepository.class),
                mock(PosSettingsService.class), mock(PosWalkInUsers.class), mock(PosReceiptService.class),
                orderService, writer, orderRepository, mock(CommerceOrderLineRepository.class),
                mock(CommerceOrderTenderRepository.class), mock(CommerceOrderDeskService.class),
                mock(CommerceStaffOrderService.class), mock(CommerceOrderEvents.class),
                mock(CommerceBuyerResolver.class), mock(CommerceCustomerService.class), counters, variantLoader,
                ledger, holds, mock(CommercePieceRepository.class), mock(CommerceStockShortFlagger.class), invoices,
                mock(CommerceApprovalService.class), mock(CommerceAuditService.class), new DocumentClock(),
                mock(ObjectProvider.class), mock(ObjectProvider.class), mock(PlatformTransactionManager.class));

        PosSession session = new PosSession();
        session.setId("s-1");
        session.setStatus("OPEN");
        session.setLocationId("loc-1");
        session.setRegisterId("reg-1");
        when(access.session(any(), eq(INST), eq("s-1"))).thenReturn(session);
        PosRegister register = new PosRegister();
        register.setStatus("ACTIVE");
        when(access.readRegister(INST, "reg-1")).thenReturn(register);
        when(orderRepository.findByInstituteIdAndClientRequestId(eq(INST), anyString())).thenReturn(Optional.empty());
        when(variantLoader.cartVariants(eq(INST), any(), any())).thenReturn(Map.of("ps-linen", linen()));
    }

    private static CustomUserDetails cashier() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("cashier-1");
        dto.setUsername("cashier-1");
        dto.setAuthorities(List.of("COMMERCE_POS_CASHIER"));
        return new CustomUserDetails(dto);
    }

    private static PosDtos.SaleRequest sale(int quantity) {
        return new PosDtos.SaleRequest("pos-step-1", "s-1",
                List.of(new PosDtos.SaleLine("L1", "ps-linen", quantity, null, null, new BigDecimal("20.00"))),
                null, null, List.of(new PosDtos.Tender("CASH", new BigDecimal("46.00"), null, null)),
                null, null, null, null, null);
    }

    @Test
    void aSaleOffTheStepIsRefusedBeforeAnythingIsPricedOrWritten() {
        InvalidRequestException refused = assertThrows(InvalidRequestException.class,
                () -> service.sale(cashier(), INST, sale(23)));

        assertEquals("QUANTITY_STEP: line L1 is sold in steps of 0.5 m", refused.getMessage());
        verifyNoInteractions(orderService, writer, ledger, holds, invoices, counters);
    }

    @Test
    void theRuleNamesTheLineAndPassesALineOnTheStep() {
        PosSaleService.Clean off = PosSaleService.validate(sale(23), PosSaleService.Kind.SALE,
                new DocumentClock().today(INST));
        PosSaleService.Clean on = PosSaleService.validate(sale(25), PosSaleService.Kind.SALE,
                new DocumentClock().today(INST));
        Map<String, CartVariant> variants = Map.of("ps-linen", linen());

        assertThrows(InvalidRequestException.class, () -> PosSaleService.requireSteps(off.lines(), variants));
        assertDoesNotThrow(() -> PosSaleService.requireSteps(on.lines(), variants));
        // A counted item with step 1 is never refused by this rule.
        assertDoesNotThrow(() -> PosSaleService.requireSteps(off.lines(),
                Map.of("ps-linen", PosSaleValidationTest.variant("ps-linen", false, true))));
    }

    private static PosDtos.SaleRequest paperBill(int quantity) {
        return new PosDtos.SaleRequest("pos-book-1", "s-1",
                List.of(new PosDtos.SaleLine("L1", "ps-linen", quantity, null, null, new BigDecimal("20.00"))),
                null, null, List.of(new PosDtos.Tender("CASH", new BigDecimal("46.00"), null, null)),
                null, new PosDtos.Approval("manager-1", "1234", null), null, "123",
                new DocumentClock().today(INST).toString());
    }

    /**
     * W8: a paper bill keyed in later records a length already cut by hand (2.3 m of a cloth sold
     * in 0.5 m): the bill-book entry does not apply the sale step, and prices it as a paper bill.
     */
    @Test
    void aPaperBillOffTheStepIsPricedNotRefused() {
        org.mockito.ArgumentCaptor<CommerceOrderService.CounterPricing> counter =
                org.mockito.ArgumentCaptor.forClass(CommerceOrderService.CounterPricing.class);
        when(orderService.priceCart(eq(INST), any(), isNull(), counter.capture()))
                .thenThrow(new IllegalStateException("priced"));

        IllegalStateException reached = assertThrows(IllegalStateException.class,
                () -> service.billBook(cashier(), INST, paperBill(23)));

        assertEquals("priced", reached.getMessage(), "past the step rule, into pricing");
        assertTrue(counter.getValue().paperBill(), "priced as a paper bill: the cart's step is off too");
        // The till's sale keeps the step.
        assertThrows(InvalidRequestException.class, () -> service.sale(cashier(), INST, sale(23)));
    }

    /** W8: the bill-book screen's quote says paper_bill; a sale may not. */
    @Test
    void onlyAQuoteMayAskForPaperBillPricing() {
        PosDtos.SaleRequest base = sale(23);
        PosDtos.SaleRequest asked = new PosDtos.SaleRequest(base.clientRequestId(), base.sessionId(), base.lines(),
                null, null, base.tenders(), null, null, null, null, null, null, Boolean.TRUE);
        assertTrue(PosSaleService.validate(asked, PosSaleService.Kind.QUOTE, new DocumentClock().today(INST))
                .paperBill());
        assertFalse(PosSaleService.validate(base, PosSaleService.Kind.QUOTE, new DocumentClock().today(INST))
                .paperBill());
        InvalidRequestException onSale = assertThrows(InvalidRequestException.class,
                () -> PosSaleService.validate(asked, PosSaleService.Kind.SALE, new DocumentClock().today(INST)));
        assertTrue(onSale.getMessage().startsWith("VALIDATION: paper_bill"), onSale.getMessage());
        assertTrue(PosSaleService.validate(paperBill(23), PosSaleService.Kind.BILL_BOOK,
                new DocumentClock().today(INST)).paperBill());
    }

    /** W12: PRICE_CHANGED names the new price per metre for a measured item, as the screen shows it. */
    @Test
    void thePriceChangedAnswerIsPerDisplayUnit() {
        vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos.Change change =
                vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos.Change.builder()
                        .lineRef("L1").variantId("ps-linen").newUnitPrice(new BigDecimal("12.34")).build();
        assertEquals("₹123.40 / m", PosSaleService.newPriceText(change, linen()));
        assertEquals("12.34", PosSaleService.newPriceText(change, null), "unknown item: as before");
        assertEquals("12.34", PosSaleService.newPriceText(change,
                PosSaleValidationTest.variant("ps-linen", false, true)), "a counted item: as before");
    }
}
