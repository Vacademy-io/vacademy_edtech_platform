package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.enums.CommerceShipmentStatus;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

/**
 * Every (from, to) of the eight order statuses on the transition route; every shipment route
 * from every order status; every shipment route from every shipment status. An allowed staff
 * move succeeds; anything else is 409 with the code of the contract, and a refusal writes
 * nothing (no order, shipment, line or tender save, no movement, no hold, no document).
 */
class CommerceOrderDeskTransitionMatrixTest {

    /** Rows 1, 2, 3, 5, 6, 8 and 10: the moves of the transition route. */
    private static final Set<String> STAFF_MOVES = Set.of(
            "COD_PENDING_CONFIRMATION>CONFIRMED",
            "COD_PENDING_CONFIRMATION>CANCELLED",
            "CONFIRMED>CANCELLED",
            "PACKED>CONFIRMED",
            "PACKED>CANCELLED",
            "SHIPPED>PACKED",
            "DELIVERED>SHIPPED");

    /** The live shipment an order in each status has (none before it is packed). */
    private static final Map<CommerceOrderStatus, String> SHIPMENT_OF = Map.of(
            CommerceOrderStatus.PACKED, "PACKED",
            CommerceOrderStatus.SHIPPED, "SHIPPED",
            CommerceOrderStatus.DELIVERED, "DELIVERED",
            CommerceOrderStatus.RTO, "RTO");

    private final CustomUserDetails admin = DeskFixture.user("ADMIN");

    /** A one-line, quantity-counted, paid order in {@code status}, with the shipment that status has. */
    private DeskFixture fixture(CommerceOrderStatus status, String shipmentStatus) {
        DeskFixture f = new DeskFixture();
        CommerceOrderLine line = f.line("l1", 2, "1000.00");
        f.snapshot();
        f.order.setAmountPaid(f.order.getTotal());
        f.order.setStatus(status.name());
        f.facts("ps-l1", "TRACKED", "QUANTITY");
        f.soldHold(line, 2);
        if (shipmentStatus != null) {
            f.shipment(shipmentStatus);
            f.shipmentLine(line, 2);
            if (!"PACKED".equals(shipmentStatus)) {
                line.setQtyShipped(2);
            }
        }
        return f;
    }

    private static void assertNothingWritten(DeskFixture f, String what) {
        try {
            verify(f.orderRepository, never()).save(any());
            verify(f.shipmentRepository, never()).save(any());
            verify(f.shipmentRepository, never()).saveAndFlush(any());
            verify(f.lineRepository, never()).save(any());
            verify(f.tenderRepository, never()).save(any());
            verify(f.tenderRepository, never()).settleOne(anyString(), anyString(), any(), any());
            verify(f.ledger, never()).postAll(anyList());
            verify(f.stockHoldService, never()).giveBackSold(anyString(), anyString(), anyInt(), any());
            verify(f.stockHoldService, never()).closeWithoutGiveBack(anyString(), anyString(), anyString());
            verify(f.invoiceService, never()).issue(anyString(), any());
            verify(f.creditNoteService, never()).issue(anyString(), any(), any());
            verify(f.writer, never()).history(any(), any(), any(), any(), any());
        } catch (AssertionError e) {
            throw new AssertionError(what + ": a refusal wrote something", e);
        }
    }

    private static String code(RuntimeException e) {
        String message = e.getMessage();
        return message.substring(0, message.indexOf(':'));
    }

    @Test
    void all64PairsOnTheTransitionRoute() {
        int allowed = 0;
        int refused = 0;
        for (CommerceOrderStatus from : CommerceOrderStatus.values()) {
            for (CommerceOrderStatus to : CommerceOrderStatus.values()) {
                String pair = from + ">" + to;
                DeskFixture f = fixture(from, SHIPMENT_OF.get(from));
                OrderDeskDtos.TransitionRequest request = OrderDeskDtos.TransitionRequest.builder()
                        .clientRequestId(DeskFixture.KEY).fromStatus(from.name()).toStatus(to.name()).build();
                if (STAFF_MOVES.contains(pair)) {
                    f.desk.transition(admin, INST, ORDER, request);
                    assertEquals(to.name(), f.order.getStatus(), pair);
                    allowed++;
                } else {
                    ConflictException e;
                    try {
                        f.desk.transition(admin, INST, ORDER, request);
                        fail(pair + " was allowed");
                        return;
                    } catch (ConflictException c) {
                        e = c;
                    }
                    assertEquals("ORDER_TRANSITION_NOT_ALLOWED", code(e), pair);
                    assertEquals(from.name(), f.order.getStatus(), pair);
                    verifyNoInteractions(f.requestGuard);
                    assertNothingWritten(f, pair);
                    refused++;
                }
            }
        }
        assertEquals(7, allowed);
        assertEquals(57, refused);
    }

    @Test
    void movesWithARouteOfTheirOwnNameThatRoute() {
        for (String[] pair : new String[][]{{"CONFIRMED", "PACKED", "POST /shipments"},
                {"PACKED", "SHIPPED", "POST /shipments/{id}/ship"}, {"SHIPPED", "DELIVERED", "POST /shipments/{id}/status"},
                {"SHIPPED", "RTO", "POST /shipments/{id}/status"}}) {
            DeskFixture f = fixture(CommerceOrderStatus.valueOf(pair[0]), SHIPMENT_OF.get(CommerceOrderStatus.valueOf(pair[0])));
            ConflictException e = org.junit.jupiter.api.Assertions.assertThrows(ConflictException.class,
                    () -> f.desk.transition(admin, INST, ORDER, OrderDeskDtos.TransitionRequest.builder()
                            .clientRequestId(DeskFixture.KEY).fromStatus(pair[0]).toStatus(pair[1]).build()));
            assertTrue(e.getMessage().contains(pair[2]), e.getMessage());
        }
    }

