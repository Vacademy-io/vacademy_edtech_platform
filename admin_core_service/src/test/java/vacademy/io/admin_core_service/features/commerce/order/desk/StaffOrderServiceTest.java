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

/**
 * A staff order: a typed price kept and audited, money received and the rest on credit (or
 * refused short or over), paid in full settles at once, the hand-over runs in the same
 * transaction, the buyer is the phone's holder, and a repeat of the request is answered.
 */
@SuppressWarnings("unchecked")
class StaffOrderServiceTest {

    private DeskFixture f;
    private CommerceOrderService orderService;
    private CommerceBuyerResolver buyerResolver;
    private CommerceCounterService counterService;
    private PaymentLogService paymentLogService;
    private UserPlanService userPlanService;
    private CommerceShipmentService shipments;
    private CommerceStaffOrderService service;
    private final CustomUserDetails manager = DeskFixture.manager();
    private CartPriceSnapshot snapshot;
    private CommerceOrderLine line;

    @BeforeEach
    void setUp() {
        f = new DeskFixture();
        orderService = mock(CommerceOrderService.class);
        buyerResolver = mock(CommerceBuyerResolver.class);
        counterService = mock(CommerceCounterService.class);
        paymentLogService = mock(PaymentLogService.class);
        userPlanService = mock(UserPlanService.class);
        shipments = mock(CommerceShipmentService.class);
        ObjectProvider<CommerceShipmentService> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(shipments);
        service = new CommerceStaffOrderService(f.desk, orderService, f.writer, f.orderRepository,
                f.tenderRepository, buyerResolver, counterService, mock(CommerceStockSettings.class),
                f.locationRepository, f.accessGuard, f.auditService, f.events, paymentLogService, userPlanService,
                provider, f.transactionManager);

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

        line = f.line("l1", 2, "1000.00");
        f.order.setChannel("ADMIN");
        when(f.writer.writeStaff(any())).thenAnswer(call -> {
            CommerceOrderWriter.StaffNewOrder n = call.getArgument(0);
            BigDecimal received = n.tenders().stream().map(CommerceOrderWriter.StaffTender::amount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            f.order.setPaymentStatus(received.compareTo(new BigDecimal("1060.00")) >= 0 ? "PAID"
                    : received.signum() > 0 ? "PARTIALLY_PAID" : "UNPAID");
            for (CommerceOrderWriter.StaffTender t : n.tenders()) {
                f.tender(t.mode(), "RECEIVED", t.amount().toPlainString());
            }
            return new CommerceOrderWriter.Written(f.order, f.lines, null);
        });
    }

    private StaffOrderRequest.StaffOrderRequestBuilder request() {
        return StaffOrderRequest.builder().clientRequestId("staff-order-1")
                .customer(StaffOrderRequest.Customer.builder().phone("+91 98765 00001").name("Counter Buyer").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Road").city("Lucknow").pincode("226001")
                        .build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(2)
                        .unitPriceOverride(new BigDecimal("500")).build()));
    }

    private static StaffOrderRequest.Tender tender(String mode, String amount) {
        return StaffOrderRequest.Tender.builder().mode(mode).amount(new BigDecimal(amount)).build();
    }

    private static String code(RuntimeException e) {
        return e.getMessage().substring(0, e.getMessage().indexOf(':'));
    }

