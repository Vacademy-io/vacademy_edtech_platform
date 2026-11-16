package vacademy.io.admin_core_service.features.commerce.returns.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundExecutor;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Finishes gateway refunds. Every minute, at most {@value #MAX_PER_RUN} rows a run and
 * {@value #MAX_PER_INSTITUTE} per institute, no new row after {@link #RUN_BUDGET}:
 * <ol>
 *   <li>PENDING gateway refunds that are due (and at least 30 s old, so the request that made
 *       one sends it first) are executed: the claim keeps them to one gateway call.</li>
 *   <li>IN_PROGRESS refunds that are due are asked about (by refund id, or by our receipt when
 *       the create's answer was lost); the gateway's answer decides. One stuck for more than
 *       {@link #STUCK_AFTER} is alerted at most once a day.</li>
 *   <li>Oversold and duplicate-payment rows whose automatic refund was not made (the hook failed)
 *       get the hook again; it is idempotent by key.</li>
 * </ol>
 * With no refund rows (commerce switched off) each query is a probe of an empty partial index:
 * no gateway call, no write.
 */
@Slf4j
@Component
public class CommerceRefundPollJob {

    static final int MAX_PER_RUN = 50;
    static final int MAX_PER_INSTITUTE = 20;
    static final int MAX_EXCEPTIONS = 20;
    static final Duration RUN_BUDGET = Duration.ofSeconds(40);
    static final Duration PENDING_GRACE = Duration.ofSeconds(30);
    static final Duration EXCEPTION_GRACE = Duration.ofMinutes(2);
    static final Duration STUCK_AFTER = Duration.ofHours(72);
    static final Duration STUCK_ALERT_EVERY = Duration.ofHours(24);

    private final CommerceRefundRepository refundRepository;
    private final CommerceRefundExecutor executor;
    private final CommercePaymentExceptionRepository exceptions;
    private final CommerceRefundHook refundHook;
    private final TransactionTemplate ownTransaction;
    private final LongSupplier clockMillis;

    @Autowired
    public CommerceRefundPollJob(CommerceRefundRepository refundRepository, CommerceRefundExecutor executor,
                                 CommercePaymentExceptionRepository exceptions, CommerceRefundHook refundHook,
                                 PlatformTransactionManager transactionManager) {
        this(refundRepository, executor, exceptions, refundHook, transactionManager, System::currentTimeMillis);
    }

    /** For tests: the wall clock the run budget is measured on. */
    CommerceRefundPollJob(CommerceRefundRepository refundRepository, CommerceRefundExecutor executor,
                          CommercePaymentExceptionRepository exceptions, CommerceRefundHook refundHook,
                          PlatformTransactionManager transactionManager, LongSupplier clockMillis) {
        this.refundRepository = refundRepository;
        this.executor = executor;
        this.exceptions = exceptions;
        this.refundHook = refundHook;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.ownTransaction.setReadOnly(false);
        this.clockMillis = clockMillis;
    }

    @Scheduled(cron = "${commerce.refund-poll.cron:25 * * * * *}")
    @SchedulerLock(name = "CommerceRefundPollJob", lockAtMostFor = "PT55S", lockAtLeastFor = "PT10S")
    public void run() {
        try {
            runOnce(new Date());
        } catch (Exception e) {
            log.error("COMMERCE_ALERT refund poll job failed: {}", e.getClass().getSimpleName(), e);
            SentryLogger.logError(e, "Commerce refund poll job failed");
        }
    }

    /** One run; the count of rows handled per step. Public for the database proof. */
    public Map<String, Integer> runOnce(Date now) {
        long started = clockMillis.getAsLong();
        Map<String, Integer> counts = new HashMap<>();
        Map<String, Integer> perInstitute = new HashMap<>();
        int handled = 0;

        List<CommerceRefundRepository.DueRefund> pending = ownTransaction.execute(status ->
                refundRepository.findDuePending(now, new Date(now.getTime() - PENDING_GRACE.toMillis()), MAX_PER_RUN));
        for (CommerceRefundRepository.DueRefund row : pending == null ? List.<CommerceRefundRepository.DueRefund>of()
                : pending) {
            if (handled >= MAX_PER_RUN || overBudget(started)) {
                break;
            }
            if (perInstitute.merge(row.getInstituteId(), 1, Integer::sum) > MAX_PER_INSTITUTE) {
                continue;
            }
            handled++;
            try {
                CommerceRefundExecutor.Result result = executor.execute(row.getId(), now);
                counts.merge("execute_" + result.name().toLowerCase(), 1, Integer::sum);
            } catch (Exception e) {
                counts.merge("errors", 1, Integer::sum);
                log.error("COMMERCE_ALERT refund execute of {} failed: {}", row.getId(), e.getClass().getSimpleName(),
                        e);
            }
        }

        List<CommerceRefundRepository.DueRefund> inProgress = handled >= MAX_PER_RUN ? List.of()
                : ownTransaction.execute(status -> refundRepository.findDueInProgress(now, MAX_PER_RUN));
        for (CommerceRefundRepository.DueRefund row : inProgress == null
                ? List.<CommerceRefundRepository.DueRefund>of() : inProgress) {
            if (handled >= MAX_PER_RUN || overBudget(started)) {
                break;
            }
            if (perInstitute.merge(row.getInstituteId(), 1, Integer::sum) > MAX_PER_INSTITUTE) {
                continue;
            }
            handled++;
            try {
                CommerceRefundExecutor.Result result = executor.check(row.getId(), now);
                counts.merge("check_" + result.name().toLowerCase(), 1, Integer::sum);
            } catch (Exception e) {
                counts.merge("errors", 1, Integer::sum);
                log.error("COMMERCE_ALERT refund check of {} failed: {}", row.getId(), e.getClass().getSimpleName(),
                        e);
            }
        }

        if (!overBudget(started)) {
            List<CommerceRefundRepository.DueRefund> stuck = ownTransaction.execute(status -> refundRepository
                    .findStuck(new Date(now.getTime() - STUCK_AFTER.toMillis()),
                            new Date(now.getTime() - STUCK_ALERT_EVERY.toMillis()), MAX_PER_RUN));
            for (CommerceRefundRepository.DueRefund row : stuck == null
                    ? List.<CommerceRefundRepository.DueRefund>of() : stuck) {
                log.error("COMMERCE_ALERT refund_stuck institute={} refund={} (in progress at the gateway for more "
                        + "than 72 h)", row.getInstituteId(), row.getId());
                ownTransaction.executeWithoutResult(status -> refundRepository.markStuckAlerted(row.getId(), now));
                counts.merge("stuck", 1, Integer::sum);
            }
        }

        if (!overBudget(started)) {
            List<CommercePaymentException> unrefunded = ownTransaction.execute(status -> exceptions.findUnrefunded(
                    new Date(now.getTime() - EXCEPTION_GRACE.toMillis()), MAX_EXCEPTIONS));
            for (CommercePaymentException row : unrefunded == null ? List.<CommercePaymentException>of()
                    : unrefunded) {
                if (overBudget(started)) {
                    break;
                }
                if (CommercePaymentException.KIND_OVERSOLD_PAID.equals(row.getKind())) {
                    refundHook.refundOversoldPaidOrder(row.getInstituteId(), row.getCommerceOrderId(),
                            row.getOrderNumber(), row.getAmount(), row.getCurrency());
                } else {
                    refundHook.refundDuplicatePayment(row.getInstituteId(), row.getCommerceOrderId(),
                            row.getOrderNumber(), row.getGatewayOrderId(), row.getGatewayPaymentId(), row.getAmount(),
                            row.getCurrency());
                }
                counts.merge("hook_retried", 1, Integer::sum);
            }
        }
        if (!counts.isEmpty()) {
            log.info("COMMERCE_REFUND_POLL run {} ms={}", counts, clockMillis.getAsLong() - started);
        }
        return counts;
    }

    private boolean overBudget(long started) {
        return clockMillis.getAsLong() - started >= RUN_BUDGET.toMillis();
    }
}
