package vacademy.io.admin_core_service.features.access_pass.service;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.core.DefaultLockingTaskExecutor;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.LockingTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.access_pass.dto.AccessPassDTOs.SyncReport;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPass;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassItem;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.AccessPassStatus;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.ItemRemovalPolicy;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.ItemStatus;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassItemRepository;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassRepository;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassSubOrgRepository;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassSubOrg;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.SubOrgLinkStatus;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgSubscriptionService;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassGrant;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.GrantStatus;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassGrantRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Applies a pass's current item list to every current holder (see
 * {@link AccessPassEntitlementService#reconcilePlan}). Runs from the 10-minute job and,
 * right after an admin changes a pass's courses, on a small background pool.
 *
 * <p>One pass is synced by one pod at a time: the run takes a ShedLock named after the
 * pass, so the scheduled sweep and an on-demand sync (possibly on another replica) never
 * grant the same course twice. A run that finds the lock held simply skips — the holder
 * of the lock is already doing the work, and needs_sync stays set until a run completes.
 */
@Slf4j
@Service
public class AccessPassSyncService {

    /** Holder plans fetched per query. */
    static final int BATCH_SIZE = 200;
    /** Upper bound on one run, so a pathological pass cannot hold the lock forever. */
    static final int MAX_BATCHES = 250;

    private final AccessPassRepository passRepository;
    private final AccessPassItemRepository itemRepository;
    private final AccessPassEntitlementService entitlementService;
    private final LockingTaskExecutor lockingTaskExecutor;
    /** @Lazy both ways: AccessPassService queues syncs here, and the sync refreshes its items. */
    @Autowired
    @Lazy
    private AccessPassService accessPassService;

    @Autowired
    private AccessPassSubOrgRepository subOrgLinkRepository;

    @Autowired
    @Lazy
    private SubOrgSubscriptionService subOrgSubscriptionService;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository membershipRepository;

    @Autowired
    private AccessPassGrantRepository grantRepository;

    private final ExecutorService background = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "access-pass-sync");
        t.setDaemon(true);
        return t;
    });

    public AccessPassSyncService(AccessPassRepository passRepository,
                                 AccessPassItemRepository itemRepository,
                                 AccessPassEntitlementService entitlementService,
                                 LockProvider lockProvider) {
        this.passRepository = passRepository;
        this.itemRepository = itemRepository;
        this.entitlementService = entitlementService;
        this.lockingTaskExecutor = new DefaultLockingTaskExecutor(lockProvider);
    }

    @PreDestroy
    void shutdown() {
        background.shutdownNow();
    }

    /**
     * Queue a sync of {@code accessPassId} for after the current transaction commits (so
     * it sees the item change that asked for it), or right away when there is none.
     */
    public void requestSync(String accessPassId) {
        Runnable submit = () -> background.submit(() -> {
            try {
                syncPass(accessPassId);
            } catch (Exception e) {
                log.error("[access-pass] background sync of {} failed", accessPassId, e);
            }
        });
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    submit.run();
                }
            });
        } else {
            submit.run();
        }
    }

    /** Sweep every pass that can have current holders. Called by AccessPassSyncJob. */
    public void syncAll() {
        List<AccessPass> passes = passRepository.findByStatusIn(
                List.of(AccessPassStatus.ACTIVE.name(), AccessPassStatus.ARCHIVED.name()));
        for (AccessPass pass : passes) {
            try {
                syncPass(pass.getId());
            } catch (Exception e) {
                log.error("[access-pass] sync of pass {} failed", pass.getId(), e);
            }
        }
    }

    /** Sync one pass under its lock. Returns the report (skippedLocked when another run holds it). */
    public SyncReport syncPass(String accessPassId) {
        LockConfiguration lock = new LockConfiguration(Instant.now(), "AccessPassSync-" + accessPassId,
                Duration.ofMinutes(30), Duration.ZERO);
        LockingTaskExecutor.TaskResult<SyncReport> result;
        try {
            result = lockingTaskExecutor.executeWithLock(() -> runSync(accessPassId), lock);
        } catch (Throwable t) {
            throw new IllegalStateException("Access pass sync failed for " + accessPassId, t);
        }
        return result.wasExecuted()
                ? result.getResult()
                : SyncReport.builder().accessPassId(accessPassId).skippedLocked(true).build();
    }

    /**
     * B2B roster: every member with a live row in the sub-org (stamped with it, or reached
     * through one of its invites) gets each of the pass's courses. The member's newest
     * live row is the template the new course rows copy. Members whose ledger already
     * covers every course are skipped without a write. Returns {granted, covered,
     * recorded, failed}.
     */
    private int[] syncSubOrgRoster(AccessPass pass, String subOrgId, List<String> included) {
        java.util.Map<String, StudentSessionInstituteGroupMapping> templateByUser = new java.util.HashMap<>();
        java.util.function.Consumer<StudentSessionInstituteGroupMapping> offer = m -> templateByUser.merge(
                m.getUserId(), m, (a, b) -> newer(a, b));
        membershipRepository.findActiveRowsBySubOrgId(subOrgId).forEach(offer);
        membershipRepository.findActiveRowsViaSubOrgInvite(subOrgId).forEach(offer);
        if (templateByUser.isEmpty()) {
            return new int[] {0, 0, 0, 0};
        }

        java.util.Map<String, String> ledgerKeyByUser = new java.util.HashMap<>();
        templateByUser.forEach((userId, t) -> ledgerKeyByUser.put(userId,
                t.getUserPlanId() != null && !t.getUserPlanId().isBlank()
                        ? t.getUserPlanId()
                        : "SUB_ORG:" + subOrgId + ":" + userId));
        java.util.Map<String, Set<String>> coveredByKey = new java.util.HashMap<>();
        for (AccessPassGrant g : grantRepository.findByUserPlanIdIn(new java.util.ArrayList<>(ledgerKeyByUser.values()))) {
            if (GrantStatus.ACTIVE.name().equals(g.getStatus())) {
                coveredByKey.computeIfAbsent(g.getUserPlanId(), k -> new HashSet<>()).add(g.getPackageSessionId());
            }
        }

        int granted = 0, covered = 0, recorded = 0, failed = 0;
        for (var e : templateByUser.entrySet()) {
            Set<String> done = coveredByKey.getOrDefault(ledgerKeyByUser.get(e.getKey()), Set.of());
            if (done.containsAll(included)) {
                continue;
            }
            try {
                AccessPassEntitlementService.PlanResult r = entitlementService.reconcileSubOrgMember(
                        pass, subOrgId, e.getValue().getId(), included);
                granted += r.granted();
                covered += r.covered();
                recorded += r.recorded();
            } catch (Exception ex) {
                failed++;
                log.warn("[access-pass] could not give pass {} courses to sub-org {} member {}: {}",
                        pass.getId(), subOrgId, e.getKey(), ex.getMessage());
            }
        }
        return new int[] {granted, covered, recorded, failed};
    }

    /** The template to copy: prefer a row stamped with the sub-org, then the later expiry. */
    private static StudentSessionInstituteGroupMapping newer(StudentSessionInstituteGroupMapping a,
                                                             StudentSessionInstituteGroupMapping b) {
        boolean aStamped = a.getSubOrg() != null;
        boolean bStamped = b.getSubOrg() != null;
        if (aStamped != bStamped) {
            return aStamped ? a : b;
        }
        if (a.getExpiryDate() == null) return a;
        if (b.getExpiryDate() == null) return b;
        return a.getExpiryDate().after(b.getExpiryDate()) ? a : b;
    }

    private SyncReport runSync(String accessPassId) {
        Timestamp startedAt = new Timestamp(System.currentTimeMillis());
        SyncReport.SyncReportBuilder report = SyncReport.builder().accessPassId(accessPassId);
        AccessPass pass = passRepository.findById(accessPassId).orElse(null);
        if (pass == null || pass.getEnrollInviteId() == null
                || AccessPassStatus.DELETED.name().equals(pass.getStatus())) {
            return report.complete(true).build();
        }
        // ALL_COURSES: pull the institute's current catalogue into the item list first,
        // so a course published since the last run reaches holders in this same run.
        int[] refreshed = accessPassService.refreshAllCourses(pass.getId());
        report.itemsAdded(refreshed[0]).itemsRemoved(refreshed[1]);

        List<String> included = itemRepository
                .findByAccessPassIdAndStatusOrderByDisplayOrderAscAddedAtAsc(pass.getId(), ItemStatus.ACTIVE.name())
                .stream().map(AccessPassItem::getPackageSessionId).toList();
        boolean revoke = ItemRemovalPolicy.REVOKE.name().equals(pass.getOnItemRemoved());

        int processed = 0, failed = 0, granted = 0, covered = 0, recorded = 0, revoked = 0;
        Set<String> seen = new HashSet<>();
        boolean exhausted = false;
        for (int batch = 0; batch < MAX_BATCHES; batch++) {
            List<String> planIds = passRepository.findHolderPlanIdsNeedingSync(pass.getId(),
                    pass.getEnrollInviteId(), revoke, new Timestamp(System.currentTimeMillis()), BATCH_SIZE);
            // Plans that failed stay "needing sync" and come back in the next query; once a
            // query returns nothing new, everything left is a known failure for this run.
            List<String> fresh = planIds.stream().filter(seen::add).toList();
            if (fresh.isEmpty()) {
                exhausted = true;
                break;
            }
            for (String planId : fresh) {
                try {
                    AccessPassEntitlementService.PlanResult r =
                            entitlementService.reconcilePlan(pass, included, planId);
                    processed++;
                    granted += r.granted();
                    covered += r.covered();
                    recorded += r.recorded();
                    revoked += r.revoked();
                } catch (Exception e) {
                    failed++;
                    log.warn("[access-pass] could not reconcile plan {} of pass {}: {}",
                            planId, pass.getId(), e.getMessage());
                }
            }
        }

        // B2B: push the item list to every sub-org holding the pass. addSubOrgPackageSessions
        // is idempotent (already-linked courses are skipped), links the course on the
        // sub-org's org invite, mirrors its learner invites and grants its team access.
        int subOrgsSynced = 0, subOrgsFailed = 0, subOrgCoursesLinked = 0;
        if (AccessPassService.isB2B(pass) && !included.isEmpty()) {
            for (AccessPassSubOrg link : subOrgLinkRepository
                    .findByAccessPassIdAndStatusOrderByAssignedAtDesc(pass.getId(), SubOrgLinkStatus.ACTIVE.name())) {
                try {
                    subOrgCoursesLinked += subOrgSubscriptionService
                            .addSubOrgPackageSessions(link.getSubOrgId(), pass.getInstituteId(), included).size();
                    // Linking a course to the sub-org only opens it for FUTURE enrolments;
                    // its current admin and learners are given the course here.
                    int[] roster = syncSubOrgRoster(pass, link.getSubOrgId(), included);
                    granted += roster[0];
                    covered += roster[1];
                    recorded += roster[2];
                    if (roster[3] > 0) {
                        throw new IllegalStateException(roster[3] + " member(s) could not be given the courses");
                    }
                    link.setLastSyncedAt(new Timestamp(System.currentTimeMillis()));
                    subOrgLinkRepository.save(link);
                    subOrgsSynced++;
                } catch (Exception e) {
                    subOrgsFailed++;
                    log.warn("[access-pass] could not push pass {} courses to sub-org {}: {}",
                            pass.getId(), link.getSubOrgId(), e.getMessage());
                }
            }
        }
        report.subOrgsSynced(subOrgsSynced).subOrgsFailed(subOrgsFailed).subOrgCoursesLinked(subOrgCoursesLinked);

        boolean complete = exhausted && failed == 0 && subOrgsFailed == 0;
        // Targeted update, not a save of the entity read at the start: an admin may have
        // edited the pass (or added another course, setting needs_sync again) meanwhile.
        passRepository.markSynced(pass.getId(), complete, startedAt, new Timestamp(System.currentTimeMillis()));

        if (processed + failed > 0) {
            log.info("[access-pass] synced pass {}: plans={} failed={} granted={} covered={} recorded={} revoked={}",
                    pass.getId(), processed, failed, granted, covered, recorded, revoked);
        }
        return report.plansProcessed(processed).plansFailed(failed).coursesGranted(granted)
                .coursesCovered(covered).ledgerRowsRecorded(recorded).coursesRevoked(revoked)
                .complete(complete).build();
    }
}
