package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Leads the CRM marked Converted leave their engines within one run (design T11: "a lead marked
 * Converted at 3 pm has its 4 pm WhatsApp cancelled within one sweep"). Without it a converted
 * member stayed ACTIVE until its next decision, which can be days away at the engine's cadence;
 * its sends were already withheld at dispatch.
 *
 * Reads only the conversions since the previous run (lead_status_history, indexed by institute
 * and status), with an overlap so a slow run or a clock skew misses nothing. Re-reading is safe:
 * members already out are not matched again.
 *
 * Engines whose goal is a meeting (channels.exitOnMeetingBooked) also let go of a lead once a
 * meeting is booked with it (booking_instance), read the same way.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementLeadExitJob {

    /** The first run after a start looks back a day; later runs chain from the previous one. */
    private static final Duration FIRST_LOOKBACK = Duration.ofHours(24);
    private static final Duration OVERLAP = Duration.ofMinutes(30);

    private final EngagementMemberRepository memberRepository;
    private final EngagementCrmMirrorDao crmDao;
    private final EngagementLeadOutcomeService outcomeService;

    private final AtomicReference<Instant> lastRunStart = new AtomicReference<>();

    @Scheduled(fixedDelayString = "${engagement.lead-exit.delay-ms:300000}",
            initialDelayString = "${engagement.lead-exit.initial-delay-ms:60000}")
    @SchedulerLock(name = "EngagementLeadExitSweep", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void sweep() {
        Instant now = Instant.now();
        Instant previous = lastRunStart.get();
        Instant since = previous != null ? previous.minus(OVERLAP) : now.minus(FIRST_LOOKBACK);
        try {
            List<String> institutes = memberRepository.institutesWithLiveEngines();
            if (institutes.isEmpty()) {
                lastRunStart.set(now);
                return;
            }
            List<String> converted = crmDao.membersOfLeadsConvertedSince(institutes, since);
            int left = outcomeService.exitConverted(converted, now);
            if (left > 0) log.info("Lead exit sweep: {} member(s) of converted or lost leads left their engines", left);
            List<String> booked = crmDao.membersOfLeadsWithMeetingBookedSince(institutes, since);
            int met = outcomeService.exitMeetingBooked(booked, now);
            if (met > 0) log.info("Lead exit sweep: {} member(s) left their engines after booking a meeting", met);
            lastRunStart.set(now);
        } catch (Exception e) {
            // Keep the old cursor: the next run re-reads this window.
            log.warn("Lead exit sweep failed: {}", e.getMessage());
        }
    }
}
