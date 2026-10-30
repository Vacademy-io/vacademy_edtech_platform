package vacademy.io.notification_service.features.engagement_ledger.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsRequest;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsResponse;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsResponse.ActionSignals;
import vacademy.io.notification_service.features.engagement_ledger.dto.ReportSignalsResponse.EmailEvents;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementReportSignalsDao;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementReportSignalsDao.InboundRow;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementReportSignalsDao.OutgoingRow;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementReportSignalsDao.TemplateRow;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NavigableSet;
import java.util.Set;
import java.util.TreeSet;

/**
 * Per-action signals for the engagement daily report in admin_core: for each engine action, the
 * message it sent, whether it was delivered/read/bounced, whether the person replied, and what
 * Meta said about its pricing.
 * <p>
 * The outgoing row is the latest WHATSAPP_MESSAGE_OUTGOING or EMAIL row whose correlation_id is the
 * action id. Everything else is read in bulk around those rows: a call costs at most five queries
 * per chunk of 500, never one per action.
 * <p>
 * Signal availability is the same as for the ledger (see EngagementLedgerService): WhatsApp
 * delivery and replies are visible for META/COMBOT, not WATI; email events exist only when SES
 * tracking is on for the institute, and their link to the email is a recipient + time heuristic;
 * email replies only while aws.inbound.email.enabled is on.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementReportSignalsService {

    private static final String WHATSAPP_OUTGOING = "WHATSAPP_MESSAGE_OUTGOING";

    private final EngagementReportSignalsDao dao;
    private final ObjectMapper objectMapper;

    @Value("${aws.inbound.email.enabled:false}")
    private boolean inboundEmailEnabled;

    @Transactional(readOnly = true)
    public ReportSignalsResponse reportSignals(ReportSignalsRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().isBlank()) {
            throw new IllegalArgumentException("instituteId is required");
        }
        if (request.getActionIds() == null) {
            throw new IllegalArgumentException("actionIds is required");
        }
        if (request.getActionIds().size() > ReportSignalsRequest.MAX_ACTION_IDS) {
            throw new IllegalArgumentException("actionIds exceeds max " + ReportSignalsRequest.MAX_ACTION_IDS
                    + " (got " + request.getActionIds().size() + ") — page the actions");
        }
        String instituteId = request.getInstituteId();
        Duration replyWindow = Duration.ofHours(replyWindowHours(request.getReplyWindowHours()));

        Set<String> actionIds = new LinkedHashSet<>();
        for (String id : request.getActionIds()) {
            if (id != null && !id.isBlank()) {
                actionIds.add(id.trim());
            }
        }
        Map<String, ActionSignals> actions = new LinkedHashMap<>();
        if (actionIds.isEmpty()) {
            return ReportSignalsResponse.builder().inboundEmailEnabled(inboundEmailEnabled).actions(actions).build();
        }

        dao.applyStatementTimeout();
        List<OutgoingRow> rows = dao.latestOutgoingByCorrelation(instituteId, actionIds);

        List<OutgoingRow> whatsAppRows = new ArrayList<>();
        List<String> emailRowIds = new ArrayList<>();
        Map<String, JsonNode> payloads = new HashMap<>();
        Set<String> templateNames = new LinkedHashSet<>();
        for (OutgoingRow row : rows) {
            JsonNode payload = parsePayload(row.messagePayload());
            payloads.put(row.correlationId(), payload);
            if (WHATSAPP_OUTGOING.equals(row.notificationType())) {
                whatsAppRows.add(row);
                String templateName = text(payload, "templateName");
                if (templateName != null) {
                    templateNames.add(templateName.toLowerCase(Locale.ROOT));
                }
            } else {
                emailRowIds.add(row.id());
            }
        }

        Map<String, List<String>> eventNamesByEmail = emailRowIds.isEmpty()
                ? Map.of() : dao.emailEventNamesBySource(emailRowIds);
        Map<String, Instant> emailReplies = inboundEmailEnabled && !emailRowIds.isEmpty()
                ? dao.firstInboundEmailBySource(emailRowIds) : Map.of();
        Map<String, NavigableSet<Instant>> inboundByPhone = inboundWhatsAppByPhone(instituteId, whatsAppRows, replyWindow);
        TemplateCategories categories = templateCategories(instituteId, templateNames);

        for (OutgoingRow row : rows) {
            JsonNode payload = payloads.get(row.correlationId());
            boolean whatsApp = WHATSAPP_OUTGOING.equals(row.notificationType());
            ActionSignals.ActionSignalsBuilder signals = ActionSignals.builder()
                    .channel(whatsApp ? "WHATSAPP" : "EMAIL")
                    .recipient(row.channelId())
                    .sentAt(row.sentAt() != null ? row.sentAt().toEpochMilli() : null)
                    .deliveryStatus(row.deliveryStatus() != null ? row.deliveryStatus()
                            : row.sendFailed() ? "FAILED" : null)
                    .deliveryErrorCode(row.deliveryErrorCode())
                    .provider(upper(text(payload, "provider")))
                    .pricingType(row.pricingType())
                    .pricingCategory(row.pricingCategory())
                    .pricingBillable(row.pricingBillable())
                    .pricingModel(row.pricingModel());
            if (whatsApp) {
                String templateName = text(payload, "templateName");
                String language = text(payload, "languageCode");
                signals.templateName(templateName)
                        .templateLanguage(language)
                        .templateCategory(categories.categoryOf(templateName, language))
                        .firstReplyAt(firstWhatsAppReply(row, inboundByPhone, replyWindow));
            } else {
                List<String> names = eventNamesByEmail.get(row.id());
                Instant repliedAt = emailReplies.get(row.id());
                signals.templateName(text(payload, "templateName"))
                        .subject(text(payload, "subject"))
                        .emailEvents(emailEvents(names))
                        .emailTracked(names != null)
                        .firstReplyAt(repliedAt != null ? repliedAt.toEpochMilli() : null);
            }
            actions.put(row.correlationId(), signals.build());
        }
        log.debug("report-signals institute={} actions={} found={} (whatsapp={}, email={})",
                instituteId, actionIds.size(), actions.size(), whatsAppRows.size(), emailRowIds.size());
        return ReportSignalsResponse.builder().inboundEmailEnabled(inboundEmailEnabled).actions(actions).build();
    }

    private static int replyWindowHours(Integer requested) {
        if (requested == null) {
            return ReportSignalsRequest.DEFAULT_REPLY_WINDOW_HOURS;
        }
        return Math.max(ReportSignalsRequest.MIN_REPLY_WINDOW_HOURS,
                Math.min(ReportSignalsRequest.MAX_REPLY_WINDOW_HOURS, requested));
    }

    /**
     * Inbound WhatsApp per phone (digits only), for the window spanning every send. Both the stored
     * and the digits-only form of each phone are asked for, so a send row written with a '+' still
     * finds replies stored without one.
     */
    private Map<String, NavigableSet<Instant>> inboundWhatsAppByPhone(String instituteId, List<OutgoingRow> rows,
                                                                      Duration replyWindow) {
        Set<String> phones = new LinkedHashSet<>();
        Instant earliest = null;
        Instant latest = null;
        for (OutgoingRow row : rows) {
            String digits = digits(row.channelId());
            if (digits == null || row.sentAt() == null) {
                continue;
            }
            phones.add(row.channelId());
            phones.add(digits);
            earliest = earliest == null || row.sentAt().isBefore(earliest) ? row.sentAt() : earliest;
            latest = latest == null || row.sentAt().isAfter(latest) ? row.sentAt() : latest;
        }
        Map<String, NavigableSet<Instant>> byPhone = new HashMap<>();
        if (phones.isEmpty()) {
            return byPhone;
        }
        for (InboundRow inbound : dao.inboundWhatsApp(instituteId, phones, earliest, latest.plus(replyWindow))) {
            String digits = digits(inbound.channelId());
            if (digits != null && inbound.receivedAt() != null) {
                byPhone.computeIfAbsent(digits, k -> new TreeSet<>()).add(inbound.receivedAt());
            }
        }
        return byPhone;
    }

    /** First inbound from the same phone in (sentAt, sentAt + window], as epoch millis. */
    private static Long firstWhatsAppReply(OutgoingRow row, Map<String, NavigableSet<Instant>> inboundByPhone,
                                           Duration replyWindow) {
        String digits = digits(row.channelId());
        if (digits == null || row.sentAt() == null) {
            return null;
        }
        NavigableSet<Instant> inbound = inboundByPhone.get(digits);
        Instant first = inbound != null ? inbound.higher(row.sentAt()) : null;
        return first != null && !first.isAfter(row.sentAt().plus(replyWindow)) ? first.toEpochMilli() : null;
    }

    private static EmailEvents emailEvents(List<String> names) {
        if (names == null) {
            return EmailEvents.builder().build();
        }
        return EmailEvents.builder()
                .delivered(names.contains("DELIVERY"))
                .opened(names.contains("OPEN"))
                .clicked(names.contains("CLICK"))
                .bounced(names.contains("BOUNCE"))
                .complained(names.contains("COMPLAINT"))
                .build();
    }

    /**
     * Meta category per template: the institute's notification_template row for the exact name and
     * language, else any language of that name (case-insensitive).
     */
    private TemplateCategories templateCategories(String instituteId, Set<String> lowerCaseNames) {
        Map<String, String> exact = new HashMap<>();
        Map<String, String> byName = new HashMap<>();
        if (!lowerCaseNames.isEmpty()) {
            for (TemplateRow t : dao.whatsAppTemplates(instituteId, lowerCaseNames)) {
                String category = upper(t.category());
                if (category == null || t.name() == null) {
                    continue;
                }
                exact.putIfAbsent(t.name() + "|" + t.language(), category);
                byName.putIfAbsent(t.name().toLowerCase(Locale.ROOT), category);
            }
        }
        return new TemplateCategories(exact, byName);
    }

    private record TemplateCategories(Map<String, String> exact, Map<String, String> byName) {
        String categoryOf(String name, String language) {
            if (name == null) {
                return null;
            }
            // Meta template names are lowercase letters, digits and underscores, so '|' cannot clash.
            String category = exact.get(name + "|" + language);
            return category != null ? category : byName.get(name.toLowerCase(Locale.ROOT));
        }
    }

    /** message_payload is free-form JSON written by several send paths; anything unreadable is null. */
    private JsonNode parsePayload(String payload) {
        if (payload == null || payload.isBlank()) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(payload);
            return node != null && node.isObject() ? node : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || !value.isValueNode()) {
            return null;
        }
        String s = value.asText().trim();
        return s.isEmpty() ? null : s;
    }

    private static String upper(String value) {
        return value != null && !value.isBlank() ? value.trim().toUpperCase(Locale.ROOT) : null;
    }

    private static String digits(String phone) {
        if (phone == null) {
            return null;
        }
        String digits = phone.replaceAll("\\D", "");
        return digits.isEmpty() ? null : digits;
    }
}
