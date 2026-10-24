package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * The engine tick. Structure (design §4.1):
 *   engine cursor scan (O(engines), idx_ee_due) → per-member lease CAS → decide cohort.
 *
 * Fairness lives in THIS loop: each due engine gets one bounded batch per sweep and its
 * cursor is bumped, so a 50k-member institute cannot starve a 200-member one. The sort key
 * inside an engine (tier, next_action_at) never spans institutes.
 *
 * @SchedulerLock is a WASTE-REDUCER only — the per-row lease CAS is what protects
 * correctness, and it survives the lock expiring mid-run (which, at LLM latencies, it will).
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementSweepJob {

    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementDecisionService decisionService;
    private final EngagementEngineService engineService;

    @Qualifier("engagementExecutor")
    private final ThreadPoolTaskExecutor engagementExecutor;

    @Value("${engagement.sweep.engines-per-tick:25}")
    private int enginesPerTick;

    @Value("${engagement.sweep.members-per-engine:50}")
    private int membersPerEngine;

    @Value("${engagement.sweep.lease-minutes:15}")
    private int leaseMinutes;

    @Value("${engagement.sweep.engine-revisit-minutes:10}")
    private int engineRevisitMinutes;

    @Scheduled(fixedDelayString = "${engagement.sweep.delay-ms:60000}")
    @SchedulerLock(name = "EngagementSweep", lockAtMostFor = "PT20M", lockAtLeastFor = "PT10S")
    public void sweep() {
        // lockAtMostFor must exceed the worst-case tick (enginesPerTick engines, each an async
        // cohort bounded by lease-1 min). The per-row lease + per-member lease re-check are what
        // protect correctness if the lock expires anyway — the lock is only a fan-out reducer.
        List<EngagementEngine> dueEngines = engineRepository.findDueEngines(Instant.now(), enginesPerTick);
        if (dueEngines.isEmpty()) return;

        for (EngagementEngine engine : dueEngines) {
            try {
                sweepEngine(engine);
            } catch (Exception e) {
                log.error("Sweep failed for engine {}: {}", engine.getId(), e.getMessage(), e);
            } finally {
                // Bump the cursor even on failure — a broken engine must not wedge the sweep.
                engineRepository.bumpCursor(engine.getId(), Instant.now(),
                        Instant.now().plus(Duration.ofMinutes(engineRevisitMinutes)));
            }
        }
    }

    private void sweepEngine(EngagementEngine engine) {
        // Fresh clock PER ENGINE: a stale tick-start `now` reused across serial engines would
        // hand engine #2+ a lease that is already partly (or fully) expired at birth.
        // Millisecond precision so the lease round-trips exactly: Linux clocks give nanoseconds,
        // Postgres keeps microseconds and rounds half-up, so about half the stored leases read back
        // later than the in-memory copy and decideOne skipped them as "lease lost".
        Instant now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        List<EngagementMember> due = memberRepository.findDueMembers(engine.getId(), now, membersPerEngine);
        if (due.isEmpty()) return;

        // Lease CAS per row: only rows we WIN. A loser was claimed by another replica.
        Instant leaseUntil = now.plus(Duration.ofMinutes(leaseMinutes));
        List<EngagementMember> claimed = new ArrayList<>();
        for (EngagementMember m : due) {
            if (memberRepository.claimLease(m.getId(), now, leaseUntil) == 1) {
                m.setNextActionAt(leaseUntil); // keep the in-memory copy consistent with the DB
                claimed.add(m);
            }
        }
        if (claimed.isEmpty()) return;

        // Decide on the dedicated executor: LLM calls are I/O-bound HTTPS — never run them on
        // the scheduler pool (spring.task.scheduling.pool.size is 4 for the whole service).
        // decideCohort re-checks each member's lease immediately before its LLM call and skips
        // any whose lease has lapsed (another pod re-claimed it) — so a cohort that outruns its
        // lease cannot double-decide the members it lost.
        CompletableFuture<Integer> work = CompletableFuture.supplyAsync(
                () -> decisionService.decideCohort(engine, claimed),
                engagementExecutor.getThreadPoolExecutor());
        try {
            int decisions = work.get(leaseMinutes - 1, TimeUnit.MINUTES);
            log.info("Engine {} swept: {} claimed, {} LLM decisions", engine.getId(), claimed.size(), decisions);
        } catch (Exception e) {
            // Timeout/failure: leases stand; those members come due again when leases expire.
            log.error("Cohort decision for engine {} did not complete: {}", engine.getId(), e.getMessage());
        }
    }

    /** Task reaper — stale open tasks expire; rows stuck mid-dispatch settle to FAILED (visible). */
    @Scheduled(fixedDelayString = "${engagement.reaper.delay-ms:900000}")
    @SchedulerLock(name = "EngagementTaskReaper", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void reapExpiredTasks() {
        int expired = actionRepository.expireStaleTasks();
        // A dispatch stuck > 10 min means the pod died between claim and settle; make it visible
        // as FAILED (never OPEN — the send may have landed) so a human can reopen after checking.
        int reaped = actionRepository.reapStuckDispatching(Instant.now().minus(Duration.ofMinutes(10)));
        if (expired > 0 || reaped > 0) {
            log.info("Reaper: {} tasks expired, {} stuck-dispatching settled to FAILED", expired, reaped);
        }
    }

    /**
     * Nightly membership reconcile (design §12): re-resolve every ACTIVE/DRY_RUN engine's
     * audience and EXIT members who left. Without this, a learner who leaves the batch or a
     * lead who opts out keeps being decided by an engine whose premise is enrollment.
     */
    @Scheduled(cron = "${engagement.reconcile.cron:0 30 2 * * ?}")
    @SchedulerLock(name = "EngagementReconcile", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void reconcileAll() {
        int engines = 0;
        for (EngagementEngine engine : engineRepository.findReconcilable()) {
            try {
                engineService.enrollAndReconcile(engine.getId(), engine.getInstituteId());
                engines++;
            } catch (Exception e) {
                log.error("Nightly reconcile failed for engine {}: {}", engine.getId(), e.getMessage());
            }
        }
        if (engines > 0) log.info("Nightly reconcile ran for {} engines", engines);
    }
}
