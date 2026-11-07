package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * What the engine page's "AI calls" card shows: whether the engine's calls still need a person's
 * approval (and how far it is from calling on its own), every call that has not happened yet, the
 * calls placed in the last day, and the people a first call is coming for.
 */
@Service
@RequiredArgsConstructor
public class EngagementUpcomingCallsService {

    static final int MAX_CALLS = 50;
    static final int MAX_FIRST_CALLS = 10;
    static final Duration PLACED_WINDOW = Duration.ofHours(24);

    /** NEEDS_APPROVAL: an inbox task; SCHEDULED: approved, held for a later time; IN_QUEUE: waiting for a line; PLACED: dialled. */
    public enum CallState { NEEDS_APPROVAL, SCHEDULED, IN_QUEUE, PLACED }

    /**
     * {@code at}: when it is due (approval and held calls), its earliest time in the queue (null =
     * as soon as a line is free), or when it was dialled. callStatus is the call's result once placed.
     */
    public record Call(String actionId, String memberId, CallState state, Instant at, Instant expiresAt,
                       String rationale, String callStatus) {
    }

    public record FirstCall(String memberId, Instant nextLookAt) {
    }

    /**
     * @param callingOn  the AI call channel is on and the engine may propose calls
     * @param engineLive the engine is ACTIVE (a paused or draft engine places no call)
     * @param auto       the admin set AI calls to run on their own
     * @param approved   calls a person approved so far; with auto, calls run on their own from threshold
     * @param killed     the engine's kill switch stops every call from running on its own
     * @param firstCalls the first people (by next look) whose first touch will be a call, of firstCallsTotal
     */
    public record UpcomingCalls(boolean callingOn, boolean engineLive, boolean auto, boolean killed,
                                long approved, int threshold, boolean graduated, List<Call> calls,
                                List<FirstCall> firstCalls, long firstCallsTotal) {
    }

    private final EngagementUpcomingCallsDao dao;
    private final EngagementCrmActionService crmActions;

    public UpcomingCalls upcoming(EngagementEngine engine) {
        EngagementCrmActionService.ActionSetting call = crmActions.settings(engine).stream()
                .filter(s -> EngagementActionTypes.SCHEDULE_AI_CALL.equals(s.type()))
                .findFirst().orElse(null);
        boolean callingOn = call != null && call.allowed() && crmActions.aiCallChannelOn(engine);
        boolean live = "ACTIVE".equalsIgnoreCase(engine.getStatus());

        LocalDateTime placedSince = LocalDateTime.ofInstant(Instant.now().minus(PLACED_WINDOW), ZoneOffset.UTC);
        List<Call> calls = toCalls(dao.calls(engine.getInstituteId(), engine.getId(), placedSince, MAX_CALLS));

        List<FirstCall> firstCalls = List.of();
        long firstTotal = 0;
        if (callingOn && live) {
            firstCalls = dao.firstCalls(engine.getInstituteId(), engine.getId(), MAX_FIRST_CALLS).stream()
                    .map(r -> new FirstCall(r.memberId(), r.nextLookAt())).toList();
            firstTotal = firstCalls.size() < MAX_FIRST_CALLS ? firstCalls.size()
                    : dao.countFirstCalls(engine.getInstituteId(), engine.getId());
        }
        return new UpcomingCalls(callingOn, live, call != null && call.auto(),
                Boolean.TRUE.equals(engine.getAutoSendKilled()),
                call != null ? call.approved() : 0, call != null ? call.threshold() : 0,
                call != null && call.graduated(), calls, firstCalls, firstTotal);
    }

    /** One entry per action (a retried call has several queue rows; the first, newest, wins). */
    static List<Call> toCalls(List<EngagementUpcomingCallsDao.CallRow> rows) {
        Set<String> seen = new LinkedHashSet<>();
        List<Call> out = new ArrayList<>();
        for (EngagementUpcomingCallsDao.CallRow r : rows) {
            if (!seen.add(r.actionId())) continue;
            CallState state = stateOf(r);
            if (state == null) continue;
            Instant at = switch (state) {
                case NEEDS_APPROVAL, SCHEDULED -> r.scheduledFor();
                case IN_QUEUE -> r.notBefore();
                case PLACED -> r.dialedAt();
            };
            out.add(new Call(r.actionId(), r.memberId(), state, at,
                    state == CallState.NEEDS_APPROVAL || state == CallState.SCHEDULED ? r.expiresAt() : null,
                    r.rationale(), state == CallState.PLACED ? r.callStatus() : null));
        }
        return out;
    }

    static CallState stateOf(EngagementUpcomingCallsDao.CallRow r) {
        String q = r.queueStatus();
        if ("QUEUED".equals(q) || "DISPATCHING".equals(q)) return CallState.IN_QUEUE;
        if ("DIALED".equals(q)) return CallState.PLACED;
        boolean open = "OPEN".equals(r.status()) || "ACKED".equals(r.status());
        if (open && "TASK".equals(r.kind())) return CallState.NEEDS_APPROVAL;
        if (open && "SEND".equals(r.kind())) return CallState.SCHEDULED;
        return null;
    }
}
