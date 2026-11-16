package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceExchangeService;

/**
 * StaffOrderServiceExchangeTest: a staff order paid (in part) by the credit of a received return.
 * The credit becomes a CREDIT_NOTE tender of min(credit, total) written first; the tenders are
 * checked with it; a credit above the new order needs a remainder method; the old order and the
 * return are locked before anything of the new order is written.
 */
@SuppressWarnings("unchecked")
class StaffOrderServiceExchangeTest {

    private DeskFixture f;
    private CommerceOrderService orderService;
    private CommerceExchangeService exchange;
    private CommerceStaffOrderService service;
    private final CustomUserDetails manager = DeskFixture.manager();
    private CartPriceSnapshot snapshot;
    private final List<String> calls = new java.util.ArrayList<>();
    private CommerceOrder oldOrder;

    @BeforeEach
    void setUp() {
        f = new DeskFixture();
        orderService = mock(CommerceOrderService.class);
        CommerceBuyerResolver buyerResolver = mock(CommerceBuyerResolver.class);
        CommerceCounterService counterService = mock(CommerceCounterService.class);
        ObjectProvider<CommerceShipmentService> provider = mock(ObjectProvider.class);
        service = new CommerceStaffOrderService(f.desk, orderService, f.writer, f.orderRepository,
                f.tenderRepository, buyerResolver, counterService, mock(CommerceStockSettings.class),
                f.locationRepository, f.accessGuard, f.auditService, f.events, mock(PaymentLogService.class),
                mock(UserPlanService.class), provider, f.transactionManager);
        exchange = mock(CommerceExchangeService.class);
        service.useExchangeService(exchange);

        snapshot = CartPriceSnapshot.builder().total(new BigDecimal("1060.00")).placeOfSupplyState("09")
                .fulfilmentLocationId(LOC).lines(List.of(CartPriceSnapshot.Line.builder().lineRef("L1").build()))
                .tax(vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult.builder().build()).build();
        when(orderService.priceCart(eq(INST), any(CartPriceRequest.class), any(CommerceOrderService.StaffPricing.class)))
                .thenAnswer(call -> new CommerceOrderService.CartPrice(snapshot,
                        CartPriceDtos.CartPrice.builder().unavailable(List.of()).build()));
        when(buyerResolver.resolve(eq(INST), eq(BuyerIdentity.PHONE_OTP), anyString(), anyString(), any(),
                eq(true))).thenReturn(new CommerceBuyerResolver.Buyer("buyer-1", true));
        when(counterService.nextNumber(INST, "ORD")).thenReturn("ORD-000009");
        when(f.orderRepository.findByInstituteIdAndClientRequestId(INST, "staff-order-1")).thenReturn(Optional.empty());
        f.line("l1", 2, "1000.00");
        f.order.setChannel("ADMIN");
        f.order.setTotal(new BigDecimal("1060.00"));
        when(f.orderRepository.save(any(CommerceOrder.class))).thenAnswer(call -> call.getArgument(0));
        when(f.writer.writeStaff(any())).thenAnswer(call -> {
            calls.add("writeStaff");
            return new CommerceOrderWriter.Written(f.order, f.lines, null);
        });
        oldOrder = new CommerceOrder();
        oldOrder.setId("old-1");
    }

    private void credit(String amount) {
        CommerceReturn ret = new CommerceReturn();
        ret.setId("ret-1");
        when(exchange.lock(eq(INST), any())).thenAnswer(call -> {
            calls.add("lock");
            return new CommerceExchangeService.Locked(oldOrder, ret, new BigDecimal(amount), "CN-0001");
        });
    }

