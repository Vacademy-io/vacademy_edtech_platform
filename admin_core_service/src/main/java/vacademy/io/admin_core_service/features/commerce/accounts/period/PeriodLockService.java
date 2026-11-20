package vacademy.io.admin_core_service.features.commerce.accounts.period;

import jakarta.persistence.LockTimeoutException;
import jakarta.persistence.PessimisticLockException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommercePeriodLock;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockView;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewItem;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewView;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommercePeriodLockRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommercePeriodLockRepository.LockRow;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard.FeatureState;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The period lock: the date through which an institute's books are closed. The single
 * {@link StockPeriodGuard} bean.
 *
 * <p>Protocol (one row per institute in {@code commerce_period_lock}): a post reads the row FOR
 * SHARE in its own transaction and holds it until it commits; a lock or unlock takes the row FOR
 * UPDATE, which waits for every post in flight. A post that starts after the lock's update waits
 * for it and re-reads the committed date (READ COMMITTED re-reads a row after a lock wait). So
 * every document dated inside a closed period committed before the lock did, and the lock's
 * preview, taken after its FOR UPDATE, sees it. Share locks do not block each other, and the lock
 * action holds no other row lock, so no deadlock can form.
 *
 * <p>While the institute does not have the accounts feature the lock is dormant: nothing is
 * refused and no row is created.
 */
@Service
public class PeriodLockService implements StockPeriodGuard {

    public static final String ACTION = "PERIOD_LOCK";
    public static final String REFERENCE_TYPE = "PERIOD_LOCK";
    public static final String UNLOCK_APPROVAL = "PERIOD_UNLOCK";
    static final String LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '5s'";
    static final LocalDate EARLIEST = LocalDate.of(2000, 1, 1);
    static final int MAX_REASON = 500;
    static final int MIN_UNLOCK_REASON = 3;
    private static final String ADMIN = "ADMIN";
    private static final String LOCK_TIMEOUT_STATE = "55P03";

    private final CommercePeriodLockRepository lockRepository;
    private final CommerceAccessGuard accessGuard;
    private final StockClock clock;
    private final CommerceRequestGuard requestGuard;
    private final CommerceApprovalService approvalService;
    private final CommerceAuditService auditService;
    private final JdbcTemplate jdbc;
    private final List<PeriodLockPreviewContributor> contributors;
    private final TransactionTemplate ownTransaction;
    private final TransactionTemplate readOnlyTransaction;

    public PeriodLockService(CommercePeriodLockRepository lockRepository,
                             CommerceAccessGuard accessGuard,
                             StockClock clock,
                             CommerceRequestGuard requestGuard,
                             CommerceApprovalService approvalService,
                             CommerceAuditService auditService,
                             JdbcTemplate jdbc,
                             PlatformTransactionManager transactionManager,
                             List<PeriodLockPreviewContributor> contributors) {
        this.lockRepository = lockRepository;
        this.accessGuard = accessGuard;
        this.clock = clock;
        this.requestGuard = requestGuard;
        this.approvalService = approvalService;
        this.auditService = auditService;
        this.jdbc = jdbc;
        List<PeriodLockPreviewContributor> sorted = new ArrayList<>(contributors == null ? List.of() : contributors);
        sorted.sort(Comparator.comparing(PeriodLockPreviewContributor::kind));
        this.contributors = List.copyOf(sorted);
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.readOnlyTransaction = new TransactionTemplate(transactionManager);
        this.readOnlyTransaction.setReadOnly(true);
    }

    // ------------------------------------------------------------------ assertOpen

