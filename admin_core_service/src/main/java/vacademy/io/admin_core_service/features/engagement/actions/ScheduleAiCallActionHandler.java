package vacademy.io.admin_core_service.features.engagement.actions;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionHandler;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionTypes;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAiCallPool;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCoordinationDao;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * SCHEDULE_AI_CALL through the AI call queue (no second call queue): it applies the institute's
 * calling shifts and the voice-box capacity (C-7), and keeps one waiting call per lead.
 * <ul>
 *   <li>C-1: a call back at the time the lead asked for ({@code dueInHours}); the inbox approval
 *   holds it until then.</li>
 *   <li>C-2 / C-3: never after a call ended as wrong number or do-not-disturb.</li>
 *   <li>C-4: at most {@code maxAttempts} AI calls to the lead in the last 7 days, from any system.</li>
 * </ul>
 * The agent is the next one in the engine's AI call pool ({@code channels.AI_CALL.agentPool}, the
 * "Agents to call with" picker). With no pool the call is refused: falling back to the institute's
 * default agent called the engine's leads with another product's script.
 */
@Component
@RequiredArgsConstructor
public class ScheduleAiCallActionHandler implements EngagementActionHandler {

    static final String QUEUE_SOURCE = "ENGAGEMENT_ENGINE";
    static final int MAX_HOURS = 24 * 14;
    static final String NO_AGENT = "This engine has no AI agent to call with. Add one to its AI call pool.";

    private final AiCallQueueService queueService;
    private final EngagementCoordinationDao coordinationDao;
    private final EngagementAiCallPool agentPool;

    @Value("${engagement.ai-call.max-attempts-per-week:3}")
    private int maxAttempts = 3;

    @Override public String type() { return EngagementActionTypes.SCHEDULE_AI_CALL; }

    @Override
    public String validate(Context ctx, Map<String, String> params) {
        if (ctx.leadRowId() == null) return "An AI call needs a lead; this person is not one.";
        if (ctx.phone() == null || ctx.phone().isBlank()) return "There is no phone number for this lead.";
        if (coordinationDao.doNotCall(ctx.instituteId(), ctx.leadRowId())) {
            return "A call to this lead ended as wrong number or do-not-disturb: no more AI calls.";
        }
        long recent = coordinationDao.aiCallCounts(ctx.instituteId(), List.of(ctx.leadRowId()),
                ctx.now().minus(Duration.ofDays(7))).getOrDefault(ctx.leadRowId(), 0L);
        if (recent >= maxAttempts) {
            return "This lead already had " + recent + " AI calls this week (the limit is " + maxAttempts + ").";
        }
        if (!agentPool.hasPool(ctx.engine())) return NO_AGENT;
        return null;
    }

    /** C-1: when to call. The queue adds the calling shifts on top. */
    public Instant callAt(Context ctx, Map<String, String> params) {
        return ctx.now().plus(Duration.ofHours(ActionText.hours(params, "dueInHours", 0, 0, MAX_HOURS)));
    }

    @Override
    public String describe(Context ctx, Map<String, String> params) {
        int hours = ActionText.hours(params, "dueInHours", 0, 0, MAX_HOURS);
        String when = hours == 0 ? "in the next calling slot" : "at " + callAt(ctx, params);
        String note = ActionText.text(params, "note");
        return "AI call to the lead " + when + (note != null ? ": " + note : ".");
    }

    @Override
    public Map<String, String> execute(Context ctx, Map<String, String> params, Approver approver) {
        AiCallRequestDTO req = new AiCallRequestDTO();
        req.setInstituteId(ctx.instituteId());
        req.setResponseId(ctx.leadRowId());
        req.setUserId(ctx.member().getUserId());
        req.setPhoneNumber(ctx.phone());
        String agentId = agentPool.next(ctx.engine());
        if (agentId == null) throw new VacademyException(NO_AGENT);
        req.setCampaignId(agentId);   // an agent's id IS its campaign id in AI_CALLING_SETTING
        req.setMetadata(Map.of("engagementActionId", ctx.actionId()));
        AiCallQueueDTOs.EnqueueResult r = queueService.enqueue(req, CallTrigger.AUTOMATION, QUEUE_SOURCE,
                ctx.actionId(), approver.userId());
        if (r == null || !r.isQueued()) {
            throw new VacademyException(r != null && r.getMessage() != null ? r.getMessage() : "The call was not queued.");
        }
        return Map.of("queueItemId", r.getQueueItemId());
    }

    @Override
    public void undo(Context ctx, Map<String, String> params, Map<String, String> result, Approver approver) {
        if (!queueService.cancelOne(ctx.instituteId(), result.get("queueItemId"), "Undone in the engagement inbox")) {
            throw new VacademyException("The call has already been placed, so it cannot be undone.");
        }
    }
}
