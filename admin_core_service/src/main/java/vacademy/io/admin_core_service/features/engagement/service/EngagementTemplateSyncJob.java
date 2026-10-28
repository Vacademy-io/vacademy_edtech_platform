package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;

import java.util.List;

/**
 * Meta template-status poll (design §9). Meta sends NO template-status webhook to this system, so a
 * submitted template's approval/rejection is only knowable by asking — this job asks, every few
 * minutes, for every institute that has something pending. Without it, a template approved by Meta
 * at 2am would sit SUBMITTED until a human happened to open the wizard and hit "sync", and the
 * engine it gates would never go live.
 *
 * @SchedulerLock keeps a single replica polling (waste-reducer); correctness is the per-proposal
 * reconcile CAS, which only advances a still-pending row.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementTemplateSyncJob {

    private final EngagementTemplateProposalRepository proposalRepository;
    private final EngagementTemplateProposalService proposalService;

    @Scheduled(fixedDelayString = "${engagement.template-sync.delay-ms:300000}")
    @SchedulerLock(name = "EngagementTemplateSync", lockAtMostFor = "PT10M", lockAtLeastFor = "PT10S")
    public void sweep() {
        List<String> institutes = proposalRepository.institutesWithPendingProposals();
        if (institutes.isEmpty()) return;

        int totalChanged = 0;
        for (String instituteId : institutes) {
            try {
                totalChanged += proposalService.sync(instituteId);
            } catch (Exception e) {
                // One institute's Meta/credential hiccup must not stall the rest.
                log.warn("Template sync failed for institute {}: {}", instituteId, e.getMessage());
            }
        }
        if (totalChanged > 0) {
            log.info("Template sync: {} proposal(s) advanced across {} institute(s)", totalChanged, institutes.size());
        }
    }

    /**
     * W12 — re-check APPROVED templates for a later Meta disable/pause. Hourly, not every 5 minutes:
     * it refreshes from Meta for every institute that has approved templates.
     */
    @Scheduled(fixedDelayString = "${engagement.template-sync.approved-delay-ms:3600000}",
            initialDelayString = "${engagement.template-sync.approved-initial-delay-ms:600000}")
    @SchedulerLock(name = "EngagementTemplateApprovedSync", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void sweepApproved() {
        for (String instituteId : proposalRepository.institutesWithApprovedProposals()) {
            try {
                proposalService.syncApproved(instituteId);
            } catch (Exception e) {
                log.warn("Approved-template sync failed for institute {}: {}", instituteId, e.getMessage());
            }
        }
    }
}
