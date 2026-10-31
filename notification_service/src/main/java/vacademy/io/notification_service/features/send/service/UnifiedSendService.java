package vacademy.io.notification_service.features.send.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.chatbot_flow.entity.NotificationTemplate;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.features.send.dto.SendBatchSummaryDTO;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.DeliveryStatusDTO;
import vacademy.io.notification_service.features.send.entity.SendBatch;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;
import vacademy.io.notification_service.service.EmailService;
import vacademy.io.notification_service.features.notification_log.MessageOriginPayload;
import vacademy.io.notification_service.service.WhatsAppService;
import vacademy.io.common.logging.SentryLogger;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class UnifiedSendService implements SendChannelRouter {

    private final WhatsAppService whatsAppService;
    private final EmailService emailService;
    private final PushNotificationService pushNotificationService;
    private final SendBatchRepository sendBatchRepository;
    private final ObjectMapper objectMapper;
    private final BatchProcessorService batchProcessorService;
    private final NotificationTemplateRepository notificationTemplateRepository;
    private final UserAnnouncementPreferenceService userAnnouncementPreferenceService;
    private final EmailCcResolver emailCcResolver;
    private final NotificationLogRepository notificationLogRepository;

    private static final int SYNC_THRESHOLD = 100;

    @PostConstruct
    public void init() {
        // Wire ourselves into BatchProcessorService to break circular dependency
        batchProcessorService.setChannelRouter(this);
    }

    /**
     * Main entry point. Routes by channel, decides sync vs async based on recipient count.
     */
    public UnifiedSendResponse send(UnifiedSendRequest request) {
        validateRequest(request);

        int recipientCount = request.getRecipients().size();

        // forceAsync: bulk callers opt into the durable batch queue even under the
        // threshold — a sync multi-recipient loop can exceed the caller's HTTP read
        // timeout while delivery keeps running here (caller sees a spurious failure).
        boolean forceAsync = Boolean.TRUE.equals(request.getForceAsync()) && recipientCount > 1;

        if (recipientCount <= SYNC_THRESHOLD && !forceAsync) {
            return routeSync(request);
        }

        return queueForAsync(request);
    }

    @Override
    public UnifiedSendResponse routeSync(UnifiedSendRequest request) {
        String channel = request.getChannel().toUpperCase();

        switch (channel) {
            case "WHATSAPP":
                return sendWhatsApp(request);
            case "EMAIL":
                return sendEmail(request);
            case "PUSH":
                return sendPush(request);
            case "SYSTEM_ALERT":
                return sendSystemAlert(request);
            default:
                throw new IllegalArgumentException("Unsupported channel: " + channel);
        }
    }

    // ==================== Attribution gating ====================

    /**
     * The correlation/attribution contract (options.source → notification_log.source,
     * options.sourceId → correlation_id, per-recipient userId on email rows) is live for
     * Engagement Engine sends only. Other callers (announcements, campaigns) already write
     * their own per-recipient log rows keyed on the legacy source values — threading their
     * options through would change those rows' values and double-attribute per-user views.
     */
    public static final String ENGAGEMENT_ENGINE_SOURCE = "ENGAGEMENT_ENGINE";
    /** SendOptions.source set by EmailInboxService.sendReply; logged as-is so replies are distinguishable from campaigns. */
    public static final String INBOX_REPLY_SOURCE = "EMAIL_INBOX";
    /**
     * notification_log.source of the SMTP row for every other plain (non-engine, non-inbox) send —
     * including an announcement's real HTML send. EmailThreadMerger pairs announcement rows only
     * with rows carrying this source.
     */
    public static final String PLAIN_LOG_SOURCE = "unified-send";

    /** Source written on the SMTP notification_log row for a plain send — see {@link #PLAIN_LOG_SOURCE}. */
    static String plainLogSource(String optsSource) {
        return INBOX_REPLY_SOURCE.equals(optsSource) ? INBOX_REPLY_SOURCE : PLAIN_LOG_SOURCE;
    }

    private boolean isEngagementEngineSend(UnifiedSendRequest request) {
        return request.getOptions() != null
                && ENGAGEMENT_ENGINE_SOURCE.equals(request.getOptions().getSource());
    }

    // ==================== WhatsApp ====================

    private UnifiedSendResponse sendWhatsApp(UnifiedSendRequest request) {
        List<UnifiedSendResponse.RecipientResult> results = new ArrayList<>();

        Optional<NotificationTemplate> storedTemplate = findWhatsAppTemplate(
                request.getInstituteId(), request.getTemplateName(),
                request.getLanguageCode() != null ? request.getLanguageCode() : "en");

        // Phase 3: Resolve named variables → positional using stored template
        Map<String, Integer> nameToPosition = resolveTemplateVariablePositions(storedTemplate);
        // {{n}} count of the approved body; WhatsAppService drops undeclared params on the Meta path.
        Integer declaredBodyParams = storedTemplate
                .map(t -> WhatsAppService.countBodyPlaceholders(t.getBodyText())).orElse(null);

        // A template approved with a media header (IMAGE/VIDEO/DOCUMENT) must be sent WITH that
        // header component — Meta rejects the message otherwise: #132012 "header: Format
        // mismatch, expected DOCUMENT, received UNKNOWN". Callers that only know the template
        // name (the Inbox composer, automations, chatbot hand-offs) carry no file, so the sample
        // the template was approved with is the default. An explicit options/_headerUrl still wins.
        String templateHeaderType = storedTemplate.map(UnifiedSendService::mediaHeaderType).orElse(null);
        String templateHeaderUrl = templateHeaderType != null
                ? httpUrlOrNull(storedTemplate.get().getHeaderSampleUrl()) : null;
        String requestHeaderType = request.getOptions() != null
                ? blankToNull(request.getOptions().getHeaderType()) : null;
        String headerType = requestHeaderType != null ? requestHeaderType : templateHeaderType;

        List<Map<String, Map<String, String>>> bodyParams = new ArrayList<>();
        Map<String, Map<String, String>> headerParams = new HashMap<>();
        Map<String, String> headerVideoParams = new HashMap<>();
        Map<String, String> buttonUrlParams = new HashMap<>();

        for (UnifiedSendRequest.Recipient r : request.getRecipients()) {
            String phone = sanitizePhone(r.getPhone());
            if (phone == null || phone.isEmpty()) {
                results.add(UnifiedSendResponse.RecipientResult.builder()
                        .phone(r.getPhone()).success(false)
                        .status("FAILED").error("Missing phone number").build());
                // Layer 4: phone was null/empty after sanitization — log to Sentry so we can track data quality issues
                SentryLogger.logWarning("WhatsApp send skipped: missing or unsanitizable phone number",
                        Map.of(
                                "template.name", request.getTemplateName() != null ? request.getTemplateName() : "unknown",
                                "institute.id", request.getInstituteId() != null ? request.getInstituteId() : "unknown",
                                "user.id", r.getUserId() != null ? r.getUserId() : "unknown",
                                "raw.phone", r.getPhone() != null ? r.getPhone() : "null",
                                "layer", "4-unified-send"
                        ));
                continue;
            }

            // Check if user has unsubscribed from WhatsApp
            if (r.getUserId() != null) {
                try {
                    if (userAnnouncementPreferenceService.isWhatsAppUnsubscribed(
                            r.getUserId(), request.getInstituteId(), phone)) {
                        log.info("Skipping WhatsApp to user {} ({}): unsubscribed", r.getUserId(), phone);
                        results.add(UnifiedSendResponse.RecipientResult.builder()
                                .phone(phone).success(false)
                                .status("SKIPPED_UNSUBSCRIBED")
                                .error("User unsubscribed from WhatsApp notifications")
                                .build());
                        continue;
                    }
                } catch (Exception ex) {
                    log.warn("Failed to check WhatsApp unsubscribe preference for user {}: {}", r.getUserId(), ex.getMessage());
                }
            }

            // Canonical aliases, restricted to names the template actually declares a
            // position for — WhatsApp params go to the provider verbatim, so we must not
            // pad the payload with a dozen unused spellings.
            Map<String, String> vars = UnifiedVariableAliases.expandForTemplate(
                    r.getVariables(), nameToPosition);

            // Convert named vars to positional if we have the template mapping
            Map<String, String> resolvedVars;
            if (!nameToPosition.isEmpty()) {
                resolvedVars = new HashMap<>();
                for (Map.Entry<String, String> entry : vars.entrySet()) {
                    Integer pos = nameToPosition.get(entry.getKey());
                    if (pos != null) {
                        resolvedVars.put(String.valueOf(pos), entry.getValue());
                    } else {
                        // Keep as-is if no mapping found (might be positional already)
                        resolvedVars.put(entry.getKey(), entry.getValue());
                    }
                }
            } else {
                resolvedVars = new HashMap<>(vars); // Copy to avoid mutating original
            }

            Map<String, Map<String, String>> userMap = new HashMap<>();
            userMap.put(phone, resolvedVars);
            bodyParams.add(userMap);

            // Header params (image/video/document) — per-recipient variable, then global options,
            // then the file the template was approved with.
            String headerUrl = null;
            if (r.getVariables() != null && r.getVariables().containsKey("_headerUrl")) {
                headerUrl = blankToNull(r.getVariables().get("_headerUrl"));
            }
            if (headerUrl == null && request.getOptions() != null) {
                headerUrl = blankToNull(request.getOptions().getHeaderUrl());
            }
            if (headerUrl == null) {
                headerUrl = templateHeaderUrl;
            }

            if (headerUrl != null) {
                if ("video".equalsIgnoreCase(headerType)) {
                    headerVideoParams.put(phone, headerUrl);
                } else {
                    headerParams.put(phone, Map.of("link", headerUrl));
                }
                // Inject into resolvedVars so WATI bulk path can read them
                resolvedVars.put("_headerUrl", headerUrl);
                if (headerType != null) resolvedVars.put("_headerType", headerType);
            }

            // Fix #2: Per-recipient button URL params from variables
            String btnUrl = null;
            if (r.getVariables() != null && r.getVariables().containsKey("_buttonUrl")) {
                btnUrl = r.getVariables().get("_buttonUrl");
            } else if (request.getOptions() != null && request.getOptions().getButtonUrlParams() != null) {
                btnUrl = request.getOptions().getButtonUrlParams().values().stream()
                        .findFirst().orElse(null);
            }
            if (btnUrl != null) {
                buttonUrlParams.put(phone, btnUrl);
                resolvedVars.put("_buttonUrl", btnUrl);
                // Preserve _buttonIndex for later extraction
                if (r.getVariables() != null && r.getVariables().containsKey("_buttonIndex")) {
                    resolvedVars.put("_buttonIndex", r.getVariables().get("_buttonIndex"));
                }
            }

            // Who is sending (e.g. a workflow), for the Inbox / timeline — lifted onto the log
            // payload by WhatsAppService and never sent to the provider (both skip "_" params).
            if (request.getOptions() != null) {
                MessageOriginPayload.putOnParams(resolvedVars, request.getOptions().getOriginType(),
                        request.getOptions().getOriginId(), request.getOptions().getOriginName());
            }
        }

        if (bodyParams.isEmpty()) {
            return UnifiedSendResponse.builder()
                    .total(request.getRecipients().size())
                    .accepted(0).failed(results.size())
                    .status("COMPLETED").results(results).build();
        }

        try {
            String langCode = request.getLanguageCode() != null ? request.getLanguageCode() : "en";

            // Build buttonIndexParams: read from _buttonIndex variable, default to "0"
            Map<String, String> buttonIndexParams = new HashMap<>();
            for (UnifiedSendRequest.Recipient r2 : request.getRecipients()) {
                String p = sanitizePhone(r2.getPhone());
                if (p != null && buttonUrlParams.containsKey(p)) {
                    String idx = (r2.getVariables() != null) ? r2.getVariables().get("_buttonIndex") : null;
                    buttonIndexParams.put(p, idx != null ? idx : "0");
                }
            }

            List<WhatsAppService.WhatsAppSendResult> waResults = whatsAppService.sendWhatsappMessagesDetailed(
                    request.getTemplateName(),
                    bodyParams,
                    headerParams.isEmpty() ? null : headerParams,
                    headerVideoParams.isEmpty() ? null : headerVideoParams,
                    buttonUrlParams.isEmpty() ? null : buttonUrlParams,
                    buttonIndexParams.isEmpty() ? null : buttonIndexParams,
                    langCode,
                    headerType,
                    request.getInstituteId(),
                    // Attribution (→ notification_log.source / correlation_id) is threaded for
                    // ENGAGEMENT_ENGINE sends ONLY: the engine stamps sourceId=action_id so its
                    // ledger joins reads/replies back to the exact decision. Every other caller
                    // (announcements, campaigns) keeps its legacy row values byte-identical —
                    // announcement stats/timeline consumers key on the old source strings.
                    isEngagementEngineSend(request) ? request.getOptions().getSource() : null,
                    isEngagementEngineSend(request) ? request.getOptions().getSourceId() : null,
                    declaredBodyParams);

            if (waResults != null) {
                for (WhatsAppService.WhatsAppSendResult r : waResults) {
                    // Carry the provider's rejection reason through to the caller. Previously
                    // this collapsed to a bare false and every failure surfaced as error:null,
                    // making WhatsApp failures undiagnosable from the API response alone.
                    results.add(UnifiedSendResponse.RecipientResult.builder()
                            .phone(r.phone())
                            .success(r.success())
                            .status(r.success() ? "SENT" : "FAILED")
                            .error(r.success() ? null : r.error())
                            // The wamid, so the caller can follow up on what the provider actually
                            // did with the message — "accepted" is all this response can ever mean.
                            .messageId(r.messageId())
                            .build());
                }
            }
        } catch (Exception e) {
            log.error("WhatsApp send failed for institute {}: {}", request.getInstituteId(), e.getMessage(), e);
            SentryLogger.logError(e, "WhatsApp send failed in UnifiedSendService",
                    Map.of(
                            "template.name", request.getTemplateName() != null ? request.getTemplateName() : "unknown",
                            "institute.id", request.getInstituteId() != null ? request.getInstituteId() : "unknown",
                            "recipient.count", String.valueOf(bodyParams.size()),
                            "layer", "4-unified-send"
                    ));
            for (Map<String, Map<String, String>> userMap : bodyParams) {
                for (String phone : userMap.keySet()) {
                    results.add(UnifiedSendResponse.RecipientResult.builder()
                            .phone(phone).success(false)
                            .status("FAILED").error(e.getMessage()).build());
                }
            }
        }

        int sent = (int) results.stream().filter(UnifiedSendResponse.RecipientResult::isSuccess).count();
        int failed = results.size() - sent;

        return UnifiedSendResponse.builder()
                .total(results.size()).accepted(sent).failed(failed)
                .status(failed == 0 ? "COMPLETED" : "PARTIAL")
                .results(results).build();
    }

    // ==================== Email ====================

    private UnifiedSendResponse sendEmail(UnifiedSendRequest request) {
        List<UnifiedSendResponse.RecipientResult> results = new ArrayList<>();
        UnifiedSendRequest.SendOptions opts = request.getOptions() != null
                ? request.getOptions()
                : UnifiedSendRequest.SendOptions.builder().build();

        // Resolve email template if templateName is provided (look up from notification_template)
        String templateSubject = opts.getEmailSubject();
        String templateBody = opts.getEmailBody();
        String previewText = opts.getPreviewText();

        if (request.getTemplateName() != null && !request.getTemplateName().isEmpty()) {
            try {
                Optional<NotificationTemplate> templateOpt = notificationTemplateRepository
                        .findByInstituteIdAndNameAndChannelType(
                                request.getInstituteId(), request.getTemplateName(), "EMAIL");
                if (templateOpt.isPresent()) {
                    NotificationTemplate tmpl = templateOpt.get();
                    // Only override subject/body from template if NOT already provided via SendOptions
                    if (templateSubject == null && tmpl.getSubject() != null) templateSubject = tmpl.getSubject();
                    if (templateBody == null && tmpl.getContent() != null) templateBody = tmpl.getContent();
                    // Read previewText from template's settingJson
                    if (previewText == null && tmpl.getSettingJson() != null) {
                        try {
                            Object settingObj = tmpl.getSettingJson();
                            if (settingObj instanceof Map) {
                                Object pt = ((Map<?, ?>) settingObj).get("previewText");
                                if (pt != null) previewText = pt.toString();
                            } else if (settingObj instanceof String) {
                                Map<String, Object> settings = objectMapper.readValue((String) settingObj, Map.class);
                                Object pt = settings.get("previewText");
                                if (pt != null) previewText = pt.toString();
                            }
                        } catch (Exception ex) {
                            log.debug("Could not parse previewText from settingJson: {}", ex.getMessage());
                        }
                    }
                    log.debug("Resolved email template '{}' for institute {}",
                            request.getTemplateName(), request.getInstituteId());
                } else {
                    log.warn("Email template '{}' not found for institute {}, using options",
                            request.getTemplateName(), request.getInstituteId());
                }
            } catch (Exception e) {
                log.warn("Failed to resolve email template '{}': {}", request.getTemplateName(), e.getMessage());
            }
        }

        // Inject preview text as hidden div at the start of the email body
        log.info("Preview text for email: '{}' (null={})", previewText, previewText == null);
        if (previewText != null && !previewText.isEmpty() && templateBody != null) {
            // HTML-escape to prevent XSS injection
            String safeText = previewText
                    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    .replace("\"", "&quot;").replace("'", "&#39;");
            // Gmail/Outlook need whitespace padding after the text to prevent them
            // from pulling visible body content into the preview area.
            // &#847; (combining grapheme joiner) is invisible and fills the space.
            StringBuilder padding = new StringBuilder();
            for (int i = 0; i < 100; i++) {
                padding.append("&#847; &#8199; &#65279; ");
            }
            String previewHtml = "<div style=\"display:none;font-size:1px;color:#ffffff;line-height:1px;"
                    + "max-height:0px;max-width:0px;opacity:0;overflow:hidden;\">"
                    + safeText + padding + "</div>";
            // Insert after <body> tag if present, otherwise prepend
            if (templateBody.toLowerCase().contains("<body")) {
                // quoteReplacement prevents $1/$2 in preview text from corrupting the regex replacement
                String escaped = java.util.regex.Matcher.quoteReplacement(previewHtml);
                templateBody = templateBody.replaceFirst("(?i)(<body[^>]*>)", "$1" + escaped);
                log.info("Injected preview text after <body> tag");
            } else {
                templateBody = previewHtml + templateBody;
                log.info("Prepended preview text to email body");
            }
        }

        // Resolve emailType and fromAddress ONCE before the loop (same for all recipients in a batch)
        String emailType = opts.getEmailType() != null ? opts.getEmailType() : "UTILITY_EMAIL";
        String fromForUnsubCheck = null;
        if (request.getInstituteId() != null) {
            try {
                fromForUnsubCheck = opts.getFromEmail();
                if (fromForUnsubCheck == null || fromForUnsubCheck.isBlank()) {
                    fromForUnsubCheck = emailService.resolveFromEmailAddress(request.getInstituteId(), emailType);
                }
            } catch (Exception ex) {
                log.warn("Failed to resolve from address for unsubscribe check: {}", ex.getMessage());
            }
        }

        // Resolve copy (CC/BCC) recipients ONCE before the loop — this hits the settings table,
        // so resolving per-recipient would issue one query per learner on a bulk blast.
        // An explicit opts.cc overrides the institute config for this single send.
        List<String> copyRecipients = List.of();
        String copyMode = "BCC";
        if (opts.getCc() != null && !opts.getCc().isEmpty()) {
            copyRecipients = opts.getCc();
            copyMode = "CC".equalsIgnoreCase(opts.getCcMode()) ? "CC" : "BCC";
        } else {
            EmailCcResolver.CopyRecipients resolved =
                    emailCcResolver.resolve(request.getInstituteId(), opts.getSource());
            if (!resolved.isEmpty()) {
                copyRecipients = resolved.cc();
                copyMode = resolved.mode();
            }
        }
        final List<String> finalCopyRecipients = copyRecipients;
        final String finalCopyMode = copyMode;

        // Logged source for plain (non-engine) sends. An ALLOWLIST, not a pass-through of
        // opts.source: EmailTrackingService lets users filter EMAIL rows by source, and announcement
        // sends already log their own 'announcement-service' row - passing every caller's source
        // through would double-count campaigns there. Only inbox replies need to be told apart.
        final String plainLogSource = plainLogSource(opts.getSource());

        // Optional rate limiting for bulk sends (e.g., announcements)
        com.google.common.util.concurrent.RateLimiter rateLimiter = null;
        if (opts.getRateLimitPerSecond() != null && opts.getRateLimitPerSecond() > 0) {
            rateLimiter = com.google.common.util.concurrent.RateLimiter.create(opts.getRateLimitPerSecond());
            log.info("Email rate limiting enabled: {} emails/sec", opts.getRateLimitPerSecond());
        }

        for (UnifiedSendRequest.Recipient r : request.getRecipients()) {
            String email = r.getEmail();
            if (email == null || email.isEmpty()) {
                results.add(UnifiedSendResponse.RecipientResult.builder()
                        .email(email).success(false)
                        .status("FAILED").error("Missing email").build());
                continue;
            }

            // Rate limit if configured
            if (rateLimiter != null) {
                rateLimiter.acquire();
            }

            try {
                String subject = templateSubject != null ? templateSubject : "Notification";
                String body = templateBody != null ? templateBody : "";

                // Expand the caller's variables over the canonical alias set before
                // substituting, so a template written against {{name}} still renders when
                // the caller supplied fullName/parentName (and vice versa). Callers'
                // explicit keys always win; this only adds the spellings they omitted.
                Map<String, String> vars = UnifiedVariableAliases.expand(r.getVariables());
                for (Map.Entry<String, String> var : vars.entrySet()) {
                    String placeholder = "{{" + var.getKey() + "}}";
                    String value = var.getValue() != null ? var.getValue() : "";
                    subject = subject.replace(placeholder, value);
                    body = body.replace(placeholder, value);
                }
                // Safety net: a placeholder nobody resolved must not reach a recipient as
                // literal "{{first_name}}". Drop it (and a dangling ", " after a greeting).
                subject = scrubUnresolved(subject);
                body = scrubUnresolved(body);

                // Check if user has unsubscribed from this email sender.
                // Only check when we have a valid UUID userId (not null, not an email address).
                // Callers that pass email-as-userId or null userId will skip this check;
                // the downstream EmailService.isEmailBlocked() still catches bounced emails.
                String userId = r.getUserId();
                if (userId != null && !userId.contains("@") && request.getInstituteId() != null && fromForUnsubCheck != null) {
                    try {
                        if (userAnnouncementPreferenceService.isEmailSenderUnsubscribed(
                                userId, request.getInstituteId(), emailType, fromForUnsubCheck)) {
                            log.info("Skipping email to user {} ({}): unsubscribed from {} ({})",
                                    userId, email, fromForUnsubCheck, emailType);
                            results.add(UnifiedSendResponse.RecipientResult.builder()
                                    .email(email).success(false)
                                    .status("SKIPPED_UNSUBSCRIBED")
                                    .error("User unsubscribed from emails sent by " + fromForUnsubCheck + " (" + emailType + ")")
                                    .build());
                            continue;
                        }
                    } catch (Exception ex) {
                        log.warn("Failed to check unsubscribe preference for user {}: {}", userId, ex.getMessage());
                    }
                }

                // Check for attachments
                EmailService.SendOutcome outcome = EmailService.SendOutcome.SENT;
                if (r.getAttachments() != null && !r.getAttachments().isEmpty()) {
                    Map<String, byte[]> attachmentMap = new HashMap<>();
                    for (UnifiedSendRequest.Attachment att : r.getAttachments()) {
                        if (att.getFilename() != null && att.getContentBase64() != null) {
                            attachmentMap.put(att.getFilename(),
                                    java.util.Base64.getDecoder().decode(att.getContentBase64()));
                        }
                    }
                    emailService.sendAttachmentEmail(email, subject, plainLogSource, body,
                            attachmentMap, request.getInstituteId(), emailType,
                            finalCopyRecipients, finalCopyMode);
                } else if (isEngagementEngineSend(request)) {
                    // Engine sends carry attribution: source → notification_log.source,
                    // sourceId → correlation_id (action id), userId → user attribution
                    // (guard against callers that pass an email address as userId).
                    outcome = emailService.sendHtmlEmail(email, subject,
                            ENGAGEMENT_ENGINE_SOURCE, body,
                            request.getInstituteId(), opts.getFromEmail(), opts.getFromName(), emailType,
                            opts.getSourceId(),
                            userId != null && !userId.contains("@") ? userId : null,
                            finalCopyRecipients, finalCopyMode);
                } else {
                    outcome = emailService.sendHtmlEmail(email, subject, plainLogSource, body,
                            request.getInstituteId(), opts.getFromEmail(), opts.getFromName(), emailType,
                            null, null, finalCopyRecipients, finalCopyMode);
                }

                // Sending controls decide the final status: an over-cap send is queued (still a
                // success from the caller's point of view), an opt-out or bounce is a skip.
                switch (outcome) {
                    case DEFERRED -> results.add(UnifiedSendResponse.RecipientResult.builder()
                            .email(email).success(true).status("DEFERRED")
                            .error("Daily cap reached for this sender - queued for the next window").build());
                    case SKIPPED_UNSUBSCRIBED -> results.add(UnifiedSendResponse.RecipientResult.builder()
                            .email(email).success(false).status("SKIPPED_UNSUBSCRIBED")
                            .error("Recipient unsubscribed from this institute's emails").build());
                    case SKIPPED_BLOCKED -> results.add(UnifiedSendResponse.RecipientResult.builder()
                            .email(email).success(false).status("SKIPPED_BLOCKED")
                            .error("Recipient address is blocklisted (bounced)").build());
                    default -> results.add(UnifiedSendResponse.RecipientResult.builder()
                            .email(email).success(true).status("SENT").build());
                }
            } catch (Exception e) {
                String errorMsg = e.getMessage() != null ? e.getMessage() : "Unknown error";

                // Retry-friendly: detect SES throttling errors
                if (errorMsg.contains("Throttling") || errorMsg.contains("Rate") || errorMsg.contains("limit")) {
                    log.warn("Email rate limit hit for {}: {} — marking as QUEUED for retry", email, errorMsg);
                    results.add(UnifiedSendResponse.RecipientResult.builder()
                            .email(email).success(false)
                            .status("QUEUED").error("Rate limited - retry later").build());
                } else {
                    log.error("Email send failed for {}: {}", email, errorMsg);
                    results.add(UnifiedSendResponse.RecipientResult.builder()
                            .email(email).success(false)
                            .status("FAILED").error(errorMsg).build());
                }
            }
        }

        int sent = (int) results.stream().filter(UnifiedSendResponse.RecipientResult::isSuccess).count();
        return UnifiedSendResponse.builder()
                .total(results.size()).accepted(sent).failed(results.size() - sent)
                .status(sent == results.size() ? "COMPLETED" : "PARTIAL")
                .results(results).build();
    }

    // ==================== Push Notification (wired) ====================

    private UnifiedSendResponse sendPush(UnifiedSendRequest request) {
        List<String> userIds = request.getRecipients().stream()
                .map(UnifiedSendRequest.Recipient::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        if (userIds.isEmpty()) {
            return UnifiedSendResponse.builder()
                    .total(0).accepted(0).failed(0)
                    .status("COMPLETED").results(List.of()).build();
        }

        UnifiedSendRequest.SendOptions opts = request.getOptions() != null
                ? request.getOptions()
                : UnifiedSendRequest.SendOptions.builder().build();

        String title = opts.getPushTitle() != null ? opts.getPushTitle() : "Notification";
        String body = opts.getPushBody() != null ? opts.getPushBody() : "";
        Map<String, String> data = opts.getPushData() != null ? opts.getPushData() : Map.of();

        try {
            pushNotificationService.sendNotificationToUsers(
                    request.getInstituteId(), userIds, title, body, data);

            return UnifiedSendResponse.builder()
                    .total(userIds.size()).accepted(userIds.size()).failed(0)
                    .status("COMPLETED").build();
        } catch (Exception e) {
            log.error("Push notification failed for institute {}: {}",
                    request.getInstituteId(), e.getMessage(), e);
            return UnifiedSendResponse.builder()
                    .total(userIds.size()).accepted(0).failed(userIds.size())
                    .status("FAILED").build();
        }
    }

    // ==================== System Alert (wired) ====================

    private UnifiedSendResponse sendSystemAlert(UnifiedSendRequest request) {
        UnifiedSendRequest.SendOptions opts = request.getOptions() != null
                ? request.getOptions()
                : UnifiedSendRequest.SendOptions.builder().build();

        String title = opts.getPushTitle() != null ? opts.getPushTitle() : "Alert";
        String body = opts.getPushBody() != null ? opts.getPushBody() : "";

        // System alerts use push infrastructure with SYSTEM_ALERT data flag
        List<String> userIds = request.getRecipients().stream()
                .map(UnifiedSendRequest.Recipient::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        if (userIds.isEmpty()) {
            return UnifiedSendResponse.builder()
                    .total(0).accepted(0).failed(0)
                    .status("COMPLETED").results(List.of()).build();
        }

        try {
            Map<String, String> alertData = new HashMap<>(
                    opts.getPushData() != null ? opts.getPushData() : Map.of());
            alertData.put("type", "SYSTEM_ALERT");

            pushNotificationService.sendNotificationToUsers(
                    request.getInstituteId(), userIds, title, body, alertData);

            return UnifiedSendResponse.builder()
                    .total(userIds.size()).accepted(userIds.size()).failed(0)
                    .status("COMPLETED").build();
        } catch (Exception e) {
            log.error("System alert failed for institute {}: {}",
                    request.getInstituteId(), e.getMessage(), e);
            return UnifiedSendResponse.builder()
                    .total(userIds.size()).accepted(0).failed(userIds.size())
                    .status("FAILED").build();
        }
    }

    // ==================== Async Batch (delegates to BatchProcessorService) ====================

    private UnifiedSendResponse queueForAsync(UnifiedSendRequest request) {
        String batchId = UUID.randomUUID().toString();

        try {
            SendBatch batch = SendBatch.builder()
                    .id(batchId)
                    .instituteId(request.getInstituteId())
                    .channel(request.getChannel().toUpperCase())
                    .templateName(request.getTemplateName())
                    .totalRecipients(request.getRecipients().size())
                    .sentCount(0).failedCount(0)
                    .status("QUEUED")
                    .requestPayload(objectMapper.writeValueAsString(request))
                    .source(request.getOptions() != null ? request.getOptions().getSource() : null)
                    .build();

            sendBatchRepository.save(batch);

            // Async via separate bean — Spring proxy works correctly
            batchProcessorService.processAsyncBatch(batchId);

            return UnifiedSendResponse.builder()
                    .batchId(batchId)
                    .total(request.getRecipients().size())
                    .accepted(request.getRecipients().size())
                    .failed(0)
                    .status("PROCESSING")
                    .build();

        } catch (Exception e) {
            log.error("Failed to queue batch: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to queue batch: " + e.getMessage());
        }
    }

    private static final java.util.regex.Pattern UNRESOLVED = java.util.regex.Pattern.compile("\\{\\{\\s*[\\w.\\-]+\\s*\\}\\}");

    /** Remove any {{placeholder}} left after substitution, tidying "Hi {{x}}," → "Hi,". */
    static String scrubUnresolved(String text) {
        if (text == null || text.indexOf("{{") < 0) return text;
        String out = UNRESOLVED.matcher(text).replaceAll("");
        return out.replaceAll("(?i)(\\b(hi|hello|hey|dear)) ,", "$1,").replaceAll("  +", " ");
    }

    public UnifiedSendResponse getBatchStatus(String batchId) {
        SendBatch batch = sendBatchRepository.findById(batchId)
                .orElseThrow(() -> new RuntimeException("Batch not found: " + batchId));

        return UnifiedSendResponse.builder()
                .batchId(batch.getId())
                .total(batch.getTotalRecipients())
                .accepted(batch.getSentCount())
                .failed(batch.getFailedCount())
                .status(batch.getStatus())
                .build();
    }

    /**
     * The provider's verdict on messages this caller already sent, keyed by wamid.
     * <p>
     * The send response deliberately cannot answer this: it returns the moment the provider accepts
     * the message, and acceptance is not delivery — an accepted WhatsApp message is regularly
     * rejected a second later (131042 payment issue, 131049 marketing cap, 131026 undeliverable).
     * Every id that has no verdict yet comes back PENDING rather than being omitted, so a caller
     * polling this can tell "still waiting" apart from "never sent".
     */
    public List<DeliveryStatusDTO> getDeliveryStatus(List<String> messageIds) {
        if (messageIds == null || messageIds.isEmpty()) {
            return List.of();
        }

        Map<String, NotificationLogRepository.DeliveryStatusRow> byId = new HashMap<>();
        for (NotificationLogRepository.DeliveryStatusRow row :
                notificationLogRepository.findDeliveryStatusByProviderMessageIds(
                        messageIds.toArray(new String[0]))) {
            byId.put(row.getMessageId(), row);
        }

        List<DeliveryStatusDTO> statuses = new ArrayList<>(messageIds.size());
        for (String messageId : messageIds) {
            NotificationLogRepository.DeliveryStatusRow row = byId.get(messageId);
            String status = (row != null && row.getDeliveryStatus() != null)
                    ? row.getDeliveryStatus() : "PENDING";
            statuses.add(DeliveryStatusDTO.builder()
                    .messageId(messageId)
                    .status(status)
                    .errorCode(row != null ? row.getErrorCode() : null)
                    .errorMessage(row != null ? row.getErrorMessage() : null)
                    .reportedAt(row != null && row.getReportedAt() != null
                            ? row.getReportedAt().toInstant() : null)
                    // READ and FAILED are terminal. DELIVERED can still become READ, so a caller
                    // that stops polling on DELIVERED simply stops early — it is never shown a
                    // verdict that later turns out to be wrong.
                    .settled("FAILED".equals(status) || "READ".equals(status))
                    .build());
        }
        return statuses;
    }

    public List<SendBatchSummaryDTO> listBatches(String instituteId, int limit) {
        return sendBatchRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                .limit(limit)
                .map(b -> SendBatchSummaryDTO.builder()
                        .id(b.getId())
                        .channel(b.getChannel())
                        .templateName(b.getTemplateName())
                        .totalRecipients(b.getTotalRecipients())
                        .sentCount(b.getSentCount())
                        .failedCount(b.getFailedCount())
                        .status(b.getStatus())
                        .source(b.getSource())
                        .createdAt(b.getCreatedAt())
                        .completedAt(b.getCompletedAt())
                        .build())
                .collect(Collectors.toList());
    }

    // ==================== Phase 3: Named → Positional Variable Resolution ====================

    /**
     * The stored copy of the WhatsApp template being sent, if we have one. Empty when the caller
     * gave no name, or the template was never synced/created here — a send still goes out then,
     * exactly as the caller shaped it.
     */
    private Optional<NotificationTemplate> findWhatsAppTemplate(
            String instituteId, String templateName, String language) {
        if (templateName == null || instituteId == null) return Optional.empty();
        try {
            return notificationTemplateRepository
                    .findByInstituteIdAndNameAndLanguage(instituteId, templateName, language);
        } catch (Exception e) {
            log.warn("Failed to load template {} for institute {}: {}", templateName, instituteId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * The template's header kind in the form the provider payload uses ("image" / "video" /
     * "document"), or null for TEXT / NONE headers, which need no file.
     */
    static String mediaHeaderType(NotificationTemplate template) {
        String raw = template.getHeaderType();
        if (raw == null) return null;
        switch (raw.trim().toUpperCase()) {
            case "IMAGE": return "image";
            case "VIDEO": return "video";
            case "DOCUMENT": return "document";
            default: return null;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /**
     * The template's saved sample only qualifies as a header fallback when it is something the
     * provider can actually fetch. A few draft rows hold pasted HTML in that column; handing that
     * to Meta as a "link" would just swap one rejection for another.
     */
    private static String httpUrlOrNull(String value) {
        String url = blankToNull(value);
        if (url == null) return null;
        String lower = url.toLowerCase();
        return lower.startsWith("https://") || lower.startsWith("http://") ? url : null;
    }

    /**
     * Builds the mapping variable name → positional index from the stored template.
     *
     * Example: bodyText = "Hello {{1}}, welcome to {{2}}"
     * bodySampleValues = '["name", "course"]' (JSON array)
     * Result: {"name" → 1, "course" → 2}
     *
     * If template not found or has no sample values, returns empty map
     * and variables pass through as-is (backward compatible).
     */
    private Map<String, Integer> resolveTemplateVariablePositions(Optional<NotificationTemplate> templateOpt) {
        if (templateOpt.isEmpty()) return Map.of();

        NotificationTemplate template = templateOpt.get();
        String templateName = template.getName();

        try {
            // Prefer bodyVariableNames (semantic: ["name", "course"])
            // Fall back to bodySampleValues (example values: ["Shreyash", "Math 101"])
            String namesJson = template.getBodyVariableNames();
            if (namesJson == null || namesJson.isBlank()) {
                namesJson = template.getBodySampleValues();
            }

            if (namesJson == null || namesJson.isBlank()) {
                return Map.of();
            }

            String[] sampleNames = objectMapper.readValue(namesJson, String[].class);

            Map<String, Integer> mapping = new HashMap<>();
            for (int i = 0; i < sampleNames.length; i++) {
                String cleanName = sampleNames[i].trim().toLowerCase()
                        .replaceAll("[^a-z0-9_]", "_");
                mapping.put(cleanName, i + 1); // WhatsApp is 1-indexed
                // Also map the original name
                mapping.put(sampleNames[i].trim(), i + 1);
            }

            log.debug("Resolved template variable mapping for {}: {}", templateName, mapping);
            return mapping;

        } catch (Exception e) {
            log.warn("Failed to resolve template variables for {}: {}", templateName, e.getMessage());
            return Map.of();
        }
    }

    // ==================== Helpers ====================

    private void validateRequest(UnifiedSendRequest request) {
        if (request.getInstituteId() == null || request.getInstituteId().isEmpty()) {
            throw new IllegalArgumentException("instituteId is required");
        }
        if (request.getChannel() == null || request.getChannel().isEmpty()) {
            throw new IllegalArgumentException("channel is required");
        }
        if (request.getRecipients() == null || request.getRecipients().isEmpty()) {
            throw new IllegalArgumentException("At least one recipient is required");
        }
    }

    private String sanitizePhone(String phone) {
        if (phone == null) return null;
        return phone.replaceAll("[^0-9]", "");
    }
}
