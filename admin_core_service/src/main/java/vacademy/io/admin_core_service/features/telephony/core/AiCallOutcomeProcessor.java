package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallDecision;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.CallDirection;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecutionState;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionStateRepository;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.dto.CallSubjectType;
import vacademy.io.admin_core_service.features.telephony.spi.dto.NormalizedCallEvent;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Turns a landed Aavtaar end-of-call result into lead action:
 *   1. resolve the lead (outbound: by our correlation id; inbound: by phone),
 *   2. promote/upsert a telephony_call_log row (so the call + recording attach to
 *      the lead and surface on the lead profile),
 *   3. read the institute's AI_CALLING_SETTING, classify the outcome,
 *   4. ASSIGN a counsellor (good response / exhausted-to-human) or set a status.
 *
 * Idempotent: a result already PROCESSED is skipped. Status stamping is
 * best-effort — it only fires if the institute's lead-status catalog has the
 * matching key (so missing catalog entries never break the call flow).
 *
 * Deferred (tracked): copying the recording to our S3 (needs an Aavtaar fetcher),
 * and the timed retry re-dialer — RETRY here only marks the lead.
 */
@Service
@RequiredArgsConstructor
public class AiCallOutcomeProcessor {

    private static final Logger log = LoggerFactory.getLogger(AiCallOutcomeProcessor.class);

    // Lead-status catalog keys the institute should provision for stamping to work.
    private static final String STATUS_QUALIFIED = "AI_QUALIFIED";
    private static final String STATUS_NOT_INTERESTED = "AI_NOT_INTERESTED";
    private static final String STATUS_NO_ANSWER = "AI_NO_ANSWER";
    private static final String STATUS_RETRY_PENDING = "AI_RETRY_PENDING";

    private final AiCallResultRepository aiCallResultRepo;
    private final TelephonyCallLogRepository callLogRepo;
    private final AudienceResponseRepository audienceResponseRepo;
    private final LeadStatusRepository leadStatusRepo;
    private final LeadStatusService leadStatusService;
    private final CounselorAssignmentService counselorAssignmentService;
    private final UserLeadProfileService userLeadProfileService;
    private final UserLeadProfileRepository userLeadProfileRepository;
    private final AiCallingSettingsService settingsService;
    private final AiCallOutcomeClassifier classifier;
    private final CallLogService callLogService;
    private final WorkflowExecutionStateRepository executionStateRepository;
    private final AiCallRecordingService aiCallRecordingService;
    private final AiCallingConfigService configService;
    private final CallBillingService billingService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // @Lazy + field injection (NOT constructor): WorkflowTriggerService transitively
    // reaches the workflow engine, so a final constructor dependency here would form an
    // eager Spring bean cycle that fails context startup (compiles fine, breaks at boot).
    // The lazy proxy breaks it. Used only on the inbound LEAD_CALLED_BACK path.
    @Autowired
    @Lazy
    private WorkflowTriggerService workflowTriggerService;

    // @Lazy (defensive, matching the pattern above): the registry-agent disposition
    // list makes the classifier agent-aware so a connected call with a custom
    // disposition isn't re-dialed as "neutral". Read-only lookup on the outcome path.
    @Autowired
    @Lazy
    private AiAgentService aiAgentService;

    // @Lazy: the booking services transitively reach live-session / audience services;
    // lazy field injection avoids an eager bean cycle (same pattern as above). Used to
    // auto-book a meeting when a call yields a scheduling request and the agent is linked
    // to a booking page.
    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.booking.service.MeetingBookingService meetingBookingService;

    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.booking.service.BookingPageService bookingPageService;

    // @Lazy: AudienceService is a large service that transitively reaches back into the
    // lead/workflow graph — a final constructor dependency would risk an eager bean
    // cycle. Used only on the inbound path to auto-capture an unknown caller as a lead
    // (its captureInboundCallLead runs in its own REQUIRES_NEW transaction).
    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.audience.service.AudienceService audienceService;

    // @Lazy, matching every other field here. Creates the WhatsApp/email/meeting actions the
    // agent promised on the call; see AiCallActionService and docs/crm/AI_CALL_ACTIONS.md.
    // Runs POST-COMMIT alongside the auto-book, never inline (see the note there).
    @Autowired
    @Lazy
    private AiCallActionService aiCallActionService;

    private record Lead(String responseId, String userId, String audienceId, String instituteId) {}

