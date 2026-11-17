package vacademy.io.admin_core_service.features.commerce.notify;

import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * {@link CommerceNotificationStore} in memory, behaving as its SQL does: the unique keys with
 * {@code ON CONFLICT DO NOTHING}, every status change a compare-and-set on the status it expects,
 * "due" and "expired" as the database would answer them (set by the test instead of a clock).
 */
public class InMemoryNotificationStore extends CommerceNotificationStore {

    /** An outbox row. */
    public static final class Event {
        public String id;
        public String instituteId;
        public String orderId;
        public String triggerCode;
        public String refId;
        public String status = "PENDING";
        public String skipReason;
        public int attempts;
        /** Minutes until due; 0 or less is due. */
        public int dueInMinutes;
        public boolean expired;
        public boolean planned;
    }

    /** A delivery row. */
    public static final class Delivery {
        public String id;
        public String eventId;
        public String instituteId;
        public String orderId;
        public String triggerCode;
        public String channel;
        public String locale;
        public String templateName;
        public String status = "PENDING";
        public int attempts;
        public int dueInMinutes;
        public String errorCode;
        public String errorDetail;
        public String providerMessageId;
        public String recipientHash;
        public String recipientMasked;
        public boolean sent;
        public int claimedMinutesAgo = -1;
        public final List<Integer> retryMinutes = new ArrayList<>();
    }

    public final Map<String, Event> events = new LinkedHashMap<>();
    public final Map<String, Delivery> deliveries = new LinkedHashMap<>();
    public final Map<String, OrderFacts> orders = new HashMap<>();
    public final Map<String, Map<String, Object>> shipments = new HashMap<>();
    public final Map<String, Map<String, Object>> returns = new HashMap<>();
    public final Map<String, Map<String, Object>> refunds = new HashMap<>();
    public final Map<String, List<Map<String, Object>>> lines = new HashMap<>();
    public final Map<String, String> instituteNames = new HashMap<>();
    public final Map<String, Boolean> anonymised = new HashMap<>();
    public int eventInserts;
    public int deliveryInsertsApplied;
    public int deliveryInsertsIgnored;
    /** Makes the next claims answer 0 rows (another pod won the race). */
    public boolean loseClaims;
    private int ids;

    public InMemoryNotificationStore() {
        super(null);
    }

    // ================================================================== events

    @Override
    public synchronized int insertEvent(String instituteId, String orderId, String triggerCode, String refId) {
        String ref = refId == null ? "" : refId;
        for (Event e : events.values()) {
            if (e.instituteId.equals(instituteId) && e.orderId.equals(orderId) && e.triggerCode.equals(triggerCode)
                    && e.refId.equals(ref)) {
                return 0;
            }
        }
        Event e = new Event();
        e.id = "ev-" + (++ids);
        e.instituteId = instituteId;
        e.orderId = orderId;
        e.triggerCode = triggerCode;
        e.refId = ref;
        events.put(e.id, e);
        eventInserts++;
        return 1;
    }

    /** Adds an outbox row and answers its id. */
    public String event(String instituteId, String orderId, String triggerCode, String refId) {
        insertEvent(instituteId, orderId, triggerCode, refId);
        return events.values().stream().filter(e -> e.orderId.equals(orderId) && e.triggerCode.equals(triggerCode)
                && e.refId.equals(refId == null ? "" : refId)).findFirst().orElseThrow().id;
    }

    public EventRow row(Event e) {
        return new EventRow(e.id, e.instituteId, e.orderId, e.triggerCode, e.refId, e.attempts, e.expired);
    }

    public EventRow row(String eventId) {
        return row(events.get(eventId));
    }

    @Override
    public synchronized List<EventRow> dueEvents(int limit) {
        return events.values().stream().filter(e -> "PENDING".equals(e.status) && e.dueInMinutes <= 0).limit(limit)
                .map(this::row).toList();
    }

    @Override
    public synchronized List<EventRow> dueEventsOfOrder(String instituteId, String orderId) {
        return events.values().stream().filter(e -> "PENDING".equals(e.status) && e.dueInMinutes <= 0
                && e.instituteId.equals(instituteId) && e.orderId.equals(orderId)).map(this::row).toList();
    }

    @Override
    public synchronized EventRow findEvent(String id) {
        Event e = events.get(id);
        return e == null ? null : row(e);
    }

    @Override
    public synchronized int skipEvent(String id, String reason) {
        Event e = events.get(id);
        if (e == null || !"PENDING".equals(e.status)) {
            return 0;
        }
        e.status = "SKIPPED";
        e.skipReason = reason;
        return 1;
    }

    @Override
    public synchronized int retryEvent(String id, int minutes) {
        Event e = events.get(id);
        if (e == null || !"PENDING".equals(e.status)) {
            return 0;
        }
        e.attempts++;
        e.dueInMinutes = minutes;
        return 1;
    }

    @Override
    public synchronized int markPlanned(String id) {
        Event e = events.get(id);
        if (e == null || !"PENDING".equals(e.status)) {
            return 0;
        }
        e.status = "PLANNED";
        e.planned = true;
        return 1;
    }

    // ================================================================== deliveries

    @Override
    public synchronized int insertDelivery(String eventId, String instituteId, String orderId, String triggerCode,
                                           String channel, String locale, String templateName) {
        for (Delivery d : deliveries.values()) {
            if (d.eventId.equals(eventId) && d.channel.equals(channel)) {
                deliveryInsertsIgnored++;
                return 0;
            }
        }
        Delivery d = new Delivery();
        d.id = "dl-" + (++ids);
        d.eventId = eventId;
        d.instituteId = instituteId;
        d.orderId = orderId;
        d.triggerCode = triggerCode;
        d.channel = channel;
        d.locale = locale;
        d.templateName = templateName;
        deliveries.put(d.id, d);
        deliveryInsertsApplied++;
        return 1;
    }

