package vacademy.io.admin_core_service.features.commerce.order.service;

import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.exceptions.ConflictException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
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

    // ------------------------------------------------------------------ staff moves (WP-30)

    private static final Set<CommerceRole> MANAGER = Collections.unmodifiableSet(
            EnumSet.of(CommerceRole.STORE_MANAGER));
    private static final Set<CommerceRole> FLOOR = Collections.unmodifiableSet(
            EnumSet.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF));

    /**
     * A move staff make on {@code POST /orders/{id}/transition}, with the roles that may make it
     * (an institute ADMIN may make every one). The other moves of the table belong to the
     * payment code, the shipment routes or the counter.
     */
    public enum StaffMove {
        CONFIRM_COD(COD_PENDING_CONFIRMATION, CONFIRMED, FLOOR),
        CANCEL_COD(COD_PENDING_CONFIRMATION, CANCELLED, FLOOR),
        CANCEL_CONFIRMED(CONFIRMED, CANCELLED, MANAGER),
        UNPACK(PACKED, CONFIRMED, MANAGER),
        CANCEL_PACKED(PACKED, CANCELLED, MANAGER),
        UNDO_SHIP(SHIPPED, PACKED, MANAGER),
        UNDO_DELIVERY(DELIVERED, SHIPPED, MANAGER);

        private final CommerceOrderStatus from;
        private final CommerceOrderStatus to;
        private final Set<CommerceRole> roles;

        StaffMove(CommerceOrderStatus from, CommerceOrderStatus to, Set<CommerceRole> roles) {
            this.from = from;
            this.to = to;
            this.roles = roles;
        }

        public CommerceOrderStatus from() {
            return from;
        }

        public CommerceOrderStatus to() {
            return to;
        }

        /** The commerce roles that may make this move; ADMIN always may. */
        public Set<CommerceRole> roles() {
            return roles;
        }

        public boolean cancels() {
            return to == CANCELLED;
        }
    }

    /** Moves of the table that have a route of their own, and that route. */
    private static final Map<String, String> OWN_ROUTE = ownRoutes();

    private static Map<String, String> ownRoutes() {
        Map<String, String> routes = new LinkedHashMap<>();
        routes.put(CONFIRMED + ">" + PACKED, "POST /shipments");
        routes.put(PACKED + ">" + SHIPPED, "POST /shipments/{id}/ship");
        routes.put(SHIPPED + ">" + DELIVERED, "POST /shipments/{id}/status");
        routes.put(SHIPPED + ">" + RTO, "POST /shipments/{id}/status");
        return Collections.unmodifiableMap(routes);
    }

    /** The staff move from {@code from} to {@code to}, or null when there is none. */
    public static StaffMove staffMove(CommerceOrderStatus from, CommerceOrderStatus to) {
        for (StaffMove move : StaffMove.values()) {
            if (move.from == from && move.to == to) {
                return move;
            }
        }
        return null;
    }

    /**
     * The staff move of the transition route.
     *
     * @throws ConflictException (409) ORDER_TRANSITION_NOT_ALLOWED when the move is not in the
     *         table, has a route of its own (named in the message), or is not one staff make here
     *         (a late payment, the void of a counter sale, anything out of PENDING_PAYMENT)
     */
    public static StaffMove requireStaffMove(CommerceOrderStatus from, CommerceOrderStatus to) {
        require(from, to);
        StaffMove move = staffMove(from, to);
        if (move != null) {
            return move;
        }
        String route = OWN_ROUTE.get(from + ">" + to);
        if (route != null) {
            throw new ConflictException("ORDER_TRANSITION_NOT_ALLOWED: " + from.name() + " to " + to.name()
                    + " is made with " + route);
        }
        throw new ConflictException("ORDER_TRANSITION_NOT_ALLOWED: " + (from == null ? "new" : from.name()) + " to "
                + to.name() + " is not a move staff make on an order");
    }

    // ------------------------------------------------------------------ next actions (staff detail)

    private static final Set<CommerceRole> MONEY = Collections.unmodifiableSet(
            EnumSet.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT));

    /** What the next actions of an order depend on. */
    public record ActionState(CommerceOrderStatus status, String liveShipmentStatus, String channel,
                              String paymentMethod, String paymentStatus, boolean stockShort,
                              boolean codCollected, boolean hasReturns) {
    }

    /**
     * The desk actions the caller may run on the order now, in a fixed order: CONFIRM, PACK,
     * SHIP, DELIVER, RTO, RTO_RECEIVE, EDIT_TRACKING, UNPACK, UNDO_SHIP, UNDO_DELIVERY, CANCEL,
     * CANCEL_LINE, RECORD_RECEIPT, CLEAR_STOCK_SHORT. The location of the order is not looked at
     * here: the route still checks it.
     */
    public static List<String> nextActions(ActionState state, Set<CommerceRole> roles, boolean admin) {
        List<String> out = new ArrayList<>();
        if (state == null || state.status() == null) {
            return out;
        }
        Set<CommerceRole> mine = roles == null ? Set.of() : roles;
        CommerceOrderStatus status = state.status();
        String shipment = state.liveShipmentStatus();
        boolean floor = admin || mine.contains(CommerceRole.STORE_MANAGER) || mine.contains(CommerceRole.WAREHOUSE_STAFF);
        boolean manager = admin || mine.contains(CommerceRole.STORE_MANAGER);
        boolean money = admin || mine.stream().anyMatch(MONEY::contains);
        if (status == COD_PENDING_CONFIRMATION && floor) {
            out.add("CONFIRM");
        }
        if (status == CONFIRMED && floor) {
            out.add("PACK");
        }
        if (status == PACKED && floor && "PACKED".equals(shipment)) {
            out.add("SHIP");
        }
        if (status == SHIPPED && floor && "SHIPPED".equals(shipment)) {
            out.add("DELIVER");
            out.add("RTO");
        }
        if (status == RTO && floor && "RTO".equals(shipment)) {
            out.add("RTO_RECEIVE");
        }
        if (status == SHIPPED && floor && "SHIPPED".equals(shipment)) {
            out.add("EDIT_TRACKING");
        }
        if (status == PACKED && manager && "PACKED".equals(shipment)) {
            out.add("UNPACK");
        }
        if (status == SHIPPED && manager && "SHIPPED".equals(shipment)) {
            out.add("UNDO_SHIP");
        }
        if (status == DELIVERED && manager && "DELIVERED".equals(shipment) && !state.codCollected()
                && !state.hasReturns()) {
            out.add("UNDO_DELIVERY");
        }
        if ((status == COD_PENDING_CONFIRMATION && floor) || ((status == CONFIRMED || status == PACKED) && manager)) {
            out.add("CANCEL");
        }
        if ((status == COD_PENDING_CONFIRMATION || status == CONFIRMED || status == PACKED) && manager) {
            out.add("CANCEL_LINE");
        }
        boolean dues = "UNPAID".equals(state.paymentStatus()) || "PARTIALLY_PAID".equals(state.paymentStatus());
        if (money && dues && "ADMIN".equals(state.channel()) && !"COD".equals(state.paymentMethod())
                && status != CANCELLED && status != RTO) {
            out.add("RECORD_RECEIPT");
        }
        if (manager && state.stockShort()) {
            out.add("CLEAR_STOCK_SHORT");
        }
        return out;
    }
}
