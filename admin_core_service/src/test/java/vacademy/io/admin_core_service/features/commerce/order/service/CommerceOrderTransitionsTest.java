package vacademy.io.admin_core_service.features.commerce.order.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.exceptions.ConflictException;

import java.util.LinkedHashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.CANCELLED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.COD_PENDING_CONFIRMATION;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.CONFIRMED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.DELIVERED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.PACKED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.PENDING_PAYMENT;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.RTO;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.SHIPPED;

/** The order status table, written out row by row; every other move is refused. */
class CommerceOrderTransitionsTest {

    /** "from>to" for every row of the table; "new" is an order that does not exist yet. */
    private static final Set<String> TABLE = Set.of(
            "new>PENDING_PAYMENT",
            "new>CONFIRMED",
            "new>COD_PENDING_CONFIRMATION",
            "new>DELIVERED",
            "PENDING_PAYMENT>CONFIRMED",
            "PENDING_PAYMENT>CANCELLED",
            "CANCELLED>CONFIRMED",
            "COD_PENDING_CONFIRMATION>CONFIRMED",
            "COD_PENDING_CONFIRMATION>CANCELLED",
            "CONFIRMED>PACKED",
            "CONFIRMED>CANCELLED",
            "PACKED>SHIPPED",
            "PACKED>CONFIRMED",
            "PACKED>CANCELLED",
            "SHIPPED>DELIVERED",
            "SHIPPED>RTO",
            "SHIPPED>PACKED",
            "DELIVERED>SHIPPED",
            "DELIVERED>CANCELLED");

    @Test
    void exactlyTheMovesOfTheTableAreAllowed() {
        Set<String> allowed = new LinkedHashSet<>();
        for (CommerceOrderStatus to : CommerceOrderStatus.values()) {
            if (CommerceOrderTransitions.isAllowed(null, to)) {
                allowed.add("new>" + to);
            }
            for (CommerceOrderStatus from : CommerceOrderStatus.values()) {
                if (CommerceOrderTransitions.isAllowed(from, to)) {
                    allowed.add(from + ">" + to);
                }
            }
        }
        assertEquals(new java.util.TreeSet<>(TABLE), new java.util.TreeSet<>(allowed));
    }

    @Test
    void everyMoveOutsideTheTableIsA409() {
        int refused = 0;
        for (CommerceOrderStatus from : CommerceOrderStatus.values()) {
            for (CommerceOrderStatus to : CommerceOrderStatus.values()) {
                if (TABLE.contains(from + ">" + to)) {
                    assertDoesNotThrow(() -> CommerceOrderTransitions.require(from, to));
                } else {
                    ConflictException e = assertThrows(ConflictException.class,
                            () -> CommerceOrderTransitions.require(from, to), from + ">" + to);
                    assertTrue(e.getMessage().startsWith("ORDER_TRANSITION_NOT_ALLOWED"));
                    refused++;
                }
            }
        }
        // 8 statuses, 64 pairs, 15 of them in the table.
        assertEquals(64 - 15, refused);
    }

    @Test
    void theMovesCheckoutMakes() {
        assertTrue(CommerceOrderTransitions.isAllowed(null, PENDING_PAYMENT));
        assertTrue(CommerceOrderTransitions.isAllowed(PENDING_PAYMENT, CONFIRMED));
        assertTrue(CommerceOrderTransitions.isAllowed(PENDING_PAYMENT, CANCELLED));
        assertTrue(CommerceOrderTransitions.isAllowed(CANCELLED, CONFIRMED));
        // A paid order is never set back to waiting, and nothing leaves RTO.
        assertFalse(CommerceOrderTransitions.isAllowed(CONFIRMED, PENDING_PAYMENT));
        assertFalse(CommerceOrderTransitions.isAllowed(CANCELLED, PENDING_PAYMENT));
        assertFalse(CommerceOrderTransitions.isAllowed(PENDING_PAYMENT, PACKED));
        assertFalse(CommerceOrderTransitions.isAllowed(PENDING_PAYMENT, null));
        assertTrue(CommerceOrderTransitions.next(RTO).isEmpty());
        assertFalse(CommerceOrderTransitions.isAllowed(null, PACKED));
        assertFalse(CommerceOrderTransitions.isAllowed(null, SHIPPED));
        assertFalse(CommerceOrderTransitions.isAllowed(null, CANCELLED));
    }

