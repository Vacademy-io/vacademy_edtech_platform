package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.controller.CommerceOrderController;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.controller.CommerceShipmentController;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

/**
 * Who may call each new route, through the controllers and the real commerce guard: ADMIN,
 * store manager (M), warehouse staff (W), accountant (Ac), cashier, a learner, another
 * institute's admin and a shopper with no staff role. 403 is the guard's refusal; anything
 * else means the caller got past it. Staff need the order's location; an admin does not.
 */
@SuppressWarnings("unchecked")
class OrderDeskRoleMatrixTest {

    private static final String ADMIN = "ADMIN";
    private static final String M = "M";
    private static final String W = "W";
    private static final String AC = "Ac";
    private static final String CASHIER = "cashier";
    private static final String LEARNER = "learner";
    private static final String OTHER_ADMIN = "other-institute admin";
    private static final String SHOPPER = "shopper";
    private static final List<String> CALLERS = List.of(ADMIN, M, W, AC, CASHIER, LEARNER, OTHER_ADMIN, SHOPPER);

    private CommerceStaffLocationRepository staffLocations;
    private CommerceAccessGuard guard;

    @BeforeEach
    void setUp() {
        CapabilityResolver capabilities = mock(CapabilityResolver.class);
        when(capabilities.isFeatureGranted(eq(INST), anyString())).thenReturn(true);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "user-1", LOC)).thenReturn(true);
        guard = new CommerceAccessGuard(capabilities, staffLocations);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void header(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails caller(String who) {
        header(who.equals(OTHER_ADMIN) ? "inst-2" : INST);
        return switch (who) {
            case ADMIN, OTHER_ADMIN -> DeskFixture.user("ADMIN");
            case M -> DeskFixture.user("COMMERCE_STORE_MANAGER");
            case W -> DeskFixture.user("COMMERCE_WAREHOUSE_STAFF");
            case AC -> DeskFixture.user("COMMERCE_ACCOUNTANT");
            case CASHIER -> DeskFixture.user("COMMERCE_POS_CASHIER");
            case LEARNER -> DeskFixture.user("STUDENT");
            default -> DeskFixture.user();
        };
    }

    /** A fresh order desk for every call, so one call's changes never decide the next. */
    private Routes routes() {
        DeskFixture f = new DeskFixture(guard);
        CommerceOrderLine line = f.line("l1", 2, "1000.00");
        f.snapshot();
        f.facts("ps-l1", "TRACKED", "QUANTITY");
        f.soldHold(line, 2);
        CommerceStaffOrderService staff = new CommerceStaffOrderService(f.desk, mock(CommerceOrderService.class),
                f.writer, f.orderRepository, f.tenderRepository, mock(CommerceBuyerResolver.class),
                mock(CommerceCounterService.class), mock(CommerceStockSettings.class), f.locationRepository, guard,
                f.auditService, f.events, mock(PaymentLogService.class), mock(UserPlanService.class),
                mock(ObjectProvider.class), f.transactionManager);
        CommerceLineCancelService lines = new CommerceLineCancelService(f.desk, f.orderRepository, f.lineRepository,
                f.tenderRepository, f.legacyRepository, f.shipmentLineRepository, f.pieceRepository,
                f.variantRepository, f.stockHoldService, staff, f.auditService, f.requestGuard);
        CommerceReceiptService receipts = new CommerceReceiptService(f.desk, f.orderRepository, f.tenderRepository,
                staff, f.auditService, f.requestGuard, f.clock);
        return new Routes(f, new CommerceOrderDeskController(f.desk, lines, receipts),
                new CommerceShipmentController(f.shipments), new CommerceOrderController(guard, f.queryService, staff));
    }

    private record Routes(DeskFixture f, CommerceOrderDeskController desk, CommerceShipmentController shipments,
                          CommerceOrderController orders) {
    }

    /** "403" when the guard refused, "ok" when the caller got past it. */
    private String status(String who, Consumer<Routes> call) {
        CustomUserDetails user = caller(who);
        Routes routes = routes();
        try {
            call.accept(withUser(routes, user));
            return "ok";
        } catch (CommerceAccessDeniedException e) {
            return "403";
        } catch (RuntimeException e) {
            return "ok";
        }
    }

    private CustomUserDetails current;

    private Routes withUser(Routes routes, CustomUserDetails user) {
        current = user;
        return routes;
    }

    private void expect(String route, Set<String> allowed, Consumer<Routes> call) {
        Map<String, String> got = new LinkedHashMap<>();
        Map<String, String> want = new LinkedHashMap<>();
        for (String who : CALLERS) {
            got.put(who, status(who, call));
            want.put(who, allowed.contains(who) ? "ok" : "403");
        }
        assertEquals(want, got, route);
    }

    private static final Set<String> FLOOR = Set.of(ADMIN, M, W);
    private static final Set<String> MANAGER = Set.of(ADMIN, M);
    private static final Set<String> MONEY = Set.of(ADMIN, M, AC);
    private static final Set<String> READ = Set.of(ADMIN, M, W, AC);

    @Test
    void everyNewRouteHasItsRoles() {
        expect("GET /orders", READ, r -> r.orders().list(INST, null, null, null, null, null, null, null, null, 0, 20,
                current));
        expect("GET /orders/{id}", READ, r -> r.orders().detail(ORDER, INST, current));
        expect("POST /orders", MANAGER, r -> r.orders().create(INST, StaffOrderRequest.builder()
                .clientRequestId("staff-order-1").customer(StaffOrderRequest.Customer.builder().phone("9876500001")
                        .name("Buyer").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId("ps-l1").quantity(1).build())).build(),
                current));
        expect("POST /orders/{id}/transition (confirm COD)", FLOOR, r -> {
            r.f().order.setStatus("COD_PENDING_CONFIRMATION");
            r.desk().transition(ORDER, INST, transition("COD_PENDING_CONFIRMATION", "CONFIRMED"), current);
        });
        expect("POST /orders/{id}/transition (cancel)", MANAGER, r -> r.desk().transition(ORDER, INST,
                transition("CONFIRMED", "CANCELLED"), current));
        expect("POST /orders/{id}/lines/{lineId}/cancel", MANAGER, r -> r.desk().cancelLine(ORDER, "l1", INST,
                OrderDeskDtos.LineCancelRequest.builder().clientRequestId(DeskFixture.KEY).quantity(1).reason("asked")
                        .build(), current));
        expect("POST /orders/{id}/receipts", MONEY, r -> {
            r.f().order.setChannel("ADMIN");
            r.f().order.setPaymentStatus("UNPAID");
            r.f().order.setAmountPaid(BigDecimal.ZERO.setScale(2));
            r.desk().receipt(ORDER, INST, OrderDeskDtos.ReceiptRequest.builder().clientRequestId(DeskFixture.KEY)
                    .mode("CASH").amount(BigDecimal.TEN).build(), current);
        });
        expect("POST /orders/{id}/stock-short/clear", MANAGER, r -> {
            r.f().order.setStockShort(true);
            r.desk().clearStockShort(ORDER, INST, OrderDeskDtos.StockShortClearRequest.builder()
                    .clientRequestId(DeskFixture.KEY).build(), current);
        });
        expect("POST /orders/bulk", FLOOR, r -> r.desk().bulk(INST, OrderDeskDtos.BulkRequest.builder()
                .clientRequestId("bulk-0001").action("PACK").items(List.of(OrderDeskDtos.BulkItem.builder()
                        .orderId(ORDER).fromStatus("CONFIRMED").build())).build(), current));
        expect("POST /shipments", FLOOR, r -> r.shipments().pack(INST, ShipmentDtos.PackRequest.builder()
                .clientRequestId("pack-key-1").orderId(ORDER).fromStatus("CONFIRMED").lines(List.of(
                        ShipmentDtos.PackLine.builder().orderLineId("l1").quantity(2).build())).build(), current));
        expect("POST /shipments/{id}/ship", FLOOR, r -> {
            r.f().order.setStatus("PACKED");
            r.f().shipment("PACKED");
            r.f().shipmentLine(r.f().lines.get(0), 2);
            r.shipments().ship(DeskFixture.SHIPMENT, INST, ShipmentDtos.ShipRequest.builder()
                    .clientRequestId("ship-key-1").carrierName("Courier").trackingNumber("TRK1").build(), current);
        });
        expect("POST /shipments/{id}/status", FLOOR, r -> {
            r.f().order.setStatus("SHIPPED");
            r.f().shipment("SHIPPED");
            r.shipments().status(DeskFixture.SHIPMENT, INST, ShipmentDtos.StatusRequest.builder()
                    .clientRequestId("status-key-1").to("DELIVERED").build(), current);
        });
        expect("PATCH /shipments/{id}", FLOOR, r -> {
            r.f().order.setStatus("SHIPPED");
            r.f().shipment("SHIPPED");
            r.shipments().patch(DeskFixture.SHIPMENT, INST, ShipmentDtos.PatchRequest.builder()
                    .clientRequestId("patch-key-1").trackingNumber("TRK2").build(), current);
        });
    }

    @Test
    void staffOutsideTheOrdersLocationAreRefusedAndAnAdminIsNot() {
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "user-1", LOC)).thenReturn(false);
        Consumer<Routes> pack = r -> r.shipments().pack(INST, ShipmentDtos.PackRequest.builder()
                .clientRequestId("pack-key-1").orderId(ORDER).fromStatus("CONFIRMED").lines(List.of(
                        ShipmentDtos.PackLine.builder().orderLineId("l1").quantity(2).build())).build(), current);
        assertEquals("403", status(M, pack));
        assertEquals("403", status(W, pack));
        assertEquals("ok", status(ADMIN, pack));
        // An order with no fulfilment location is for an admin only.
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "user-1", LOC)).thenReturn(true);
        Consumer<Routes> noLocation = r -> {
            r.f().order.setFulfilmentLocationId(null);
            r.desk().transition(ORDER, INST, transition("CONFIRMED", "CANCELLED"), current);
        };
        assertEquals("403", status(M, noLocation));
        assertEquals("ok", status(ADMIN, noLocation));
    }

    private static OrderDeskDtos.TransitionRequest transition(String from, String to) {
        return OrderDeskDtos.TransitionRequest.builder().clientRequestId(DeskFixture.KEY).fromStatus(from).toStatus(to)
                .build();
    }
}
