package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
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
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

    private Map<String, EngagementActionHandler> handlers;

    private Map<String, EngagementActionHandler> handlers() {
        if (handlers == null) {
            handlers = handlerList.stream().collect(Collectors.toMap(EngagementActionHandler::type, Function.identity()));
        }
        return handlers;
    }

    // ── what an engine may do ───────────────────────────────────────────────

    /** The CRM action types this engine allows ({@code channels.actions}); empty = messages only. */
    public List<String> allowedActions(EngagementEngine engine) {
        List<String> out = new ArrayList<>();
        try {
            JsonNode actions = objectMapper.readTree(engine.getChannels()).path("actions");
            for (String type : EngagementActionTypes.CRM_TYPES) {
                for (JsonNode a : actions) {
                    if (type.equals(a.asText()) && handlers().containsKey(type)) out.add(type);
                }
            }
        } catch (Exception e) {
            // unreadable channels: no CRM actions (never guess a permission)
        }
        return out;
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
            String reason = validateProposal(l.engine(), l.member(), l.phone(), action.getActionType(), params);
            if (reason != null) throw new VacademyException(reason);

            EngagementActionHandler h = handlers().get(action.getActionType());
            if (h instanceof ScheduleAiCallActionHandler call) {
                Instant at = call.callAt(ctx, params);
                if (at.isAfter(now.plus(SCHEDULE_THRESHOLD))) {
                    // C-1: hold until the time the lead asked for; the dispatch job runs it then.
                    Map<String, Object> v = variables(action);
                    v.put("approvedBy", user.getUserId());
                    v.put("approvedByName", user.getUsername());
                    action.setVariablesJson(write(v));
                    action.setKind("SEND");
                    action.setStatus("OPEN");
                    action.setScheduledFor(at);
                    action.setExpiresAt(at.plus(Duration.ofHours(24)));
                    action.setErrorMessage(null);
                    return actionRepository.save(action);
                }
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
            String reason = validateProposal(l.engine(), l.member(), l.phone(), claimed.getActionType(), params);
            if (reason != null) throw new VacademyException(reason);
            EngagementActionHandler h = handlers().get(claimed.getActionType());
            EngagementActionHandler.Context ctx = context(l.engine(), l.member(), l.phone(), claimed.getId());
            settleDone(claimed, h.execute(ctx, params, approver), h.describe(ctx, params), approver.userId(), now);
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
