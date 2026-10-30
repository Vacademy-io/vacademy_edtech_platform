package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateCatalog;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * The send path for the copilot inbox (Phase 1b). A human reviews a draft and hits send;
 * this dispatches it exactly once and stamps the correlation key so Phase 0's ledger can
 * later say "did this exact decision land / get read?".
 *
 * AT-MOST-ONCE (design §6.3): the caller claims the action (OPEN/ACKED → DISPATCHING) BEFORE
 * this runs; the send stamps options.sourceId = action.id → notification_log.correlation_id.
 * There is no dedup at UnifiedSendService, so the claim is the only guard against a double
 * send from two admins clicking at once — never move it after the send.
 *
 * Channel reality (fact §1.7): WhatsApp needs a Meta-approved template + variables, so a
 * WhatsApp send with no template_name is REJECTED here (the template-negotiation flow is a
 * later sub-phase). Email and in-app are free-form and send the draft directly.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementDispatcher {

    public static final String SOURCE = "ENGAGEMENT_ENGINE";

    /**
     * variables_json key AiCallActionService stamps with the number the call was on, so an
     * AI-call promise ("shall I send it on this WhatsApp number?") goes to that number even when
     * the lead row and the student row hold none — 44 of the first 106 promises had no phone
     * ContactResolver could find. Trusted ONLY on source=AI_CALL rows: a brain-drafted row's
     * variables come from the model, and a model-written "_toPhone" must never redirect a send.
     * Always stripped before the variables go to Meta.
     */
    public static final String VAR_TO_PHONE = "_toPhone";

    /** variables_json key for an EMAIL action's subject line (the brain writes it). */
    public static final String VAR_SUBJECT = "_subject";
    /** variables_json key on a REPLY: comma-separated assets asset ids to send with the text. */
    public static final String VAR_ASSET_IDS = "_assetIds";
    /** B6: the approved email template version a template-only email was drafted on (A3 catalog). */
    public static final String VAR_EMAIL_TEMPLATE = "_emailTemplateId";

    /** The sender every engine email used before channels.EMAIL.emailType existed. */
    static final String DEFAULT_EMAIL_TYPE = "UTILITY_EMAIL";

    private final NotificationService notificationService;
    private final EngagementActionRepository actionRepository;
    private final EngagementMemberRepository memberRepository;
    private final TimelineEventService timelineEventService;
    private final ContactResolver contactResolver;
    private final EngagementInternalClients clients;
    private final EngagementEngineRepository engineRepository;
    private final PolicyGate policyGate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** The engine's assets, for the attachments of a REPLY; optional so a context without it still starts. */
    @Autowired(required = false)
    private EngagementAssetService assetService;

    /** The templates track's renderer (A3); optional so a context without it still starts. */
    @Autowired(required = false)
    private EngagementEmailTemplateCatalog emailCatalog;

    /**
     * Dispatch an action that has ALREADY been claimed (status DISPATCHING). {@code editedBody}
     * (nullable) is the human's edit — recorded as sent_body so an EDITED-vs-ACCEPTED label is
     * derivable. Settles the action to SENT / FAILED and, on success, writes a REACHOUT timeline
     * event so a counsellor sees the engine already reached out.
     */
    /** Pre-send rejection (no message left the building) → safe to return the task to OPEN. */
    private static class SendRejectedException extends RuntimeException {
        SendRejectedException(String m) { super(m); }
    }

    public EngagementAction dispatchClaimed(EngagementAction action, String editedBody, String actorId) {
        return dispatchClaimed(action, editedBody, actorId, false);
    }

    /**
     * @param answeringTheirMessage true only for an answer to a message the person just sent us about a
     *        meeting they hold: a member who EXITED because the goal was met (meeting booked) may still be
     *        answered, but an opted-out one never. Everything else keeps the strict consent check.
     */
    public EngagementAction dispatchClaimed(EngagementAction action, String editedBody, String actorId,
                                            boolean answeringTheirMessage) {
        String channel = action.getChannel() != null ? action.getChannel().toUpperCase() : "";
        try {
            if (EngagementActionTypes.isCrmAction(action.getActionType())) {
                throw new SendRejectedException("This is a CRM action, not a message: approve it instead of sending it.");
            }
            // Resolve INSIDE the try: a DB blip here would otherwise leave the row stuck in
            // DISPATCHING forever (no reaper reaches it) — the worst failure class. On failure
            // it now settles to FAILED, which is visible and reopenable.
            EngagementMember member = memberRepository.findById(action.getMemberId())
                    .orElseThrow(() -> new IllegalStateException("member missing for action " + action.getId()));
            // Consent holds for every send, a human's send-on-behalf included: a task drafted before
            // the person opted out (or left the audience) must not reach them afterwards.
            if ("OPTED_OUT".equals(member.getStatus())
                    || ("EXITED".equals(member.getStatus()) && !answeringTheirMessage)) {
                throw new SendRejectedException("This person has opted out or left the audience, so nothing was sent.");
            }
            // The member row only learns of a CRM opt-out at the next decision, so a task drafted for
            // a lead must re-read the lead row before a human sends it (F2 / L3). An AI-call promise
            // stops only on an opt-out, as in the dispatch job. A lead marked Converted or Lost stops
            // the engine's own sends, not a human who chooses to send this draft.
            PolicyGate.LeadBlock leadBlock = policyGate.leadBlock(action.getInstituteId(), member.getAudienceResponseId());
            if (!PolicyGate.isLeadOutcome(leadBlock)
                    && EngagementDispatchJob.leadNotSendableReason(leadBlock, action) != null) {
                throw new SendRejectedException(
                        "This lead has opted out or was removed in the CRM, so nothing was sent.");
            }
            Subject subject = contactResolver.resolve(List.of(member)).get(0);

            // Resolve the SENT body per channel. A PROACTIVE WhatsApp (kind!=REPLY) is a FIXED
            // Meta-approved template render (draftBody at decision time); free text can't change what
            // Meta sends, so a body edit is REJECTED rather than silently dropped (which would falsify
            // sent_body/outcome). A WhatsApp REPLY (kind=REPLY) is a free-form session message, so its
            // body IS editable — like EMAIL/IN_APP, the human's edit is the sent content.
            boolean fixedTemplate = ("WHATSAPP".equals(channel) && !"REPLY".equalsIgnoreCase(action.getKind()))
                    || ("EMAIL".equals(channel) && parseVariables(action.getVariablesJson()).containsKey(VAR_EMAIL_TEMPLATE));
            String body;
            if (fixedTemplate) {
                if (editedBody != null && !editedBody.isBlank() && !editedBody.equals(action.getDraftBody())) {
                    throw new SendRejectedException("EMAIL".equals(channel)
                            ? "This email uses an approved template — its text can't be edited here."
                            : "WhatsApp uses a fixed Meta-approved template — its text can't be edited; "
                            + "change the variables instead.");
                }
                body = action.getDraftBody();
                action.setSentBody(body);
                action.setOutcome("ACCEPTED");
            } else {
                body = editedBody != null && !editedBody.isBlank() ? editedBody : action.getDraftBody();
                action.setSentBody(body);
                // Label from the ACTUALLY SENT body vs the draft — a blank editedBody falls back to the
                // draft, so it reads ACCEPTED, not EDITED (else autotune labels rot).
                action.setOutcome(body != null && !body.equals(action.getDraftBody()) ? "EDITED" : "ACCEPTED");
            }

            switch (channel) {
                case "EMAIL" -> sendEmail(action, subject, body);
                case "IN_APP" -> sendInApp(action, subject, body);
                case "WHATSAPP" -> sendWhatsApp(action, subject, body);
                case "AI_CALL" -> throw new SendRejectedException(
                        "AI calls are task-only in this phase — mark this task Done after calling.");
                default -> throw new SendRejectedException("Unsupported channel for send: " + channel);
            }
            action.setStatus("SENT");
            action.setDispatchedAt(Instant.now());
            action.setCompletedAt(Instant.now());
            writeReachoutTimeline(action, member, subject, body, actorId);
        } catch (SendRejectedException re) {
            // Nothing was sent (pre-send guard). Return to OPEN so the human can re-handle.
            action.setStatus("OPEN");
            action.setErrorMessage(re.getMessage());
            actionRepository.save(action);
            throw new VacademyException(re.getMessage());
        } catch (Exception e) {
            // ANY error once we may have hit the sender is UNKNOWN-outcome, NOT open: the POST may
            // have landed even if the response was lost/garbled (a 2xx empty body throws inside
            // sendUnified AFTER delivery). Marking OPEN here would let a human re-send → duplicate.
            // FAILED blocks the re-send CAS; correlation_id lets a later reconcile confirm delivery.
            log.error("Dispatch failed (unknown outcome) for action {}: {}", action.getId(), e.getMessage(), e);
            action.setStatus("FAILED");
            action.setErrorMessage(e.getMessage());
            action.setDispatchedAt(Instant.now());
        }
        return actionRepository.save(action);
    }

    private void sendEmail(EngagementAction action, Subject subject, String body) {
        if (subject.getEmail() == null || subject.getEmail().isBlank()) {
            throw new SendRejectedException("No email address on file for this person");
        }
        Map<String, String> vars = parseVariables(action.getVariablesJson());
        String subjectLine = vars.get(VAR_SUBJECT);
        String html = toHtml(body);
        String templateId = vars.get(VAR_EMAIL_TEMPLATE);
        if (templateId != null) {
            // Template-only email (B6): render the exact approved version it was drafted on, and
            // refuse to send when a variable is missing or the template now breaks the brief (E2, E7).
            if (emailCatalog == null) throw new SendRejectedException("Email templates are unavailable right now.");
            Map<String, String> templateVars = new java.util.HashMap<>(vars);
            templateVars.remove(VAR_SUBJECT);
            templateVars.remove(VAR_EMAIL_TEMPLATE);
            var rendered = emailCatalog.renderById(templateId, action.getInstituteId(), templateVars)
                    .orElseThrow(() -> new SendRejectedException("The email template is no longer approved."));
            if (!rendered.sendable()) {
                throw new SendRejectedException("The email template can't be sent: "
                        + String.join("; ", concat(rendered.missingVariables(), rendered.problems())));
            }
            subjectLine = rendered.subject();
            html = rendered.html();
        }
        UnifiedSendRequest req = UnifiedSendRequest.builder()
                .instituteId(action.getInstituteId())
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                        .email(subject.getEmail())
                        .userId(subject.getUserId())
                        .name(subject.getName())
                        .build()))
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(subjectLine != null && !subjectLine.isBlank() ? subjectLine : deriveSubject(body))
                        .emailBody(html)  // the draft is plain text (or the template's own HTML)
                        .emailType(emailTypeFor(action))
                        .source(SOURCE)          // → notification_log.source
                        .sourceId(action.getId()) // → correlation_id (Phase 0)
                        .build())
                .build();
        requireAccepted(notificationService.sendUnified(req), "email");
    }

    /**
     * In-app goes through the ANNOUNCEMENT chain (createSystemAlertAnnouncement), not a raw FCM
     * push: that persists a recipient_messages row the learner's in-app centre reads and a
     * message_interactions READ receipt — a bare SYSTEM_ALERT unified-send only fires a transient
     * push, writes nothing, swallows token errors, and would report a false SENT. In-app read state
     * lives in message_interactions (its own receipt), not notification_log.correlation_id, which
     * the ledger's observable flags already reflect.
     */
    private void sendInApp(EngagementAction action, Subject subject, String body) {
        if (subject.getUserId() == null) {
            throw new SendRejectedException("In-app messages need a platform account; this person has none");
        }
        notificationService.createSystemAlertAnnouncement(
                action.getInstituteId(), List.of(subject.getUserId()),
                "A message for you", body,
                "ENGAGEMENT_ENGINE", "Engagement Engine", "ADMIN", null);
        // createSystemAlertAnnouncement is void + best-effort-durable; it returns after persisting
        // the announcement. A hard failure throws (→ FAILED); otherwise the row is queryable.
    }

    private void sendWhatsApp(EngagementAction action, Subject subject, String body) {
        Map<String, String> variables = new java.util.HashMap<>(parseVariables(action.getVariablesJson()));
        String calledNumber = variables.remove(VAR_TO_PHONE);
        String phone = EngagementAction.SOURCE_AI_CALL.equals(action.getSource())
                && calledNumber != null && !calledNumber.isBlank()
                ? calledNumber : subject.getPhone();
        if (phone == null || phone.isBlank()) {
            throw new SendRejectedException("No phone number on file for this person");
        }
        // A REPLY is a free-form WhatsApp SESSION message (they messaged us first), NOT a template.
        // It is legal only inside Meta's 24h window, so verify the window is still open before sending
        // — a human answering an escalated reply hours later could otherwise send into a closed window
        // (Meta rejects free-form there). The auto-reply path checks the window too, but a human send
        // can lag, so this guard is the real gate.
        if ("REPLY".equalsIgnoreCase(action.getKind())) {
            sendWhatsAppReply(action, subject, body);
            return;
        }
        if (action.getTemplateName() == null || action.getTemplateName().isBlank()) {
            // The honest constraint: proactive WhatsApp is a pre-approved template + variables,
            // never free-form. Until the template-negotiation flow assigns an approved template,
            // this draft can only be sent on another channel or handled manually.
            throw new SendRejectedException(
                    "WhatsApp needs a Meta-approved template. Send this on email/in-app, or wait for "
                    + "template approval. (The AI draft is a preview of intent, not a sendable WhatsApp message.)");
        }
        // A media header is only rendered as an IMAGE if headerType is literally "image".
        // WhatsAppService.buildHeaderConfig decides with
        //     "image".equalsIgnoreCase(headerType) ? "image" : "document"
        // so a null type silently becomes a document — and attaches filename "file.pdf".
        // Meta then compares that against the template's declared header and rejects the
        // whole send: "(#132012) header: Format mismatch, expected IMAGE, received
        // DOCUMENT". The URL was travelling correctly; only its type was missing.
        // Carried per-action in variables_json rather than as a column: it belongs to the
        // template the rule chose, and "_"-prefixed keys are filtered out of the body
        // parameters by both provider paths, so it cannot disturb the positional count.
        String headerType = variables.get("_headerType");
        UnifiedSendRequest req = UnifiedSendRequest.builder()
                .instituteId(action.getInstituteId())
                .channel("WHATSAPP")
                .templateName(action.getTemplateName())
                // Meta identifies a template by name+language; use the locale it was registered under
                // (stamped when the template was attached), not a hardcoded "en" that fails for hi.
                .languageCode(action.getTemplateLanguage() != null && !action.getTemplateLanguage().isBlank()
                        ? action.getTemplateLanguage() : "en")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                        .phone(phone)
                        .userId(subject.getUserId())
                        .name(subject.getName())
                        .variables(variables)
                        .build()))
                .options(UnifiedSendRequest.SendOptions.builder()
                        .source(SOURCE)
                        .sourceId(action.getId())
                        // Null for a text-header or headerless template, which is what
                        // UnifiedSendService expects when there is no media to attach.
                        .headerType(headerType != null && !headerType.isBlank() ? headerType : null)
                        .build())
                .build();
        requireAccepted(notificationService.sendUnified(req), "whatsapp");
    }

    /**
     * Free-form WhatsApp session reply (kind=REPLY). Legal ONLY inside Meta's 24h window, so the
     * window is verified here — a human answering an escalated reply can lag hours past the window,
     * and a free-form send there is rejected by Meta. The correlation key is the action id, so the
     * ledger attributes it exactly like a template send.
     */
    private void sendWhatsAppReply(EngagementAction action, Subject subject, String body) {
        if (body == null || body.isBlank()) {
            throw new SendRejectedException("Empty reply — nothing to send");
        }
        // Assets: a link rides inside the text, a file goes out as its own attachment after it.
        java.util.List<vacademy.io.admin_core_service.features.engagement.entity.EngagementAsset> assets =
                assetsFor(action);
        StringBuilder text = new StringBuilder(body);
        for (var a : assets) {
            if ("link".equals(a.getMediaType())) text.append("\n\n").append(a.getTitle()).append(": ").append(a.getUrl());
        }
        String message = text.toString();
        // Pre-send local validation mirroring notification_service's 400 guard: reject HERE so the
        // task returns to OPEN (fixable) instead of the remote 400 collapsing into a generic error
        // → FAILED (which hides a never-sent, human-editable reply from the default inbox).
        if (message.length() > 4096) {
            throw new SendRejectedException(
                    "WhatsApp messages are capped at 4096 characters — shorten the reply and send again.");
        }
        Instant windowOpen = memberRepository.findById(action.getMemberId())
                .map(EngagementMember::getWindowOpenUntil).orElse(null);
        if (windowOpen == null || windowOpen.isBefore(Instant.now())) {
            throw new SendRejectedException(
                    "The 24h WhatsApp reply window has closed — reach this person with an approved "
                    + "template instead.");
        }
        // Any failure here propagates to the caller's generic catch → FAILED (unknown outcome: the
        // POST may have landed), never OPEN — same at-most-once discipline as the template path.
        // Success = the explicit accepted flag, NOT a non-blank wamid: WATI's session API returns no
        // per-message id after a real delivery, and keying on wamid would fail every WATI reply.
        JsonNode resp = clients.sendWhatsAppReply(action.getInstituteId(), subject.getPhone(), message, action.getId());
        if (resp == null || !resp.path("accepted").asBoolean(false)) {
            throw new IllegalStateException("whatsapp-reply was not accepted by notification service");
        }
        if (!message.equals(body)) action.setSentBody(message);

        // The text is out. An attachment that fails now must not turn the action into FAILED (the
        // person already has the reply), but it must not vanish either: the failure is written on
        // the action so the counsellor sees what was promised and not delivered.
        java.util.List<String> undelivered = new java.util.ArrayList<>();
        for (var a : assets) {
            if ("link".equals(a.getMediaType())) continue;
            try {
                JsonNode r = clients.sendWhatsAppMedia(action.getInstituteId(), subject.getPhone(), a.getMediaType(),
                        a.getUrl(), a.getTitle(), a.getFilename(), action.getId());
                if (r == null || !r.path("accepted").asBoolean(false)) undelivered.add(a.getTitle());
            } catch (Exception e) {
                log.warn("Asset attachment {} not delivered for action {}: {}", a.getId(), action.getId(), e.getMessage());
                undelivered.add(a.getTitle());
            }
        }
        if (!undelivered.isEmpty()) {
            String note = "Attachment not delivered: " + String.join(", ", undelivered)
                    + " — send it to this person by hand.";
            action.setErrorMessage(note);
            action.setRationale(truncate((action.getRationale() == null ? "" : action.getRationale() + " · ") + note, 4000));
        }
    }

    /** The assets a REPLY carries (ids in variables_json), restricted to this engine's own assets. */
    private java.util.List<vacademy.io.admin_core_service.features.engagement.entity.EngagementAsset>
            assetsFor(EngagementAction action) {
        String ids = parseVariables(action.getVariablesJson()).get(VAR_ASSET_IDS);
        if (assetService == null || ids == null || ids.isBlank() || action.getEngineId() == null) return java.util.List.of();
        return assetService.resolve(action.getEngineId(), java.util.Arrays.stream(ids.split(","))
                .map(String::trim).filter(x -> !x.isEmpty()).toList());
    }

    private void writeReachoutTimeline(EngagementAction action, EngagementMember member,
                                       Subject subject, String body, String actorId) {
        try {
            // Only leads have an audience_response timeline anchor; a pure learner has no lead
            // journey, so skip (their student communication timeline already shows the send via
            // notification_log). Lead → REACHOUT so a counsellor sees the engine already acted.
            if (member.getAudienceResponseId() == null) return;
            Map<String, Object> metadata = Map.of(
                    "engine_id", action.getEngineId(),
                    "action_id", action.getId(),
                    "channel", action.getChannel() != null ? action.getChannel() : "",
                    "rationale", action.getRationale() != null ? action.getRationale() : "");
            timelineEventService.logJourneyEvent(
                    "AUDIENCE_RESPONSE", member.getAudienceResponseId(),
                    LeadJourneyActionType.REACHOUT,
                    "ENGAGEMENT_ENGINE", actorId, "Engagement Engine",
                    "Engagement message sent (" + action.getChannel() + ")",
                    truncate(body, 280),
                    metadata,
                    member.getUserId());
        } catch (Exception e) {
            // Timeline is a side-effect — never fail the send because the journal write failed.
            log.warn("Failed to write REACHOUT timeline for action {}: {}", action.getId(), e.getMessage());
        }
    }

    private void requireAccepted(UnifiedSendResponse resp, String what) {
        if (resp == null || resp.getAccepted() < 1) {
            String err = resp != null && resp.getResults() != null && !resp.getResults().isEmpty()
                    ? resp.getResults().get(0).getError() : "send not accepted";
            throw new IllegalStateException(what + " send not accepted: " + err);
        }
    }

    /**
     * The engine's email sender: channels.EMAIL.emailType names one of the institute's sender nodes
     * (EMAIL_SETTING.data.&lt;type&gt;), e.g. a dedicated outreach address whose node carries the
     * unsubscribe footer and a daily cap. Unset → the transactional sender, as before.
     */
    private String emailTypeFor(EngagementAction action) {
        EngagementEngine engine = action.getEngineId() == null ? null
                : engineRepository.findById(action.getEngineId()).orElse(null);
        if (engine == null || engine.getChannels() == null) return DEFAULT_EMAIL_TYPE;
        JsonNode type;
        try {
            type = objectMapper.readTree(engine.getChannels()).path("EMAIL").path("emailType");
        } catch (Exception e) {
            // Never fall back to the transactional sender here: an outreach engine's mail would
            // then leave as the institute's OTP/receipt address.
            throw new SendRejectedException("This engine's email settings can't be read, so nothing was sent.");
        }
        return type.isTextual() && !type.asText().isBlank() ? type.asText().trim() : DEFAULT_EMAIL_TYPE;
    }

    /** The AI draft is plain text; EmailService renders emailBody as HTML, so preserve line breaks. */
    private String toHtml(String plain) {
        if (plain == null) return "";
        String escaped = plain
                .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        return "<p>" + escaped.replace("\n\n", "</p><p>").replace("\n", "<br/>") + "</p>";
    }

    private String deriveSubject(String body) {
        String firstLine = body != null ? body.strip().split("\n", 2)[0] : "A message for you";
        if (firstLine.isBlank()) firstLine = "A message for you";
        return firstLine.length() > 120 ? firstLine.substring(0, 117) + "..." : firstLine;
    }

    private static List<String> concat(List<String> a, List<String> b) {
        List<String> out = new java.util.ArrayList<>();
        if (a != null) a.forEach(m -> out.add("missing " + m));
        if (b != null) out.addAll(b);
        return out;
    }

    private Map<String, String> parseVariables(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructMapType(java.util.HashMap.class, String.class, String.class));
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static String truncate(String s, int n) {
        if (s == null) return null;
        return s.length() <= n ? s : s.substring(0, n);
    }
}
