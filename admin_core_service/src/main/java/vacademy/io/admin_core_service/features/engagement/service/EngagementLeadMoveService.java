package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * L7: a lead moved to another list leaves the engines that no longer target it and joins the
 * engines of its new list, within minutes instead of at the 02:30 UTC reconcile. Leaving cancels
 * what is still pending for it (an AI-call promise stays: the person asked for it on the call).
 *
 * <p>A member stays when the engine still reaches the person some other way: the new list is in
 * its audience too, or it also targets learners and the lead has an account (the reconcile's own
 * rule, PolicyGate.stopsAsLead).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementLeadMoveService {

    private final EngagementWakeDao dao;
    private final EngagementMemberRepository memberRepository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementEngineService engineService;

    /**
     * @param enroll false for a bulk move: the exits still happen (they cost nothing and stop
     *               messages to the wrong list), the joins wait for the nightly reconcile so a
     *               500-lead move does not make 500 first looks at once
     * @return how many members left plus how many engines it joined
     */
    public int leadMoved(String instituteId, String leadRowId, String newAudienceId, String userId,
                         boolean enroll, Instant now) {
        if (instituteId == null || leadRowId == null || newAudienceId == null) return 0;
        List<EngagementMember> members = memberRepository.findAllById(dao.liveMemberIdsOfLeadRow(instituteId, leadRowId));
        Map<String, EngagementEngine> engines = engineRepository
                .findAllById(members.stream().map(EngagementMember::getEngineId).distinct().toList()).stream()
                .collect(Collectors.toMap(EngagementEngine::getId, Function.identity()));
        List<String> leaving = new ArrayList<>();
        for (EngagementMember m : members) {
            EngagementEngine engine = engines.get(m.getEngineId());
            if (engine == null || engine.isSystemManaged()) continue;
            if (engineService.targetsAudience(engine, newAudienceId)) continue;
            if (!PolicyGate.stopsAsLead(engine, m.getUserId())) continue;
            leaving.add(m.getId());
        }
        int changed = 0;
        if (!leaving.isEmpty()) {
            changed += memberRepository.exitMembers(leaving, now);
            actionRepository.cancelOpenForMembers(leaving,
                    "Cancelled: this lead was moved to another list.", now, true);
        }
        if (enroll) {
            changed += engineService.enrollNewLead(instituteId, newAudienceId, leadRowId, userId);
        }
        if (changed > 0) {
            log.info("Lead {} moved to list {}: {} engine membership(s) left, joins {}",
                    leadRowId, newAudienceId, leaving.size(), enroll ? "now" : "at the nightly reconcile");
        }
        return changed;
    }
}