    @Test
    void aPaidStaffOrderIsPricedWithTheTypedPriceAndSettlesAtOnce() {
        line.setListUnitPrice(new BigDecimal("550.00"));
        line.setUnitPrice(new BigDecimal("500.00"));
        when(paymentLogService.markCommerceLogsPaid(any())).thenReturn(List.of("log-l1"));
        UserPlan plan = new UserPlan();
        when(userPlanService.findById("plan-l1")).thenReturn(plan);

        CommerceStaffOrderService.Created created = service.create(manager, INST, request()
                .tenders(List.of(tender("CASH", "1000"), tender("UPI", "60.00"))).build());
        assertFalse(created.replayed());

        ArgumentCaptor<CommerceOrderService.StaffPricing> pricing =
                ArgumentCaptor.forClass(CommerceOrderService.StaffPricing.class);
        ArgumentCaptor<CartPriceRequest> cart = ArgumentCaptor.forClass(CartPriceRequest.class);
        verify(orderService).priceCart(eq(INST), cart.capture(), pricing.capture());
        assertEquals(new BigDecimal("500.00"), pricing.getValue().unitPriceByLineRef().get("L1"));
        assertTrue(pricing.getValue().chargeShipping(), "an address means delivery is charged by default");
        assertEquals("226001", cart.getValue().getPincode());
        assertEquals("L1", cart.getValue().getLines().get(0).getLineRef());

        ArgumentCaptor<CommerceOrderWriter.StaffNewOrder> written =
                ArgumentCaptor.forClass(CommerceOrderWriter.StaffNewOrder.class);
        verify(f.writer).writeStaff(written.capture());
        assertEquals("9876500001", written.getValue().phone().substring(written.getValue().phone().length() - 10));
        assertEquals("buyer-1", written.getValue().userId());
        assertEquals("ORD-000009", written.getValue().orderNumber());
        assertEquals("user-1", written.getValue().actorUserId());
        assertFalse(written.getValue().restOnCredit());
        verify(paymentLogService).markCommerceLogsPaid(Set.of("log-l1"));
        verify(userPlanService).activateCommercePlan(plan);
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("LINE_PRICE_OVERRIDE"), eq("ORDER_LINE"),
                eq("l1"), anyString(), anyString(), any());
        verify(f.accessGuard).require(manager, INST, CommerceFeature.ORDERS, Set.of(CommerceRole.STORE_MANAGER));
        verify(f.accessGuard).require(manager, INST, CommerceFeature.ORDERS, Set.of(CommerceRole.STORE_MANAGER), LOC);
        verify(shipments, never()).handOverInside(any(), any(), any(), any());
    }

    @Test
    void theRestOnCreditLeavesTheOrderUnsettled() {
        service.create(manager, INST, request().tenders(List.of(tender("CASH", "100"))).restOnCredit(true).build());
        verify(paymentLogService, never()).markCommerceLogsPaid(any());
        verify(f.writer).writeStaff(org.mockito.ArgumentMatchers.argThat(CommerceOrderWriter.StaffNewOrder::restOnCredit));
    }

    @Test
    void tendersShortOrOverAreRefusedBeforeAnythingIsWritten() {
        assertEquals("TENDERS_SHORT", code(assertThrows(InvalidRequestException.class, () -> service.create(manager,
                INST, request().tenders(List.of(tender("CASH", "100"))).build()))));
        assertEquals("TENDERS_OVER", code(assertThrows(InvalidRequestException.class, () -> service.create(manager,
                INST, request().tenders(List.of(tender("CASH", "1060.01"))).build()))));
        snapshot.setTotal(BigDecimal.ZERO.setScale(2));
        assertEquals("cart_not_priceable", code(assertThrows(ConflictException.class, () -> service.create(manager,
                INST, request().restOnCredit(true).build()))));
        verify(f.writer, never()).writeStaff(any());
        verify(counterService, never()).nextNumber(anyString(), anyString());
    }

    @Test
    void theBodyIsChecked() {
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .tenders(List.of(tender("GATEWAY", "1060"))).build()));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(1)
                        .unitPriceOverride(BigDecimal.ZERO).build())).build()));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(1)
                        .unitPriceOverride(new BigDecimal("1.005")).build())).build()));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .customer(StaffOrderRequest.Customer.builder().phone("12").name("X").build()).build()));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of()).build()));
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .buyerGstin("NOT-A-GSTIN").build()));
        verify(f.accessGuard, never()).require(any(), any(), any(), any());
    }

    @Test
    void aHandOverPacksShipsAndDeliversInTheSameTransaction() {
        service.create(manager, INST, request().shippingAddress(null).chargeShipping(null)
                .tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build());
        verify(shipments).handOverInside(f.order, f.lines, Map.of(), "user-1");
        ArgumentCaptor<CommerceOrderService.StaffPricing> pricing =
                ArgumentCaptor.forClass(CommerceOrderService.StaffPricing.class);
        verify(orderService).priceCart(eq(INST), any(), pricing.capture());
        assertFalse(pricing.getValue().chargeShipping(), "no address, no delivery charge");
    }

    @Test
    void aHandOverNamesThePiecesOfAOneOfAKindLineOnThatLine() {
        service.create(manager, INST, request().shippingAddress(null).chargeShipping(null)
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(2)
                        .pieceIds(List.of(" pc-1 ")).pieceCodes(List.of("PC-0002")).build()))
                .tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build());
        ArgumentCaptor<Map<String, CommerceShipmentService.PackLine>> pieces = ArgumentCaptor.forClass(Map.class);
        verify(shipments).handOverInside(eq(f.order), eq(f.lines), pieces.capture(), eq("user-1"));
        assertEquals(Set.of("L1"), pieces.getValue().keySet(), "keyed by the line's ref");
        assertEquals(List.of("pc-1"), pieces.getValue().get("L1").pieceIds());
        assertEquals(List.of("PC-0002"), pieces.getValue().get("L1").pieceCodes());
        assertEquals(2, pieces.getValue().get("L1").quantity());
    }

    @Test
    void piecesAreNamedOnlyForAHandOverAndOnePerUnit() {
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(1)
                        .pieceIds(List.of("pc-1")).build()))
                .tenders(List.of(tender("CASH", "1060"))).build()), "no hand-over: pack the order instead");
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(2)
                        .pieceIds(List.of("pc-1")).build()))
                .tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build()), "two units, one piece");
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(2)
                        .pieceIds(List.of("pc-1", "pc-1")).build()))
                .tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build()), "a piece named twice");
        assertThrows(InvalidRequestException.class, () -> service.create(manager, INST, request()
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(1)
                        .pieceIds(List.of("x".repeat(37))).build()))
                .tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build()), "an id too long");
        verify(f.writer, never()).writeStaff(any());
        verify(f.accessGuard, never()).require(any(), any(), any(), any());
    }

    @Test
    void aRepeatIsAnsweredWithTheOrderItMadeAndAnotherBodyIsAMismatch() {
        StaffOrderRequest body = request().tenders(List.of(tender("CASH", "1060"))).build();
        f.order.setRequestHash(CommerceRequestGuard.hash("STAFF_ORDER", body));
        when(f.orderRepository.findByInstituteIdAndClientRequestId(INST, "staff-order-1")).thenReturn(Optional.of(
                f.order));
        CommerceStaffOrderService.Created again = service.create(manager, INST, body);
        assertTrue(again.replayed());
        assertEquals(Boolean.TRUE, again.detail().getReplayed());
        verify(f.writer, never()).writeStaff(any());

        StaffOrderRequest other = request().tenders(List.of(tender("CASH", "1000"))).restOnCredit(true).build();
        assertEquals(CommerceRequestGuard.IDEMPOTENCY_MISMATCH, code(assertThrows(ConflictException.class,
                () -> service.create(manager, INST, other))));
        assertNull(f.order.getCancelReason());
        assertEquals(ORDER, f.order.getId());
    }

    // ------------------------------------------------------------------ buyer messages (WP-33)

    private List<CommerceOrderEvents.OrderEvent> emitted() {
        ArgumentCaptor<CommerceOrderEvents.OrderEvent> captor = ArgumentCaptor.forClass(
                CommerceOrderEvents.OrderEvent.class);
        verify(f.events, org.mockito.Mockito.atLeast(0)).afterCommit(captor.capture());
        return captor.getAllValues();
    }

    @Test
    void aSaleHandedOverAtTheCounterIsABillOnly() {
        service.create(manager, INST, request().shippingAddress(null).chargeShipping(null)
                .tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build());
        List<CommerceOrderEvents.OrderEvent> sent = emitted();
        assertEquals(List.of(CommerceOrderEvents.POS_BILL_ISSUED),
                sent.stream().map(CommerceOrderEvents.OrderEvent::type).toList());
        CommerceOrderEvents.OrderEvent bill = sent.get(0);
        assertEquals(INST, bill.instituteId());
        assertEquals(f.order.getId(), bill.orderId());
        assertEquals("", bill.refId());
        assertTrue(bill.notifyCustomer());
    }

    @Test
    void anOrderForLaterDeliveryIsConfirmed() {
        service.create(manager, INST, request().tenders(List.of(tender("CASH", "1060"))).build());
        List<CommerceOrderEvents.OrderEvent> sent = emitted();
        assertEquals(List.of(CommerceOrderEvents.ORDER_CONFIRMED),
                sent.stream().map(CommerceOrderEvents.OrderEvent::type).toList());
        assertEquals("", sent.get(0).refId());
        assertTrue(sent.get(0).notifyCustomer());
        verify(shipments, never()).handOverInside(any(), any(), any(), any());
    }

    @Test
    void anOrderOnCreditForLaterDeliveryIsConfirmedToo() {
        service.create(manager, INST, request().tenders(List.of(tender("CASH", "100"))).restOnCredit(true).build());
        assertEquals(List.of(CommerceOrderEvents.ORDER_CONFIRMED),
                emitted().stream().map(CommerceOrderEvents.OrderEvent::type).toList());
    }

    @Test
    void aRepeatedRequestTellsNobodyAgain() {
        StaffOrderRequest body = request().tenders(List.of(tender("CASH", "1060"))).handOverNow(true).build();
        f.order.setRequestHash(CommerceRequestGuard.hash("STAFF_ORDER", body));
        when(f.orderRepository.findByInstituteIdAndClientRequestId(INST, "staff-order-1")).thenReturn(Optional.of(
                f.order));
        assertTrue(service.create(manager, INST, body).replayed());
        assertTrue(emitted().isEmpty());
    }
}
