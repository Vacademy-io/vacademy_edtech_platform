package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.actions.ScheduleAiCallActionHandler;
import vacademy.io.admin_core_service.features.engagement.actions.UpdateStatusActionHandler;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateCatalog;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * B6: CRM actions as copilot tasks. The brain proposes one (actionType + {@code action} fields);
 * this checks it against the engine's allow-list (S4, on the server) and the action's own rules,
 * stores it as an inbox TASK, and runs it through its {@link EngagementActionHandler} when a person
 * approves it. Done actions can be undone (S9).
 *
 * <p>The task's {@code variables_json} carries {@code {"action": <the brain's fields>, "result":
 * <what execute wrote>}}, so the inbox shows what will happen and undo knows what to reverse.
 *
 * <p>Allow-list: {@code channels.actions}, an array of CRM action types; none by default, so an
 * existing engine behaves exactly as before until an admin allows actions.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementCrmActionService {

    public static final String OUTCOME_UNDONE = "UNDONE";
    /** An approved AI call this far out waits as a scheduled row; nearer, it is queued at once. */
    static final Duration SCHEDULE_THRESHOLD = Duration.ofMinutes(30);

    private final List<EngagementActionHandler> handlerList;
    private final EngagementActionRepository actionRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementEngineRepository engineRepository;
    private final ContactResolver contactResolver;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** The templates track's catalog (A3); optional so a context without it still starts. */
    @Autowired(required = false)
    private EngagementEmailTemplateCatalog emailCatalog;

    /** B7: credits for an autonomous AI call (S5); optional in unit tests (then calls never run alone). */
    @Autowired(required = false)
    private CreditClient creditClient;

    /** B7: the lead's counsellor, who owns a follow-up the engine creates on its own. */
    @Autowired(required = false)
    private EngagementCoordinationDao coordinationDao;

    /** Approvals of an action type before the engine may run that type on its own (S7). */
    @Value("${engagement.autonomy.first-n:5}")
    private int defaultFirstN = 5;

    /** Who an autonomous action is recorded as (approvedBy / doneBy). */
    public static final String SYSTEM_ACTOR = "ENGAGEMENT_ENGINE";
    public static final String OUTCOME_AUTO = "AUTO";

    private Map<String, EngagementActionHandler> handlers;

    private Map<String, EngagementActionHandler> handlers() {
        if (handlers == null) {
            handlers = handlerList.stream().collect(Collectors.toMap(EngagementActionHandler::type, Function.identity()));
        }
        return handlers;
    }

    // ── what an engine may do ───────────────────────────────────────────────

    /**
     * The CRM action types this engine allows ({@code channels.actions}); empty = messages only.
     * Each entry is a type name, or {@code {"type": "...", "auto": true}} to let it run on its own
     * once graduated (B7).
     */
    public List<String> allowedActions(EngagementEngine engine) {
        return actionsWhere(engine, false);
    }

    /** B7: the allowed types the admin marked {@code auto}: they may run without a person once graduated. */
    public List<String> autoActions(EngagementEngine engine) {
        return actionsWhere(engine, true);
    }

    private List<String> actionsWhere(EngagementEngine engine, boolean autoOnly) {
        List<String> out = new ArrayList<>();
        try {
            JsonNode actions = objectMapper.readTree(engine.getChannels()).path("actions");
            for (String type : EngagementActionTypes.CRM_TYPES) {
                for (JsonNode a : actions) {
                    String t = a.isObject() ? a.path("type").asText("") : a.asText();
                    boolean auto = a.isObject() && a.path("auto").asBoolean(false);
                    if (type.equals(t) && handlers().containsKey(type) && (!autoOnly || auto) && !out.contains(type)) {
                        out.add(type);
                    }
                }
            }
        } catch (Exception e) {
            // unreadable channels: no CRM actions (never guess a permission)
        }
        return out;
    }

    // ── autonomy (B7) ───────────────────────────────────────────────────────

    /** Types that only reach the counsellor (the CRM), never the lead or the lead's record. */
    static final Set<String> INTERNAL_TYPES = Set.of(
            EngagementActionTypes.ADD_NOTE, EngagementActionTypes.ESCALATE, EngagementActionTypes.CREATE_FOLLOWUP);

    /** S7: a person approved at least first_n actions of THIS type on this engine. */
    public boolean graduated(EngagementEngine engine, String type) {
        int threshold = engine.getFirstN() != null ? engine.getFirstN() : defaultFirstN;
        if (threshold <= 0) return true;
        return actionRepository.countApprovedCrmActions(engine.getId(), type) >= threshold;
    }

    /**
     * Why this drafted CRM action may NOT run on its own (null = it may). In order: dry run, the kill
     * switch (S6: it stops every autonomous action, calls and status changes included), the admin's
     * per-type intent, graduation per type (S7), holdout (S10), the lead's coordination hold (B5:
     * do-not-automate stops all; a counsellor at work or a follow-up today stops calls and status
     * changes, notes and follow-ups for the counsellor still go), and credits for a call (S5).
     */
    public String autonomyBlock(EngagementEngine engine, EngagementMember member, String type, String hold,
                                boolean humanTouched, boolean dryRun) {
        if (dryRun || "DRY_RUN".equalsIgnoreCase(engine.getStatus())) return "dry run";
        if (Boolean.TRUE.equals(engine.getAutoSendKilled())) return "the kill switch is on";
        if (!autoActions(engine).contains(type)) return "not set to run on its own";
        if (!graduated(engine, type)) return "needs more approved " + type + " actions first";
        if (Boolean.TRUE.equals(member.getIsHoldout())) return "holdout";
        if (EngagementCoordinationService.HOLD_DO_NOT_AUTOMATE.equals(hold)
                || EngagementCoordinationService.HOLD_UNKNOWN.equals(hold)) return "do not automate";
        if ((hold != null || humanTouched) && !INTERNAL_TYPES.contains(type)) return "a counsellor is active on this lead";
        if (EngagementActionTypes.SCHEDULE_AI_CALL.equals(type)) {
            Double balance = null;
            try {
                balance = creditClient != null ? creditClient.readBalance(engine.getInstituteId()).orElse(null) : null;
            } catch (Exception ignored) {
                // unknown balance: the call waits for a person (C-6: hold it, never switch channel silently)
            }
            if (balance == null || balance <= 0) return "out of AI credits (or the balance could not be read)";
        }
        return null;
    }

    /**
     * B7: run a just-drafted task on its own when nothing in {@link #autonomyBlock} stops it. When it
     * cannot run (or fails), it simply stays in the inbox as the copilot task it already is, with the
     * reason. @return the action as it now stands
     */
    public EngagementAction tryAutonomous(EngagementAction task, EngagementEngine engine, EngagementMember member,
                                          String phone, String hold, boolean humanTouched, boolean dryRun) {
        String block = autonomyBlock(engine, member, task.getActionType(), hold, humanTouched, dryRun);
        if (block != null) return task;
        Instant now = Instant.now();
        if (actionRepository.claimCrmAction(task.getId(), task.getInstituteId(), EngagementActionTypes.CRM_TYPES, now) != 1) {
            return task;
        }
        try {
            Map<String, String> params = params(task);
            EngagementActionHandler.Context ctx = context(engine, member, phone, task.getId());
            EngagementActionHandler h = handlers().get(task.getActionType());
            if (h instanceof ScheduleAiCallActionHandler call) {
                Instant at = call.callAt(ctx, params);
                if (at.isAfter(now.plus(SCHEDULE_THRESHOLD))) return holdUntil(task, at, SYSTEM_ACTOR, "AI · Engagement Engine");
            }
            EngagementActionHandler.Approver approver = systemApprover(engine, member, task.getActionType());
            EngagementAction done = settleDone(task, h.execute(ctx, params, approver), h.describe(ctx, params), SYSTEM_ACTOR, now);
            done.setOutcome(OUTCOME_AUTO);
            return actionRepository.save(done);
        } catch (Exception e) {
            task.setStatus("OPEN");
            task.setErrorMessage("Not run automatically: " + e.getMessage());
            log.info("Autonomous {} for member {} left to the inbox: {}", task.getActionType(), member.getId(), e.getMessage());
            return actionRepository.save(task);
        }
    }

    /**
     * The identity an autonomous action runs as. A follow-up belongs to the lead's counsellor (the
     * follow-up service records its creator); with no counsellor it is left to a person (F-5).
     */
    private EngagementActionHandler.Approver systemApprover(EngagementEngine engine, EngagementMember member, String type) {
        if (!EngagementActionTypes.CREATE_FOLLOWUP.equals(type)) {
            return new EngagementActionHandler.Approver(null, "AI · Engagement Engine", null);
        }
        String owner = coordinationDao != null && member.getAudienceResponseId() != null
                ? coordinationDao.leadOwnerUserId(engine.getInstituteId(), member.getAudienceResponseId()) : null;
        if (owner == null) throw new VacademyException("the lead has no counsellor to own the follow-up");
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(owner);
        dto.setUsername("AI · Engagement Engine");
        return new EngagementActionHandler.Approver(owner, "AI · Engagement Engine", new CustomUserDetails(dto));
    }

    /** {@code channels.EMAIL.mode = "TEMPLATE"}: the brain picks an approved email template, never free text. */
    public boolean emailTemplateMode(EngagementEngine engine) {
        try {
            return "TEMPLATE".equalsIgnoreCase(objectMapper.readTree(engine.getChannels())
                    .path("EMAIL").path("mode").asText(""));
        } catch (Exception e) {
            return false;
        }
    }

    /** The prompt's action menu for this engine (per engine, so the prompt prefix stays cacheable). */
    public EngagementBrainClient.ActionMenu menu(EngagementEngine engine) {
        List<String> actions = allowedActions(engine);
        List<EngagementBrainClient.StatusOption> statuses = List.of();
        if (actions.contains(EngagementActionTypes.UPDATE_STATUS)
                && handlers().get(EngagementActionTypes.UPDATE_STATUS) instanceof UpdateStatusActionHandler h) {
            try {
                statuses = h.allowedStatuses(engine.getInstituteId()).stream()
                        .map(s -> new EngagementBrainClient.StatusOption(s.getStatusKey(), s.getLabel())).toList();
            } catch (Exception e) {
                log.warn("Engine {}: lead statuses unavailable, UPDATE_STATUS left out: {}", engine.getId(), e.getMessage());
                actions = actions.stream().filter(a -> !EngagementActionTypes.UPDATE_STATUS.equals(a)).toList();
            }
        }
        List<EngagementBrainClient.TemplateOption> emailTemplates = null;
        if (emailTemplateMode(engine)) {
            try {
                emailTemplates = emailCatalog != null
                        ? emailCatalog.findApprovedEmailTemplates(engine.getId(), engine.getInstituteId()) : List.of();
            } catch (Exception e) {
                log.warn("Engine {}: email templates unavailable: {}", engine.getId(), e.getMessage());
                emailTemplates = List.of();
            }
        }
        return new EngagementBrainClient.ActionMenu(actions, statuses, emailTemplates);
    }

    // ── decision time ───────────────────────────────────────────────────────

    /** Null when the brain's proposal may become an inbox task, else why not. */
    public String validateProposal(EngagementEngine engine, EngagementMember member, String phone,
                                   String type, Map<String, String> params) {
        if (!allowedActions(engine).contains(type)) return type + " is not allowed for this engine.";
        EngagementActionHandler h = handlers().get(type);
        return h.validate(context(engine, member, phone, null), params != null ? params : Map.of());
    }

    public String describe(EngagementEngine engine, EngagementMember member, String phone,
                           String type, Map<String, String> params) {
        return handlers().get(type).describe(context(engine, member, phone, null), params != null ? params : Map.of());
    }

    /** What the task stores: the brain's fields, for approve and undo. */
    public String taskVariables(Map<String, String> params) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("action", params != null ? params : Map.of());
        return write(v);
    }

    // ── approve / undo ──────────────────────────────────────────────────────

    /**
     * A person approved the task: run it (or, for an AI call asked for later, hold it until then).
     * Re-checked first: the allow-list, the lead and the action's own rules may have changed since
     * it was drafted. A failure puts the task back in the inbox with the reason.
     */
    public EngagementAction approve(String taskId, String instituteId, CustomUserDetails user) {
        Instant now = Instant.now();
        if (actionRepository.claimCrmAction(taskId, instituteId, EngagementActionTypes.CRM_TYPES, now) != 1) {
            throw new VacademyException("Task not found, not a CRM action, or already being handled");
        }
        EngagementAction action = actionRepository.findById(taskId)
                .orElseThrow(() -> new VacademyException("Task vanished after claim"));
        EngagementActionHandler.Approver approver = new EngagementActionHandler.Approver(
                user.getUserId(), user.getUsername(), user);
        try {
            Loaded l = load(action);
            Map<String, String> params = params(action);
            EngagementActionHandler.Context ctx = context(l.engine(), l.member(), l.phone(), action.getId());
            if (Boolean.TRUE.equals(l.member().getIsHoldout())) {
                throw new VacademyException("This person is in the holdout group: no action of any kind (S10).");
            }
            String reason = validateProposal(l.engine(), l.member(), l.phone(), action.getActionType(), params);
            if (reason != null) throw new VacademyException(reason);

            EngagementActionHandler h = handlers().get(action.getActionType());
            if (h instanceof ScheduleAiCallActionHandler call) {
                Instant at = call.callAt(ctx, params);
                // C-1: hold until the time the lead asked for; the dispatch job runs it then.
                if (at.isAfter(now.plus(SCHEDULE_THRESHOLD))) return holdUntil(action, at, user.getUserId(), user.getUsername());
            }
            return settleDone(action, h.execute(ctx, params, approver), h.describe(ctx, params), user.getUserId(), now);
        } catch (Exception e) {
            action.setStatus("OPEN");
            action.setErrorMessage("Not done: " + e.getMessage());
            actionRepository.save(action);
            throw e instanceof VacademyException ve ? ve : new VacademyException("The action failed: " + e.getMessage());
        }
    }

    /**
     * The dispatch job's turn for an approved AI call that waited for its time (C-1). Re-checked
     * like an approval: a lead who said "don't call" since, or hit the weekly limit, is not called.
     * @return true when the call was queued
     */
    public boolean runScheduled(EngagementAction action, Instant now) {
        if (actionRepository.claimForDispatch(action.getId(), action.getInstituteId(), now) != 1) return false;
        EngagementAction claimed = actionRepository.findById(action.getId()).orElse(action);
        Map<String, Object> v = variables(claimed);
        EngagementActionHandler.Approver approver = new EngagementActionHandler.Approver(
                (String) v.get("approvedBy"), (String) v.get("approvedByName"), null);
        try {
            Loaded l = load(claimed);
            Map<String, String> params = params(claimed);
            if (Boolean.TRUE.equals(l.member().getIsHoldout())) throw new VacademyException("holdout (S10)");
            boolean autonomous = SYSTEM_ACTOR.equals(approver.userId());
            if (autonomous && Boolean.TRUE.equals(l.engine().getAutoSendKilled())) {
                // S6: the kill switch stops what the engine scheduled on its own; a person decides.
                claimed.setKind("TASK");
                claimed.setStatus("OPEN");
                claimed.setErrorMessage("The kill switch is on: approve this call yourself if it should still go.");
                actionRepository.save(claimed);
                return false;
            }
            String reason = validateProposal(l.engine(), l.member(), l.phone(), claimed.getActionType(), params);
            if (reason != null) throw new VacademyException(reason);
            EngagementActionHandler h = handlers().get(claimed.getActionType());
            EngagementActionHandler.Context ctx = context(l.engine(), l.member(), l.phone(), claimed.getId());
            EngagementAction done = settleDone(claimed, h.execute(ctx, params, approver), h.describe(ctx, params),
                    approver.userId(), now);
            if (autonomous) {
                done.setOutcome(OUTCOME_AUTO);
                actionRepository.save(done);
            }
            return true;
        } catch (Exception e) {
            claimed.setStatus("EXPIRED");
            claimed.setErrorMessage("Not done: " + e.getMessage());
            actionRepository.save(claimed);
            log.info("Scheduled CRM action {} not run: {}", claimed.getId(), e.getMessage());
            return false;
        }
    }

    /** S9: reverse a done action (or drop an approved AI call still waiting for its time). */
    public EngagementAction undo(String taskId, String instituteId, CustomUserDetails user) {
        Instant now = Instant.now();
        EngagementAction waiting = actionRepository.findById(taskId)
                .filter(a -> instituteId.equals(a.getInstituteId()))
                .filter(a -> "SEND".equals(a.getKind()) && "OPEN".equals(a.getStatus())
                        && EngagementActionTypes.isCrmAction(a.getActionType()))
                .orElse(null);
        if (waiting != null) {
            if (actionRepository.claimForDispatch(taskId, instituteId, now) != 1) {
                throw new VacademyException("The action is already running");
            }
            waiting.setStatus("DISMISSED");
            waiting.setOutcome(OUTCOME_UNDONE);
            waiting.setCompletedAt(now);
            waiting.setErrorMessage("Undone by " + user.getUsername() + " before it ran.");
            return actionRepository.save(waiting);
        }
        if (actionRepository.claimCrmUndo(taskId, instituteId, EngagementActionTypes.CRM_TYPES, now) != 1) {
            throw new VacademyException("Only a done CRM action can be undone");
        }
        EngagementAction action = actionRepository.findById(taskId)
                .orElseThrow(() -> new VacademyException("Task vanished after claim"));
        try {
            Loaded l = load(action);
            EngagementActionHandler h = handlers().get(action.getActionType());
            h.undo(context(l.engine(), l.member(), l.phone(), action.getId()), params(action), result(action),
                    new EngagementActionHandler.Approver(user.getUserId(), user.getUsername(), user));
            action.setStatus("DONE");
            action.setOutcome(OUTCOME_UNDONE);
            action.setErrorMessage("Undone by " + user.getUsername() + ".");
            return actionRepository.save(action);
        } catch (Exception e) {
            action.setStatus("DONE");
            actionRepository.save(action);
            throw e instanceof VacademyException ve ? ve : new VacademyException("Undo failed: " + e.getMessage());
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** An AI call for later: a scheduled row the dispatch job runs at {@code at} (C-1). */
    private EngagementAction holdUntil(EngagementAction action, Instant at, String approvedBy, String approvedByName) {
        Map<String, Object> v = variables(action);
        v.put("approvedBy", approvedBy);
        v.put("approvedByName", approvedByName);
        action.setVariablesJson(write(v));
        action.setKind("SEND");
        action.setStatus("OPEN");
        action.setScheduledFor(at);
        action.setExpiresAt(at.plus(Duration.ofHours(24)));
        action.setErrorMessage(null);
        return actionRepository.save(action);
    }

    private EngagementAction settleDone(EngagementAction action, Map<String, String> result, String summary,
                                        String byUserId, Instant now) {
        Map<String, Object> v = variables(action);
        v.put("result", result != null ? result : Map.of());
        v.put("doneBy", byUserId);
        action.setVariablesJson(write(v));
        action.setStatus("DONE");
        action.setOutcome("ACCEPTED");
        action.setCompletedAt(now);
        action.setSentBody(summary);
        action.setErrorMessage(null);
        return actionRepository.save(action);
    }

    private record Loaded(EngagementEngine engine, EngagementMember member, String phone) {}

    private Loaded load(EngagementAction action) {
        EngagementEngine engine = engineRepository.findById(action.getEngineId())
                .orElseThrow(() -> new VacademyException("The engine is gone"));
        EngagementMember member = memberRepository.findById(action.getMemberId())
                .orElseThrow(() -> new VacademyException("The person is no longer in the engine"));
        String phone = null;
        if (EngagementActionTypes.SCHEDULE_AI_CALL.equals(action.getActionType())) {
            List<Subject> s = contactResolver.resolve(List.of(member));
            phone = s.isEmpty() ? null : s.get(0).getPhone();
        }
        return new Loaded(engine, member, phone);
    }

    private static EngagementActionHandler.Context context(EngagementEngine engine, EngagementMember member,
                                                           String phone, String actionId) {
        return new EngagementActionHandler.Context(engine, member, member.getAudienceResponseId(), phone,
                actionId, Instant.now());
    }

    private Map<String, Object> variables(EngagementAction action) {
        try {
            if (action.getVariablesJson() == null) return new LinkedHashMap<>();
            return objectMapper.readValue(action.getVariablesJson(), new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> stringMap(Object o) {
        Map<String, String> out = new HashMap<>();
        if (o instanceof Map<?, ?> m) m.forEach((k, val) -> { if (val != null) out.put(k.toString(), val.toString()); });
        return out;
    }

    Map<String, String> params(EngagementAction action) {
        return stringMap(variables(action).get("action"));
    }

    Map<String, String> result(EngagementAction action) {
        return stringMap(variables(action).get("result"));
    }

    private String write(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }
}
