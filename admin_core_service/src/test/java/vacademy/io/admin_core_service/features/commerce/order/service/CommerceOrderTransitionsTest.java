package vacademy.io.admin_core_service.features.commerce.order.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
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
}
