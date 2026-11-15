package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Asks the gateway about one gateway order whose captured webhook has not arrived, and settles
 * what it finds through the same steps the webhook uses: a captured payment goes to
 * {@link CommercePaymentConfirmService#confirmPaid} (amount and currency checked there, logs
 * claimed PAID once, a second captured payment recorded as a duplicate), an authorised one to
 * {@link CommercePaymentConfirmService#markAuthorized}; created and failed payments write
 * nothing. Source {@code "fetch"}.
 *
 * <p>The gateway call is made with no transaction open (the service refuses to run in one).
 * Before it the row is taken for this run ({@link CommerceGatewayOrderRepository#claimFetch}),
 * so a run that overlaps (another pod, after the job lock lapsed) leaves it alone; the schedule
 * of the row is then written in one short transaction of its own, which frees it. A webhook
 * that arrives after a fetch is a replay, and a fetch and a webhook of one order meet at the
 * PAID claim.
 *
 * <p>Nothing about the gateway account is logged: a gateway error is logged by its kind only.
 */
@Slf4j
@Service
public class CommercePaymentFetchService {

    public static final String SOURCE = "fetch";

    /** The schedule after an open order's fetch, by how many fetches the row had before it. */
    static final Duration[] OPEN_BACKOFF = {Duration.ofMinutes(2), Duration.ofMinutes(3), Duration.ofMinutes(5),
            Duration.ofMinutes(5), Duration.ofMinutes(10)};
    /** After {@link #OPEN_BACKOFF}: an open order (a long hold) is still asked about this often. */
    static final Duration OPEN_SLOW = Duration.ofMinutes(30);
    /**
     * The final stage: from the job's lag after the hold time, a fetch that found no capture is
     * repeated every {@link #FINAL_RETRY} until this long after the hold time, so a payment
     * captured in the grace (the stock is held 3 minutes past the order) is still seen.
     */
    static final Duration FINAL_WINDOW = Duration.ofMinutes(2);
    static final Duration FINAL_RETRY = Duration.ofMinutes(1);
    /** A row taken for a fetch is left alone by other runs this long (a run that died frees it then). */
    public static final Duration FETCH_LEASE = Duration.ofMinutes(3);
    /** After the final fetch: the late schedule starts here. */
    static final Duration AFTER_FINAL = Duration.ofMinutes(15);
    /** After the first error in a row: try again in a minute. */
    static final Duration AFTER_ERROR = Duration.ofMinutes(1);
    /** Errors in a row wait 1, 2, 4 ... minutes, never longer than this. */
    static final Duration MAX_AFTER_ERROR = Duration.ofMinutes(60);

    /** Which rule made a row due. */
    public enum Kind { OPEN, FINAL, LATE }

    /**
     * What one fetch found; the {@code result} of the log line. BUSY: another run had the row,
     * or it was paid or settled meanwhile; nothing was asked or written.
     */
    public enum Outcome { CONFIRMED, REPLAY, AUTHORIZED, NO_PAYMENT, FAILED_ONLY, REFUSED, ERROR, BUSY }

    private final CommercePaymentGateway gateway;
    private final CommercePaymentConfirmService confirmService;
    private final CommerceGatewayOrderRepository gatewayOrders;

    public CommercePaymentFetchService(CommercePaymentGateway gateway, CommercePaymentConfirmService confirmService,
                                       CommerceGatewayOrderRepository gatewayOrders) {
        this.gateway = gateway;
        this.confirmService = confirmService;
        this.gatewayOrders = gatewayOrders;
    }

    /**
     * The rule that made {@code row} due at {@code now}; FINAL (the hold time passed at least
     * {@code finalAfterHold} ago, final stage not over) wins over OPEN.
     */
    public static Kind kindOf(CommercePaymentGuard.DueFetch row, Date now, Duration finalAfterHold) {
        if (!"PENDING_PAYMENT".equals(row.orderStatus())) {
            return Kind.LATE;
        }
        if (row.finalFetchedAt() == null && row.holdExpiresAt() != null
                && !row.holdExpiresAt().after(new Date(now.getTime() - finalAfterHold.toMillis()))) {
            return Kind.FINAL;
        }
        return Kind.OPEN;
    }

    /**
     * The next fetch after a successful one; null when nothing (late) is left. An open order is
     * asked about on {@link #OPEN_BACKOFF}, then every {@link #OPEN_SLOW} while it stays open.
     *
     * <p>Late: one hour, six hours and a day apart, by the time since the order was cancelled:
     * the first late fetch comes about 15 minutes after the cancel, the next ones at about
     * 1 h 15, 7 h 15 and 31 h 15; after that none.
     */
    public static Date nextAfterSuccess(Kind kind, int fetchCountBefore, Date now, Date cancelledAt) {
        long t = now.getTime();
        switch (kind) {
            case FINAL:
                return new Date(t + AFTER_FINAL.toMillis());
            case OPEN:
                return new Date(t + (fetchCountBefore >= 0 && fetchCountBefore < OPEN_BACKOFF.length
                        ? OPEN_BACKOFF[fetchCountBefore] : OPEN_SLOW).toMillis());
            default:
                long since = cancelledAt == null ? Long.MAX_VALUE : t - cancelledAt.getTime();
                if (since < Duration.ofHours(1).toMillis()) {
                    return new Date(t + Duration.ofHours(1).toMillis());
                }
                if (since < Duration.ofHours(7).toMillis()) {
                    return new Date(t + Duration.ofHours(6).toMillis());
                }
                if (since < Duration.ofHours(31).toMillis()) {
                    return new Date(t + Duration.ofHours(24).toMillis());
                }
                return null;
        }
    }

    /**
     * When to try again after an error, by the errors in a row before this one: 1, 2, 4 ... 60
     * minutes. A final fetch is tried again in a minute, so it still falls inside its grace.
     */
    public static Date nextAfterError(Kind kind, int errorsBefore, Date now) {
        long wait = AFTER_ERROR.toMillis();
        if (kind != Kind.FINAL) {
            int doublings = Math.min(Math.max(errorsBefore, 0), 6);
            wait = Math.min(wait << doublings, MAX_AFTER_ERROR.toMillis());
        }
        return new Date(now.getTime() + wait);
    }

    /**
     * True when the final stage of an open order is over after this fetch: something was
     * settled or refused, or the grace has gone on {@link #FINAL_WINDOW} past the hold time.
     * No capture (nothing, authorised only, failed) before then keeps it going.
     */
    static boolean finalStageOver(Outcome outcome, Date holdExpiresAt, Date now) {
        if (outcome == Outcome.CONFIRMED || outcome == Outcome.REPLAY || outcome == Outcome.REFUSED) {
            return true;
        }
        return holdExpiresAt == null || !now.before(new Date(holdExpiresAt.getTime() + FINAL_WINDOW.toMillis()));
    }

    /**
     * One fetch of one row. Never throws for a gateway or confirm failure: the outcome says
     * ERROR and the row is asked again later (see {@link #nextAfterError}).
     */
    public Outcome fetch(CommercePaymentGuard.DueFetch row, Kind kind, Date now) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("The payment fetch calls the gateway and must not run in a transaction");
        }
        Date claimNext = new Date(now.getTime() + FETCH_LEASE.toMillis());
        try {
            if (gatewayOrders.claimFetch(row.gatewayRowId(), now, claimNext,
                    new Date(now.getTime() - FETCH_LEASE.toMillis())) == 0) {
                logResult(row, Outcome.BUSY, kind);
                return Outcome.BUSY;
            }
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT payment fetch could not take gateway order {}: {}", row.gatewayOrderId(),
                    e.getClass().getSimpleName());
            logResult(row, Outcome.ERROR, kind);
            return Outcome.ERROR;
        }
        List<CommercePaymentGateway.GatewayPayment> payments;
        try {
            payments = gateway.fetchPayments(row.instituteId(), row.gatewayOrderId());
        } catch (RuntimeException e) {
            String kindOfError = e instanceof CommercePaymentGatewayException g ? g.getCode()
                    : e.getClass().getSimpleName();
            log.warn("COMMERCE_FETCH gateway_error institute={} gateway_order={} kind={} errors_in_a_row={}",
                    row.instituteId(), row.gatewayOrderId(), kindOfError, row.fetchErrors() + 1);
            recordError(row, now, nextAfterError(kind, row.fetchErrors(), now), claimNext);
            logResult(row, Outcome.ERROR, kind);
            return Outcome.ERROR;
        }

        Outcome outcome;
        try {
            outcome = settle(row, payments);
        } catch (RuntimeException e) {
            // The confirm step failed (the database, most likely); the next run tries again.
            log.error("COMMERCE_ALERT payment fetch could not settle order {} ({}): {}", row.commerceOrderId(),
                    row.gatewayOrderId(), e.getClass().getSimpleName());
            recordError(row, now, nextAfterError(kind, row.fetchErrors(), now), claimNext);
            logResult(row, Outcome.ERROR, kind);
            return Outcome.ERROR;
        }
        if (kind == Kind.FINAL && !finalStageOver(outcome, row.holdExpiresAt(), now)) {
            // Still in the grace: ask again next minute, the final stage goes on.
            record(row, now, new Date(now.getTime() + FINAL_RETRY.toMillis()), null, claimNext);
        } else {
            record(row, now, nextAfterSuccess(kind, row.fetchCount(), now, row.cancelledAt()),
                    kind == Kind.FINAL ? now : null, claimNext);
        }
        logResult(row, outcome, kind);
        return outcome;
    }

    private Outcome settle(CommercePaymentGuard.DueFetch row, List<CommercePaymentGateway.GatewayPayment> payments) {
        List<CommercePaymentGateway.GatewayPayment> ours = new ArrayList<>();
        if (payments != null) {
            for (CommercePaymentGateway.GatewayPayment p : payments) {
                // Only payments on this very gateway order; anything else is not ours to settle.
                if (p != null && row.gatewayOrderId().equals(p.orderId()) && StringUtils.hasText(p.id())) {
                    ours.add(p);
                }
            }
        }
        if (ours.isEmpty()) {
            return Outcome.NO_PAYMENT;
        }
        ours.sort(Comparator.comparing(p -> p.createdAt() == null ? Instant.EPOCH : p.createdAt()));
        Optional<CommerceGatewayOrder> found = gatewayOrders.findById(row.gatewayRowId());
        if (found.isEmpty()) {
            return Outcome.NO_PAYMENT;
        }
        CommerceGatewayOrder gatewayOrder = found.get();
        boolean confirmed = false;
        boolean replay = false;
        boolean authorized = false;
        boolean refused = false;
        for (CommercePaymentGateway.GatewayPayment p : ours) {
            String status = p.status() == null ? "" : p.status();
            if ("captured".equals(status)) {
                // The gateway always states what it captured; without both, nothing is confirmed
                // (the confirm step reads a missing amount as "not known" and would not check it).
                if (p.amountMinor() < 0 || !StringUtils.hasText(p.currency())) {
                    log.error("COMMERCE_ALERT payment fetch found a captured payment without amount or currency "
                            + "institute={} order={} gateway_order={} payment={}", row.instituteId(),
                            row.commerceOrderId(), row.gatewayOrderId(), p.id());
                    refused = true;
                    continue;
                }
                // Part of it was given back (by hand, in the gateway): the order is not paid in
                // full, so nothing is confirmed; the shop decides.
                if (p.anyRefunded()) {
                    log.error("COMMERCE_ALERT payment fetch found a captured payment that was partly refunded "
                                    + "institute={} order={} gateway_order={} payment={} refunded={}",
                            row.instituteId(), row.commerceOrderId(), row.gatewayOrderId(), p.id(),
                            p.amountRefundedMinor());
                    refused = true;
                    continue;
                }
                CommercePaymentConfirmService.Result result = confirmService.confirmPaid(gatewayOrder,
                        row.instituteId(), p.amountMinor(), p.currency(), p.id(), SOURCE);
                if (result == null || result.refused()) {
                    refused = true;
                } else if (result.claimedLogs() > 0) {
                    confirmed = true;
                    // The money was taken and only this fetch noticed: the webhook is not reaching us.
                    log.error("COMMERCE_ALERT lost_webhook_recovered institute={} order={} gateway_order={} "
                                    + "payment={}", row.instituteId(), row.commerceOrderId(), row.gatewayOrderId(),
                            p.id());
                } else {
                    replay = true;
                }
            } else if ("authorized".equals(status)) {
                CommercePaymentConfirmService.Result result = confirmService.markAuthorized(gatewayOrder,
                        row.instituteId(), p.id(), SOURCE);
                if (result != null && !result.refused()) {
                    authorized = true;
                } else {
                    refused = true;
                }
            }
        }
        if (confirmed) {
            return Outcome.CONFIRMED;
        }
        if (replay) {
            return Outcome.REPLAY;
        }
        if (refused) {
            return Outcome.REFUSED;
        }
        if (authorized) {
            return Outcome.AUTHORIZED;
        }
        boolean anyFailed = ours.stream().anyMatch(p -> "failed".equals(p.status()));
        return anyFailed ? Outcome.FAILED_ONLY : Outcome.NO_PAYMENT;
    }

    private void recordError(CommercePaymentGuard.DueFetch row, Date now, Date next, Date claimNext) {
        try {
            gatewayOrders.recordFetchError(row.gatewayRowId(), now, next, claimNext);
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT payment fetch schedule of gateway order {} not saved: {}",
                    row.gatewayOrderId(), e.getClass().getSimpleName());
        }
    }

    private void record(CommercePaymentGuard.DueFetch row, Date now, Date next, Date finalAt, Date claimNext) {
        try {
            gatewayOrders.recordFetch(row.gatewayRowId(), now, next, finalAt, claimNext);
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT payment fetch schedule of gateway order {} not saved: {}",
                    row.gatewayOrderId(), e.getClass().getSimpleName());
        }
    }

    private static void logResult(CommercePaymentGuard.DueFetch row, Outcome outcome, Kind kind) {
        log.info("COMMERCE_FETCH order={} gateway_order={} result={} final={}", row.commerceOrderId(),
                row.gatewayOrderId(), outcome, kind == Kind.FINAL);
    }
}