    @Transactional
    public void process(String aiCallResultId) {
        // Atomic claim FIRST (status-guarded UPDATE, same transaction): providers
        // retry report POSTs and the webhook runs this synchronously — two requests
        // must not both process the same result (double counsellor-assignment). A
        // duplicate blocks on the row lock, re-evaluates after our commit and
        // no-ops; a rollback restores the prior status so genuine retries heal.
        if (aiCallResultRepo.claimForProcessing(aiCallResultId) == 0) return;
        AiCallResult r = aiCallResultRepo.findById(aiCallResultId).orElse(null);
        if (r == null) return;
        if ("PROCESSED".equals(r.getProcessingStatus())) return;

        // Read settings up-front (scoped to the result's institute) so we can classify
        // inbound vs outbound BEFORE attempting any outbound-call matching. Re-scoped to
        // the lead's institute after resolution for the disposition classifier below.
        String instituteId = r.getInstituteId();
        AiCallingSettingsPojo settings = settingsService.get(instituteId); // never null (defaults())

        // Inbound classification. An inbound AI call (the lead dialed our AI line) carries
        // a campaign id the institute tagged INBOUND. We never placed it, so there's no
        // correlation id / provider call id to bind — skip outbound matching entirely and
        // resolve the lead by phone (resolveLead's last-10 path). Stamp INBOUND so the new
        // telephony_call_log row records the right direction.
        // SECURITY (P0): the AI-voice report webhook is PUBLIC and, for an institute
        // with no configured webhook secret (the norm for VACADEMY_AI), accepts
        // unauthenticated POSTs. Our own bot authenticates by CAPABILITY: it always
        // echoes the unguessable correlationId = the telephony_call_log id we created
        // when the call was placed (outbound) or answered (inbound IVR). Require that
        // corr to resolve to a call log OWNED by the report's institute before this
        // report may touch ANY lead. Without it, a forger who knows only a (non-secret)
        // instituteId + a lead's phone could inject a fabricated outcome and mark the
        // lead Not-Interested / hijack its workflow via the phone-match binding below.
        // Trusted binding = a call log we can PROVE we own: our unguessable
        // correlationId (VACADEMY_AI echoes it), OR a provider_call_id our own dial
        // recorded that matches the report's call_uuid. Computed for ALL providers —
        // the provider string comes from the attacker-chosen URL path, so it must not
        // gate the security check.
        TelephonyCallLog ownedCall = null;
        if (r.getInstituteId() != null) {
            if (r.getCorrelationId() != null) {
                ownedCall = callLogRepo.findById(r.getCorrelationId())
                        .filter(c -> r.getInstituteId().equals(c.getInstituteId()))
                        .orElse(null);
            }
            if (ownedCall == null && r.getCallUuid() != null && r.getProvider() != null) {
                ownedCall = callLogRepo
                        .findByProviderTypeAndProviderCallId(r.getProvider(), r.getCallUuid())
                        .filter(c -> r.getInstituteId().equals(c.getInstituteId()))
                        .orElse(null);
            }
        }
        // SECURITY (P0): the report webhook is PUBLIC and fails open when the institute
        // has no configured webhook secret (the norm for VACADEMY_AI). A report that is
        // neither authenticated by that secret NOR bound to a call we own must not be
        // allowed to phone-match and mutate a real lead — otherwise anyone who knows a
        // (non-secret) instituteId + a lead's phone forges an outcome, and relabeling
        // the provider in the URL (e.g. /webhook/aavtaar) would dodge a provider-scoped
        // check. Require the capability (owned call) whenever unauthenticated.
        String webhookSecret = configService.getEffectiveWebhookSecret(r.getInstituteId());
        boolean authenticated = webhookSecret != null && !webhookSecret.isBlank();
        if (!authenticated && ownedCall == null) {
            log.warn("ai-call outcome: result {} REJECTED — unauthenticated (no webhook secret) and correlationId {} / callUuid {} resolves to no call log owned by institute {} (possible forged report)",
                    r.getId(), r.getCorrelationId(), r.getCallUuid(), r.getInstituteId());
            r.setProcessingStatus("REJECTED_UNVERIFIED");
            aiCallResultRepo.save(r);
            return;
        }

        boolean isInbound = isInboundCampaign(r.getCampaignId(), settings);
        // VACADEMY_AI binds to the EXACT verified call log (both directions) — never
        // phone-matched — so a report can only ever affect the call it belongs to.
        // Deriving direction from the owned row also fixes inbound reports creating a
        // second call-log row (the phone-match path did) and BOTH-direction agents
        // being mis-detected as OUTBOUND.
        TelephonyCallLog existing = ownedCall;
        if (existing != null && CallDirection.INBOUND.name().equalsIgnoreCase(existing.getDirection())) {
            isInbound = true;
        }
        if (isInbound) {
            r.setDirection(CallDirection.INBOUND.name());
        }

        if (existing == null && !isInbound) {
            existing = (r.getCorrelationId() == null) ? null
                    : callLogRepo.findById(r.getCorrelationId()).orElse(null);
            // Exact match: when the provider returns its call id at placement (Aavtaar now
            // does), it's stored as the call log's provider_call_id and the webhook carries the
            // same id as call_uuid — binding the report to THE exact call (timing-immune,
            // and unaffected by leads sharing a phone).
            if (existing == null && r.getCallUuid() != null && r.getProvider() != null) {
                existing = callLogRepo
                        .findByProviderTypeAndProviderCallId(r.getProvider(), r.getCallUuid())
                        .orElse(null);
            }
            // Fallback (no provider call id — older calls / provider didn't return one): bind by
            // phone. The webhook can arrive LATE (after the next retry dial), so anchor on the
            // report's dial time (callStart) and pick the OUTBOUND call placed CLOSEST to
            // it, so a late report binds to the attempt it describes rather than the most
            // recent dial. Fall back to most-recent when the report carries no dial time.
            // Without this the result can't bind → call_log_id stays empty and the
            // recording/disposition/status never attach to the lead.
            // Provider-scoped: only ever bind to a call placed by THIS provider, so an
            // Aavtaar report can never attach to (and overwrite) an Exotel/Airtel call log
            // that happens to share the lead's phone number.
            if (existing == null && r.getInstituteId() != null && r.getPhoneNumber() != null
                    && r.getProvider() != null) {
                var anchor = r.getCallStart();
                existing = (anchor != null)
                        ? callLogRepo.findOutboundByPhoneNearest(
                                r.getInstituteId(), r.getProvider(), r.getPhoneNumber(),
                                java.sql.Timestamp.from(anchor)).orElse(null)
                        : callLogRepo.findMostRecentOutboundByPhone(
                                r.getInstituteId(), r.getProvider(), r.getPhoneNumber()).orElse(null);
            }
        }

        Lead lead = resolveLead(r, existing, settings);
        String callLogId = upsertCallLog(r, lead, existing);
        if (callLogId != null) {
            r.setCallLogId(callLogId);
            // Copy the recording into our storage (media_service pre-signed URL) so it
            // plays from the lead profile's Call History. Async — never blocks the webhook.
            // Dispatch AFTER this transaction commits, so the async thread can see the
            // just-inserted call-log row (avoids a read-before-commit race for new rows).
            if (r.getRecordingUrl() != null && !r.getRecordingUrl().isBlank()) {
                final String cid = callLogId;
                if (TransactionSynchronizationManager.isSynchronizationActive()) {
                    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            aiCallRecordingService.persistAsync(cid);
                        }
                    });
                } else {
                    aiCallRecordingService.persistAsync(cid);
                }
            }
        }

        // AI-conversation-minutes metering (CallBillingService). Runs AFTER the
        // ownership/verification gate above (the report webhook is public — never bill
        // off an unverified report). Review-hardened gates:
        //  - EXPLICIT completed status only ("completed"/"complete" verbatim) — never
        //    mapStatus, whose default-to-COMPLETED exists to keep malformed reports
        //    flowing through the NON-billing pipeline.
        //  - Identity comes from aiIdempotencyKey: the provider call id when present
        //    (stable across re-POSTs), else the call-log id only when the row provably
        //    pre-dates this report. An unbindable no-call_uuid report mints a NEW
        //    result row (and possibly call-log row) per webhook re-delivery — any
        //    row-derived key would bill once per delivery, so those skip with a warn.
        //  - A verified completed call with NULL duration (isConnected treats it as
        //    connected) bills ONE minute rather than silently riding free; an explicit
        //    zero/negative duration is not billable.
        //  - callLogId is NOT required: an unknown inbound caller with lead-capture off
        //    leaves only the ai_call_result, but the STT/LLM/TTS spend was real.
        // Applies to lead and non-lead subjects alike. Dispatched after commit, same
        // as the recording copy; success stamps ai_call_result.credits_billed_at so
        // the reconciliation sweep stops re-attempting.
        String rawAiStatus = r.getStatus() == null ? "" : r.getStatus().trim().toLowerCase();
        boolean explicitlyCompleted = "completed".equals(rawAiStatus) || "complete".equals(rawAiStatus);
        if (billingService.isAiBillableProvider(r.getProvider()) && explicitlyCompleted
                && (r.getDurationSeconds() == null || r.getDurationSeconds() > 0)) {
            String billKey = CallBillingService.aiIdempotencyKey(
                    r.getProvider(), r.getCallUuid(), r.getCorrelationId(),
                    existing != null ? callLogId : null);
            if (billKey == null) {
                log.warn("ai-call billing: result {} has no stable call identity "
                        + "(call_uuid and correlation both absent) — NOT billed", r.getId());
            } else {
                final String key = billKey;
                final String billResultId = r.getId();
                final String billInstitute = existing != null ? existing.getInstituteId()
                        : (lead.instituteId() != null ? lead.instituteId() : r.getInstituteId());
                final String billProvider = r.getProvider();
                final String billDirection = existing != null && existing.getDirection() != null
                        ? existing.getDirection() : r.getDirection();
                final int billSecs = r.getDurationSeconds() == null ? 60 : r.getDurationSeconds();
                // campaign_id IS the ai_agent id for VACADEMY_AI calls — it selects the
                // TTS engine, and therefore the per-minute price (V421).
                final String billAgentId = r.getCampaignId();
                if (TransactionSynchronizationManager.isSynchronizationActive()) {
                    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            billingService.billAiLeg(key, billResultId, billInstitute,
                                    billProvider, billDirection, billSecs, billAgentId);
                        }
                    });
                } else {
                    billingService.billAiLeg(key, billResultId, billInstitute,
                            billProvider, billDirection, billSecs, billAgentId);
                }
            }
        }

        // Subject routing. The node is generic: its OUTPUT (disposition + the extracted
        // answers) is already persisted on this ai_call_result (subject-tagged → queryable),
        // and below it is also delivered into the workflow context so downstream nodes can
        // consume it. A non-lead subject gets ONLY that generic treatment — no lead
        // assign/status. LEAD (or a legacy null subject_type) falls through to the built-in
        // lead consumer pipeline, unchanged.
        CallSubjectType subjectType = (existing != null)
                ? CallSubjectType.fromString(existing.getSubjectType())
                : CallSubjectType.LEAD;
        if (subjectType != CallSubjectType.LEAD) {
            String subjectInstitute = lead.instituteId() != null ? lead.instituteId() : r.getInstituteId();
            AiCallingSettingsPojo subjectSettings = settingsService.get(subjectInstitute);
            int attempts = r.getCallRetry() == null ? 0 : r.getCallRetry();
            // Generic terminality by CONNECTIVITY — NOT the lead-centric disposition lists
            // (a connected sales call with a "neutral" disposition retries; a connected data
            // call has already collected its data and is done). A call that connected →
            // terminal; one that didn't connect retries within the institute's cap, else
            // gives up. On terminal, resume the workflow PAST the node carrying the output.
            boolean connected = isConnected(r, subjectSettings);
            boolean terminal = connected || attempts >= Math.max(1, subjectSettings.getMaxRetries());
            if (terminal) {
                AiCallDecision outcome = new AiCallDecision(
                        connected ? AiCallDecision.Action.ASSIGN : AiCallDecision.Action.STOP,
                        connected ? "connected" : "exhausted");
                resumeWorkflowWithOutput(existing != null ? existing.getSubjectId() : null, r, outcome, connected);
            }
            // else: not connected + retries remain → leave the CALL_AI state paused; it re-dials.
            r.setProcessingStatus("PROCESSED");
            aiCallResultRepo.save(r);
            log.info("ai-call outcome: {} (non-lead) result={} -> {} (connected={})",
                    subjectType, r.getId(), terminal ? "output exposed past node" : "left paused for retry", connected);
            return;
        }

        instituteId = lead.instituteId() != null ? lead.instituteId() : r.getInstituteId();
        settings = settingsService.get(instituteId);
        int priorAttempts = r.getCallRetry() == null ? 0 : r.getCallRetry();
        // Agent-defined dispositions (VACADEMY_AI registry agent) make a connected call
        // carrying a custom outcome terminal instead of re-dialed. Empty for Aavtaar.
        List<String> agentDispositions = List.of();
        if (ProviderType.VACADEMY_AI.equals(r.getProvider()) && r.getCampaignId() != null) {
            agentDispositions = aiAgentService.find(r.getCampaignId(), instituteId)
                    .map(a -> aiAgentService.parseList(a.getDispositions()))
                    .orElse(List.of());
        }
        // A call OUR OWN diagnostics scored as broken must not close the lead.
        //
        // The bot ships a health verdict on the same report that carries the
        // disposition, and it lands on this very row (diag_health / diag_faults).
        // The classifier's signature predates diagnostics and has no health
        // input, so a call where the agent never spoke, looped, or had nothing to
        // say still produced a terminal disposition: measured 2026-08-14, 113 of
        // 161 RED calls over 30 days wrote one — 41 Not_Interested and one
        // Do_Not_Call. Those leads are closed permanently on OUR failure, and
        // Do_Not_Call is not recoverable at all.
        //
        // Degrading to Incomplete puts the lead on the retry path instead, which
        // is what the analyser itself does when it cannot judge a call
        // (report.py: an unparseable analysis degrades to Incomplete rather than
        // dropping the report). Scoped to faults that mean WE broke the call —
        // not to DEAD_AIR, ANSWER_DELETED or LIKELY_MACHINE, which can be RED on
        // a call the caller still answered perfectly well.
        boolean untrusted = isUntrustworthyCall(r);
        String effectiveDisposition = r.getDisposition();
        if (untrusted) {
            log.warn("ai-call outcome: result={} health={} faults=[{}] — call was broken on OUR side; "
                    + "degrading disposition '{}' to Incomplete so the lead is not closed",
                    r.getId(), r.getDiagHealth(), r.getDiagFaults(), r.getDisposition());
            effectiveDisposition = "Incomplete";
        }

        // callerWordCount is the bot's MEASURED count of what the caller said. It lets
        // the classifier hand an engaged-but-unjudged call to a human rather than
        // re-dial it — including the RED-degraded case just above, which is precisely
        // where a long real conversation used to be thrown to the retry loop.
        AiCallDecision decision = classifier.classify(
                r.getStatus(), r.getDurationSeconds(), effectiveDisposition, priorAttempts, settings,
                agentDispositions, r.getCallerWordCount());
        boolean connected = isConnected(r, settings);

        log.info("ai-call outcome: result={} lead={} disposition={} status={} callerWords={} -> {} ({})",
                r.getId(), lead.userId(), effectiveDisposition, r.getStatus(), r.getCallerWordCount(),
                decision.action(), decision.reason());

        applyDecision(decision, lead, r, connected);

        // Reflect the call disposition in the lead status for EVERY outcome (including
        // retry-worthy ones like Callback) by auto-matching the disposition to the
        // institute's lead-status catalog (e.g. "Callback" -> CALL_BACK / "Call Back").
        // Only fires when a matching status exists, so it never forces a status the
        // institute hasn't defined; otherwise the lead is left as-is. Runs after
        // applyDecision so it's the authoritative status write for this outcome.
        //
        // Passed null for an untrusted call: this is the SECOND write that would
        // stamp the bad verdict (applyDecision is the first), and degrading the
        // classifier input alone would leave it free to write Not-Interested here
        // anyway. stampStatusFromDisposition returns early on a null disposition.
        stampStatusFromDisposition(lead, untrusted ? null : r.getDisposition());

        // Inbound: the lead dialed our AI line. Once the call log + status are settled,
        // fire LEAD_CALLED_BACK so any workflow wired to "lead called back" can react.
        // Best-effort, and handleTriggerEvents runs in its own (REQUIRES_NEW) transaction,
        // so a trigger miss never rolls back the call-log/result write. Only fires once we
        // resolved the caller to a lead (unknown callers leave only the ai_call_result row).
        if (isInbound && lead.responseId() != null) {
            try {
                Map<String, Object> ctx = new java.util.HashMap<>();
                ctx.put("responseId", lead.responseId());
                if (lead.userId() != null) ctx.put("userId", lead.userId());
                if (lead.audienceId() != null) ctx.put("audienceId", lead.audienceId());
                if (r.getDisposition() != null) ctx.put("disposition", r.getDisposition());
                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.LEAD_CALLED_BACK.name(),
                        lead.responseId(), lead.instituteId(), ctx);
            } catch (Exception ex) {
                log.warn("ai-call: LEAD_CALLED_BACK fire failed for response {}: {}",
                        lead.responseId(), ex.getMessage());
            }
        }

        // Auto-book a meeting when the caller agreed to a demo/visit/call at a specific
        // time AND this agent is linked to a booking page. DEFERRED to AFTER this
        // transaction commits — NOT inline. MeetingBookingService.createBooking persists
        // via a TransactionTemplate with default PROPAGATION_REQUIRED, so calling it inside
        // this @Transactional method would JOIN this tx: a booking failure would mark THIS
        // tx rollback-only and — despite the try/catch — roll back the ENTIRE outcome
        // (counsellor assignment, status, workflows) and re-loop via reprocessing; and its
        // confirmation email / Meet link would fire before this tx committed. Post-commit it
        // runs exactly once (PROCESSED is already persisted, so no reprocess re-book), fully
        // isolated, and createBooking's own 2-phase tx behaves as designed.
        final AiCallResult rRef = r;
        final Lead leadRef = lead;
        final String instRef = instituteId;
        Runnable bookTask = () -> {
            try {
                maybeAutoBookMeeting(rRef, leadRef, instRef);
            } catch (Exception ex) {
                log.warn("ai-call: auto-book failed for result {} (non-fatal): {}",
                        rRef.getId(), ex.getMessage());
            }
            // Separate try: a booking failure must not cost the caller the brochure they
            // were promised, and vice versa. Two independent promises, two independent
            // failure domains.
            try {
                maybeRunSendRules(rRef, leadRef, instRef);
            } catch (Exception ex) {
                log.warn("ai-call: send rules failed for result {} (non-fatal): {}",
                        rRef.getId(), ex.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    bookTask.run();
                }
            });
        } else {
            bookTask.run();
        }

        r.setProcessingStatus("PROCESSED");
        aiCallResultRepo.save(r);
    }

    // ── lead resolution ─────────────────────────────────────────────────────────

    private Lead resolveLead(AiCallResult r, TelephonyCallLog existing, AiCallingSettingsPojo settings) {
        // Prefer the bound call log's identity — but only when it actually identifies
        // a lead. An inbound row (now bound by corr, not created fresh) may carry no
        // responseId and a placeholder user, so fall through to the phone match below
        // rather than returning an anonymous lead (the pre-corr-gate inbound path did
        // phone-match; keep that attribution).
        if (existing != null
                && (existing.getResponseId() != null || hasRealUser(existing.getUserId()))) {
            String audienceId = existing.getResponseId() == null ? null
                    : audienceResponseRepo.findById(existing.getResponseId())
                        .map(AudienceResponse::getAudienceId).orElse(null);
            return new Lead(existing.getResponseId(), existing.getUserId(), audienceId, existing.getInstituteId());
        }
        // Inbound (or lost correlation): match the lead by the CALLER's phone within the
        // institute, LAST-10 normalized so country-code/format variance can't miss or
        // mis-bind. Uses the exact RIGHT(...,10) lookup, not the old %phone% LIKE (H2).
        String last10 = lastDigits(r.getPhoneNumber());
        if (r.getInstituteId() == null || last10 == null) {
            return new Lead(null, null, null, r.getInstituteId());
        }
        List<Object[]> rows = audienceResponseRepo
                .findLeadIdAndUserByInstituteAndPhoneLast10(r.getInstituteId(), last10);
        if (rows.isEmpty()) {
            // Unknown inbound caller: if the institute opted into inbound lead capture,
            // create (or match on the user record) a lead now so the call is followable.
            Lead captured = captureInboundLeadIfEnabled(r, settings);
            return captured != null ? captured : new Lead(null, null, null, r.getInstituteId());
        }
        Object[] row = rows.get(0); // [audience_response.id, user_id]
        String responseId = (String) row[0];
        String userId = (String) row[1];
        String audienceId = audienceResponseRepo.findById(responseId)
                .map(AudienceResponse::getAudienceId).orElse(null);
        return new Lead(responseId, userId, audienceId, r.getInstituteId());
    }

    /**
     * Inbound helpline lead capture: when an INBOUND report's caller isn't a known lead
     * and the institute opted in, create (or match) a lead so the call is followable.
     * Only ever fires for a report already verified as owned by the institute (the
     * corr-gate ran upstream), so a forged webhook can't inject junk leads. Best-effort
     * — the capture runs in its own transaction and any failure returns null (the call
     * simply stays an anonymous inbound row, exactly as before opt-in). Gated to inbound
     * only: the direction is stamped INBOUND before resolveLead is called.
     */
    private Lead captureInboundLeadIfEnabled(AiCallResult r, AiCallingSettingsPojo settings) {
        boolean inbound = CallDirection.INBOUND.name().equalsIgnoreCase(r.getDirection());
        boolean enabled = settings != null && settings.getInboundLeadCapture() != null
                && settings.getInboundLeadCapture().isEnabled();
        if (!inbound || !enabled || r.getInstituteId() == null
                || r.getPhoneNumber() == null || r.getPhoneNumber().isBlank()) {
            return null;
        }
        try {
            var ref = audienceService.captureInboundCallLead(r.getInstituteId(), r.getPhoneNumber(), null);
            if (ref != null && ref.userId() != null) {
                log.info("ai-call inbound: captured lead response={} user={} for caller {} inst {}",
                        ref.responseId(), ref.userId(), r.getPhoneNumber(), r.getInstituteId());
                return new Lead(ref.responseId(), ref.userId(), ref.audienceId(), r.getInstituteId());
            }
        } catch (Exception e) {
            log.warn("ai-call inbound: lead capture failed for caller {} inst {}: {}",
                    r.getPhoneNumber(), r.getInstituteId(), e.getMessage());
        }
        return null;
    }

    /** A call log's user_id identifies a real lead (not null/blank and not the
     *  inbound "UNKNOWN" placeholder). */
    private static boolean hasRealUser(String userId) {
        return userId != null && !userId.isBlank() && !"UNKNOWN".equalsIgnoreCase(userId);
    }

    // ── call-log promotion ──────────────────────────────────────────────────────

    private String upsertCallLog(AiCallResult r, Lead lead, TelephonyCallLog existing) {
        TelephonyCallLog row = existing;
        if (row == null) {
            // No prior row (inbound). telephony_call_log.user_id is NOT NULL, so we
            // can only create a row when the lead resolved to a user.
            if (lead.userId() == null) return null;
            row = TelephonyCallLog.builder()
                    .id(UUID.randomUUID().toString())
                    .instituteId(lead.instituteId() != null ? lead.instituteId() : r.getInstituteId())
                    .providerType(r.getProvider())
                    .responseId(lead.responseId())
                    .userId(lead.userId())
                    .direction(r.getDirection() != null ? r.getDirection() : CallDirection.INBOUND.name())
                    .toNumber(r.getPhoneNumber())
                    .status(CallStatus.INITIATED.name())
                    .recordingFetchAttempts(0)
                    .recordingLogged(false)
                    .build();
            row.markNew();
            callLogRepo.save(row);
        } else if (lead.userId() != null) {
            // Back-fill attribution onto a previously-unattributed inbound row (created
            // with user_id='UNKNOWN' at answer time) now that we've resolved/created the
            // lead — so the call attaches to the lead's Call History and shows named in
            // the Call Log. Only overwrite the placeholder; never a row that already
            // identifies a real lead (e.g. an outbound row).
            boolean changed = false;
            if (!hasRealUser(row.getUserId())) {
                row.setUserId(lead.userId());
                changed = true;
            }
            if (lead.responseId() != null && row.getResponseId() == null) {
                row.setResponseId(lead.responseId());
                changed = true;
            }
            if (changed) callLogRepo.save(row);
        }
        // Reuse the canonical, rank-ordered idempotent update — the same path Exotel
        // uses — so duplicate/out-of-order reports can't move status backwards.
        NormalizedCallEvent ev = NormalizedCallEvent.builder()
                .correlationId(row.getId())
                .providerCallId(r.getCallUuid())
                .status(mapStatus(r.getStatus()))
                .durationSeconds(r.getDurationSeconds())
                .recordingUrl(r.getRecordingUrl())
                .terminationReason(r.getHangupCause())
                .rawPayload(r.getRawPayload())
                .build();
        // voiceBillable only for rows that PRE-DATE this report (a real telephony row
        // fed by provider webhooks). A row this promotion just minted is a bookkeeping
        // artifact of the report — no telephony webhook will ever reference it, and
        // voice-metering it would double-bill the physical call (the real inbound row
        // bills off the Plivo hangup) or monetize a forged-but-authenticated report.
        callLogService.applyEvent(row, ev, existing != null);
        return row.getId();
    }

    // ── actions ───────────────────────────────────────────────────────────────

    private void applyDecision(AiCallDecision decision, Lead lead, AiCallResult r, boolean connected) {
        switch (decision.action()) {
            case ASSIGN -> {
                // A qualification (not the exhausted-retries hand-off) may move an owned lead
                // to the pool, when the institute has opted in. See assignCounsellor.
                assignCounsellor(lead, !decision.isExhausted());
                setStatus(lead, decision.isExhausted() ? STATUS_NO_ANSWER : STATUS_QUALIFIED);
                // Resume the paused CALL_AI state PAST the node (instead of cancelling it,
                // which killed the graph at CALL_AI) — inject the terminal disposition + the
                // call's output so the node short-circuits out and downstream nodes get the data.
                resumeWorkflowWithOutput(lead.responseId(), r, decision, connected);
            }
            case STOP -> {
                setStatus(lead, decision.isExhausted() ? STATUS_NO_ANSWER : STATUS_NOT_INTERESTED);
                // Terminal disposition (e.g. Not_Interested): resume PAST CALL_AI rather than
                // cancel, so any downstream nodes still run.
                resumeWorkflowWithOutput(lead.responseId(), r, decision, connected);
            }
            // RETRY: leave the paused CALL_AI workflow alone — it resumes itself and re-dials.
            case RETRY -> setStatus(lead, STATUS_RETRY_PENDING);
            case NONE -> { /* AI calling disabled — record only */ }
        }
    }

    /**
     * Cancel→resume bridge: on a terminal AI-call outcome, RESUME the lead's paused
     * CALL_AI state(s) instead of cancelling them, so the workflow graph continues PAST
     * the CALL_AI node. Injects the contract context keys the CALL_AI node reads to
     * short-circuit out without re-dialing:
     *   callOutcome    — the decision action name (ASSIGN | STOP | RETRY)
     *   callDisposition— the raw provider disposition string
     *   callConnected  — whether the call connected (false on a hard STOP)
     * Best-effort: a miss just means the loop runs one more cycle and self-stops on its
     * own assigned / max-retries gate (and stopRetryLoop remains as the fallback path).
     */
    private void resumeWorkflowWithOutput(String resumeKey, AiCallResult r, AiCallDecision decision, boolean connected) {
        if (resumeKey == null || resumeKey.isBlank()) return;
        try {
            List<WorkflowExecutionState> states =
                    executionStateRepository.findActiveAiCallStatesBySubject(resumeKey);
            int resumed = 0;
            for (WorkflowExecutionState state : states) {
                Map<String, Object> ctx = state.getSerializedContext();
                if (ctx == null) continue;
                ctx.put("callOutcome", decision.action().name());
                ctx.put("callDisposition", r.getDisposition());
                // The TRUE connectivity (status completed AND past the connect threshold) — the
                // same value the terminal decision used, so a downstream node reading
                // ctx['callConnected'] never disagrees with what actually happened.
                ctx.put("callConnected", connected);
                // The node's OUTPUT: the structured answers the AI extracted, handed to the
                // workflow so downstream nodes can read them (e.g. #ctx['callAnswers'][...]).
                // This is what makes CALL_AI a generic "get the data" step for any subject.
                if (r.getExtractedQa() != null) ctx.put("callAnswers", r.getExtractedQa());
                // Atomic, status-guarded update (WHERE status='WAITING') rather than a JPA
                // read-modify-save: if the resume job already claimed this row (RESUMED) in
                // the meantime, this no-ops instead of reverting it to WAITING and causing a
                // double dial/assign. resume_at=now() so the next resume tick picks it up.
                String ctxJson = objectMapper.writeValueAsString(ctx);
                resumed += executionStateRepository.resumeWithContextIfWaiting(state.getId(), ctxJson);
            }
            if (resumed > 0) {
                log.info("ai-call outcome: resumed {} paused CALL_AI state(s) past the node for subject {} (outcome={} disposition={} connected={})",
                        resumed, resumeKey, decision.action(), r.getDisposition(), connected);
            }
        } catch (Exception e) {
            log.warn("ai-call outcome: could not resume CALL_AI state for subject {}: {}",
                    resumeKey, e.getMessage());
        }
    }

    /**
     * Cancel the lead's paused AI-call workflow (the CALL_AI pause/resume retry loop)
     * so it stops re-dialing once the outcome is terminal (assigned / not-interested).
     * Best-effort — a miss just means the loop runs one more cycle and self-stops on
     * its own assigned / max-retries gate.
     */
    private void stopRetryLoop(Lead lead) {
        if (lead.responseId() == null) return;
        try {
            int cancelled = executionStateRepository.cancelAiCallRetriesByResponseId(lead.responseId());
            if (cancelled > 0) {
                log.info("ai-call outcome: stopped {} paused retry loop(s) for lead {}", cancelled, lead.userId());
            }
        } catch (Exception e) {
            log.warn("ai-call outcome: could not cancel retry loop for response {}: {}",
                    lead.responseId(), e.getMessage());
        }
    }

    /**
     * Terminal handoff when the CALL_AI retry loop gives up (attempts hit maxRetries
     * with no pickup). Mirrors the classifier's exhausted() branch: assign the lead
     * to a human (when {@code assignExhaustedToHuman}) and stamp AI_NO_ANSWER — so an
     * exhausted no-answer lead is never silently dropped. Called by the CALL_AI node.
     */
    @Transactional
    public void giveUpAfterRetries(String responseId, String instituteId, String userId) {
        if (responseId == null || responseId.isBlank() || instituteId == null || instituteId.isBlank()) return;
        String audienceId = audienceResponseRepo.findById(responseId)
                .map(AudienceResponse::getAudienceId).orElse(null);
        Lead lead = new Lead(responseId, userId, audienceId, instituteId);
        AiCallingSettingsPojo settings = settingsService.get(instituteId);
        if (settings.isAssignExhaustedToHuman()) {
            assignCounsellor(lead);
        }
        setStatus(lead, STATUS_NO_ANSWER);
        log.info("ai-call: retries exhausted for lead {} -> AI_NO_ANSWER (assignToHuman={})",
                userId, settings.isAssignExhaustedToHuman());
    }

    private void assignCounsellor(Lead lead) {
        assignCounsellor(lead, false);
    }

    /**
     * @param qualified true when this is a real qualification (a disposition the institute
     *                  maps to "assign"), false for the exhausted-retries hand-off. Only a
     *                  qualification may move a lead that already has an owner, and only when
     *                  {@code reassignQualifiedToPool} is on for the institute.
     */
    private void assignCounsellor(Lead lead, boolean qualified) {
        if (lead.audienceId() == null || lead.userId() == null) {
            log.info("ai-call assign: skipped (no audience/user) for lead {}", lead.userId());
            return;
        }
        // A lead that ALREADY has a counsellor keeps them. The rotation exists to give an
        // UNOWNED lead an owner, not to move one between people.
        //
        // Before CALL_AI could opt out of the already-assigned guard, this could not happen:
        // automation never dialled an owned lead, so every lead reaching this method was
        // unowned and the rotation was always the right answer. With ignoreAssignedGuard the
        // canonical flow is "counsellor rings the lead, marks it DNP, the bot re-calls" — and
        // without this check that flow ENDS by handing their lead to whoever is next in the
        // rotation and ringing that person's bell, silently taking it off the counsellor who
        // is actively working it. assignCounselor() overwrites assigned_counselor_id with no
        // guard of its own (it is also the manual-reassignment path, so it must not grow one).
        String currentOwner = userLeadProfileRepository
                .findByUserIdAndInstituteId(lead.userId(), lead.instituteId())
                .map(UserLeadProfile::getAssignedCounselorId)
                .filter(id -> id != null && !id.isBlank())
                .orElse(null);
        if (currentOwner != null) {
            // The opt-in escape: a lead the bot actually QUALIFIED goes to the pool the list is
            // attached to, even though it already has an owner. Only a qualification, never the
            // exhausted-retries hand-off — see AiCallingSettingsPojo#reassignQualifiedToPool.
            AiCallingSettingsPojo settings = settingsService.get(lead.instituteId());
            boolean mayReassign = qualified && settings != null && settings.isReassignQualifiedToPool();
            if (!mayReassign) {
                log.info("ai-call assign: lead {} already owned by counsellor {} — keeping them (no rotation)",
                        lead.userId(), currentOwner);
                return;
            }
            log.info("ai-call assign: lead {} is owned by {} but the AI qualified it and "
                            + "reassignQualifiedToPool is on — routing to the pool",
                    lead.userId(), currentOwner);
        }
        Optional<String> counselorId = counselorAssignmentService.assignCounselorForLead(lead.audienceId());
        if (counselorId.isEmpty()) {
            log.info("ai-call assign: no counsellor returned (manual/empty pool) for audience {}", lead.audienceId());
            return;
        }
        if (counselorId.get().equals(currentOwner)) {
            // The rotation landed on the person who already holds it. Nothing to write, and no
            // assignment bell for a change that is not a change.
            log.info("ai-call assign: rotation picked the current owner {} for lead {} — no change",
                    currentOwner, lead.userId());
            return;
        }
        userLeadProfileService.assignCounselor(lead.userId(), lead.instituteId(), counselorId.get(), null);
        log.info("ai-call assign: lead {} -> counsellor {}{}", lead.userId(), counselorId.get(),
                currentOwner != null ? " (reassigned from " + currentOwner + ")" : "");
    }

    private void setStatus(Lead lead, String statusKey) {
        if (lead.instituteId() == null || lead.responseId() == null) return;
        LeadStatus status = leadStatusRepo.findByInstituteIdAndStatusKey(lead.instituteId(), statusKey).orElse(null);
        if (status == null) {
            log.debug("ai-call status: '{}' not in catalog for institute {} — skipping stamp", statusKey, lead.instituteId());
            return;
        }
        leadStatusService.changeLeadStatus(lead.responseId(), status.getId(), null, "AI_CALLING");
    }

    /**
     * Stamp the lead status to whatever institute lead-status matches the call
     * disposition by name (e.g. disposition "Callback" → status_key CALL_BACK or label
     * "Call Back"; "Not_Interested" → NOT_INTERESTED). Matching is case- and
     * separator-insensitive. If the institute has no matching status the lead is left
     * untouched (never forced to a non-existent status). This is what makes a Callback
     * move the lead off "New" even though Callback is a retry-worthy disposition.
     */
    private void stampStatusFromDisposition(Lead lead, String disposition) {
        if (lead.instituteId() == null || lead.responseId() == null
                || disposition == null || disposition.isBlank()) return;
        String norm = normalizeKey(disposition);
        if (norm.isEmpty()) return;

        // The institute's configured mapping wins over the name match. This is what lets
        // an agent vocabulary the catalog does not contain ("Quiz_Link_Sent") still land
        // the lead on a real status ("FOLLOWUP") — and it works on EVERY webhook, with no
        // workflow involved, so an outcome that arrives after its workflow closed is still
        // recorded instead of being silently dropped.
        String mapped = resolveConfiguredStatusKey(lead.instituteId(), norm);
        if (mapped != null) {
            LeadStatus target = leadStatusRepo
                    .findByInstituteIdAndStatusKey(lead.instituteId(), mapped).orElse(null);
            if (target != null) {
                leadStatusService.changeLeadStatus(lead.responseId(), target.getId(), null, "AI_CALLING");
                log.info("ai-call status: lead {} -> {} (configured mapping for disposition '{}')",
                        lead.userId(), target.getStatusKey(), disposition);
                return;
            }
            log.warn("ai-call status: disposition '{}' maps to status '{}' which institute {} does not have "
                            + "— falling back to a name match", disposition, mapped, lead.instituteId());
        }

        LeadStatus match = leadStatusRepo
                .findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(lead.instituteId())
                .stream()
                .filter(s -> norm.equals(normalizeKey(s.getStatusKey())) || norm.equals(normalizeKey(s.getLabel())))
                .findFirst()
                .orElse(null);
        if (match == null) {
            log.info("ai-call status: no lead-status matches disposition '{}' for institute {} — leaving as-is",
                    disposition, lead.instituteId());
            return;
        }
        leadStatusService.changeLeadStatus(lead.responseId(), match.getId(), null, "AI_CALLING");
        log.info("ai-call status: lead {} -> {} (matched disposition '{}')",
                lead.userId(), match.getStatusKey(), disposition);
    }

    /**
     * The status key this institute has configured for a disposition, or null when it has
     * not mapped one. Keys are compared normalised, so the admin can type the disposition
     * however they like.
     */
    private String resolveConfiguredStatusKey(String instituteId, String normalisedDisposition) {
        try {
            AiCallingSettingsPojo s = settingsService.get(instituteId);
            if (s == null || s.getDispositionStatusMap() == null) return null;
            for (var e : s.getDispositionStatusMap().entrySet()) {
                if (e.getKey() == null || e.getValue() == null || e.getValue().isBlank()) continue;
                if (normalisedDisposition.equals(normalizeKey(e.getKey()))) return e.getValue().trim();
            }
        } catch (Exception e) {
            log.debug("ai-call status: disposition map lookup failed for {}: {}", instituteId, e.getMessage());
        }
        return null;
    }

    /** Upper-case alphanumerics only, so "Call Back" / "CALL_BACK" / "Callback" all match. */
    private String normalizeKey(String s) {
        return s == null ? "" : s.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
    }

    /**
     * Faults that mean the call failed on OUR side, so its disposition is not
     * evidence about the lead.
     *
     * <p>Deliberately NOT the whole RED set. {@code DEAD_AIR}, {@code ANSWER_DELETED}
     * and {@code LIKELY_MACHINE} are frequently RED on calls the caller answered
     * perfectly well — on the 2026-08-14 sample they were 46%, 60% and 30% of calls
     * respectively, so treating them as untrustworthy would push most outcomes onto
     * the retry path and re-dial leads who had a real conversation. These mean
     * the agent could not hold up its end at all. {@code CALLER_IGNORED} (voice bot
     * rules v7, 2026-10-14) is RED when two caller turns met silence — checked
     * against the audio that played — so the lead never heard us either.
     */
    private static final List<String> UNTRUSTWORTHY_FAULTS =
            List.of("BOT_SILENT", "TTS_WEDGE", "HANDBACK_LOOP", "REPLY_LOOP", "CALLER_IGNORED");

    /**
     * True when the voice bot's own verdict says this call was broken by us:
     * health RED <b>and</b> at least one {@link #UNTRUSTWORTHY_FAULTS} code.
     *
     * <p>Both conditions are required. RED alone is too broad (see above), and a
     * fault code alone can be AMBER, which is a degraded-but-usable call.
     * Absent diagnostics (older bot builds, non-VACADEMY_AI providers) read as
     * trustworthy, preserving the prior behaviour exactly.
     */
    public static boolean isUntrustworthyCall(AiCallResult r) {
        if (r == null || !"RED".equalsIgnoreCase(r.getDiagHealth())) return false;
        String faults = r.getDiagFaults();
        if (faults == null || faults.isBlank()) return false;
        String upper = faults.toUpperCase();
        return UNTRUSTWORTHY_FAULTS.stream().anyMatch(upper::contains);
    }

    /**
     * True if the call really connected: status "completed" AND past the institute's connect
     * threshold (absent duration ⇒ trust "completed"). Same rule as {@link AiCallOutcomeClassifier}
     * — kept consistent so the {@code callConnected} we hand the workflow matches the decision.
     */
    private boolean isConnected(AiCallResult r, AiCallingSettingsPojo s) {
        String status = r.getStatus();
        if (status == null || !status.trim().equalsIgnoreCase("completed")) return false;
        Integer d = r.getDurationSeconds();
        return d == null || d >= s.getConnectThresholdSec();
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private CallStatus mapStatus(String s) {
        if (s == null) return CallStatus.COMPLETED;
        return switch (s.trim().toLowerCase()) {
            case "completed", "complete" -> CallStatus.COMPLETED;
            case "no-answer", "no_answer", "noanswer", "missed" -> CallStatus.NO_ANSWER;
            case "busy" -> CallStatus.BUSY;
            case "failed", "error" -> CallStatus.FAILED;
            case "cancelled", "canceled" -> CallStatus.CANCELLED;
            default -> CallStatus.COMPLETED;
        };
    }

    /** Last 10 digits — tolerates country-code variance when matching by phone. */
    private String lastDigits(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) return null;
        return digits.length() <= 10 ? digits : digits.substring(digits.length() - 10);
    }

    /**
     * True when {@code campaignId} is one the institute tagged INBOUND in its
     * AI_CALLING_SETTING campaign registry. Blank id / no campaigns ⇒ false (the call
     * stays outbound — the default for every institute that hasn't registered inbound
     * campaigns, so existing behaviour is unchanged until they opt in).
     */
    private boolean isInboundCampaign(String campaignId, AiCallingSettingsPojo settings) {
        if (campaignId == null || campaignId.isBlank()
                || settings == null || settings.getCampaigns() == null) return false;
        return settings.getCampaigns().stream().anyMatch(c ->
                c != null && "INBOUND".equalsIgnoreCase(c.getDirection())
                        && campaignId.equals(c.getCampaignId()));
    }

    /**
     * If the AI report flags a scheduled meeting/demo/visit with a resolvable time and the
     * call's agent (VACADEMY_AI campaignId == agent id) is linked to a booking page, create
     * a booking on that page for the lead. The page supplies host, duration, Google Meet and
     * reminders; its linked audience list handles adding/refreshing the lead (name + phone).
     * We only pass name/phone/email we already have — no custom fields (the caller can't fill
     * arbitrary list fields on a call; when the lead already exists, its data is reused).
     */
    private void maybeAutoBookMeeting(AiCallResult r, Lead lead, String instituteId) {
        if (!ProviderType.VACADEMY_AI.equals(r.getProvider()) || r.getCampaignId() == null) return;
        String bookingPageId = aiAgentService.find(r.getCampaignId(), instituteId)
                .map(a -> a.getBookingPageId()).orElse(null);
        if (bookingPageId == null || bookingPageId.isBlank()) return;

        // Meeting intent + resolved time live in the raw report payload the voice bot posted
        // (meetingRequested / meetingDatetimeIso). Absent for non-VACADEMY_AI providers.
        String rawIso = null; boolean requested = false;
        try {
            com.fasterxml.jackson.databind.JsonNode root = objectMapper.readTree(
                    r.getRawPayload() == null ? "{}" : r.getRawPayload());
            requested = root.path("meetingRequested").asBoolean(false);
            com.fasterxml.jackson.databind.JsonNode isoNode = root.path("meetingDatetimeIso");
            if (isoNode != null && !isoNode.isNull() && !isoNode.asText().isBlank()) {
                rawIso = isoNode.asText().trim();
            }
        } catch (Exception ex) {
            log.warn("ai-call: could not parse report payload for booking (result {}): {}",
                    r.getId(), ex.getMessage());
            return;
        }
        if (!requested || rawIso == null) return;

        // Guard against a mis-resolved past time (LLM occasionally resolves 'tomorrow'
        // to the wrong day, or picks a time already elapsed). A past meeting is useless
        // (no reminder fires) — skip rather than create junk. Small grace for end-of-call
        // 'in a few minutes' cases.
        try {
            java.time.OffsetDateTime when = java.time.OffsetDateTime.parse(rawIso);
            if (when.toInstant().isBefore(java.time.Instant.now().minusSeconds(120))) {
                log.info("ai-call: skip auto-book for result {} — resolved time {} is in the past",
                        r.getId(), rawIso);
                return;
            }
        } catch (Exception ex) {
            log.warn("ai-call: skip auto-book for result {} — unparseable meeting time '{}': {}",
                    r.getId(), rawIso, ex.getMessage());
            return;
        }

        // A BOOK_MEETING rule can route this call to a different page than the agent's
        // default (different meeting types, different hosts). Rules never CREATE the
        // booking — this method already validates the resolved time and runs post-commit,
        // and a second copy of that would drift. They only choose the page.
        try {
            var ruleAgent = aiAgentService.find(r.getCampaignId(), instituteId).orElse(null);
            if (ruleAgent != null) {
                var reportRoot = objectMapper.readTree(
                        r.getRawPayload() == null ? "{}" : r.getRawPayload());
                String override = aiCallActionService.bookingPageOverride(
                        ruleAgent, reportRoot, r.getDisposition());
                if (override != null && !override.isBlank()) bookingPageId = override;
            }
        } catch (Exception ex) {
            log.warn("ai-call: booking-page rule lookup failed for result {} — using the "
                    + "agent default: {}", r.getId(), ex.getMessage());
        }

        // Validate the page belongs to this institute + resolve its host for the principal.
        var page = bookingPageService.getOrThrow(bookingPageId);
        if (page == null || !instituteId.equals(page.getInstituteId())) {
            log.warn("ai-call: booking page {} missing or cross-institute for result {} — skip",
                    bookingPageId, r.getId());
            return;
        }

        var req = vacademy.io.admin_core_service.features.booking.dto.MeetingBookingRequestDTO.builder()
                .instituteId(instituteId)
                .bookingPageId(bookingPageId)
                .startTime(rawIso)                         // exact time the caller agreed to
                .audienceResponseId(lead.responseId())     // links + reuses the existing lead
                .inviteeUserId(lead.userId())
                .inviteeName(r.getCustomerName())
                .inviteePhone(r.getPhoneNumber())
                .inviteeEmail(r.getCustomerEmail())
                .build();

        var principal = new vacademy.io.common.auth.model.CustomUserDetails(
                buildHostPrincipal(page.getHostUserId()));
        var created = meetingBookingService.createBooking(req, principal);
        log.info("ai-call: auto-booked meeting {} on page {} for lead {} at {}",
                created != null ? created.getId() : "?", bookingPageId, lead.responseId(), rawIso);
    }

    /**
     * Create the WhatsApp / email actions this agent's rules call for.
     *
     * <p>Post-commit and fully isolated, for the same reason the auto-book is: the
     * disposition, the counsellor assignment and the lead status are what matter, and a
     * brochure must never be able to roll them back. Every failure inside is swallowed and
     * logged; the method cannot throw.
     */
    private void maybeRunSendRules(AiCallResult r, Lead lead, String instituteId) {
        var agent = aiAgentService.find(r.getCampaignId(), instituteId).orElse(null);
        if (agent == null) return;
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = objectMapper.readTree(r.getRawPayload() == null ? "{}" : r.getRawPayload());
        } catch (Exception ex) {
            log.warn("ai-call: unreadable report payload for send rules (result {}): {}",
                    r.getId(), ex.getMessage());
            return;
        }
        // callLogId is half the idempotency key. It is the same value as correlationId for
        // an outbound VACADEMY_AI call (telephony_call_log.id == corr); the fallback covers
        // a report that could not be bound to a log row.
        String callKey = (r.getCallLogId() != null && !r.getCallLogId().isBlank())
                ? r.getCallLogId() : r.getCorrelationId();
        aiCallActionService.applyPostCall(agent, instituteId, callKey,
                lead.userId(), lead.responseId(), root, r.getDisposition(), r.getCustomerName(),
                r.getPhoneNumber(), r.getCustomerEmail());
    }

    private vacademy.io.common.auth.dto.UserServiceDTO buildHostPrincipal(String hostUserId) {
        var dto = new vacademy.io.common.auth.dto.UserServiceDTO();
        dto.setUserId(hostUserId);
        dto.setUsername("ai-call-autobook");
        return dto;
    }

}
