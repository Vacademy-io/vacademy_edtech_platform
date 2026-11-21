package vacademy.io.admin_core_service.features.commerce.otp;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceRateLimitRepository;

import java.time.Duration;
import java.util.Date;

/**
 * Deletes what the public shop routes leave behind: limiter windows that have ended
 * ({@code commerce_rate_limit}; the longest window is a day) and codes that can no longer be
 * tried or whose token has long expired ({@code commerce_otp_challenge}). Once a day; the
 * ShedLock keeps it to one pod. Rows exist only for an institute with a shop.
 */
@Slf4j
@Component
public class CommerceCheckoutCleanupJob {

    static final Duration KEEP_LIMIT_WINDOWS = Duration.ofDays(2);
    static final Duration KEEP_CHALLENGES = Duration.ofDays(7);

    private final CommerceRateLimitRepository rateLimits;
    private final CommerceOtpChallengeRepository challenges;
    private final TransactionTemplate transaction;

    public CommerceCheckoutCleanupJob(CommerceRateLimitRepository rateLimits,
                                      CommerceOtpChallengeRepository challenges,
                                      PlatformTransactionManager transactionManager) {
        this.rateLimits = rateLimits;
        this.challenges = challenges;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Scheduled(cron = "${commerce.cleanup.cron:0 40 21 * * *}", zone = "UTC")
    @SchedulerLock(name = "CommerceCheckoutCleanupJob", lockAtMostFor = "PT10M", lockAtLeastFor = "PT30S")
    public void run() {
        try {
            int[] deleted = clean(new Date());
            if (deleted[0] > 0 || deleted[1] > 0) {
                log.info("Commerce clean-up: {} limiter window(s) and {} OTP challenge(s) deleted", deleted[0],
                        deleted[1]);
            }
        } catch (Exception e) {
            log.error("Commerce clean-up job failed: {}", e.getMessage(), e);
        }
    }

    /** One run. Returns {limiter windows, challenges} deleted. Package-visible for the test. */
    int[] clean(Date now) {
        Date windowsBefore = new Date(now.getTime() - KEEP_LIMIT_WINDOWS.toMillis());
        Date challengesBefore = new Date(now.getTime() - KEEP_CHALLENGES.toMillis());
        Integer windows = transaction.execute(status -> rateLimits.deleteAllWindowsBefore(windowsBefore));
        Integer codes = challenges.deleteCreatedBefore(challengesBefore);
        return new int[] {windows == null ? 0 : windows, codes == null ? 0 : codes};
    }
}