    // ------------------------------------------------------------------ shipment routes × order status

    private enum Route { PACK, SHIP, DELIVER, RTO, RTO_RECEIVED, PATCH }

    private static void run(DeskFixture f, CustomUserDetails user, Route route) {
        switch (route) {
            case PACK -> f.shipments.pack(user, INST, ShipmentDtos.PackRequest.builder().clientRequestId("pack-key-1")
                    .orderId(ORDER).fromStatus(f.order.getStatus())
                    .lines(List.of(ShipmentDtos.PackLine.builder().orderLineId("l1").quantity(2).build())).build());
            case SHIP -> f.shipments.ship(user, INST, DeskFixture.SHIPMENT, ShipmentDtos.ShipRequest.builder()
                    .clientRequestId("ship-key-1").carrierName("Courier").trackingNumber("TRK1").build());
            case DELIVER -> f.shipments.status(user, INST, DeskFixture.SHIPMENT, ShipmentDtos.StatusRequest.builder()
                    .clientRequestId("status-key-1").to("DELIVERED").build());
            case RTO -> f.shipments.status(user, INST, DeskFixture.SHIPMENT, ShipmentDtos.StatusRequest.builder()
                    .clientRequestId("status-key-1").to("RTO").rtoReason("REFUSED").build());
            case RTO_RECEIVED -> f.shipments.status(user, INST, DeskFixture.SHIPMENT, ShipmentDtos.StatusRequest
                    .builder().clientRequestId("status-key-1").to("RTO_RECEIVED").lines(List.of(ShipmentDtos.StatusLine
                            .builder().orderLineId("l1").condition("RESALEABLE").quantity(2).build())).build());
            case PATCH -> f.shipments.patch(user, INST, DeskFixture.SHIPMENT, ShipmentDtos.PatchRequest.builder()
                    .clientRequestId("patch-key-1").trackingNumber("TRK2").build());
        }
    }

    /** The shipment a route needs to find (pack needs none). */
    private static final Map<Route, String> SHIPMENT_FOR = Map.of(Route.SHIP, "PACKED", Route.DELIVER, "SHIPPED",
            Route.RTO, "SHIPPED", Route.RTO_RECEIVED, "RTO", Route.PATCH, "SHIPPED");
    /** The one order status each route moves an order from (PATCH and RTO_RECEIVED keep it). */
    private static final Map<Route, CommerceOrderStatus> ORDER_FOR = Map.of(Route.PACK, CommerceOrderStatus.CONFIRMED,
            Route.SHIP, CommerceOrderStatus.PACKED, Route.DELIVER, CommerceOrderStatus.SHIPPED,
            Route.RTO, CommerceOrderStatus.SHIPPED, Route.RTO_RECEIVED, CommerceOrderStatus.RTO);

    @Test
    void everyShipmentRouteFromEveryOrderStatus() {
        List<String> seen = new ArrayList<>();
        for (Route route : Route.values()) {
            if (route == Route.PATCH) {
                continue; // a tracking correction does not look at the order status
            }
            for (CommerceOrderStatus status : CommerceOrderStatus.values()) {
                DeskFixture f = fixture(status, SHIPMENT_FOR.get(route));
                String what = route + " from " + status;
                if (status == ORDER_FOR.get(route)) {
                    run(f, admin, route);
                    seen.add(what);
                } else {
                    ConflictException e = org.junit.jupiter.api.Assertions.assertThrows(ConflictException.class,
                            () -> run(f, admin, route), what);
                    String expected = route == Route.RTO_RECEIVED ? "ORDER_STATE_CHANGED" : "ORDER_TRANSITION_NOT_ALLOWED";
                    assertEquals(expected, code(e), what);
                    assertNothingWritten(f, what);
                    assertEquals(status.name(), f.order.getStatus(), what);
                }
            }
        }
        assertEquals(5, seen.size(), seen.toString());
    }

    @Test
    void everyShipmentRouteFromEveryShipmentStatus() {
        int allowed = 0;
        for (Route route : Route.values()) {
            if (route == Route.PACK) {
                continue; // pack makes the shipment
            }
            for (CommerceShipmentStatus status : CommerceShipmentStatus.values()) {
                CommerceOrderStatus orderStatus = ORDER_FOR.getOrDefault(route, CommerceOrderStatus.SHIPPED);
                DeskFixture f = fixture(orderStatus, status.name());
                String what = route + " on a " + status + " parcel";
                if (status.name().equals(SHIPMENT_FOR.get(route))) {
                    run(f, admin, route);
                    allowed++;
                } else {
                    Consumer<DeskFixture> call = fixture -> run(fixture, admin, route);
                    ConflictException e = org.junit.jupiter.api.Assertions.assertThrows(ConflictException.class,
                            () -> call.accept(f), what);
                    assertEquals("SHIPMENT_STATE_CHANGED", code(e), what);
                    assertNothingWritten(f, what);
                    assertEquals(status.name(), f.shipment.getStatus(), what);
                }
            }
        }
        assertEquals(5, allowed);
    }
}
