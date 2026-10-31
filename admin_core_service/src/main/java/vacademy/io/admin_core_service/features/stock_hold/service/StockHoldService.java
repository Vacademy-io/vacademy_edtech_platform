package vacademy.io.admin_core_service.features.stock_hold.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.StockInfoProjection;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldStatus;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.logging.SentryLogger;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Stock held while a learner pays, and every later movement of that stock (V635).
 *
 * <p>Only package sessions with {@code max_seats} set are stock-tracked; every method here
 * ignores unlimited sessions, so courses without stock never see a row.
 *
 * <p>CONTRACT — other code calls exactly these signatures. Bodies are implemented by the
 * stock work package; do not change a signature without updating every caller.
 *
 * <p>Concurrency: every row change is a compare-and-set UPDATE and every stock change is one
 * conditional UPDATE on {@code package_session}, so the webhook, the expiry job, the release
 * endpoint and admin actions can race on the same order and stock still moves exactly once.
 * Rows are always processed in package-session order, so two transactions lock stock rows in
 * the same order and cannot deadlock each other.
 *
 * <p>Webhook safety: {@link #onPlanActivated}, {@link #onPlanStacked}, the release methods and
 * {@link #restoreForPlan} never throw. A stock problem is logged and sent to Sentry; it must not
 * roll back the payment it follows. Catching is not enough for that: a failed statement aborts
 * the whole Postgres transaction. So the hooks a payment, an enrollment or an admin action calls
 * (activate, stack, restore, release held / unclaimed picks) move stock after the caller
 * commits, in a transaction of their own ({@link #afterCommit}). Only the checkout-time
 * {@link #hold} / {@link #attach} throw, because a checkout that cannot hold its stock must fail.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StockHoldService {

    /** How long a hold lasts; also the Razorpay checkout {@code timeout} the storefront sets. */
    public static final int HOLD_MINUTES = 30;

    /** Expired holds released per scheduler tick; the next tick picks up the rest. */
    private static final int EXPIRY_BATCH_SIZE = 500;

    private static final String HELD = StockHoldStatus.HELD.name();
    private static final String SOLD = StockHoldStatus.SOLD.name();
    private static final String RELEASED = StockHoldStatus.RELEASED.name();
    private static final String RESTORED = StockHoldStatus.RESTORED.name();
    private static final String PURCHASE = StockHoldKind.PURCHASE.name();
    private static final String RENT_PREFERENCE = StockHoldKind.RENT_PREFERENCE.name();

    /** package_session_id and id are NOT NULL columns. */
    private static final Comparator<StockHoldRow> BY_SESSION = Comparator
            .comparing(StockHoldRow::getPackageSessionId)
            .thenComparing(StockHoldRow::getId);

    private final StockHoldRepository stockHoldRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final PlatformTransactionManager transactionManager;

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Takes {@code quantity} from {@code available_slots} for each stock-tracked package session,
     * one atomic conditional UPDATE each, and records a HELD row per session with
     * {@code expires_at = now + HOLD_MINUTES}. Unlimited sessions are skipped (no row).
     *
     * @throws vacademy.io.common.exceptions.ConflictException (409) "Only N left of <name>" when
     *         a session is short. The caller's transaction rolls back every hold already taken.
     * @return the HELD rows created, not yet linked to a plan or payment log (see {@link #attach}).
     */
    @Transactional
    public List<StockHold> hold(String instituteId, Map<String, Integer> quantityByPackageSessionId,
                                StockHoldKind kind) {
        List<StockHold> holds = new ArrayList<>();
        if (quantityByPackageSessionId == null || quantityByPackageSessionId.isEmpty()) {
            return holds;
        }
        // Sorted, so two checkouts for the same books lock the stock rows in the same order.
        TreeMap<String, Integer> sorted = new TreeMap<>();
        quantityByPackageSessionId.forEach((packageSessionId, quantity) -> {
            if (!StringUtils.hasText(packageSessionId)) {
                return;
            }
            if (quantity == null || quantity < 1) {
                throw new InvalidRequestException("Quantity must be a whole number of at least 1");
            }
            sorted.put(packageSessionId, quantity);
        });
        if (sorted.isEmpty()) {
            return holds;
        }

        // Rent picks arrive as raw ids from the browser: never hold another institute's stock.
        if (StringUtils.hasText(instituteId)) {
            Set<String> ofInstitute = new HashSet<>(
                    packageSessionRepository.findIdsOfInstitute(sorted.keySet(), instituteId));
            sorted.keySet().removeIf(packageSessionId -> {
                boolean foreign = !ofInstitute.contains(packageSessionId);
                if (foreign) {
                    log.warn("Not holding stock for package session {}: not a session of institute {}",
                            packageSessionId, instituteId);
                }
                return foreign;
            });
            if (sorted.isEmpty()) {
                return holds;
            }
        }

        Map<String, StockInfoProjection> stock = stockInfo(sorted.keySet());
        Date expiresAt = new Date(System.currentTimeMillis() + HOLD_MINUTES * 60_000L);
        String kindName = (kind != null ? kind : StockHoldKind.PURCHASE).name();

        for (Map.Entry<String, Integer> entry : sorted.entrySet()) {
            String packageSessionId = entry.getKey();
            int quantity = entry.getValue();
            StockInfoProjection info = stock.get(packageSessionId);
            if (info == null || info.getMaxSeats() == null) {
                continue; // unlimited (or unknown): nothing to hold
            }
            if (packageSessionRepository.takeAvailableSlots(packageSessionId, quantity) == 0) {
                // Read again: the admin may have made the session unlimited since the read above.
                StockInfoProjection now = stockInfo(List.of(packageSessionId)).get(packageSessionId);
                if (now == null || now.getMaxSeats() == null) {
                    continue;
                }
                int left = now.getAvailableSlots() != null ? Math.max(now.getAvailableSlots(), 0) : 0;
                throw new ConflictException("Only " + left + " left of " + displayName(now));
            }
            holds.add(newRow(packageSessionId, instituteId, null, null, kindName, quantity, HELD,
                    expiresAt, false));
        }
        if (holds.isEmpty()) {
            return holds;
        }

        List<StockHold> saved = stockHoldRepository.saveAllAndFlush(holds);
        // Detached on purpose: attach() links the rows with UPDATEs and mirrors the values onto
        // these objects, which must never be flushed back over a status another transaction set.
        saved.forEach(entityManager::detach);
        log.info("Held stock for {} package session(s) of institute {} until {}",
                saved.size(), instituteId, expiresAt);
        return saved;
    }

    /**
     * Links holds to the learner, the plan that owns them, and the order's gateway payment log
     * (the log the storefront polls and releases by — the same id for every hold of an order).
     * A null argument leaves that field as it is: the plan is known before the gateway call and
     * the payment log after it, so callers link in two steps.
     */
    @Transactional
    public void attach(List<StockHold> holds, String userId, String userPlanId, String orderPaymentLogId) {
        if (holds == null || holds.isEmpty()) {
            return;
        }
        List<String> ids = holds.stream()
                .filter(Objects::nonNull)
                .map(StockHold::getId)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return;
        }
        // Column updates, not entity saves: a save would also write the row's status as this
        // object remembers it, undoing a release or sale another transaction made meanwhile.
        if (userId != null) {
            stockHoldRepository.setUserId(ids, userId);
        }
        if (userPlanId != null) {
            stockHoldRepository.setUserPlanId(ids, userPlanId);
        }
        if (orderPaymentLogId != null) {
            stockHoldRepository.setPaymentLogId(ids, orderPaymentLogId);
        }
        for (StockHold hold : holds) {
            if (hold == null || entityManager.contains(hold)) {
                continue; // a managed copy is left untouched so it never becomes dirty
            }
            if (userId != null) {
                hold.setUserId(userId);
            }
            if (userPlanId != null) {
                hold.setUserPlanId(userPlanId);
            }
            if (orderPaymentLogId != null) {
                hold.setPaymentLogId(orderPaymentLogId);
            }
        }
    }

    /**
     * Call wherever a plan becomes ACTIVE (first payment, free enrollment, admin MANUAL
     * enrollment). Replaces every old {@code decrementAvailability(psId, 1)} loop on those paths.
     * <ul>
     *   <li>Plan has holds: HELD → SOLD (no second decrement); RELEASED → take the stock again,
     *       or mark SOLD + oversold when it is gone (money was taken, so fulfil anyway).</li>
     *   <li>Plan has none: for each activated stock-tracked session, claim this learner's
     *       unclaimed SOLD RENT_PREFERENCE hold for it if one exists (no decrement); otherwise
     *       take {@code userPlan.quantity} atomically and record a SOLD PURCHASE row.</li>
     * </ul>
     * Idempotent per plan: a second call for an already-SOLD plan changes nothing.
     *
     * <p>The plan's own holds settle whatever {@code activatedPackageSessionIds} says: they were
     * taken at checkout for exactly what the learner bought (a repeat purchase of an owned book
     * activates no new mapping on this plan, yet its hold must still become SOLD). The list only
     * decides which sessions WITHOUT a hold take stock now; null means "none".
     *
     * <p>Runs once the caller commits ({@link #afterCommit}); never throws.
     */
    public void onPlanActivated(UserPlan userPlan, List<String> activatedPackageSessionIds) {
        if (userPlan == null || !StringUtils.hasText(userPlan.getId())) {
            return;
        }
        loadForLater(userPlan);
        List<String> sessionIds = activatedPackageSessionIds != null ? new ArrayList<>(activatedPackageSessionIds) : null;
        afterCommit("Stock update failed on plan activation",
                tags("userPlanId", userPlan.getId(), "userId", userPlan.getUserId()),
                () -> settleOnActivation(userPlan, sessionIds));
    }

    /**
     * A paid plan was queued (PENDING) behind the learner's running plan for the same invite
     * instead of activating, which is what a renewal bought through checkout looks like.
     * Stacking has never moved stock (nor does the later promotion), so the plan's own
     * PURCHASE holds go back; its RENT_PREFERENCE picks were paid for and settle as SOLD, ready
     * for the admin to assign. Runs once the caller commits; never throws.
     */
    public void onPlanStacked(UserPlan userPlan) {
        if (userPlan == null || !StringUtils.hasText(userPlan.getId())) {
            return;
        }
        String userPlanId = userPlan.getId();
        afterCommit("Stock update failed for stacked plan", tags("userPlanId", userPlanId), () -> {
            List<StockHoldRow> rows = sorted(stockHoldRepository.findRowsOwnedOrClaimedByPlan(userPlanId));
            for (StockHoldRow row : rows) {
                if (!userPlanId.equals(row.getUserPlanId())) {
                    continue;
                }
                if (RENT_PREFERENCE.equals(row.getKind())) {
                    settleOwnedRow(row, userPlan);
                } else if (HELD.equals(row.getStatus())
                        && stockHoldRepository.transitionStatus(row.getId(), HELD, RELEASED) == 1) {
                    giveBack(row.getPackageSessionId(), quantityOf(row));
                }
            }
        });
    }

    /** Payment window closed: releases the order's HELD holds unless its payment log is PAID. */
    @Transactional
    public int releaseForOrder(String orderPaymentLogId) {
        if (!StringUtils.hasText(orderPaymentLogId)) {
            return 0;
        }
        int released = 0;
        try {
            // The PAID check lives in the UPDATE itself, so a webhook landing mid-release wins.
            for (StockHoldRow row : sorted(stockHoldRepository.findHeldRowsByPaymentLogId(orderPaymentLogId))) {
                if (releaseIfUnpaid(row)) {
                    released++;
                }
            }
            if (released > 0) {
                log.info("Released {} stock hold(s) for closed payment window, payment log {}",
                        released, orderPaymentLogId);
            }
        } catch (Exception e) {
            log.error("Could not release stock holds for payment log {}", orderPaymentLogId, e);
            SentryLogger.logError(e, "Stock hold release failed", tags("paymentLogId", orderPaymentLogId));
        }
        return released;
    }

    /** Scheduler: releases HELD holds past {@code expires_at} whose order payment log is not PAID. */
    @Transactional
    public int releaseExpired() {
        int released = 0;
        try {
            List<StockHoldRow> rows = new ArrayList<>(stockHoldRepository.findExpiredUnpaidHeldRows(
                    new Date(), PageRequest.of(0, EXPIRY_BATCH_SIZE)));
            rows.sort(BY_SESSION);
            for (StockHoldRow row : rows) {
                if (releaseIfUnpaid(row)) {
                    released++;
                }
            }
            if (released > 0) {
                log.info("Released {} expired stock hold(s)", released);
            }
        } catch (Exception e) {
            log.error("Releasing expired stock holds failed", e);
            SentryLogger.logError(e, "Expired stock hold release failed");
        }
        return released;
    }

    /**
     * Admin assigned books to a learner (MANUAL, after every item was enrolled): releases that
     * learner's remaining unclaimed SOLD RENT_PREFERENCE holds whose package session shares a
     * level with one of {@code assignedPackageSessionIds} — the admin picked other books from the
     * same level (e.g. "rent") instead. Holds on other levels are left alone, so an admin
     * "Buy Books" action never releases a learner's rent picks.
     *
     * <p>The released picks end RESTORED, not RELEASED: they were paid for, and RELEASED would
     * make a later activation of the membership plan take their stock again.
     *
     * <p>Runs once the caller commits, after the activations of the same assignment (which may
     * claim some of these picks first); never throws.
     */
    public void releaseUnclaimedRentPreferences(String userId, String instituteId,
                                                List<String> assignedPackageSessionIds) {
        if (!StringUtils.hasText(userId) || assignedPackageSessionIds == null
                || assignedPackageSessionIds.isEmpty()) {
            return;
        }
        List<String> assigned = new ArrayList<>(assignedPackageSessionIds);
        afterCommit("Rent pick release failed", tags("userId", userId, "instituteId", instituteId), () -> {
            Set<String> assignedLevelIds = stockInfo(assigned).values().stream()
                    .map(StockInfoProjection::getLevelId)
                    .filter(StringUtils::hasText)
                    .collect(Collectors.toSet());
            if (assignedLevelIds.isEmpty()) {
                return;
            }
            List<StockHoldRow> picks = sorted(stockHoldRepository.findUnclaimedSoldRentPreferences(userId)).stream()
                    .filter(row -> instituteId == null || row.getInstituteId() == null
                            || instituteId.equals(row.getInstituteId()))
                    .toList();
            if (picks.isEmpty()) {
                return;
            }
            Map<String, StockInfoProjection> pickStock = stockInfo(picks.stream()
                    .map(StockHoldRow::getPackageSessionId).collect(Collectors.toSet()));
            int released = 0;
            for (StockHoldRow pick : picks) {
                StockInfoProjection info = pickStock.get(pick.getPackageSessionId());
                if (info == null || !assignedLevelIds.contains(info.getLevelId())) {
                    continue;
                }
                if (stockHoldRepository.restoreUnclaimed(pick.getId()) == 1) {
                    giveBack(pick.getPackageSessionId(), quantityOf(pick));
                    released++;
                }
            }
            if (released > 0) {
                log.info("Released {} unclaimed rent pick(s) of user {} after an admin assignment", released, userId);
            }
        });
    }

    /**
     * Cancel / terminate / return / de-assign: gives back, once, the SOLD stock this plan owns
     * (its own unclaimed holds, plus RENT_PREFERENCE holds it claimed) → RESTORED. A hold still
     * HELD on the plan (cancelled before the payment settled) is released at the same time
     * instead of waiting for its expiry.
     *
     * <p>The plan's rows are looked up now, so the caller knows at once whether to fall back;
     * the stock itself moves once the caller commits. Never throws.
     *
     * @param packageSessionIdOrNull limit to one session (de-assign), or null for the whole plan
     * @return true when the plan had any stock_hold row — the caller then skips its legacy
     *         increment; false for plans created before V635, which keep today's behaviour.
     */
    public boolean restoreForPlan(String userPlanId, String packageSessionIdOrNull) {
        if (!StringUtils.hasText(userPlanId)) {
            return false;
        }
        boolean hadRows;
        try {
            hadRows = stockHoldRepository.existsByUserPlanIdOrClaimedByUserPlanId(userPlanId, userPlanId);
        } catch (Exception e) {
            log.error("Could not look up stock holds of plan {}", userPlanId, e);
            SentryLogger.logError(e, "Stock hold lookup failed on restore", tags("userPlanId", userPlanId));
            return false;
        }
        if (!hadRows) {
            return false;
        }
        afterCommit("Stock restore failed", tags("userPlanId", userPlanId, "packageSessionId", packageSessionIdOrNull), () -> {
            int restored = 0;
            for (StockHoldRow row : sorted(stockHoldRepository.findRowsOwnedOrClaimedByPlan(userPlanId))) {
                if (packageSessionIdOrNull != null && !packageSessionIdOrNull.equals(row.getPackageSessionId())) {
                    continue;
                }
                boolean claimedByPlan = userPlanId.equals(row.getClaimedByUserPlanId());
                boolean ownedUnclaimed = userPlanId.equals(row.getUserPlanId()) && row.getClaimedByUserPlanId() == null;
                int won = 0;
                if (SOLD.equals(row.getStatus())) {
                    // A pick the membership owns but an admin plan claimed belongs to that plan now:
                    // only its return gives the stock back.
                    won = claimedByPlan ? stockHoldRepository.restoreClaimed(row.getId(), userPlanId)
                            : ownedUnclaimed ? stockHoldRepository.restoreUnclaimed(row.getId()) : 0;
                } else if (HELD.equals(row.getStatus()) && userPlanId.equals(row.getUserPlanId())) {
                    won = stockHoldRepository.transitionStatus(row.getId(), HELD, RELEASED);
                }
                if (won == 1) {
                    giveBack(row.getPackageSessionId(), quantityOf(row));
                    restored++;
                }
            }
            if (restored > 0) {
                log.info("Gave back stock of {} hold(s) for plan {} (session {})",
                        restored, userPlanId, packageSessionIdOrNull != null ? packageSessionIdOrNull : "all");
            }
        });
        return true;
    }

    /**
     * Soft cancel (CANCELED): the learner keeps the item until the plan ends, so sold stock stays
     * out — only holds still waiting for payment go back. A terminate / return / hard de-assign
     * gives sold stock back through {@link #restoreForPlan}. Runs once the caller commits;
     * never throws.
     */
    public void releaseHeldForPlan(String userPlanId) {
        if (!StringUtils.hasText(userPlanId)) {
            return;
        }
        afterCommit("Stock release failed on cancel", tags("userPlanId", userPlanId), () -> {
            for (StockHoldRow row : sorted(stockHoldRepository.findRowsOwnedOrClaimedByPlan(userPlanId))) {
                if (HELD.equals(row.getStatus()) && userPlanId.equals(row.getUserPlanId())
                        && stockHoldRepository.transitionStatus(row.getId(), HELD, RELEASED) == 1) {
                    giveBack(row.getPackageSessionId(), quantityOf(row));
                }
            }
        });
    }

    /** Sum of HELD quantity on a package session, for Manage Inventory's "held" count. */
    @Transactional(readOnly = true)
    public int heldQuantity(String packageSessionId) {
        if (!StringUtils.hasText(packageSessionId)) {
            return 0;
        }
        try {
            Long held = stockHoldRepository.sumHeldQuantity(packageSessionId);
            return held != null ? held.intValue() : 0;
        } catch (Exception e) {
            log.warn("Could not read held stock for package session {}: {}", packageSessionId, e.getMessage());
            return 0;
        }
    }

    /** {@link #heldQuantity} for many sessions in one grouped query; sessions with nothing held are absent. */
    @Transactional(readOnly = true)
    public Map<String, Integer> heldQuantities(Collection<String> packageSessionIds) {
        Map<String, Integer> held = new HashMap<>();
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return held;
        }
        try {
            for (StockHoldRepository.HeldQuantityRow row
                    : stockHoldRepository.sumHeldQuantityByPackageSession(new HashSet<>(packageSessionIds))) {
                held.put(row.getPackageSessionId(), row.getHeld() != null ? row.getHeld().intValue() : 0);
            }
        } catch (Exception e) {
            log.warn("Could not read held stock for {} package session(s): {}", packageSessionIds.size(), e.getMessage());
        }
        return held;
    }

    // ── internals ───────────────────────────────────────────────────────────

    /**
     * Runs {@code update} once the caller's transaction commits, in a transaction of its own;
     * with no caller transaction, runs it now. A failure is logged and sent to Sentry and never
     * reaches the caller. If the caller rolls back, the update never runs — its plan was never
     * activated, cancelled or assigned.
     */
    private void afterCommit(String failure, Map<String, String> sentryTags, Runnable update) {
        Runnable inOwnTransaction = () -> {
            try {
                TransactionTemplate template = new TransactionTemplate(transactionManager);
                template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                template.executeWithoutResult(status -> update.run());
            } catch (Exception e) {
                log.error("{} {}", failure, sentryTags, e);
                SentryLogger.logError(e, failure, sentryTags);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    inOwnTransaction.run();
                }
            });
        } else {
            inOwnTransaction.run();
        }
    }

    /**
     * Loads the plan's invite while the caller's session is still open: a deferred update reads
     * its institute from it (instituteIdOf), when the plan is no longer attached to a session.
     */
    private static void loadForLater(UserPlan userPlan) {
        try {
            if (userPlan.getEnrollInvite() != null) {
                userPlan.getEnrollInvite().getInstituteId();
            }
        } catch (Exception e) {
            log.debug("Could not load the invite of plan {}: {}", userPlan.getId(), e.getMessage());
        }
    }

    private void settleOnActivation(UserPlan userPlan, List<String> activatedPackageSessionIds) {
        String userPlanId = userPlan.getId();
        // Sessions this plan already has stock for: its own live PURCHASE rows, and rent picks
        // it claimed. Anything covered here never takes stock again — that is the idempotency.
        Set<String> covered = new HashSet<>();
        for (StockHoldRow row : sorted(stockHoldRepository.findRowsOwnedOrClaimedByPlan(userPlanId))) {
            if (userPlanId.equals(row.getClaimedByUserPlanId())) {
                if (SOLD.equals(row.getStatus())) {
                    covered.add(row.getPackageSessionId());
                }
                continue;
            }
            if (!userPlanId.equals(row.getUserPlanId())) {
                continue;
            }
            if (PURCHASE.equals(row.getKind()) && !RESTORED.equals(row.getStatus())) {
                covered.add(row.getPackageSessionId());
            }
            settleOwnedRow(row, userPlan);
        }

        if (activatedPackageSessionIds == null || activatedPackageSessionIds.isEmpty()) {
            return;
        }
        List<String> uncovered = activatedPackageSessionIds.stream()
                .filter(StringUtils::hasText)
                .distinct()
                .filter(id -> !covered.contains(id))
                .sorted()
                .toList();
        if (uncovered.isEmpty()) {
            return;
        }
        Map<String, StockInfoProjection> stock = stockInfo(uncovered);
        int quantity = planQuantity(userPlan);
        List<StockHoldRow> rentPicks = null;
        for (String packageSessionId : uncovered) {
            StockInfoProjection info = stock.get(packageSessionId);
            if (info == null || info.getMaxSeats() == null) {
                continue; // unlimited: nothing to track
            }
            if (rentPicks == null) {
                rentPicks = StringUtils.hasText(userPlan.getUserId())
                        ? new ArrayList<>(stockHoldRepository.findUnclaimedSoldRentPreferences(userPlan.getUserId()))
                        : new ArrayList<>();
            }
            int remaining = quantity;
            // The learner picked this book at rent checkout and already paid for its stock:
            // use that hold up instead of taking the stock a second time.
            Iterator<StockHoldRow> picks = rentPicks.iterator();
            while (remaining > 0 && picks.hasNext()) {
                StockHoldRow pick = picks.next();
                if (!packageSessionId.equals(pick.getPackageSessionId()) || userPlanId.equals(pick.getUserPlanId())) {
                    continue;
                }
                picks.remove();
                if (stockHoldRepository.claim(pick.getId(), userPlanId) == 1) {
                    remaining -= quantityOf(pick);
                    log.info("Plan {} claimed rent pick {} for package session {}", userPlanId, pick.getId(),
                            packageSessionId);
                }
            }
            if (remaining > 0) {
                takeAndRecordSold(userPlan, packageSessionId, remaining);
            }
        }
    }

    /** Settles one row the plan owns: HELD → SOLD, RELEASED → taken again (or oversold). */
    private void settleOwnedRow(StockHoldRow row, UserPlan userPlan) {
        String status = row.getStatus();
        if (HELD.equals(status)) {
            if (stockHoldRepository.markSold(row.getId(), HELD, false) == 1) {
                return;
            }
            // Lost a race — most likely the expiry job released it a moment ago. Settle what it is now.
            StockHoldRow now = stockHoldRepository.findRowById(row.getId()).orElse(null);
            if (now != null && RELEASED.equals(now.getStatus())) {
                retakeReleased(now, userPlan);
            }
        } else if (RELEASED.equals(status)) {
            retakeReleased(row, userPlan);
        }
        // SOLD / RESTORED: already settled.
    }

    /** Paid after the hold was released: take the stock again, or fulfil anyway and flag it. */
    private void retakeReleased(StockHoldRow row, UserPlan userPlan) {
        String packageSessionId = row.getPackageSessionId();
        int quantity = quantityOf(row);
        if (packageSessionRepository.takeAvailableSlots(packageSessionId, quantity) == 1) {
            if (stockHoldRepository.markSold(row.getId(), RELEASED, false) != 1) {
                // Someone else settled the row in between; hand back what was just taken.
                giveBack(packageSessionId, quantity);
            }
            return;
        }
        StockInfoProjection now = stockInfo(List.of(packageSessionId)).get(packageSessionId);
        boolean tracked = now != null && now.getMaxSeats() != null;
        if (stockHoldRepository.markSold(row.getId(), RELEASED, tracked) == 1 && tracked) {
            reportOversold(packageSessionId, quantity, userPlan, row.getId());
        }
    }

    /** No hold to settle: take the plan's quantity now and record it, oversold if it is gone. */
    private void takeAndRecordSold(UserPlan userPlan, String packageSessionId, int quantity) {
        boolean oversold = false;
        if (packageSessionRepository.takeAvailableSlots(packageSessionId, quantity) == 0) {
            StockInfoProjection now = stockInfo(List.of(packageSessionId)).get(packageSessionId);
            if (now == null || now.getMaxSeats() == null) {
                return; // became unlimited meanwhile
            }
            oversold = true;
        }
        StockHold sold = stockHoldRepository.save(newRow(packageSessionId,
                instituteIdOf(userPlan, packageSessionId), userPlan.getUserId(), userPlan.getId(),
                PURCHASE, quantity, SOLD, null, oversold));
        if (oversold) {
            reportOversold(packageSessionId, quantity, userPlan, sold.getId());
        }
    }

    private boolean releaseIfUnpaid(StockHoldRow row) {
        if (stockHoldRepository.releaseIfUnpaid(row.getId()) != 1) {
            return false;
        }
        giveBack(row.getPackageSessionId(), quantityOf(row));
        return true;
    }

    private void giveBack(String packageSessionId, int quantity) {
        if (packageSessionRepository.giveBackAvailableSlots(packageSessionId, quantity) == 0) {
            log.info("No stock to give back on package session {} (unlimited now, or deleted)", packageSessionId);
        }
    }

    private void reportOversold(String packageSessionId, int quantity, UserPlan userPlan, String holdId) {
        log.warn("OVERSOLD: package session {} had no stock left for {} unit(s) of paid plan {} (hold {}) "
                + "— fulfilled anyway", packageSessionId, quantity, userPlan.getId(), holdId);
        SentryLogger.logWarning("Stock oversold: a paid order was fulfilled after its stock ran out",
                tags("packageSessionId", packageSessionId, "userPlanId", userPlan.getId(),
                        "userId", userPlan.getUserId(), "stockHoldId", holdId,
                        "quantity", String.valueOf(quantity)));
    }

    private Map<String, StockInfoProjection> stockInfo(Collection<String> packageSessionIds) {
        Map<String, StockInfoProjection> byId = new HashMap<>();
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return byId;
        }
        for (StockInfoProjection info : packageSessionRepository.findStockInfoByIds(new HashSet<>(packageSessionIds))) {
            byId.put(info.getPackageSessionId(), info);
        }
        return byId;
    }

    private String instituteIdOf(UserPlan userPlan, String packageSessionId) {
        try {
            if (userPlan.getEnrollInvite() != null && StringUtils.hasText(userPlan.getEnrollInvite().getInstituteId())) {
                return userPlan.getEnrollInvite().getInstituteId();
            }
        } catch (Exception e) {
            log.debug("Could not read the invite of plan {}: {}", userPlan.getId(), e.getMessage());
        }
        return packageSessionRepository.findInstituteIdByPackageSessionId(packageSessionId).orElse(null);
    }

    private static StockHold newRow(String packageSessionId, String instituteId, String userId, String userPlanId,
                                    String kind, int quantity, String status, Date expiresAt, boolean oversold) {
        StockHold row = new StockHold();
        row.setPackageSessionId(packageSessionId);
        row.setInstituteId(instituteId);
        row.setUserId(userId);
        row.setUserPlanId(userPlanId);
        row.setKind(kind);
        row.setQuantity(quantity);
        row.setStatus(status);
        row.setExpiresAt(expiresAt);
        row.setOversold(oversold);
        return row;
    }

    private static List<StockHoldRow> sorted(List<StockHoldRow> rows) {
        List<StockHoldRow> copy = new ArrayList<>(rows != null ? rows : List.of());
        copy.sort(BY_SESSION);
        return copy;
    }

    private static int quantityOf(StockHoldRow row) {
        return row.getQuantity() != null && row.getQuantity() > 0 ? row.getQuantity() : 1;
    }

    private static int planQuantity(UserPlan userPlan) {
        return userPlan.getQuantity() != null ? Math.max(1, userPlan.getQuantity()) : 1;
    }

    private static String displayName(StockInfoProjection info) {
        return StringUtils.hasText(info.getPackageName()) ? info.getPackageName() : "this item";
    }

    /** Sentry tags from key/value pairs, skipping null values (Map.of would throw on them). */
    private static Map<String, String> tags(String... keyValues) {
        Map<String, String> tags = new HashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            if (keyValues[i + 1] != null) {
                tags.put(keyValues[i], keyValues[i + 1]);
            }
        }
        return tags;
    }
}