    /**
     * Refuses a document dated on or before the institute's lock (409 PERIOD_LOCKED naming the
     * lock date and the first open date). Inside the caller's transaction the share lock is held
     * until that transaction ends; with no transaction the check runs in a short one of its own
     * and is a point-in-time check.
     */
    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public void assertOpen(String instituteId, LocalDate date) {
        if (date == null) {
            return;
        }
        // A lock is always before today: today and later never touch the database.
        if (!date.isBefore(clock.today(instituteId))) {
            return;
        }
        // Feature off: dormant, so no database read and no transaction (cached feature snapshot; UNKNOWN keeps the lock).
        if (accessGuard.featureState(instituteId, CommerceFeature.ACCOUNTS) == FeatureState.OFF) {
            return;
        }
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            ownTransaction.executeWithoutResult(status -> check(instituteId, date));
            return;
        }
        check(instituteId, date);
    }

    private void check(String instituteId, LocalDate date) {
        if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            // A read-only transaction cannot take row locks (and may run on the replica): plain read, no insert.
            CommercePeriodLock row = lockRepository.findByInstituteId(instituteId).orElse(null);
            if (row != null) {
                decide(instituteId, date, row.getLockedThrough());
            }
            return;
        }
        List<LockRow> rows = lockRepository.readForShare(instituteId);
        if (rows.isEmpty()) {
            if (accessGuard.featureState(instituteId, CommerceFeature.ACCOUNTS) == FeatureState.OFF) {
                return;
            }
            // First need: create the row so a concurrent first lock waits for this post's commit.
            lockRepository.ensureRow(UUID.randomUUID().toString(), instituteId);
            rows = lockRepository.readForShare(instituteId);
            if (rows.isEmpty()) {
                throw new IllegalStateException("period lock row missing after it was ensured");
            }
        }
        decide(instituteId, date, rows.get(0).getLockedThrough());
    }

    private void decide(String instituteId, LocalDate date, LocalDate lockedThrough) {
        if (lockedThrough == null || date.isAfter(lockedThrough)) {
            return;
        }
        // Dormant while the feature is off (nobody could unlock it); UNKNOWN keeps the lock.
        if (accessGuard.featureState(instituteId, CommerceFeature.ACCOUNTS) == FeatureState.OFF) {
            return;
        }
        throw new ConflictException("PERIOD_LOCKED: the books are closed through " + lockedThrough
                + "; use a date from " + lockedThrough.plusDays(1));
    }

    // ------------------------------------------------------------------ read

    /** {@code GET /period-lock}: the stored lock; no row is created by a read. */
    public PeriodLockView read(CustomUserDetails user, String instituteId) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ownTransaction.execute(status -> current(instituteId));
    }

    /** {@code GET /period-lock/preview}: what is still open on or before {@code date}. */
    public PreviewView preview(CustomUserDetails user, String instituteId, LocalDate date) {
        accessGuard.requireInstituteWide(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        if (date == null) {
            throw new InvalidRequestException("VALIDATION: date is required");
        }
        requireLockDate(instituteId, date);
        return readOnlyTransaction.execute(status -> previewInside(instituteId, date));
    }

    /** Every contributor, in kind order, inside the caller's transaction. */
    PreviewView previewInside(String instituteId, LocalDate through) {
        List<PreviewItem> items = new ArrayList<>();
        for (PeriodLockPreviewContributor contributor : contributors) {
            PreviewItem item = contributor.items(instituteId, through);
            if (item != null) {
                if (item.getKind() == null) {
                    item.setKind(contributor.kind());
                }
                if (item.getSample() == null) {
                    item.setSample(List.of());
                }
                items.add(item);
            }
        }
        return new PreviewView(through, items);
    }

    // ------------------------------------------------------------------ change

    /**
     * {@code PUT /period-lock}: moves the lock date forward (LOCK), back or to nothing (UNLOCK,
     * manager or admin with their own PIN and a reason), or leaves it (NONE). Exactly once per
     * client key.
     *
     * @throws ConflictException 409 PERIOD_LOCK_BUSY when posts held the row for 5 s; IDEMPOTENCY_MISMATCH
     */
    public PeriodLockView change(CustomUserDetails user, String instituteId, PeriodLockRequest request) {
        accessGuard.requireInstituteWide(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: the request body is required");
        }
        String clientKey = CommerceRequestGuard.requireClientKey(request.getClientRequestId());
        LocalDate target = request.getLockedThrough();
        if (target != null) {
            requireLockDate(instituteId, target);
        }
        String reason = trimToNull(request.getReason());
        if (reason != null && reason.length() > MAX_REASON) {
            throw new InvalidRequestException("VALIDATION: reason is longer than " + MAX_REASON + " characters");
        }
        String actor = user.getUserId();
        CommerceRequestGuard.Key key = new CommerceRequestGuard.Key(instituteId, clientKey, ACTION, REFERENCE_TYPE,
                instituteId, requestHash(instituteId, request), actor);
        try {
            return requestGuard.run(key,
                    () -> changeInside(user, instituteId, target, reason, request.getApproval()),
                    () -> current(instituteId)).value();
        } catch (RuntimeException e) {
            if (isLockTimeout(e)) {
                throw new ConflictException("PERIOD_LOCK_BUSY: entries are being posted; try again");
            }
            throw e;
        }
    }

    /** The hash of the body without the approval: the PIN never enters the hash or the request row. */
    static String requestHash(String instituteId, PeriodLockRequest request) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("locked_through", request.getLockedThrough() == null ? null : request.getLockedThrough().toString());
        body.put("reason", trimToNull(request.getReason()));
        return CommerceRequestGuard.hash(ACTION, body, instituteId);
    }

    private PeriodLockView changeInside(CustomUserDetails user, String instituteId, LocalDate target, String reason,
                                        Approval approval) {
        // Transaction-scoped (safe under transaction pooling); a plain SET would outlive the transaction.
        jdbc.execute(LOCK_TIMEOUT_SQL);
        String actor = user.getUserId();

        // The unlock approval calls auth_service: it runs (in this transaction) before the row is taken FOR
        // UPDATE, so posts never queue behind a remote call. Its direction is checked again under the lock.
        List<LockRow> seen = lockRepository.readPlain(instituteId);
        boolean approved = false;
        if ("UNLOCK".equals(direction(seen.isEmpty() ? null : seen.get(0).getLockedThrough(), target))) {
            requireUnlockAllowed(user, reason, approval);
            approvalService.approve(instituteId, null, actor, actor, approval.getPin(), UNLOCK_APPROVAL,
                    REFERENCE_TYPE, instituteId, null, reason);
            approved = true;
        }

        lockRepository.ensureRow(UUID.randomUUID().toString(), instituteId);
        List<LockRow> rows = lockRepository.readForUpdate(instituteId);
        if (rows.isEmpty()) {
            throw new IllegalStateException("period lock row missing after it was ensured");
        }
        LocalDate cur = rows.get(0).getLockedThrough();
        String direction = direction(cur, target);
        if (approved != "UNLOCK".equals(direction)) {
            // The lock moved between the first read and the row lock: refuse (rolling back any approval) and retry.
            if ("UNLOCK".equals(direction)) {
                requireUnlockAllowed(user, reason, approval);
            }
            throw new ConflictException("PERIOD_LOCK_BUSY: the lock date changed meanwhile; try again");
        }
        if ("NONE".equals(direction)) {
            PeriodLockView view = current(instituteId);
            view.setChanged(false);
            view.setDirection("NONE");
            return view;
        }

        PreviewView preview = "LOCK".equals(direction) ? previewInside(instituteId, target) : null;

        lockRepository.setLockedThrough(instituteId, target, actor);

        Map<String, Object> oldValue = new LinkedHashMap<>();
        oldValue.put("locked_through", cur == null ? null : cur.toString());
        Map<String, Object> newValue = new LinkedHashMap<>();
        newValue.put("locked_through", target == null ? null : target.toString());
        if (preview != null) {
            Map<String, Object> counts = new LinkedHashMap<>();
            for (PreviewItem item : preview.getItems()) {
                counts.put(item.getKind(), item.getCount());
            }
            newValue.put("preview_counts", counts);
        }
        auditService.record(instituteId, actor, null,
                "LOCK".equals(direction) ? AccountsAuditKinds.PERIOD_LOCK : AccountsAuditKinds.PERIOD_UNLOCK,
                REFERENCE_TYPE, instituteId, CommerceInputRules.json(oldValue), CommerceInputRules.json(newValue),
                reason);

        PeriodLockView view = current(instituteId);
        view.setChanged(true);
        view.setDirection(direction);
        view.setPreview(preview);
        return view;
    }

    /** NONE, LOCK (the date moves forward) or UNLOCK (back, or to nothing). */
    static String direction(LocalDate cur, LocalDate target) {
        if (cur == null ? target == null : cur.equals(target)) {
            return "NONE";
        }
        if (target != null && (cur == null || target.isAfter(cur))) {
            return "LOCK";
        }
        return "UNLOCK";
    }

    /** Role, reason and own-approver rules of an unlock (local checks; the PIN is checked by the approval). */
    private static void requireUnlockAllowed(CustomUserDetails user, String reason, Approval approval) {
        if (!isAdmin(user) && !CommerceAccessGuard.rolesOf(user).contains(CommerceRole.STORE_MANAGER)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                    "only a manager can reopen closed books");
        }
        if (reason == null || reason.length() < MIN_UNLOCK_REASON) {
            throw new InvalidRequestException("VALIDATION: a reason of " + MIN_UNLOCK_REASON + " to " + MAX_REASON
                    + " characters is required to reopen closed books");
        }
        if (approval == null || trimToNull(approval.getApproverUserId()) == null) {
            throw new InvalidRequestException("VALIDATION: reopening closed books needs your PIN approval");
        }
        if (!approval.getApproverUserId().trim().equals(user.getUserId())) {
            throw new InvalidRequestException("VALIDATION: unlock is approved with your own PIN");
        }
    }

    /** The stored lock (a plain read) with {@code changed: false}, direction NONE and no preview. */
    PeriodLockView current(String instituteId) {
        CommercePeriodLock row = lockRepository.findByInstituteId(instituteId).orElse(null);
        LocalDate through = row == null ? null : row.getLockedThrough();
        return new PeriodLockView(through, row == null ? null : row.getLockedBy(),
                row == null ? null : row.getLockedAt(), through == null ? null : through.plusDays(1), false, "NONE",
                null);
    }

    private void requireLockDate(String instituteId, LocalDate date) {
        if (date.isBefore(EARLIEST) || !date.isBefore(clock.today(instituteId))) {
            throw new InvalidRequestException("VALIDATION: the lock date must be before today (and from 2000-01-01)");
        }
    }

    /** A lock wait that ran out (SQLSTATE 55P03), however the layers wrapped it. */
    static boolean isLockTimeout(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof PessimisticLockingFailureException || t instanceof PessimisticLockException
                    || t instanceof LockTimeoutException) {
                return true;
            }
            if (t instanceof SQLException sql && LOCK_TIMEOUT_STATE.equals(sql.getSQLState())) {
                return true;
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return false;
    }

    private static boolean isAdmin(CustomUserDetails user) {
        return user != null && user.getAuthorities() != null && user.getAuthorities().stream()
                .anyMatch(a -> a != null && a.getAuthority() != null
                        && ADMIN.equals(a.getAuthority().trim().toUpperCase()));
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