    @Test
    void nextListsWhatTheTableAllows() {
        assertEquals(Set.of(CONFIRMED, CANCELLED), CommerceOrderTransitions.next(PENDING_PAYMENT));
        assertEquals(Set.of(CONFIRMED, CANCELLED), CommerceOrderTransitions.next(COD_PENDING_CONFIRMATION));
        assertEquals(Set.of(PACKED, CANCELLED), CommerceOrderTransitions.next(CONFIRMED));
        assertEquals(Set.of(SHIPPED, CONFIRMED, CANCELLED), CommerceOrderTransitions.next(PACKED));
        assertEquals(Set.of(DELIVERED, RTO, PACKED), CommerceOrderTransitions.next(SHIPPED));
        assertEquals(Set.of(SHIPPED, CANCELLED), CommerceOrderTransitions.next(DELIVERED));
        assertEquals(Set.of(CONFIRMED), CommerceOrderTransitions.next(CANCELLED));
        assertEquals(Set.of(PENDING_PAYMENT, CONFIRMED, COD_PENDING_CONFIRMATION, DELIVERED),
                CommerceOrderTransitions.next(null));
    }

    @Test
    void anUnknownStoredStatusIsNoStatus() {
        assertEquals(null, CommerceOrderStatus.of("OVERSOLD_PAID"));
        assertEquals(null, CommerceOrderStatus.of(null));
        assertEquals(CANCELLED, CommerceOrderStatus.of("CANCELLED"));
    }

    // ------------------------------------------------------------------ staff moves (WP-30)

