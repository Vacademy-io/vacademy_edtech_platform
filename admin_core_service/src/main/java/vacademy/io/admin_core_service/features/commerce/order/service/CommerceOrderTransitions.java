package vacademy.io.admin_core_service.features.commerce.order.service;

import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.common.exceptions.ConflictException;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.CANCELLED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.COD_PENDING_CONFIRMATION;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.CONFIRMED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.DELIVERED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.PACKED;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.PENDING_PAYMENT;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.RTO;
import static vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus.SHIPPED;

/**
 * The transition table of the order states, as data. Any move that is not in it is
 * refused with 409. Who may make a move and what it does belongs to the caller (checkout here,
 * the order desk in WP-30); this class only answers "is this move in the table".
 *
 * <p>Two rows carry a condition the table states in words: CANCELLED to CONFIRMED is the late
 * payment of an order that was cancelled unpaid, and DELIVERED to CANCELLED is the void of a
 * counter sale. The condition is checked by the caller that makes the move.
 */
public final class CommerceOrderTransitions {

    /** The statuses an order may be created in. */
    public static final Set<CommerceOrderStatus> INITIAL = Collections.unmodifiableSet(
            EnumSet.of(PENDING_PAYMENT, CONFIRMED, COD_PENDING_CONFIRMATION, DELIVERED));

    private static final Map<CommerceOrderStatus, Set<CommerceOrderStatus>> TABLE = table();

    private CommerceOrderTransitions() {
    }

    private static Map<CommerceOrderStatus, Set<CommerceOrderStatus>> table() {
        Map<CommerceOrderStatus, Set<CommerceOrderStatus>> t = new EnumMap<>(CommerceOrderStatus.class);
        t.put(PENDING_PAYMENT, EnumSet.of(CONFIRMED, CANCELLED));
        t.put(COD_PENDING_CONFIRMATION, EnumSet.of(CONFIRMED, CANCELLED));
        t.put(CONFIRMED, EnumSet.of(PACKED, CANCELLED));
        t.put(PACKED, EnumSet.of(SHIPPED, CONFIRMED, CANCELLED));
        t.put(SHIPPED, EnumSet.of(DELIVERED, RTO, PACKED));
        t.put(DELIVERED, EnumSet.of(SHIPPED, CANCELLED));
        t.put(RTO, EnumSet.noneOf(CommerceOrderStatus.class));
        t.put(CANCELLED, EnumSet.of(CONFIRMED));
        return Collections.unmodifiableMap(t);
    }

    public static boolean isAllowed(CommerceOrderStatus from, CommerceOrderStatus to) {
        if (to == null) {
            return false;
        }
        if (from == null) {
            return INITIAL.contains(to);
        }
        return TABLE.getOrDefault(from, Set.of()).contains(to);
    }

    /** The statuses that can follow {@code from}; never null. */
    public static Set<CommerceOrderStatus> next(CommerceOrderStatus from) {
        return from == null ? INITIAL : Collections.unmodifiableSet(TABLE.getOrDefault(from, Set.of()));
    }

    /** @throws ConflictException (409) when the move is not in the table */
    public static void require(CommerceOrderStatus from, CommerceOrderStatus to) {
        if (!isAllowed(from, to)) {
            throw new ConflictException("ORDER_TRANSITION_NOT_ALLOWED: an order cannot go from "
                    + (from == null ? "new" : from.name()) + " to " + (to == null ? "nothing" : to.name()));
        }
    }
}
