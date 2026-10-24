package vacademy.io.admin_core_service.features.workflow.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallNodeDispatcher;
import vacademy.io.admin_core_service.features.telephony.core.AiCallOutcomeProcessor;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.CallingWindowUtil;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecutionState;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowExecutionStatus;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionStateRepository;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;

import java.time.Instant;
import java.util.Collection;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CALL_AI workflow node — a re-entrant, phase-routed AI caller that IS the retry
 * loop. On each (re)entry it decides what to do for the lead from the institute's
 * AI_CALLING_SETTING (caps + shifts + timings), then:
 *   DIAL  → enqueue one paced AI call, bump the attempt counters, and PAUSE the
 *           workflow (persist {@code workflow_execution_state}) until the next window;
 *   DEFER → PAUSE for a re-check (outside the calling shifts / hit the per-day cap);
 *   STOP  → complete (lead assigned, out of retries, or AI calling off).
 *
 * <p>The retry state (attempt counts) lives in the paused execution's serialized
 * context — the general workflow pause/resume table, not a telephony table. When the
 * end-of-call outcome is terminal (assigned / not-interested), AiCallOutcomeProcessor
 * cancels the paused state so the loop stops early. The same node serves the
 * first call and every retry — one node, no separate re-dialer.
 */
@Component
@RequiredArgsConstructor
public class CallAiNodeHandler implements NodeHandler {