    @Test
    void theTransitionRouteMakesExactlySevenStaffMoves() {
        Set<String> moves = new java.util.TreeSet<>();
        for (CommerceOrderTransitions.StaffMove move : CommerceOrderTransitions.StaffMove.values()) {
            moves.add(move.from() + ">" + move.to());
            assertTrue(CommerceOrderTransitions.isAllowed(move.from(), move.to()), "a staff move is in the table");
            assertEquals(move, CommerceOrderTransitions.requireStaffMove(move.from(), move.to()));
        }
        assertEquals(new java.util.TreeSet<>(Set.of("COD_PENDING_CONFIRMATION>CONFIRMED",
                "COD_PENDING_CONFIRMATION>CANCELLED", "CONFIRMED>CANCELLED", "PACKED>CONFIRMED", "PACKED>CANCELLED",
                "SHIPPED>PACKED", "DELIVERED>SHIPPED")), moves);
        Set<CommerceRole> floor = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF);
        Set<CommerceRole> manager = Set.of(CommerceRole.STORE_MANAGER);
        assertEquals(floor, CommerceOrderTransitions.StaffMove.CONFIRM_COD.roles());
        assertEquals(floor, CommerceOrderTransitions.StaffMove.CANCEL_COD.roles());
        assertEquals(manager, CommerceOrderTransitions.StaffMove.CANCEL_CONFIRMED.roles());
        assertEquals(manager, CommerceOrderTransitions.StaffMove.UNPACK.roles());
        assertEquals(manager, CommerceOrderTransitions.StaffMove.CANCEL_PACKED.roles());
        assertEquals(manager, CommerceOrderTransitions.StaffMove.UNDO_SHIP.roles());
        assertEquals(manager, CommerceOrderTransitions.StaffMove.UNDO_DELIVERY.roles());
    }

    @Test
    void tableMovesThatAreNotStaffMovesAreRefusedWithTheRouteToUse() {
        assertTrue(assertThrows(ConflictException.class, () -> CommerceOrderTransitions.requireStaffMove(CONFIRMED,
                PACKED)).getMessage().contains("POST /shipments"));
        assertTrue(assertThrows(ConflictException.class, () -> CommerceOrderTransitions.requireStaffMove(PACKED,
                SHIPPED)).getMessage().contains("POST /shipments/{id}/ship"));
        assertTrue(assertThrows(ConflictException.class, () -> CommerceOrderTransitions.requireStaffMove(SHIPPED,
                RTO)).getMessage().contains("POST /shipments/{id}/status"));
        for (CommerceOrderStatus[] pair : new CommerceOrderStatus[][]{{PENDING_PAYMENT, CONFIRMED},
                {PENDING_PAYMENT, CANCELLED}, {CANCELLED, CONFIRMED}, {DELIVERED, CANCELLED}}) {
            ConflictException e = assertThrows(ConflictException.class,
                    () -> CommerceOrderTransitions.requireStaffMove(pair[0], pair[1]));
            assertTrue(e.getMessage().startsWith("ORDER_TRANSITION_NOT_ALLOWED"), e.getMessage());
        }
    }

    private static CommerceOrderTransitions.ActionState state(CommerceOrderStatus status, String shipment) {
        return new CommerceOrderTransitions.ActionState(status, shipment, "ONLINE", "PREPAID", "PAID", false, false,
                false);
    }

    @Test
    void nextActionsFollowTheStatusAndTheCallersRoles() {
        Set<CommerceRole> manager = Set.of(CommerceRole.STORE_MANAGER);
        Set<CommerceRole> warehouse = Set.of(CommerceRole.WAREHOUSE_STAFF);
        Set<CommerceRole> accountant = Set.of(CommerceRole.ACCOUNTANT);
        assertEquals(java.util.List.of("PACK", "CANCEL", "CANCEL_LINE"),
                CommerceOrderTransitions.nextActions(state(CONFIRMED, null), manager, false));
        assertEquals(java.util.List.of("PACK"), CommerceOrderTransitions.nextActions(state(CONFIRMED, null), warehouse,
                false));
        assertEquals(java.util.List.of(), CommerceOrderTransitions.nextActions(state(CONFIRMED, null), accountant,
                false));
        assertEquals(java.util.List.of("SHIP", "UNPACK", "CANCEL", "CANCEL_LINE"),
                CommerceOrderTransitions.nextActions(state(PACKED, "PACKED"), Set.of(), true));
        assertEquals(java.util.List.of("DELIVER", "RTO", "EDIT_TRACKING"),
                CommerceOrderTransitions.nextActions(state(SHIPPED, "SHIPPED"), warehouse, false));
        assertEquals(java.util.List.of("RTO_RECEIVE"),
                CommerceOrderTransitions.nextActions(state(RTO, "RTO"), warehouse, false));
        assertEquals(java.util.List.of(), CommerceOrderTransitions.nextActions(state(RTO, "RTO_RECEIVED"), manager,
                false));
        assertEquals(java.util.List.of("UNDO_DELIVERY"),
                CommerceOrderTransitions.nextActions(state(DELIVERED, "DELIVERED"), manager, false));
        assertEquals(java.util.List.of(), CommerceOrderTransitions.nextActions(new CommerceOrderTransitions
                .ActionState(DELIVERED, "DELIVERED", "ONLINE", "COD", "PAID", false, true, false), manager, false));
        assertEquals(java.util.List.of("CONFIRM", "CANCEL", "CANCEL_LINE"),
                CommerceOrderTransitions.nextActions(state(COD_PENDING_CONFIRMATION, null), manager, false));
        // A staff order with money due: a receipt for the manager and the accountant, not for COD.
        CommerceOrderTransitions.ActionState dues = new CommerceOrderTransitions.ActionState(CONFIRMED, null, "ADMIN",
                "OFFLINE", "PARTIALLY_PAID", true, false, false);
        assertEquals(java.util.List.of("RECORD_RECEIPT"), CommerceOrderTransitions.nextActions(dues, accountant, false));
        assertEquals(java.util.List.of("PACK", "CANCEL", "CANCEL_LINE", "RECORD_RECEIPT", "CLEAR_STOCK_SHORT"),
                CommerceOrderTransitions.nextActions(dues, manager, false));
        assertTrue(CommerceOrderTransitions.nextActions(null, manager, true).isEmpty());
    }
}
