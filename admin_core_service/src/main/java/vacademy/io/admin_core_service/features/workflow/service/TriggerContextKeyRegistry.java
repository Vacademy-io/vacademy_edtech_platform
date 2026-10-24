package vacademy.io.admin_core_service.features.workflow.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowCatalogController;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which top-level {@code #ctx[...]} keys each trigger event actually puts on the seed context.
 *
 * <p>Exists because the AI drafter and admins can only reference keys they are told about, and a
 * key that is NOT there fails in the worst possible way: a CUSTOM_EXPRESSION idempotency key such
 * as {@code #ctx['lead']['id']} throws inside SpEL, and {@code WorkflowTriggerService} then skips
 * the trigger — no execution row, nothing in the Executions tab. (Audited 2026-09-11: the AI
 * catalog advertised a {@code lead} key for AUDIENCE_LEAD_SUBMISSION that no emitter sets.)</p>
 *
 * <p>The audited events below were read off their emitters — the file is named next to each so
 * the list can be re-checked when an emitter changes. Lead-SLA and assessment events delegate to
 * {@link WorkflowCatalogController#getTriggerContextVariables()}, which is already the admin-facing
 * token list for those events. Events not covered return {@link Optional#empty()} and are not
 * validated — an unknown event must never produce a false error.</p>
 */
@Component
@RequiredArgsConstructor
public class TriggerContextKeyRegistry {

    private final WorkflowCatalogController workflowCatalogController;

    /** Matches the first-level key of a {@code #ctx['key']} reference. */
    private static final Pattern CTX_KEY = Pattern.compile("#ctx\\['([^']+)'\\]");

    /**
     * Keys {@code WorkflowTriggerService} stamps on every seed context before the engine runs.
     * Note that only {@code triggerId}, {@code eventName} and {@code eventId} exist at idempotency
     * key time (see {@code CustomExpressionKeyGenerator}); the rest are added just after.
     */
    public static final Set<String> ENGINE_KEYS = Set.of(
            "triggerId", "eventName", "eventId", "instituteId", "triggerEvents", "executionId",
            "eventAppliedType", "isGlobalTrigger", "triggerTime");

    /** Keys available while the CUSTOM_EXPRESSION idempotency key is being evaluated. */
    public static final Set<String> IDEMPOTENCY_TIME_ENGINE_KEYS = Set.of("triggerId", "eventName", "eventId");

    private static final Map<String, Set<String>> AUDITED = new LinkedHashMap<>();

    static {
        // AudienceService: submitLead (~L1289), submitLeadV2 (~L1803), form-provider webhook (~L5001).
        // The person is `user` (UserDTO) on all three paths. There is NO `lead` key. userId /
        // leadUserId / phone / parentMobile are set by the first two paths only.
        AUDITED.put(WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(), Set.of(
                "user", "userId", "leadUserId", "phone", "parentMobile", "responseId", "audience", "audienceId",
                "instituteId", "instituteName", "campaignName", "customFields", "submissionTime",
                "sendRespondentEmail", "respondentEmailRequests", "adminEmailRequests", "formProvider",
                // Set only by AudienceService.scheduleDestinationAutomations (a lead MOVED into the
                // list with "run destination automations" ticked): leadSource = "LEAD_MOVED".
                "leadSource", "fromAudienceId"));
        // StudentRegistrationManager ~L1200. `packageSessionIds` is a single id string despite the name.
        // membershipType is 'TRIAL' | 'PAID' | 'UNKNOWN' (no plan resolvable — admin/bulk/free
        // enrolment), and isTrial is false for UNKNOWN too, so conditions that must distinguish
        // the two happy flows gate on membershipType, not on isTrial being falsy.
        AUDITED.put(WorkflowTriggerEvent.LEARNER_BATCH_ENROLLMENT.name(), Set.of(
                "user", "packageSessionIds", "subOrg", "packageId", "packageName", "lmsEditExistingUser",
                "userPlanId", "isTrial", "membershipType"));
        // Step1Service ~L85 / LiveSessionWorkflowAsyncHelper ~L55.
        AUDITED.put(WorkflowTriggerEvent.LIVE_SESSION_CREATE.name(), Set.of(
                "liveSession", "createdBy"));
        // LearnerEnrollmentEntryService ~L170. `user` only when the account could be resolved.
        AUDITED.put(WorkflowTriggerEvent.ABANDONED_CART.name(), Set.of(
                "userId", "userPlanId", "packageSessionId", "packageSessionIds", "packageId", "packageName", "user"));
        // PaymentLogService ~L1815 (no `user`) + RenewalPaymentService.emitRenewalEvent (adds renewal, user when resolvable).
        AUDITED.put(WorkflowTriggerEvent.PAYMENT_FAILED.name(), Set.of(
                "paymentLog", "userId", "userPlanId", "amount", "vendor", "enrollInviteId", "packageSessionIds",
                "renewal", "user"));
        // PackageSessionScheduler ~L165. No `user`.
        AUDITED.put(WorkflowTriggerEvent.MEMBERSHIP_EXPIRY.name(), Set.of(
                "userPlanId", "userId", "paymentPlanId", "enrollInviteId", "endDate", "daysToExpiry"));
    }

    /**
     * Keys emitted by {@code eventName}, plus {@link #ENGINE_KEYS}. Empty when the event is not
     * catalogued — callers must treat that as "unknown", not "none".
     */
    public Optional<Set<String>> knownKeys(String eventName) {
        if (eventName == null) return Optional.empty();
        Set<String> emitted = emittedKeys(eventName);
        if (emitted == null) return Optional.empty();
        Set<String> all = new LinkedHashSet<>(emitted);
        all.addAll(ENGINE_KEYS);
        return Optional.of(all);
    }

    /** Only the emitter's own keys (no engine keys), for display in the AI catalog. Null when unknown. */
    public Set<String> emittedKeys(String eventName) {
        Set<String> audited = AUDITED.get(eventName);
        if (audited != null) return audited;
        List<Map<String, String>> vars = catalogVars().get(eventName);
        if (vars == null) return null;
        Set<String> keys = new LinkedHashSet<>();
        for (Map<String, String> v : vars) keys.add(v.get("key"));
        return keys;
    }

    /** Every event this registry knows, in a stable order (audited first, then catalog events). */
    public Map<String, Set<String>> allKnown() {
        Map<String, Set<String>> out = new LinkedHashMap<>(AUDITED);
        for (String event : catalogVars().keySet()) {
            out.computeIfAbsent(event, this::emittedKeys);
        }
        return out;
    }

    /** First-level {@code #ctx['key']} references in a SpEL expression, in order of appearance. */
    public static Set<String> referencedCtxKeys(String expression) {
        Set<String> keys = new LinkedHashSet<>();
        if (expression == null) return keys;
        Matcher m = CTX_KEY.matcher(expression);
        while (m.find()) keys.add(m.group(1));
        return keys;
    }

    private Map<String, List<Map<String, String>>> catalogVars() {
        Map<String, List<Map<String, String>>> body = workflowCatalogController.getTriggerContextVariables().getBody();
        return body == null ? Map.of() : body;
    }
}
