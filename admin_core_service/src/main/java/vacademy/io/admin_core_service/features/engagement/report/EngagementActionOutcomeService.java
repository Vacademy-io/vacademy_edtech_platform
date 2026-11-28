package vacademy.io.admin_core_service.features.engagement.report;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionTypes;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.CallRow;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.TaskRow;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What became of each inbox row once it went out, read the way the daily report reads it: delivery,
 * opens, bounces and pricing from notification_service ({@link EngagementReportSignalsClient}), the
 * reply credited by the report's rule ({@link EngagementDailyReportService#attributeReplies}), and an
 * AI call's result from ai_call_queue / telephony_call_log. The inbox shows it per row
 * (GET /engagement/tasks/outcomes) and filters on it ({@link #matches}), so a number on the report
 * opens exactly the rows behind it.
 *
 * <p>Which rows a message outcome can match is the report's population: a message (SEND, or a TASK
 * a person sent), not CRM work, on EMAIL / WHATSAPP / IN_APP, SENT or FAILED. A call outcome is any
 * row that queued an AI call (an AI_CALL message or a SCHEDULE_AI_CALL task).
 */
@Slf4j
@Service
public class EngagementActionOutcomeService {

    /** Every outcome the inbox filters on (lower case, as the URL carries it). */
    public static final Set<String> OUTCOMES = Set.of("delivered", "not_delivered", "opened", "clicked", "bounced",
            "complained", "read", "replied", "failed", "connected", "no_answer", "busy", "call_failed");

    private static final Set<String> MESSAGE_CHANNELS = Set.of("EMAIL", "WHATSAPP", "IN_APP");
    /** Queue rows that ended without a dial; the report counts them as "not dialled". */
    private static final Set<String> NOT_DIALLED = Set.of("FAILED", "EXPIRED", "CANCELLED");

    private final EngagementTaskQueryDao dao;
    private final EngagementReportSignalsClient signalsClient;
    private final LeadReportSettingService leadReportSettings;
    private final InstituteTimezoneService timezoneService;

    public EngagementActionOutcomeService(EngagementTaskQueryDao dao,
                                          EngagementReportSignalsClient signalsClient,
                                          LeadReportSettingService leadReportSettings,
                                          InstituteTimezoneService timezoneService) {
        this.dao = dao;
        this.signalsClient = signalsClient;
        this.leadReportSettings = leadReportSettings;
        this.timezoneService = timezoneService;
    }

    /**
     * One row's outcome (the /tasks/outcomes contract). tracked is false when nothing reports back:
     * in-app, an email without SES tracking, WhatsApp through WATI, a row that never went out. An
     * AI-call row carries {@code call} and never the email flags; its delivered means connected, as
     * in the report's channel table.
     */
    public record ActionOutcome(String actionId, String channel, boolean tracked, String deliveryStatus,
                                boolean delivered, boolean opened, boolean clicked, boolean bounced,
                                boolean complained, String repliedAt, String errorCode, String pricingCategory,
                                CallOutcome call) {
    }

    /**
     * status: the call log's (COMPLETED, NO_ANSWER, BUSY, FAILED, INITIATED, ...), QUEUED while it
     * waits for a slot, NOT_DIALLED when the queue gave up on it.
     */
    public record CallOutcome(String status, boolean connected, Integer durationSeconds, String callLogId,
                              String queueStatus) {
    }

    /**
     * Outcomes of these rows, keyed by action id. One signals call for the message rows (THROWS 503
     * when notification_service cannot answer: an unknown outcome must not read as "not delivered").
     */
    public Map<String, ActionOutcome> outcomes(String instituteId, List<TaskRow> rows) {
        List<String> messageIds = new ArrayList<>();
        Set<String> attributable = new LinkedHashSet<>();
        List<String> callIds = new ArrayList<>();
        for (TaskRow r : rows) {
            if (isCallRow(r)) {
                callIds.add(r.id());
            } else if (("EMAIL".equals(r.channel()) || "WHATSAPP".equals(r.channel()))
                    && ("SENT".equals(r.status()) || "FAILED".equals(r.status()))) {
                messageIds.add(r.id());
                if (isReportSend(r) && "SENT".equals(r.status())) attributable.add(r.id());
            }
        }

        Map<String, Signal> signals = Map.of();
        Map<String, Long> replies = Map.of();
        if (!messageIds.isEmpty()) {
            String tz = EngagementReportDay.zone(timezoneService.getTimezoneId(instituteId)).getId();
            List<String> whatsapp = rows.stream()
                    .filter(r -> "WHATSAPP".equals(r.channel()) && attributable.contains(r.id()))
                    .map(TaskRow::id).toList();
            Set<String> later = new LinkedHashSet<>(dao.laterSendsSameDay(instituteId, whatsapp, tz));
            Set<String> fetch = new LinkedHashSet<>(messageIds);
            fetch.addAll(later);
            signals = fetchSignals(instituteId, List.copyOf(fetch));
            // Only messages take part in attribution: the rows of the report's population and the
            // sends that followed them.
            Map<String, Signal> attributionInput = new HashMap<>();
            Set<String> eligible = new HashSet<>(attributable);
            eligible.addAll(later);
            for (String id : eligible) {
                Signal g = signals.get(id);
                if (g != null) attributionInput.put(id, g);
            }
            replies = EngagementDailyReportService.attributeReplies(attributionInput);
        }

        Map<String, CallOutcome> calls = callIds.isEmpty() ? Map.of()
                : pickCalls(dao.calls(instituteId, callIds), connectedStatuses(instituteId));

        Map<String, ActionOutcome> out = new LinkedHashMap<>();
        for (TaskRow r : rows) {
            Long repliedAt = attributable.contains(r.id()) ? replies.get(r.id()) : null;
            out.put(r.id(), build(r, signals.get(r.id()), repliedAt, calls.get(r.id())));
        }
        return out;
    }

    private Map<String, Signal> fetchSignals(String instituteId, List<String> ids) {
        try {
            Signals s = signalsClient.fetch(instituteId, ids, EngagementDailyReportService.REPLY_WINDOW_HOURS);
            return s.byActionId();
        } catch (Exception e) {
            log.warn("[EngagementOutcomes] signals failed for institute {}: {}", instituteId, e.getMessage());
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Delivery and reply data is unavailable right now. Try again in a minute.");
        }
    }

    private Set<String> connectedStatuses(String instituteId) {
        LeadReportSettingService.ReportSettings settings = leadReportSettings.get(instituteId);
        Set<String> statuses = settings != null ? settings.connectedCallStatuses() : null;
        return statuses == null || statuses.isEmpty() ? Set.of("COMPLETED") : statuses;
    }

    // ── rules (pure, unit-tested) ────────────────────────────────────────────

    /** A row that queued an AI call: an AI_CALL message, or a SCHEDULE_AI_CALL task on any channel. */
    public static boolean isCallRow(TaskRow r) {
        return "AI_CALL".equals(r.channel()) || EngagementActionTypes.SCHEDULE_AI_CALL.equals(r.actionType());
    }

    /** The daily report's messages: a SEND or a TASK, not CRM work, on a message channel, settled. */
    public static boolean isReportSend(TaskRow r) {
        return ("SEND".equals(r.kind()) || "TASK".equals(r.kind()))
                && !EngagementActionTypes.isCrmAction(r.actionType())
                && r.channel() != null && MESSAGE_CHANNELS.contains(r.channel())
                && ("SENT".equals(r.status()) || "FAILED".equals(r.status()));
    }

    /** The channels an outcome can occur on, to narrow the rows read before filtering. */
    public static Set<String> channelsFor(String outcome) {
        return switch (outcome) {
            case "opened", "clicked", "bounced", "complained" -> Set.of("EMAIL");
            case "read", "replied" -> Set.of("EMAIL", "WHATSAPP");
            case "connected", "no_answer", "busy", "call_failed" -> Set.of("AI_CALL");
            default -> Set.of("EMAIL", "WHATSAPP", "IN_APP", "AI_CALL");
        };
    }

    /**
     * Whether a row counts toward an outcome, by the same definitions as the report's numbers:
     * delivered = email delivered/opened/clicked, WhatsApp DELIVERED/READ, in-app sent, call
     * connected; read = email opened or WhatsApp READ; failed = a message that failed going out or
     * that Meta failed, a call that failed or was never dialled; the call outcomes as the report's
     * calls table (a connected status wins over NO_ANSWER/BUSY/FAILED).
     */
    public static boolean matches(String outcome, TaskRow r, ActionOutcome o) {
        if (o == null) return false;
        CallOutcome call = isCallRow(r) ? o.call() : null;
        boolean send = isReportSend(r);
        boolean sent = send && "SENT".equals(r.status());
        boolean email = "EMAIL".equals(r.channel()), whatsapp = "WHATSAPP".equals(r.channel());
        boolean waFailed = whatsapp && "FAILED".equals(o.deliveryStatus());
        return switch (outcome) {
            case "delivered" -> (sent && o.delivered()) || (call != null && call.connected());
            case "not_delivered" -> (sent && (email || whatsapp) && !o.delivered())
                    || (call != null && !call.connected());
            case "opened" -> sent && email && o.opened();
            case "clicked" -> sent && email && o.clicked();
            case "bounced" -> sent && email && o.bounced();
            case "complained" -> sent && email && o.complained();
            case "read" -> sent && ((email && o.opened()) || (whatsapp && "READ".equals(o.deliveryStatus())));
            case "replied" -> sent && o.repliedAt() != null;
            case "failed" -> (send && ("FAILED".equals(r.status()) || waFailed))
                    || (call != null && (callIs(call, "FAILED") || NOT_DIALLED.contains(call.queueStatus())));
            case "connected" -> call != null && call.connected();
            case "no_answer" -> call != null && callIs(call, "NO_ANSWER");
            case "busy" -> call != null && callIs(call, "BUSY");
            case "call_failed" -> call != null && callIs(call, "FAILED");
            default -> false;
        };
    }

    private static boolean callIs(CallOutcome c, String status) {
        return !c.connected() && status.equals(c.status());
    }

    static ActionOutcome build(TaskRow r, Signal g, Long repliedAt, CallOutcome call) {
        if (isCallRow(r)) {
            return new ActionOutcome(r.id(), "AI_CALL", call != null, null, call != null && call.connected(),
                    false, false, false, false, null, null, null, call);
        }
        String channel = r.channel();
        boolean failedRow = "FAILED".equals(r.status());
        if ("EMAIL".equals(channel) && g != null) {
            return new ActionOutcome(r.id(), channel, g.emailTracked(),
                    upper(g.deliveryStatus(), failedRow), g.delivered() || g.opened() || g.clicked(),
                    g.opened(), g.clicked(), g.bounced(), g.complained(), iso(repliedAt),
                    g.deliveryErrorCode(), null, null);
        }
        if ("WHATSAPP".equals(channel) && g != null) {
            String ds = upper(g.deliveryStatus(), failedRow);
            String category = g.pricingCategory() != null ? g.pricingCategory() : g.templateCategory();
            return new ActionOutcome(r.id(), channel, !"WATI".equalsIgnoreCase(g.provider()), ds,
                    "DELIVERED".equals(ds) || "READ".equals(ds), false, false, false, false, iso(repliedAt),
                    g.deliveryErrorCode(), category == null ? null : category.toLowerCase(Locale.ROOT), null);
        }
        // No signal: in-app (written straight to the app inbox, delivered once sent, as the report
        // counts it), a message that never went out, or one notification_service has no row for.
        boolean message = channel != null && MESSAGE_CHANNELS.contains(channel);
        return new ActionOutcome(r.id(), channel, false, message && failedRow ? "FAILED" : null,
                "IN_APP".equals(channel) && "SENT".equals(r.status()),
                false, false, false, false, null, null, null, null);
    }

    /**
     * One call per action: a connected one if any (a retry that got through), else the newest.
     * {@code rows} come newest first.
     */
    static Map<String, CallOutcome> pickCalls(List<CallRow> rows, Set<String> connected) {
        Map<String, CallOutcome> out = new HashMap<>();
        for (CallRow c : rows) {
            CallOutcome o = callOutcome(c, connected);
            CallOutcome prev = out.get(c.actionId());
            if (prev == null || (!prev.connected() && o.connected())) out.put(c.actionId(), o);
        }
        return out;
    }

    static CallOutcome callOutcome(CallRow c, Set<String> connected) {
        String status;
        if (c.callLogId() != null) {
            status = c.callStatus() != null ? c.callStatus() : "INITIATED";
        } else if (NOT_DIALLED.contains(c.queueStatus())) {
            status = "NOT_DIALLED";
        } else {
            status = "DIALED".equals(c.queueStatus()) ? "INITIATED" : "QUEUED";
        }
        boolean isConnected = c.callStatus() != null && connected.contains(c.callStatus());
        return new CallOutcome(status, isConnected, c.durationSeconds(), c.callLogId(), c.queueStatus());
    }

    private static String upper(String s, boolean failedRow) {
        if (s == null || s.isBlank()) return failedRow ? "FAILED" : null;
        return s.trim().toUpperCase(Locale.ROOT);
    }

    private static String iso(Long epochMs) {
        return epochMs == null ? null : Instant.ofEpochMilli(epochMs).toString();
    }
}
