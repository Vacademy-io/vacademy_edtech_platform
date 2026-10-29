package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

/**
 * New leads join their engines within a minute, whatever way they arrived (form, admin "Add lead",
 * webhook, import). Only the Lead Agent intake called {@link EngagementEngineService#enrollNewLead};
 * every other lead waited for the 02:30 UTC reconcile, so an engine set to "reach them right away"
 * met a lead added at 6 pm the next morning.
 *
 * Reads the lists targeted by live engines for leads submitted since the previous run (with an
 * overlap). A lead row already in any engine is skipped: enrollNewLead re-activates an EXITED
 * membership, and someone who left (booked a meeting, said no) must not be pulled back in.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementIntakeSweepJob {

    private static final Duration FIRST_LOOKBACK = Duration.ofMinutes(30);
    private static final Duration OVERLAP = Duration.ofMinutes(2);

    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementReadDao dao;
    private final EngagementEngineService engineService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final AtomicReference<Instant> lastRunStart = new AtomicReference<>();

    @Scheduled(fixedDelayString = "${engagement.intake.delay-ms:60000}",
            initialDelayString = "${engagement.intake.initial-delay-ms:45000}")
    @SchedulerLock(name = "EngagementIntakeSweep", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void sweep() {
        Instant now = Instant.now();
        Instant previous = lastRunStart.get();
        Instant since = previous != null ? previous.minus(OVERLAP) : now.minus(FIRST_LOOKBACK);
        try {
            Set<String> lists = new LinkedHashSet<>();
            for (String instituteId : memberRepository.institutesWithLiveEngines()) {
                for (EngagementEngine e : engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId)) {
                    if (e.isSystemManaged()) continue;
                    if (!"ACTIVE".equals(e.getStatus()) && !"DRY_RUN".equals(e.getStatus())) continue;
                    lists.addAll(audienceIds(e.getAudience()));
                }
            }
            int joined = 0;
            List<Object[]> leads = dao.leadsSubmittedSince(lists, since);
            if (!leads.isEmpty()) {
                Set<String> already = new HashSet<>(memberRepository.responsesWithMembership(
                        leads.stream().map(r -> (String) r[0]).toList()));
                for (Object[] r : leads) {
                    String responseId = (String) r[0];
                    if (already.contains(responseId)) continue;
                    try {
                        joined += engineService.enrollNewLead((String) r[2], (String) r[1], responseId, (String) r[3]);
                    } catch (Exception ex) {
                        log.warn("Intake: lead {} not enrolled: {}", responseId, ex.getMessage());
                    }
                }
            }
            if (joined > 0) log.info("Intake sweep: {} new lead membership(s) across {} list(s)", joined, lists.size());
            lastRunStart.set(now);
        } catch (Exception e) {
            // Keep the old cursor: the next run re-reads this window.
            log.warn("Intake sweep failed: {}", e.getMessage());
        }
    }

    Set<String> audienceIds(String audienceJson) {
        Set<String> ids = new LinkedHashSet<>();
        try {
            JsonNode arr = objectMapper.readTree(audienceJson == null ? "[]" : audienceJson);
            for (JsonNode sel : arr) {
                if ("AUDIENCE".equals(sel.path("type").asText()) && !sel.path("id").asText("").isBlank()) {
                    ids.add(sel.path("id").asText());
                }
            }
        } catch (Exception ignored) {
            // an unreadable audience targets no list
        }
        return ids;
    }
}