    private static final Logger log = LoggerFactory.getLogger(CallAiNodeHandler.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final AiCallNodeDispatcher aiCallDispatcher;
    private final vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService aiCallQueueService;
    private final AiCallingSettingsService settingsService;
    private final UserLeadProfileRepository userLeadProfileRepository;
    private final WorkflowExecutionStateRepository executionStateRepository;
    private final WorkflowExecutionRepository executionRepository;
    private final SpelEvaluator spelEvaluator;
    private final vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository callLogRepo;
    private final ObjectMapper mapper = new ObjectMapper();

    /** Server-wide fallback institute daily-cap (mirrors AiCallService); 0 disables. */
    @org.springframework.beans.factory.annotation.Value("${telephony.ai.max-calls-per-day-default:500}")
    private int globalMaxCallsPerDay;

    /**
     * Field-injected with {@code @Lazy} to break an init-time bean cycle:
     * CALL_AI → AiCallOutcomeProcessor → LeadStatusService → WorkflowTriggerService →
     * WorkflowEngineService → NodeHandlerRegistry → CALL_AI. It's only used at runtime
     * on the exhausted-retry handoff, so a lazily-resolved proxy is correct.
     */
    @Autowired
    @Lazy
    private AiCallOutcomeProcessor aiCallOutcomeProcessor;

    @Override
    public boolean supports(String nodeType) {
        return "CALL_AI".equalsIgnoreCase(nodeType);
    }

    @Override
    public Map<String, Object> handle(Map<String, Object> context, String nodeConfigJson,
                                      Map<String, NodeTemplate> nodeTemplates, int countProcessed) {
        Map<String, Object> out = new HashMap<>();

        // Cohort (forEach) mode: when the node config carries a "forEach" block, iterate a
        // source list from context (e.g. a QUERY node's ssigm_list) and enqueue one paced AI
        // call per item — a provider-agnostic broadcast. Distinct from the single-subject
        // retry flow below (which runs whenever there is no forEach). No per-item pause/retry.
        JsonNode forEach = readConfigNode(nodeConfigJson, "forEach");
        if (forEach != null && forEach.isObject()) {
            return handleCohort(context, nodeConfigJson, forEach, out);
        }

        String instituteId = str(context.get("instituteId"));
        String userId = firstNonBlank(str(context.get("leadUserId")), str(context.get("userId")));
        String phone = firstNonBlank(str(context.get("phone")), str(context.get("parentMobile")));
        // The lead id (audience_response.id). NOTE: "eventId" is the AUDIENCE id, not
        // the lead, so it is deliberately NOT a fallback.
        String responseId = firstNonBlank(str(context.get("responseId")), str(context.get("leadId")));
        // Campaign: prefer a provider-agnostic agent NAME (resolved per-provider from the
        // campaigns registry downstream); a raw campaignId still works as an override.
        String campaignName = firstNonBlank(readConfig(nodeConfigJson, "campaignName"), str(context.get("campaignName")));
        String campaignId = firstNonBlank(readConfig(nodeConfigJson, "campaignId"), str(context.get("campaignId")));
        // Subject envelope: who we're calling. Blank ⇒ LEAD with subjectId = the lead's
        // responseId, so existing lead workflows (which set neither) behave exactly as before.
        // PACKAGE_SESSION_STUDENT / LIVE_SESSION_PARTICIPANT set these in their initial context.
        String subjectType = firstNonBlank(str(context.get("subjectType")), "LEAD");
        String subjectId = firstNonBlank(str(context.get("subjectId")), responseId);
        // Provider per-node (node config wins, else workflow context, else AiCallService
        // falls back to the institute's AI_CALLING_SETTING default). Lets one builder pick
        // the provider for this node without touching global settings.
        String provider = firstNonBlank(readConfig(nodeConfigJson, "provider"), str(context.get("provider")));
        // Opt-in escape from the already-assigned guard. OFF by default: automation that
        // re-dials leads a counsellor already owns is exactly what the guard exists to stop.
        // Turned ON only for graphs deliberately built to target owned leads — the canonical
        // case being "a counsellor manually called and dispositioned this lead DNP, now let
        // the bot try again", where the lead is assigned BY DEFINITION and the guard would
        // silently stop every dial. The daily cap and duplicate window still apply.
        boolean ignoreAssignedGuard = readConfigBool(nodeConfigJson, "ignoreAssignedGuard");
        // Arbitrary call metadata handed to the AI agent (e.g. studentName, sessionName,
        // courseName — whatever the conversation needs). Static keys come from the node
        // config's "metadata" object; dynamic per-run values from the context's
        // "aiCallMetadata" map (set by the trigger / an upstream node / the cohort scheduler).
        // This is what makes the node reusable for ANY purpose — it carries whatever the agent
        // needs, not a fixed lead/feedback shape. Round-trips on the webhook for correlation.
        Map<String, Object> callMetadata = new HashMap<>();
        Map<String, Object> cfgMeta = readConfigMap(nodeConfigJson, "metadata");
        if (cfgMeta != null) callMetadata.putAll(cfgMeta);
        if (context.get("aiCallMetadata") instanceof Map<?, ?> m) {
            m.forEach((k, v) -> callMetadata.put(String.valueOf(k), v));
        }

        int attempts = asInt(context.get("aiCallAttempts"));
        int callsToday = asInt(context.get("aiCallsToday"));
        String callsDay = str(context.get("aiCallDay"));

        // Cancel→resume bridge: the outcome processor resumed this paused state with a
        // terminal disposition injected (callOutcome). Short-circuit OUT of the node —
        // route to the next node via normal traversal — without re-dialing or pausing.
        // The bridge keys (callOutcome / callDisposition / callConnected / callAnswers)
        // are LEFT in the live context: the nodes after this one are exactly what reads
        // them (the template's CONDITION "#ctx['callOutcome'] == 'ASSIGN'"), and the
        // engine runs them on this same map. Removing them here made that branch
        // unreachable — every lead landed on the "false" leg.
        //
        // The one-shot guarantee is enforced by aiCallDone instead: it is set true by
        // this short-circuit and reset to false the moment the node dials again, so a
        // graph that loops back to CALL_AI after a terminal outcome sees the stale
        // callOutcome but is NOT short-circuited by it — the stale keys are dropped and
        // a fresh dial is planned. remove() not null-put: a "null" round-trips to the
        // String "null".
        String callOutcome = str(context.get("callOutcome"));
        boolean outcomeAlreadyConsumed = "true".equalsIgnoreCase(str(context.get("aiCallDone")));
        if (("ASSIGN".equals(callOutcome) || "STOP".equals(callOutcome)) && !outcomeAlreadyConsumed) {
            out.put("aiCallDone", true);
            out.put("aiCallStopReason", "disposition_terminal");
            log.info("CALL_AI node: terminal disposition ({}) for lead {} — routing out without re-dial", callOutcome, userId);
            return out;   // routes to next node via normal traversal; does NOT pause/dial; does NOT call giveUpAfterRetries
        }
        // Not a terminal resume: anything still under the bridge keys is left over from
        // an earlier call (loop-back / a second CALL_AI node) — drop it so no downstream
        // node reads the previous call's outcome as this call's. Reset aiCallDone on the
        // LIVE context too (not only on `out`): the DIAL/DEFER paths below snapshot
        // `context` into the paused state, and that snapshot is what the webhook bridge
        // resumes — a stale true there would make the next terminal outcome look
        // already-consumed and re-dial an interested lead.
        context.remove("callOutcome");
        context.remove("callDisposition");
        context.remove("callConnected");
        context.remove("callAnswers");
        context.put("aiCallDone", false);
        out.put("aiCallDone", false);

        // The previous attempt may not have become a call yet: the queue can be paused,
        // out of credits, outside calling hours, or simply deep. Counting those as
        // attempts is how a lead gets declared unreachable while its call is still
        // sitting in the queue — and how pausing the queue silently burns a campaign's
        // retries. Wait for the call to actually happen before spending the attempt.
        String waitingSubject = firstNonBlank(userId, subjectId, responseId, phone);
        if (waitingSubject != null
                && aiCallQueueService.hasCallWaiting(instituteId, provider, waitingSubject)) {
            Instant recheck = Instant.now().plus(
                    Math.max(1, settingsService.get(instituteId).getRecheckMinutes()), ChronoUnit.MINUTES);
            pauseWorkflow(context, recheck, "AI_CALL_AWAITING_DIAL", out);
            log.info("CALL_AI node: lead {} still has a call waiting in the queue — deferring to {} "
                    + "without spending attempt {} of {}", userId, recheck, attempts + 1,
                    settingsService.get(instituteId).getMaxRetries());
            out.put("aiCallAwaitingDial", true);
            return out;
        }

        Plan plan = plan(instituteId, userId, attempts, callsToday, callsDay, provider, ignoreAssignedGuard);

        switch (plan.action()) {
            case STOP -> {
                log.info("CALL_AI node: stop ({}) for lead {} after {} attempt(s)", plan.reason(), userId, attempts);
                // Gave up after maxRetries with no pickup → LEAD terminal handoff
                // (assign-to-human per settings + stamp AI_NO_ANSWER). Lead-specific: a
                // non-lead subject just completes the node (the workflow continues with the
                // exhausted reason; no lead assignment / status).
                if ("exhausted".equals(plan.reason()) && "LEAD".equalsIgnoreCase(subjectType)) {
                    aiCallOutcomeProcessor.giveUpAfterRetries(responseId, instituteId, userId);
                }
                out.put("aiCallDone", true);
                out.put("aiCallStopReason", plan.reason());
            }
            case DEFER -> {
                pauseWorkflow(context, plan.resumeAt(), "AI_CALL_RECHECK", out);
                log.info("CALL_AI node: deferring ({}) lead {} until {}", plan.reason(), userId, plan.resumeAt());
            }
            case DIAL -> {
                AiCallRequestDTO req = new AiCallRequestDTO();
                req.setInstituteId(instituteId);
                req.setUserId(userId);
                req.setPhoneNumber(phone);
                req.setResponseId(responseId);
                req.setCampaignName(campaignName); // provider-agnostic agent; resolved downstream
                req.setCampaignId(campaignId);     // raw override (back-compat)
                req.setProvider(provider);         // null ⇒ AiCallService uses the settings default
                req.setSubjectType(subjectType);
                req.setSubjectId(subjectId);
                if (!callMetadata.isEmpty()) req.setMetadata(callMetadata);

                // paced; placeCall re-applies the same guards server-side. The trigger must
                // match the decision plan() just made, or placeCall would refuse a dial the
                // node already counted as an attempt.
                aiCallDispatcher.enqueue(req, ignoreAssignedGuard
                        ? CallTrigger.WORKFLOW_EXPLICIT : CallTrigger.AUTOMATION);

                int newAttempts = attempts + 1;
                String today = LocalDate.now(IST).toString();
                int newCallsToday = today.equals(callsDay) ? callsToday + 1 : 1;

                Map<String, Object> pauseContext = new HashMap<>(context);
                pauseContext.put("aiCallAttempts", newAttempts);
                pauseContext.put("aiCallsToday", newCallsToday);
                pauseContext.put("aiCallDay", today);
                if (responseId != null) pauseContext.put("responseId", responseId); // lead resume lookup
                if (subjectId != null) pauseContext.put("subjectId", subjectId);     // generic subject resume lookup

                pauseWorkflow(pauseContext, plan.resumeAt(), "AI_CALL_RETRY", out);
                log.info("CALL_AI node: queued AI call for lead {} (attempt {}); pausing until {}",
                        userId, newAttempts, plan.resumeAt());
                out.put("aiCallQueued", true);
                out.put("aiCallAttempt", newAttempts);
            }
        }
        return out;
    }

    /** Persist a paused execution state and mark the execution PAUSED — the existing
     *  WorkflowResumeJob re-runs the workflow at {@code resumeAt}. */
    private void pauseWorkflow(Map<String, Object> context, Instant resumeAt, String reason, Map<String, Object> out) {
        String executionId = str(context.get("executionId"));
        if (executionId == null) {
            // No execution to pause (e.g. a manual/test invocation) — can't loop; just dialed once.
            log.warn("CALL_AI node: no executionId in context — cannot pause for retry");
            out.put("__workflow_paused", false);
            return;
        }
        String nodeId = firstNonBlank(str(context.get("currentNodeId")), "CALL_AI");

        WorkflowExecutionState state = WorkflowExecutionState.builder()
                .executionId(executionId)
                .pausedAtNodeId(nodeId)
                .serializedContext(new HashMap<>(context))
                .resumeAt(resumeAt)
                .pauseReason(reason)
                .status("WAITING")
                .build();
        executionStateRepository.save(state);

        executionRepository.findById(executionId).ifPresent(ex -> {
            ex.setStatus(WorkflowExecutionStatus.PAUSED);
            executionRepository.save(ex);
        });

        out.put("__workflow_paused", true);
        out.put("resumeAt", resumeAt.toString());
    }

    private String readConfig(String json, String key) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode v = mapper.readTree(json).get(key);
            return v == null || v.isNull() ? null : v.asText();
        } catch (Exception e) {
            return null;
        }
    }

    /** Read a boolean flag from the node config; absent / unparseable ⇒ false. */
    private boolean readConfigBool(String json, String key) {
        if (json == null || json.isBlank()) return false;
        try {
            JsonNode v = mapper.readTree(json).get(key);
            // asBoolean() also accepts the string "true", which is what the builder's
            // config panel writes for a checkbox.
            return v != null && !v.isNull() && v.asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /** Read a JSON object node from the node config as a Map (for the metadata bag). */
    @SuppressWarnings("unchecked")
    private Map<String, Object> readConfigMap(String json, String key) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode v = mapper.readTree(json).get(key);
            if (v == null || !v.isObject()) return null;
            return mapper.convertValue(v, Map.class);
        } catch (Exception e) {
            return null;
        }
    }

    /** Read a raw JSON node from the node config (for nested config blocks like forEach). */
    private JsonNode readConfigNode(String json, String key) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode v = mapper.readTree(json).get(key);
            return (v == null || v.isNull()) ? null : v;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Cohort broadcast: enqueue one paced AI call per item in a source list (e.g. a QUERY
     * node's {@code ssigm_list}). Each item's fields map to the call — defaults match
     * fetch_ssigm_by_package (userId / mobileNumber / packageSessionId / fullName); override
     * via the forEach config. Fire-and-forget + paced (no per-item pause/retry); each call's
     * answers land on ai_call_result, subject-tagged. The node then completes so the workflow
     * continues to its next node. Provider-agnostic: agent name + provider come from node
     * config (or context), exactly like the single-subject path.
     *
     * Config shape:
     * {
     *   "forEach": { "source": "#ctx['ssigm_list']", "subjectType": "PACKAGE_SESSION_STUDENT",
     *                "userIdField": "userId", "phoneField": "mobileNumber",
     *                "subjectIdField": "packageSessionId", "nameField": "fullName" },
     *   "campaignName": "Class Feedback", "provider": "MOCK",
     *   "metadata": { "sessionName": "..." }
     * }
     */
    private Map<String, Object> handleCohort(Map<String, Object> context, String nodeConfigJson,
                                             JsonNode forEach, Map<String, Object> out) {
        String source = forEach.path("source").asText("");
        if (isBlank(source)) {
            out.put("aiCallCohortError", "forEach.source is required");
            return out;
        }
        Object listObj;
        try {
            listObj = spelEvaluator.evaluate(source, context);
        } catch (Exception e) {
            out.put("aiCallCohortError", "could not evaluate forEach.source: " + e.getMessage());
            return out;
        }
        if (!(listObj instanceof Collection)) {
            out.put("aiCallCohortError", "forEach.source did not resolve to a list");
            return out;
        }

        String instituteId = str(context.get("instituteId"));
        // Agent + provider — same resolution as the single-subject path (config wins, else context).
        String campaignName = firstNonBlank(readConfig(nodeConfigJson, "campaignName"), str(context.get("campaignName")));
        String campaignId = firstNonBlank(readConfig(nodeConfigJson, "campaignId"), str(context.get("campaignId")));
        String provider = firstNonBlank(readConfig(nodeConfigJson, "provider"), str(context.get("provider")));

        // Subject + per-item field mapping (defaults align with fetch_ssigm_by_package output).
        String subjectType = firstNonBlank(forEach.path("subjectType").asText(null), "PACKAGE_SESSION_STUDENT");
        String userIdField = forEach.path("userIdField").asText("userId");
        String phoneField = forEach.path("phoneField").asText("mobileNumber");
        String subjectIdField = forEach.path("subjectIdField").asText("packageSessionId");
        String nameField = forEach.path("nameField").asText("fullName");
        Map<String, Object> metaTemplate = readConfigMap(nodeConfigJson, "metadata");

        int queued = 0, skipped = 0;
        for (Object it : (Collection<?>) listObj) {
            if (!(it instanceof Map<?, ?> item)) { skipped++; continue; }
            String userId = str(item.get(userIdField));
            if (isBlank(userId)) { skipped++; continue; } // telephony_call_log.user_id is NOT NULL
            String phone = str(item.get(phoneField));
            String subjectId = firstNonBlank(str(item.get(subjectIdField)), str(context.get("subjectId")));
            String name = str(item.get(nameField));

            AiCallRequestDTO req = new AiCallRequestDTO();
            req.setInstituteId(instituteId);
            req.setUserId(userId);
            req.setPhoneNumber(phone);          // blank ⇒ AiCallService resolves from the user profile
            req.setProvider(provider);
            req.setCampaignName(campaignName);
            req.setCampaignId(campaignId);
            req.setSubjectType(subjectType);
            req.setSubjectId(subjectId);
            req.setCustomerName(name);

            Map<String, Object> meta = new HashMap<>();
            if (metaTemplate != null) meta.putAll(metaTemplate);
            if (name != null) meta.put("studentName", name);
            if (subjectId != null) meta.put("packageSessionId", subjectId);
            req.setMetadata(meta.isEmpty() ? null : meta);

            aiCallDispatcher.enqueue(req);      // paced, async; placeCall records + dials (or MOCKs)
            queued++;
        }

        out.put("aiCallCohortQueued", queued);
        out.put("aiCallCohortSkipped", skipped);
        out.put("aiCallDone", true);            // node completes; workflow continues to the next node
        log.info("CALL_AI cohort: source='{}' subjectType={} -> {} queued, {} skipped (agent='{}', provider='{}')",
                source, subjectType, queued, skipped, campaignName, provider);
        return out;
    }

    private int asInt(Object o) {
        if (o instanceof Number n) return n.intValue();
        if (o instanceof String s && !s.isBlank()) {
            try { return Integer.parseInt(s.trim()); } catch (NumberFormatException ignore) { /* fall through */ }
        }
        return 0;
    }

    private String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private String firstNonBlank(String... vals) {
        for (String v : vals) {
            if (v != null && !v.isBlank() && !"null".equals(v)) return v;
        }
        return null;
    }

    // ── Retry decision ──────────────────────────────────────────────────────────
    // The node owns this: given the institute's AI_CALLING_SETTING + the lead's
    // counters, dial now (resume_at = now + retryGapMinutes), defer (recheck later),
    // or stop. Nothing here runs on a schedule — it just computes the next-run time
    // the resume job will honor. Everything is read from the settings; nothing hardcoded.

    private enum Action { DIAL, DEFER, STOP }

    /** {@code resumeAt} = next-run time after a DIAL (gap) or DEFER (recheck); null for STOP. */
    private record Plan(Action action, Instant resumeAt, String reason) {}

    private Plan plan(String instituteId, String userId, int attempts, int callsToday, String callsDay,
                      String provider, boolean ignoreAssignedGuard) {
        AiCallingSettingsPojo s = settingsService.get(instituteId);
        if (s == null || !s.isEnabled()) return new Plan(Action.STOP, null, "ai_calling_disabled");
        if (!ignoreAssignedGuard && leadAlreadyAssigned(userId, instituteId)) {
            return new Plan(Action.STOP, null, "assigned");
        }
        if (attempts >= Math.max(1, s.getMaxRetries())) return new Plan(Action.STOP, null, "exhausted");

        ZoneId tz = resolveZone(s.getTimezone());
        Instant now = Instant.now();
        Instant recheck = now.plus(Math.max(1, s.getRecheckMinutes()), ChronoUnit.MINUTES);

        if (!withinAnyShift(now, s.getCallingShifts(), tz)) {
            // Outside the calling shift: don't poll every recheckMinutes all night.
            // Sleep until the NEXT shift-open instant (today if still ahead, else
            // the first shift tomorrow) so the lead only wakes when dialing is allowed.
            Instant nextOpen = nextShiftOpen(now, s.getCallingShifts(), tz);
            Instant resumeAt = nextOpen != null ? nextOpen : recheck;
            log.info("CALL_AI node: outside calling shift for lead {} — resuming at next shift-open {} (tz {}) instead of recheck +{}m",
                    userId, resumeAt, tz, Math.max(1, s.getRecheckMinutes()));
            return new Plan(Action.DEFER, resumeAt, "outside_shift");
        }
        LocalDate today = LocalDate.now(tz);
        int effectiveToday = today.toString().equals(callsDay) ? callsToday : 0;
        if (effectiveToday >= Math.max(1, s.getMaxCallsPerDayPerLead())) {
            return new Plan(Action.DEFER, recheck, "day_cap");
        }
        // Institute-wide daily budget (distinct from the per-lead cap above). DEFER
        // rather than DIAL so a lead over the shared budget WAITS for capacity — the
        // same guardrail AiCallService.placeCall enforces, but decided HERE so a
        // capped dial never consumes a retry and never mislabels the lead AI_NO_ANSWER.
        int instCap = s.getMaxCallsPerDay() > 0 ? s.getMaxCallsPerDay() : globalMaxCallsPerDay;
        String effProvider = firstNonBlank(provider, s.getProvider());
        if (instCap > 0 && !isBlank(effProvider)) {
            long placedToday = callLogRepo.countOutboundSince(instituteId, effProvider,
                    java.sql.Timestamp.from(now.minus(24, ChronoUnit.HOURS)));
            if (placedToday >= instCap) {
                log.info("CALL_AI node: institute {} over daily cap {} for {} ({} in 24h) — deferring lead {}",
                        instituteId, instCap, effProvider, placedToday, userId);
                return new Plan(Action.DEFER, recheck, "institute_day_cap");
            }
        }
        return new Plan(Action.DIAL, now.plus(Math.max(1, s.getRetryGapMinutes()), ChronoUnit.MINUTES), "dial");
    }

    private boolean leadAlreadyAssigned(String userId, String instituteId) {
        if (isBlank(userId) || isBlank(instituteId)) return false;
        return userLeadProfileRepository.findByUserIdAndInstituteId(userId, instituteId)
                .map(UserLeadProfile::getAssignedCounselorId)
                .filter(id -> id != null && !id.isBlank())
                .isPresent();
    }

    // The four shift helpers below moved to CallingWindowUtil unchanged, so the AI call
    // queue's drainer can apply the SAME window rule when it dispatches an item that has
    // been waiting (dialing used to be immediate, so only this node could ever land
    // outside a shift). These remain as thin delegates: every call site in this file, and
    // its behaviour, is untouched.

    /** Inside any [start,end] shift (institute tz); handles windows wrapping midnight. */
    private boolean withinAnyShift(Instant now, List<AiCallingSettingsPojo.Shift> shifts, ZoneId tz) {
        return CallingWindowUtil.withinAnyShift(now, shifts, tz);
    }

    /**
     * Earliest upcoming shift-open instant in the institute tz: the smallest shift
     * start that is still ahead of {@code now} today; if none remain today, the
     * smallest shift start tomorrow. Returns null if no usable shift starts (caller
     * falls back to the recheck time).
     */
    private Instant nextShiftOpen(Instant now, List<AiCallingSettingsPojo.Shift> shifts, ZoneId tz) {
        return CallingWindowUtil.nextShiftOpen(now, shifts, tz);
    }

    private LocalTime parseTime(String hhmm) {
        return CallingWindowUtil.parseTime(hhmm);
    }

    private ZoneId resolveZone(String tz) {
        return CallingWindowUtil.resolveZone(tz);
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
