package vacademy.io.notification_service.features.engagement_ledger.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.engagement_ledger.dto.LedgerBatchRequest;
import vacademy.io.notification_service.features.engagement_ledger.dto.LedgerBatchResponse;
import vacademy.io.notification_service.features.engagement_ledger.repository.EngagementContactRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository.EmailLedgerRow;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository.LatestBodyRow;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository.WhatsAppLedgerRow;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The Engagement Engine's read side of the notification ledger. Answers, per subject:
 * what did we send, was it delivered/read, did they reply, is the WhatsApp 24h window open,
 * and is the channel degrading (failure counts + last Meta error code).
 *
 * Batched by construction: a cohort of N subjects costs a fixed number of queries, not N.
 *
 * Signal availability (be honest with the model — see the observable flags):
 * - WhatsApp delivery/read: typed rows written by CombotWebhookService for META/COMBOT
 *   institutes. WATI status events flow through a different pipeline and are NOT visible here.
 * - WhatsApp replies: WHATSAPP_MESSAGE_INCOMING rows — visible for META/COMBOT.
 * - Email: sends only. Read/open state is not exposed (SES open tracking is per-institute
 *   opt-in with heuristic parent linkage); replies only if inbound email is enabled (off in
 *   prod today: aws.inbound.email.enabled=false).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementLedgerService {

    /** Body format written by CombotWebhookService.processMessageFailedFromWebhook: "Error: msg (code=131049)" */
    private static final Pattern FAILURE_CODE = Pattern.compile("code=([A-Za-z0-9_.-]+)\\)");
    private static final Duration WHATSAPP_REPLY_WINDOW = Duration.ofHours(24);

    private final NotificationLogRepository notificationLogRepository;
    private final InstituteInternalService instituteInternalService;
    private final EngagementContactRepository contactRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${aws.inbound.email.enabled:false}")
    private boolean inboundEmailEnabled;

    /**
     * Recent inbound WhatsApp replies since a cursor, for the engine's reply-ingestion sweep and
     * auto-reply. {@code text} is the FULL inbound message for rows written after the
     * WebhookEventProcessor REPLY-branch change (and always was on the Combot path) — the auto-reply
     * classifies money/anger on it, so do NOT re-truncate it at the read side. Legacy rows may still
     * carry the old 100-char preview; the responder escalates those rather than auto-answering.
     */
    public List<Map<String, Object>> inboundSince(String instituteId, Instant since) {
        return inboundSince(instituteId, since, false);
    }

    /**
     * {@link #inboundSince(String, Instant)}, plus inbound emails when {@code includeEmail} is set.
     * An email row carries channel=EMAIL, the sender's address, the subject and only the new part
     * of the reply (the quoted thread below it is cut, so our own earlier text is never read as
     * theirs). Its Message-ID goes in {@code wamid}, the key the engine dedups every reply on.
     */
    public List<Map<String, Object>> inboundSince(String instituteId, Instant since, boolean includeEmail) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new IllegalArgumentException("instituteId is required");
        }
        Instant cursor = since != null ? since : Instant.now().minus(Duration.ofMinutes(15));
        List<Map<String, Object>> out = new ArrayList<>();
        for (NotificationLogRepository.InboundReplyRow row :
                notificationLogRepository.findInboundRepliesSince(instituteId, cursor)) {
            Map<String, Object> m = new java.util.HashMap<>();
            m.put("channel", "WHATSAPP");
            m.put("phone", row.getChannelId());
            m.put("text", row.getBody());
            m.put("receivedAt", row.getReceivedAt() != null ? row.getReceivedAt().toInstant().toString() : null);
            m.put("wamid", row.getWamid());   // stable per-message id the auto-reply dedups on
            out.add(m);
        }
        if (includeEmail) {
            for (NotificationLogRepository.InboundEmailRow row :
                    notificationLogRepository.findInboundEmailsSince(instituteId, cursor)) {
                if (row.getMessageId() == null || row.getMessageId().isBlank() || row.getFromAddress() == null) {
                    continue; // no stable id or no sender: nothing the engine could dedup or match
                }
                Map<String, Object> m = new java.util.HashMap<>();
                m.put("channel", "EMAIL");
                m.put("email", row.getFromAddress().trim().toLowerCase(java.util.Locale.ROOT));
                m.put("subject", row.getSubject());
                m.put("text", EmailReplyText.newPart(payloadBody(row.getPayload())));
                m.put("receivedAt", row.getReceivedAt() != null ? row.getReceivedAt().toInstant().toString() : null);
                m.put("wamid", row.getMessageId());
                out.add(m);
            }
        }
        return out;
    }

    private String payloadBody(String payload) {
        if (payload == null || payload.isBlank()) return null;
        try {
            JsonNode body = objectMapper.readTree(payload).path("body");
            return body.isTextual() ? body.asText() : null;
        } catch (Exception e) {
            return null;
        }
    }

    public LedgerBatchResponse ledgerBatch(LedgerBatchRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().isBlank()) {
            throw new IllegalArgumentException("instituteId is required");
        }
        List<LedgerBatchRequest.Subject> subjects = request.getSubjects();
        if (subjects == null || subjects.isEmpty()) {
            return LedgerBatchResponse.builder().bySubject(Map.of()).build();
        }
        if (subjects.size() > LedgerBatchRequest.MAX_SUBJECTS) {
            throw new IllegalArgumentException("subjects exceeds max " + LedgerBatchRequest.MAX_SUBJECTS
                    + " (got " + subjects.size() + ") — page the cohort");
        }

        String instituteId = request.getInstituteId();
        int windowDays = request.getRecentWindowDays() != null && request.getRecentWindowDays() > 0
                ? request.getRecentWindowDays() : 7;
        Instant recentSince = Instant.now().minus(Duration.ofDays(windowDays));

        // Collect distinct identifiers. Phones are normalized to digits-only — the same
        // normalization UnifiedSendService.sanitizePhone applies at write time.
        LinkedHashSet<String> phones = new LinkedHashSet<>();
        LinkedHashSet<String> emails = new LinkedHashSet<>();
        for (LedgerBatchRequest.Subject s : subjects) {
            String phone = normalizePhone(s.getPhone());
            if (phone != null) phones.add(phone);
            String email = normalizeEmail(s.getEmail());
            if (email != null) emails.add(email);
        }

        // Fixed number of queries per cohort, regardless of cohort size.
        Map<String, WhatsAppLedgerRow> waByPhone = new HashMap<>();
        Map<String, LatestBodyRow> replyByPhone = new HashMap<>();
        Map<String, LatestBodyRow> failureByPhone = new HashMap<>();
        if (!phones.isEmpty()) {
            List<String> phoneList = new ArrayList<>(phones);
            for (WhatsAppLedgerRow row : notificationLogRepository
                    .aggregateWhatsAppLedger(instituteId, phoneList, recentSince)) {
                waByPhone.put(row.getChannelId(), row);
            }
            for (LatestBodyRow row : notificationLogRepository
                    .findLatestBodyPerChannel(instituteId, phoneList, "WHATSAPP_MESSAGE_INCOMING")) {
                replyByPhone.put(row.getChannelId(), row);
            }
            for (LatestBodyRow row : notificationLogRepository
                    .findLatestBodyPerChannel(instituteId, phoneList, "WHATSAPP_MESSAGE_FAILED")) {
                failureByPhone.put(row.getChannelId(), row);
            }
        }

        Map<String, EmailLedgerRow> emailByAddress = new HashMap<>();
        if (!emails.isEmpty()) {
            for (EmailLedgerRow row : notificationLogRepository
                    .aggregateEmailLedger(instituteId, new ArrayList<>(emails), recentSince)) {
                emailByAddress.put(row.getChannelId(), row);
            }
        }

        // WATI institutes: delivery/read/failure statuses flow through a DIFFERENT webhook
        // pipeline (WebhookEventProcessor) that writes untyped WHATSAPP_STATUS_EVENT rows the
        // aggregates above cannot see. Report those signals as unobservable rather than letting
        // the brain read permanent silence as "never delivered / never read". Inbound replies
        // are typed (WHATSAPP_MESSAGE_INCOMING) on both pipelines, so reply stays observable.
        Map<String, EngagementContactRepository.ContactRow> contactByChannel = new HashMap<>();
        Integer contactDays = request.getContactWindowDays();
        if (contactDays != null && contactDays > 0 && (!phones.isEmpty() || !emails.isEmpty())) {
            List<String> channels = new ArrayList<>(phones);
            channels.addAll(emails);
            for (EngagementContactRepository.ContactRow row : contactRepository.contactsSince(
                    instituteId, channels, Instant.now().minus(Duration.ofDays(contactDays)))) {
                contactByChannel.put(row.getChannelId(), row);
            }
        }
        boolean statusObservable = !"WATI".equals(resolveWhatsAppProvider(instituteId));

        Map<String, LedgerBatchResponse.SubjectLedger> bySubject = new HashMap<>();
        for (LedgerBatchRequest.Subject s : subjects) {
            if (s.getKey() == null || s.getKey().isBlank()) continue;
            String phone = normalizePhone(s.getPhone());
            String email = normalizeEmail(s.getEmail());
            bySubject.put(s.getKey(), LedgerBatchResponse.SubjectLedger.builder()
                    .whatsapp(phone == null ? null : buildWhatsAppLedger(
                            waByPhone.get(phone), replyByPhone.get(phone), failureByPhone.get(phone),
                            statusObservable))
                    .email(email == null ? null : buildEmailLedger(emailByAddress.get(email)))
                    .contact(contactDays != null && contactDays > 0
                            ? contact(contactByChannel.get(phone), contactByChannel.get(email)) : null)
                    .build());
        }

        return LedgerBatchResponse.builder().bySubject(bySubject).build();
    }

    /** Phone and email together: the limit is per person, whichever way they were reached (L10). */
    static LedgerBatchResponse.ContactLedger contact(EngagementContactRepository.ContactRow byPhone,
                                                     EngagementContactRepository.ContactRow byEmail) {
        long touches = 0;
        Instant lastHuman = null;
        for (EngagementContactRepository.ContactRow r : new EngagementContactRepository.ContactRow[]{byPhone, byEmail}) {
            if (r == null) continue;
            touches += r.getTouches() != null ? r.getTouches() : 0;
            if (r.getLastHumanSentAt() != null && (lastHuman == null || r.getLastHumanSentAt().isAfter(lastHuman))) {
                lastHuman = r.getLastHumanSentAt();
            }
        }
        return LedgerBatchResponse.ContactLedger.builder().touches(touches).lastHumanSentAt(lastHuman).build();
    }

    private LedgerBatchResponse.ChannelLedger buildWhatsAppLedger(WhatsAppLedgerRow agg,
                                                                  LatestBodyRow latestReply,
                                                                  LatestBodyRow latestFailure,
                                                                  boolean statusObservable) {
        Instant lastReplyAt = agg != null ? toInstant(agg.getLastReplyAt()) : null;
        return LedgerBatchResponse.ChannelLedger.builder()
                .lastSentAt(agg != null ? toInstant(agg.getLastSentAt()) : null)
                .lastDeliveredAt(agg != null ? toInstant(agg.getLastDeliveredAt()) : null)
                .lastReadAt(agg != null ? toInstant(agg.getLastReadAt()) : null)
                .lastReplyAt(lastReplyAt)
                .lastReplyText(latestReply != null ? latestReply.getBody() : null)
                .windowOpenUntil(lastReplyAt != null ? lastReplyAt.plus(WHATSAPP_REPLY_WINDOW) : null)
                .recentSends(agg != null && agg.getRecentSends() != null ? agg.getRecentSends() : 0L)
                .recentReads(agg != null && agg.getRecentReads() != null ? agg.getRecentReads() : 0L)
                .recentFailures(agg != null && agg.getRecentFailures() != null ? agg.getRecentFailures() : 0L)
                .lastFailureCode(latestFailure != null ? extractFailureCode(latestFailure.getBody()) : null)
                .observable(Map.of("delivery", statusObservable, "read", statusObservable, "reply", true))
                .build();
    }

    /**
     * Same settings walk WhatsAppService uses: setting.WHATSAPP_SETTING.data.UTILITY_WHATSAPP
     * .provider, defaulting to META. Fail-open to META (statuses observable) is deliberate:
     * a transient settings-fetch error must not flip signals to "unobservable" and back, which
     * would whipsaw the brain's interpretation of silence.
     */
    private String resolveWhatsAppProvider(String instituteId) {
        try {
            String setting = instituteInternalService.getInstituteByInstituteId(instituteId).getSetting();
            if (setting == null || setting.isEmpty()) return "META";
            JsonNode whatsappSetting = objectMapper.readTree(setting)
                    .path(NotificationConstants.SETTING)
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);
            return whatsappSetting.path(NotificationConstants.PROVIDER).asText("META").toUpperCase();
        } catch (Exception e) {
            log.warn("Could not resolve WhatsApp provider for institute {}: {}", instituteId, e.getMessage());
            return "META";
        }
    }

    private LedgerBatchResponse.ChannelLedger buildEmailLedger(EmailLedgerRow agg) {
        return LedgerBatchResponse.ChannelLedger.builder()
                .lastSentAt(agg != null ? toInstant(agg.getLastSentAt()) : null)
                .lastReplyAt(agg != null ? toInstant(agg.getLastReplyAt()) : null)
                .recentSends(agg != null && agg.getRecentSends() != null ? agg.getRecentSends() : 0L)
                .observable(Map.of("delivery", false, "read", false, "reply", inboundEmailEnabled))
                .build();
    }

    private static String extractFailureCode(String body) {
        if (body == null) return null;
        Matcher m = FAILURE_CODE.matcher(body);
        return m.find() ? m.group(1) : null;
    }

    private static String normalizePhone(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        return digits.isEmpty() ? null : digits;
    }

    private static String normalizeEmail(String email) {
        if (email == null) return null;
        // Lowercased on both sides: aggregateEmailLedger compares LOWER(channel_id) IN (:emails),
        // and INBOUND_EMAIL rows already store the parsed From address lowercased.
        String trimmed = email.trim().toLowerCase();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static Instant toInstant(Timestamp ts) {
        return ts != null ? ts.toInstant() : null;
    }
}