    public List<Delivery> deliveriesOf(String eventId) {
        return deliveries.values().stream().filter(d -> d.eventId.equals(eventId)).toList();
    }

    public Delivery delivery(String eventId, String channel) {
        return deliveries.values().stream().filter(d -> d.eventId.equals(eventId) && d.channel.equals(channel))
                .findFirst().orElse(null);
    }

    private DeliveryRow row(Delivery d) {
        Event e = events.get(d.eventId);
        return new DeliveryRow(d.id, d.eventId, d.instituteId, d.orderId, d.triggerCode, e == null ? "" : e.refId,
                d.channel, d.locale, d.status, d.templateName, d.attempts, e != null && e.expired);
    }

    @Override
    public synchronized List<DeliveryRow> dueDeliveries(int limit) {
        return deliveries.values().stream().filter(d -> "PENDING".equals(d.status) && d.dueInMinutes <= 0)
                .limit(limit).map(this::row).toList();
    }

    @Override
    public synchronized List<DeliveryRow> dueDeliveriesOfOrder(String instituteId, String orderId) {
        return deliveries.values().stream().filter(d -> "PENDING".equals(d.status) && d.dueInMinutes <= 0
                && d.instituteId.equals(instituteId) && d.orderId.equals(orderId)).map(this::row).toList();
    }

    @Override
    public synchronized DeliveryRow findDelivery(String id) {
        Delivery d = deliveries.get(id);
        return d == null ? null : row(d);
    }

    @Override
    public synchronized int claim(String id) {
        Delivery d = deliveries.get(id);
        if (loseClaims || d == null || !"PENDING".equals(d.status) || d.dueInMinutes > 0) {
            return 0;
        }
        d.status = "SENDING";
        d.attempts++;
        d.claimedMinutesAgo = 0;
        return 1;
    }

    @Override
    public synchronized int finish(String id, String status, String code, String detail, String providerMessageId,
                                   String recipientHash, String recipientMasked, boolean sent) {
        Delivery d = deliveries.get(id);
        if (d == null || !"SENDING".equals(d.status)) {
            return 0;
        }
        d.status = status;
        d.errorCode = code;
        d.errorDetail = detail;
        d.providerMessageId = providerMessageId;
        d.recipientHash = recipientHash != null ? recipientHash : d.recipientHash;
        d.recipientMasked = recipientMasked != null ? recipientMasked : d.recipientMasked;
        d.sent = d.sent || sent;
        return 1;
    }

    @Override
    public synchronized int retryDelivery(String id, int minutes, String code, String recipientHash,
                                          String recipientMasked) {
        Delivery d = deliveries.get(id);
        if (d == null || !"SENDING".equals(d.status)) {
            return 0;
        }
        d.status = "PENDING";
        d.errorCode = code;
        d.dueInMinutes = minutes;
        d.retryMinutes.add(minutes);
        d.recipientHash = recipientHash != null ? recipientHash : d.recipientHash;
        d.recipientMasked = recipientMasked != null ? recipientMasked : d.recipientMasked;
        return 1;
    }

    @Override
    public synchronized int expirePending(String id) {
        Delivery d = deliveries.get(id);
        if (d == null || !"PENDING".equals(d.status)) {
            return 0;
        }
        d.status = "EXPIRED";
        d.errorCode = "EXPIRED";
        return 1;
    }

    @Override
    public synchronized List<Lost> reapLostClaims(int minutes, int limit) {
        List<Lost> out = new ArrayList<>();
        for (Delivery d : deliveries.values()) {
            if (out.size() >= limit) {
                break;
            }
            if ("SENDING".equals(d.status) && d.claimedMinutesAgo > minutes) {
                d.status = "UNKNOWN";
                d.errorCode = "CLAIM_LOST";
                out.add(new Lost(d.id, d.instituteId, d.orderId, d.triggerCode, d.channel));
            }
        }
        return out;
    }

    // ================================================================== what a message needs

    @Override
    public OrderFacts order(String instituteId, String orderId) {
        OrderFacts o = orders.get(orderId);
        return o != null && Objects.equals(o.instituteId(), instituteId) ? o : null;
    }

    @Override
    public Map<String, Object> shipment(String orderId, String shipmentId) {
        return shipments.getOrDefault(orderId + "|" + shipmentId, Map.of());
    }

    @Override
    public Map<String, Object> orderReturn(String orderId, String returnId) {
        return returns.getOrDefault(orderId + "|" + returnId, Map.of());
    }

    @Override
    public Map<String, Object> refund(String orderId, String refundId) {
        return refunds.getOrDefault(orderId + "|" + refundId, Map.of());
    }

    @Override
    public List<Map<String, Object>> itemLines(String orderId) {
        return lines.getOrDefault(orderId, List.of());
    }

    @Override
    public String instituteName(String instituteId) {
        return instituteNames.get(instituteId);
    }

    @Override
    public boolean customerAnonymised(String customerId) {
        return customerId != null && Boolean.TRUE.equals(anonymised.get(customerId));
    }

    @Override
    public Integer revokeLinks(String instituteId, String orderId) {
        OrderFacts o = order(instituteId, orderId);
        if (o == null) {
            return null;
        }
        OrderFacts raised = new OrderFacts(o.id(), o.instituteId(), o.orderNumber(), o.customerName(),
                o.customerPhone(), o.customerEmail(), o.phoneVerified(), o.channel(), o.userId(), o.locale(),
                o.total(), o.currency(), o.cancelReason(), o.paymentMethod(), o.status(), o.linkEpoch() + 1,
                o.customerId());
        orders.put(orderId, raised);
        return raised.linkEpoch();
    }
}