    private StaffOrderRequest.StaffOrderRequestBuilder request(String method) {
        return StaffOrderRequest.builder().clientRequestId("staff-order-1")
                .customer(StaffOrderRequest.Customer.builder().phone("+91 98765 00001").name("Counter Buyer").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(2).build()))
                .exchange(StaffOrderRequest.Exchange.builder().returnId("ret-1").remainderRefund(method == null ? null
                        : StaffOrderRequest.RemainderRefund.builder().method(method).build()).build());
    }

    private List<CommerceOrderWriter.StaffTender> tenders() {
        ArgumentCaptor<CommerceOrderWriter.StaffNewOrder> written =
                ArgumentCaptor.forClass(CommerceOrderWriter.StaffNewOrder.class);
        verify(f.writer).writeStaff(written.capture());
        return written.getValue().tenders();
    }

    @Test
    void aCreditBelowTheNewOrderPaysPartAndTheRestIsReceivedOrOnCredit() {
        credit("400.00");
        service.create(manager, INST, request(null).tenders(List.of(StaffOrderRequest.Tender.builder().mode("CASH")
                .amount(new BigDecimal("660.00")).build())).build());
        List<CommerceOrderWriter.StaffTender> tenders = tenders();
        assertEquals("CREDIT_NOTE", tenders.get(0).mode());
        assertEquals(0, new BigDecimal("400.00").compareTo(tenders.get(0).amount()));
        assertEquals("CN-0001", tenders.get(0).reference());
        assertEquals("CASH", tenders.get(1).mode());
        assertEquals(List.of("lock", "writeStaff"), calls, "the old order and return are locked first");
        assertEquals("old-1", f.order.getExchangeOfOrderId());
        verify(exchange).apply(any(), eq(f.order), any(), eq("user-1"));
        verify(exchange).executeRemainder(INST, f.order.getId());
    }

    @Test
    void aCreditBelowTheNewOrderWithoutTheRestIsShortUnlessOnCredit() {
        credit("400.00");
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> service.create(manager, INST,
                request(null).build()));
        assertTrue(e.getMessage().startsWith("TENDERS_SHORT"), e.getMessage());
        verify(f.writer, never()).writeStaff(any());
        service.create(manager, INST, request(null).restOnCredit(true).build());
        assertEquals(1, tenders().size());
    }

    @Test
    void aCreditEqualToTheNewOrderPaysItInFull() {
        credit("1060.00");
        service.create(manager, INST, request(null).build());
        List<CommerceOrderWriter.StaffTender> tenders = tenders();
        assertEquals(1, tenders.size());
        assertEquals(0, new BigDecimal("1060.00").compareTo(tenders.get(0).amount()));
    }

    @Test
    void aCreditAboveTheNewOrderNeedsARemainderMethodAndPaysOnlyTheTotal() {
        credit("1500.00");
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> service.create(manager, INST,
                request(null).build()));
        assertTrue(e.getMessage().startsWith("EXCHANGE_REMAINDER_REQUIRED"), e.getMessage());
        verify(f.writer, never()).writeStaff(any());
        for (String method : List.of("CASH", "UPI", "BANK_TRANSFER", "GATEWAY")) {
            org.mockito.Mockito.clearInvocations(f.writer, exchange);
            service.create(manager, INST, request(method).build());
            List<CommerceOrderWriter.StaffTender> tenders = tenders();
            assertEquals(0, new BigDecimal("1060.00").compareTo(tenders.get(0).amount()), method);
            ArgumentCaptor<CommerceExchangeService.Ask> ask = ArgumentCaptor.forClass(CommerceExchangeService.Ask.class);
            verify(exchange).apply(any(), any(), ask.capture(), any());
            assertEquals(method, ask.getValue().remainderMethod().name());
        }
    }

    @Test
    void moneyOverTheTotalAndBadExchangeBodiesAreRefused() {
        credit("400.00");
        InvalidRequestException over = assertThrows(InvalidRequestException.class, () -> service.create(manager, INST,
                request(null).tenders(List.of(StaffOrderRequest.Tender.builder().mode("CASH")
                        .amount(new BigDecimal("700.00")).build())).build()));
        assertTrue(over.getMessage().startsWith("TENDERS_OVER"));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request("EXCHANGE_CREDIT")
                .build()));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request(null)
                .exchange(StaffOrderRequest.Exchange.builder().build()).build()));
        verify(f.writer, never()).writeStaff(any());
    }

    @Test
    void aReturnThatCannotBeExchangedRefusesTheWholeOrder() {
        when(exchange.lock(eq(INST), any())).thenThrow(new ConflictException(
                "EXCHANGE_NOT_AVAILABLE: the return was refunded already"));
        ConflictException e = assertThrows(ConflictException.class, () -> service.create(manager, INST,
                request(null).build()));
        assertTrue(e.getMessage().startsWith("EXCHANGE_NOT_AVAILABLE"));
        verify(f.writer, never()).writeStaff(any());
    }
}
