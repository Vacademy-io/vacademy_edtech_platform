package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotEscalation;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlow;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotFlowStatus;
import vacademy.io.notification_service.features.chatbot_flow.enums.EscalationReason;
import vacademy.io.notification_service.features.chatbot_flow.enums.EscalationStatus;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotEscalationRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.sql.Timestamp;
import java.util.*;
import java.util.function.Function;

/**
 * Owns the "a learner is waiting for a human reply" lifecycle.
 *
 * <p>Three entry points:
 * <ul>
 *   <li>{@link #raise} — the bot could not answer. Upserts the conversation's single open
 *       escalation (so a learner asking three unanswerable questions produces one open item) and
 *       emails the flow's configured notification addresses.</li>
 *   <li>{@link #resolveForPhone} — a human replied from the Inbox; the reply IS the answer.</li>
 *   <li>{@link #findPendingByPhone} / {@link #findPendingPhones} — what the Inbox renders as
 *       <b>Unanswered</b>.</li>
 * </ul>
 *
 * <p>Nothing here is allowed to break the bot: {@link #raise} swallows its own failures, because a
 * missing escalation row is far less bad than a learner getting no reply at all.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ChatbotEscalationService {

    private final ChatbotEscalationRepository escalationRepository;
    private final ChatbotFlowRepository flowRepository;
    private final InstituteInternalService instituteInternalService;
    private final UnifiedSendService unifiedSendService;
    private final ObjectMapper objectMapper;

    /**
     * How long before the SAME open escalation may email the admins again. A learner who keeps
     * asking while nobody has answered must not turn into an inbox flood.
     */
    @Value("${chatbot.escalation.renotify.minutes:120}")
    private int defaultRenotifyMinutes;

    @Value("${chatbot.escalation.notify.enabled:true}")
    private boolean notifyEnabled;

    /** Language used for the WhatsApp alert template when the flow names none. */
    @Value("${chatbot.escalation.whatsapp.language:en}")
    private String defaultWhatsappTemplateLanguage;

    /** Caller id stamped on the notification sends, for log attribution and CC matching. */
    private static final String NOTIFY_SOURCE = "CHATBOT_ESCALATION";

    /** What the bot says when it has no answer and is handing over. Overridable per AI node. */
    public static final String DEFAULT_ESCALATION_MESSAGE =
            "I don't have that information with me right now. Let me check with our team and get back to you shortly.";

    /** Everything needed to raise (or refresh) one escalation. */
    @Data
    @Builder
    public static class EscalationRequest {
        private String instituteId;
        private String flowId;
        private String sessionId;
        private String nodeId;
        private String userPhone;
        private String userId;
        private String userName;
        private String channelType;
        private String businessChannelId;
        private EscalationReason reason;
        /** The learner message the bot could not answer. */
        private String userMessage;
        /** What the bot replied instead. */
        private String botReply;
        private String errorMessage;
    }

    // ==================== Raise ====================

    /**
     * Record that the bot handed this conversation to a human, and notify the configured admins.
     * Idempotent per conversation: an already-open escalation is refreshed in place.
     *
     * <p>Deliberately NOT {@code @Transactional}: {@link #notifyAdmins} makes external calls (a
     * synchronous WhatsApp send, and an email send that can block on the SES rate limiter), and
     * this runs on the inbound-webhook hot path. Wrapping it would hold a pooled DB connection for
     * the duration of a provider round-trip and exhaust the pool under load — the same reason
     * {@code ChatbotFlowEngine.handleIncomingMessage} is not transactional. The two writes here
     * (the upsert, then the notified-at stamp) are fine-grained saves, each in its own repository
     * transaction.
     *
     * @return the open escalation, or {@code null} if it could not be recorded (never throws).
     */
    public ChatbotEscalation raise(EscalationRequest request) {
        if (request == null || request.getInstituteId() == null || request.getUserPhone() == null) {
            return null;
        }
        try {
            Optional<ChatbotEscalation> existing = escalationRepository
                    .findFirstByInstituteIdAndUserPhoneAndStatusOrderByCreatedAtDesc(
                            request.getInstituteId(), request.getUserPhone(),
                            EscalationStatus.PENDING.name());

            ChatbotEscalation escalation;
            if (existing.isPresent()) {
                // Refresh the open item with the latest unanswered question rather than stacking.
                escalation = existing.get();
                escalation.setReason(reasonName(request.getReason()));
                escalation.setUserMessage(request.getUserMessage());
                escalation.setBotReply(request.getBotReply());
                escalation.setErrorMessage(request.getErrorMessage());
                if (request.getFlowId() != null) escalation.setFlowId(request.getFlowId());
                if (request.getSessionId() != null) escalation.setSessionId(request.getSessionId());
                if (request.getNodeId() != null) escalation.setNodeId(request.getNodeId());
                if (request.getUserId() != null) escalation.setUserId(request.getUserId());
                if (request.getUserName() != null) escalation.setUserName(request.getUserName());
            } else {
                escalation = ChatbotEscalation.builder()
                        .instituteId(request.getInstituteId())
                        .flowId(request.getFlowId())
                        .sessionId(request.getSessionId())
                        .nodeId(request.getNodeId())
                        .userPhone(request.getUserPhone())
                        .userId(request.getUserId())
                        .userName(request.getUserName())
                        .channelType(request.getChannelType())
                        .businessChannelId(request.getBusinessChannelId())
                        .reason(reasonName(request.getReason()))
                        .userMessage(request.getUserMessage())
                        .botReply(request.getBotReply())
                        .errorMessage(request.getErrorMessage())
                        .status(EscalationStatus.PENDING.name())
                        .build();
            }

            escalation = escalationRepository.save(escalation);
            log.info("Chatbot escalation {} for institute={}, phone={}, reason={}",
                    existing.isPresent() ? "refreshed" : "raised",
                    request.getInstituteId(), request.getUserPhone(), escalation.getReason());

            notifyAdmins(escalation);
            return escalation;

        } catch (Exception e) {
            // A lost escalation row must never cost the learner their reply.
            log.error("Failed to raise chatbot escalation for phone={}: {}",
                    request.getUserPhone(), e.getMessage(), e);
            return null;
        }
    }

    private String reasonName(EscalationReason reason) {
        return (reason != null ? reason : EscalationReason.NO_CONTEXT).name();
    }

    // ==================== Resolve ====================

    /**
     * Mark every open escalation on a conversation answered. Called when an admin replies from the
     * WhatsApp Inbox.
     *
     * @return how many rows were resolved
     */
    @Transactional
    public int resolveForPhone(String instituteId, String phone, String resolvedBy) {
        if (instituteId == null || phone == null) return 0;
        try {
            int resolved = escalationRepository.resolvePendingForPhone(
                    instituteId, phone, resolvedBy != null ? resolvedBy : "INBOX_REPLY",
                    new Timestamp(System.currentTimeMillis()));
            if (resolved > 0) {
                log.info("Resolved {} chatbot escalation(s) for institute={}, phone={}",
                        resolved, instituteId, phone);
            }
            return resolved;
        } catch (Exception e) {
            log.warn("Failed to resolve escalations for phone={}: {}", phone, e.getMessage());
            return 0;
        }
    }

    /** Resolve one escalation by id (admin dismissed it without replying). */
    @Transactional
    public boolean resolveById(String escalationId, String resolvedBy) {
        return escalationRepository.findById(escalationId).map(e -> {
            if (EscalationStatus.RESOLVED.name().equals(e.getStatus())) return true;
            e.setStatus(EscalationStatus.RESOLVED.name());
            e.setResolvedAt(new Timestamp(System.currentTimeMillis()));
            e.setResolvedBy(resolvedBy != null ? resolvedBy : "ADMIN");
            escalationRepository.save(e);
            return true;
        }).orElse(false);
    }

    // ==================== Reads ====================

    public List<ChatbotEscalation> listEscalations(String instituteId, String status) {
        if (instituteId == null || instituteId.isBlank()) return List.of();
        if (status == null || status.isBlank() || "ALL".equalsIgnoreCase(status)) {
            return escalationRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId);
        }
        return escalationRepository.findByInstituteIdAndStatusOrderByCreatedAtDesc(
                instituteId, status.toUpperCase());
    }

    /** phone → its open escalation, for one page of the Inbox conversation list. */
    public Map<String, ChatbotEscalation> findPendingByPhone(String instituteId, List<String> phones) {
        if (instituteId == null || phones == null || phones.isEmpty()) return Map.of();
        try {
            Map<String, ChatbotEscalation> byPhone = new HashMap<>();
            // Ordered newest-first; keep the first seen so the newest wins.
            for (ChatbotEscalation e : escalationRepository.findPendingForPhones(instituteId, phones)) {
                byPhone.putIfAbsent(e.getUserPhone(), e);
            }
            return byPhone;
        } catch (Exception e) {
            log.warn("Failed to load pending escalations: {}", e.getMessage());
            return Map.of();
        }
    }

    /** Every phone with an open escalation — drives the Inbox "Unanswered" filter. */
    public Set<String> findPendingPhones(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return Set.of();
        try {
            return new LinkedHashSet<>(escalationRepository.findPendingPhones(instituteId));
        } catch (Exception e) {
            log.warn("Failed to load pending escalation phones: {}", e.getMessage());
            return Set.of();
        }
    }

    // ==================== Admin notification ====================

    /**
     * Tell the flow's configured recipients that a learner is waiting — over email, WhatsApp, or
     * both. Re-notification on an already-notified open escalation is rate-limited by
     * {@code escalationRenotifyMinutes}.
     *
     * <p>Both channels go through {@link UnifiedSendService} with a template name from the flow's
     * settings, so admins compose these alerts in the same template screen they already use for
     * every other message. Email additionally falls back to a built-in layout when no template is
     * named, because an escalation with recipients but no template must still reach someone.
     * WhatsApp has no such fallback: a business-initiated message RE\"UIRES an approved template,
     * so a phone list without one is skipped with a warning rather than failing at the provider.
     */
    private void notifyAdmins(ChatbotEscalation escalation) {
        if (!notifyEnabled) return;
        try {
            FlowNotificationSettings settings = resolveSettings(
                    escalation.getInstituteId(), escalation.getFlowId());

            if (!settings.notifyOnEscalation
                    || (settings.emails.isEmpty() && settings.phones.isEmpty())) {
                log.debug("No escalation notification recipients for institute={} flow={}",
                        escalation.getInstituteId(), escalation.getFlowId());
                return;
            }

            if (escalation.getNotifiedAt() != null) {
                long minutesSince = (System.currentTimeMillis() - escalation.getNotifiedAt().getTime())
                        / 60_000L;
                if (minutesSince < settings.renotifyMinutes) {
                    log.debug("Skipping escalation re-notify for phone={} ({}min < {}min)",
                            escalation.getUserPhone(), minutesSince, settings.renotifyMinutes);
                    return;
                }
            }

            InstituteInfoDTO institute = safeInstitute(escalation.getInstituteId());
            String instituteName = institute != null && institute.getInstituteName() != null
                    ? institute.getInstituteName() : "your institute";
            String inboxUrl = buildInboxUrl(institute);

            Map<String, String> variables = buildTemplateVariables(escalation, instituteName, inboxUrl);

            List<String> emailed = notifyByEmail(escalation, settings, variables, instituteName, inboxUrl);
            List<String> messaged = notifyByWhatsApp(escalation, settings, variables);

            if (!emailed.isEmpty() || !messaged.isEmpty()) {
                escalation.setNotifiedAt(new Timestamp(System.currentTimeMillis()));
                escalation.setNotifiedEmails(emailed.isEmpty() ? null : String.join(",", emailed));
                escalation.setNotifiedPhones(messaged.isEmpty() ? null : String.join(",", messaged));
                escalationRepository.save(escalation);
                log.info("Notified {} email(s) and {} phone(s) about escalation {}",
                        emailed.size(), messaged.size(), escalation.getId());
            }
        } catch (Exception e) {
            log.warn("Failed to notify admins about escalation {}: {}",
                    escalation.getId(), e.getMessage());
        }
    }

    /**
     * The placeholder set both templates receive. Named (not positional) — UnifiedSendService maps
     * these onto a WhatsApp template's positional params using its stored variable names, and
     * substitutes them into an email template's {{key}} placeholders directly.
     *
     * <p>Keys are snake_case to match the rest of the platform's template variables.
     */
    private Map<String, String> buildTemplateVariables(ChatbotEscalation escalation,
                                                        String instituteName, String inboxUrl) {
        Map<String, String> variables = new LinkedHashMap<>();
        variables.put("contact_name", nullToEmpty(displayName(escalation)));
        variables.put("phone", nullToEmpty(escalation.getUserPhone()));
        variables.put("question", nullToEmpty(escalation.getUserMessage()));
        variables.put("bot_reply", nullToEmpty(escalation.getBotReply()));
        variables.put("reason", reasonText(escalation.getReason()));
        variables.put("institute_name", nullToEmpty(instituteName));
        variables.put("inbox_url", nullToEmpty(inboxUrl));
        return variables;
    }

    /** @return the addresses that accepted the send */
    private List<String> notifyByEmail(ChatbotEscalation escalation, FlowNotificationSettings settings,
                                       Map<String, String> variables, String instituteName,
                                       String inboxUrl) {
        if (settings.emails.isEmpty()) return List.of();

        UnifiedSendRequest.SendOptions.SendOptionsBuilder options =
                UnifiedSendRequest.SendOptions.builder()
                        .emailType("UTILITY_EMAIL")
                        .source(NOTIFY_SOURCE)
                        .sourceId(escalation.getId());

        if (settings.emailTemplate == null || settings.emailTemplate.isBlank()) {
            // No template configured — fall back to the built-in layout so the alert still lands.
            options.emailSubject("Action needed: " + displayName(escalation)
                            + " is waiting for a reply on WhatsApp")
                    .emailBody(buildEmailBody(escalation, instituteName, inboxUrl));
        }

        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(escalation.getInstituteId())
                .channel("EMAIL")
                .templateName(emptyToNull(settings.emailTemplate))
                .recipients(settings.emails.stream()
                        .map(email -> UnifiedSendRequest.Recipient.builder()
                                .email(email)
                                .variables(variables)
                                .build())
                        .toList())
                .options(options.build())
                .build();

        return dispatch(request, settings.emails, "email",
                UnifiedSendResponse.RecipientResult::getEmail);
    }

    /** @return the phone numbers that accepted the send */
    private List<String> notifyByWhatsApp(ChatbotEscalation escalation,
                                          FlowNotificationSettings settings,
                                          Map<String, String> variables) {
        if (settings.phones.isEmpty()) return List.of();

        if (settings.whatsappTemplate == null || settings.whatsappTemplate.isBlank()) {
            // Meta only accepts business-initiated messages built from an approved template.
            // Saying so here beats a provider 400 that nobody reads.
            log.warn("Escalation {} has {} notification phone(s) but no WhatsApp template "
                            + "configured — skipping the WhatsApp alert. Set "
                            + "settings.escalationWhatsappTemplate on the flow.",
                    escalation.getId(), settings.phones.size());
            return List.of();
        }

        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(escalation.getInstituteId())
                .channel("WHATSAPP")
                .templateName(settings.whatsappTemplate)
                .languageCode(settings.whatsappTemplateLanguage)
                .recipients(settings.phones.stream()
                        .map(phone -> UnifiedSendRequest.Recipient.builder()
                                .phone(phone)
                                .variables(variables)
                                .build())
                        .toList())
                .options(UnifiedSendRequest.SendOptions.builder()
                        .source(NOTIFY_SOURCE)
                        .sourceId(escalation.getId())
                        .build())
                .build();

        return dispatch(request, settings.phones, "WhatsApp",
                UnifiedSendResponse.RecipientResult::getPhone);
    }

    /**
     * Run one send and report which recipients it accepted. A failing alert is logged, never
     * rethrown — the learner already has their reply, and losing the notification must not undo
     * the escalation record the Inbox depends on.
     */
    private List<String> dispatch(UnifiedSendRequest request, List<String> requested, String channel,
                                  Function<UnifiedSendResponse.RecipientResult, String> keyOf) {
        try {
            UnifiedSendResponse response = unifiedSendService.send(request);
            if (response == null) return List.of();

            if (response.getResults() == null || response.getResults().isEmpty()) {
                // \"ueued as a batch — no per-recipient verdict yet, so credit what we asked for.
                return response.getAccepted() > 0 ? requested : List.of();
            }
            List<String> accepted = new ArrayList<>();
            for (UnifiedSendResponse.RecipientResult result : response.getResults()) {
                if (result.isSuccess()) {
                    String key = keyOf.apply(result);
                    if (key != null) accepted.add(key);
                } else {
                    log.warn("Escalation {} alert to {} failed: {}", channel,
                            keyOf.apply(result), result.getError());
                }
            }
            return accepted;
        } catch (Exception e) {
            log.warn("Failed to send escalation {} alert: {}", channel, e.getMessage());
            return List.of();
        }
    }

    private String displayName(ChatbotEscalation escalation) {
        return escalation.getUserName() != null && !escalation.getUserName().isBlank()
                ? escalation.getUserName() : escalation.getUserPhone();
    }

    private InstituteInfoDTO safeInstitute(String instituteId) {
        try {
            return instituteInternalService.getInstituteByInstituteId(instituteId);
        } catch (Exception e) {
            log.debug("Could not load institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /** Deep link to the WhatsApp Inbox, when the institute has an admin portal URL on file. */
    private String buildInboxUrl(InstituteInfoDTO institute) {
        if (institute == null) return null;
        String base = institute.getAdminPortalUrl();
        if (base == null || base.isBlank()) return null;
        String normalized = base.trim();
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized + "/communication/inbox";
    }

    /** Plain-language reason, shared by both templates and the built-in email layout. */
    private String reasonText(String reason) {
        return switch (reason == null ? "" : reason) {
            case "NO_CONTEXT" -> "The assistant did not have the information to answer this.";
            case "MAX_TURNS" -> "The conversation reached its automated reply limit.";
            case "AI_ERROR" -> "The assistant could not generate a reply.";
            case "EXISTING_LEAD" -> "An existing lead got in touch again on WhatsApp.";
            case "CRM_SAVE_FAILED" -> "The chatbot could not save this lead's answers to the CRM — please add them by hand.";
            default -> "This conversation was handed over for a human reply.";
        };
    }

    /** Built-in email layout, used only when the flow names no email template. */
    private String buildEmailBody(ChatbotEscalation escalation, String instituteName, String inboxUrl) {
        StringBuilder html = new StringBuilder();
        html.append("<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6\">");
        html.append("<p>Hi,</p>");
        html.append("<p>A learner is waiting for a reply on <b>").append(escape(instituteName))
                .append("</b>'s WhatsApp.</p>");
        html.append("<p style=\"color:#6b7280\">").append(escape(reasonText(escalation.getReason())))
                .append("</p>");

        html.append("<table cellpadding=\"6\" cellspacing=\"0\" style=\"border-collapse:collapse;margin:16px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px\">");
        html.append(row("Contact", displayName(escalation)));
        html.append(row("Phone", escalation.getUserPhone()));
        if (escalation.getUserMessage() != null && !escalation.getUserMessage().isBlank()) {
            html.append(row("They asked", escalation.getUserMessage()));
        }
        if (escalation.getBotReply() != null && !escalation.getBotReply().isBlank()) {
            html.append(row("Bot replied", escalation.getBotReply()));
        }
        html.append("</table>");

        if (inboxUrl != null) {
            html.append("<p><a href=\"").append(inboxUrl)
                    .append("\" style=\"display:inline-block;background:#16a34a;color:#ffffff;")
                    .append("padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600\">")
                    .append("Open WhatsApp Inbox</a></p>");
        } else {
            html.append("<p>Open the WhatsApp Inbox in your admin dashboard to reply.</p>");
        }

        html.append("<p style=\"color:#6b7280;font-size:12px\">Replying from the Inbox marks this ")
                .append("conversation as answered. You are receiving this because your address is ")
                .append("listed in the chatbot's notification settings.</p>");
        html.append("</div>");
        return html.toString();
    }

    private String row(String label, String value) {
        return "<tr><td style=\"color:#6b7280;white-space:nowrap;vertical-align:top\">" + escape(label)
                + "</td><td style=\"color:#111827\">" + escape(value) + "</td></tr>";
    }

    private String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private String emptyToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    // ==================== Settings ====================

    /** Resolved notification config for one flow (or the institute's active flows). */
    private static class FlowNotificationSettings {
        List<String> emails = List.of();
        List<String> phones = List.of();
        /** notification_template name (channel EMAIL). Null/blank = use the built-in layout. */
        String emailTemplate;
        /** notification_template name (channel WHATSAPP). Required to alert phones at all. */
        String whatsappTemplate;
        String whatsappTemplateLanguage;
        boolean notifyOnEscalation = true;
        int renotifyMinutes;

        boolean hasRecipients() {
            return !emails.isEmpty() || !phones.isEmpty();
        }
    }

    /**
     * Where the admin recipients come from: the chatbot flow's {@code settings} JSON —
     * <pre>{"notificationEmails":["ops@school.com"],
     *  "notificationPhones":["919812345678"],
     *  "escalationEmailTemplate":"chatbot_escalation",
     *  "escalationWhatsappTemplate":"chatbot_escalation",
     *  "notifyOnEscalation":true,
     *  "escalationRenotifyMinutes":120}</pre>
     * When the escalation carries no flow id (or that flow lists nobody), fall back to the union of
     * every ACTIVE flow's recipients for the institute, so an Inbox-raised escalation still reaches
     * someone.
     */
    private FlowNotificationSettings resolveSettings(String instituteId, String flowId) {
        FlowNotificationSettings resolved = new FlowNotificationSettings();
        resolved.renotifyMinutes = defaultRenotifyMinutes;
        resolved.whatsappTemplateLanguage = defaultWhatsappTemplateLanguage;

        if (flowId != null) {
            ChatbotFlow flow = flowRepository.findById(flowId).orElse(null);
            if (flow != null) {
                applySettings(resolved, parseSettings(flow.getSettings()));
                if (resolved.hasRecipients()) return resolved;
            }
        }

        // Fall back to the institute's active flows, so an escalation raised outside any one flow
        // (or by a flow that configured nobody) still reaches someone. Template names come from
        // the first flow that names one — they are institute-wide content, not per-flow.
        LinkedHashSet<String> emailUnion = new LinkedHashSet<>(resolved.emails);
        LinkedHashSet<String> phoneUnion = new LinkedHashSet<>(resolved.phones);
        try {
            for (ChatbotFlow flow : flowRepository.findByInstituteIdAndStatusOrderByUpdatedAtDesc(
                    instituteId, ChatbotFlowStatus.ACTIVE.name())) {
                FlowNotificationSettings each = new FlowNotificationSettings();
                each.renotifyMinutes = defaultRenotifyMinutes;
                each.whatsappTemplateLanguage = defaultWhatsappTemplateLanguage;
                applySettings(each, parseSettings(flow.getSettings()));
                if (!each.notifyOnEscalation) continue;
                emailUnion.addAll(each.emails);
                phoneUnion.addAll(each.phones);
                if (resolved.emailTemplate == null) resolved.emailTemplate = each.emailTemplate;
                if (resolved.whatsappTemplate == null) {
                    resolved.whatsappTemplate = each.whatsappTemplate;
                    resolved.whatsappTemplateLanguage = each.whatsappTemplateLanguage;
                }
            }
        } catch (Exception e) {
            log.debug("Could not scan active flows for notification recipients: {}", e.getMessage());
        }
        resolved.emails = new ArrayList<>(emailUnion);
        resolved.phones = new ArrayList<>(phoneUnion);
        return resolved;
    }

    private void applySettings(FlowNotificationSettings target, Map<String, Object> settings) {
        if (settings == null) return;

        Object emails = settings.get("notificationEmails");
        if (emails == null) emails = settings.get("escalationNotificationEmails");
        target.emails = normalizeEmails(emails);

        Object phones = settings.get("notificationPhones");
        if (phones == null) phones = settings.get("escalationNotificationPhones");
        target.phones = normalizePhones(phones);

        target.emailTemplate = asText(settings.get("escalationEmailTemplate"));
        target.whatsappTemplate = asText(settings.get("escalationWhatsappTemplate"));
        String language = asText(settings.get("escalationWhatsappTemplateLanguage"));
        if (language != null) target.whatsappTemplateLanguage = language;

        Object notify = settings.get("notifyOnEscalation");
        if (notify instanceof Boolean b) target.notifyOnEscalation = b;
        else if (notify instanceof String s) target.notifyOnEscalation = Boolean.parseBoolean(s);

        Object renotify = settings.get("escalationRenotifyMinutes");
        if (renotify instanceof Number n && n.intValue() > 0) target.renotifyMinutes = n.intValue();
    }

    private String asText(Object value) {
        if (value == null) return null;
        String text = value.toString().trim();
        return text.isEmpty() ? null : text;
    }

    /** Accepts a list or a comma/semicolon separated string; trims, lower-cases, dedupes. */
    private List<String> normalizeEmails(Object raw) {
        if (raw == null) return List.of();
        List<String> candidates = new ArrayList<>();
        if (raw instanceof Collection<?> collection) {
            for (Object o : collection) if (o != null) candidates.add(o.toString());
        } else {
            candidates.addAll(Arrays.asList(raw.toString().split("[,;\\s]+")));
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String c : candidates) {
            String email = c == null ? "" : c.trim().toLowerCase();
            // Cheap shape check — a malformed entry would only produce a bounced send.
            if (email.length() > 3 && email.contains("@") && email.indexOf('@') < email.lastIndexOf('.')) {
                out.add(email);
            }
        }
        return new ArrayList<>(out);
    }

    /**
     * Accepts a list or a comma/semicolon separated string of admin numbers. Kept as entered apart
     * from stripping spaces, dashes and brackets — the WhatsApp providers each normalise the number
     * their own way, and rewriting it here (guessing a country code, say) would silently misroute
     * an alert. A leading + is preserved.
     */
    private List<String> normalizePhones(Object raw) {
        if (raw == null) return List.of();
        List<String> candidates = new ArrayList<>();
        if (raw instanceof Collection<?> collection) {
            for (Object o : collection) if (o != null) candidates.add(o.toString());
        } else {
            candidates.addAll(Arrays.asList(raw.toString().split("[,;]+")));
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String c : candidates) {
            if (c == null) continue;
            String phone = c.replaceAll("[\\s()\\-]", "").trim();
            // Digits only after an optional +, and long enough to be a real subscriber number.
            if (phone.matches("\\+?\\d{8,15}")) out.add(phone);
            else if (!phone.isEmpty()) log.warn("Ignoring malformed notification phone: {}", c);
        }
        return new ArrayList<>(out);
    }

    private Map<String, Object> parseSettings(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            log.debug("Unparseable chatbot flow settings: {}", e.getMessage());
            return null;
        }
    }
}
