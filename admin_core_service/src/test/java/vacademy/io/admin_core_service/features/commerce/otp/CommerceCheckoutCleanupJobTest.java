package vacademy.io.admin_core_service.features.commerce.otp;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceRateLimitRepository;

import java.time.Duration;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Old limiter windows and old OTP challenges are deleted; what can still matter is kept. */
class CommerceCheckoutCleanupJobTest {

    @Test
    void windowsOlderThanTwoDaysAndChallengesOlderThanSevenAreDeleted() {
        CommerceRateLimitRepository limits = mock(CommerceRateLimitRepository.class);
        CommerceOtpChallengeRepository challenges = mock(CommerceOtpChallengeRepository.class);
        when(limits.deleteAllWindowsBefore(any())).thenReturn(12);
        when(challenges.deleteCreatedBefore(any())).thenReturn(3);
        CommerceCheckoutCleanupJob job = new CommerceCheckoutCleanupJob(limits, challenges,
                mock(PlatformTransactionManager.class));
        Date now = new Date(1_800_000_000_000L);

        assertArrayEquals(new int[] {12, 3}, job.clean(now));

        ArgumentCaptor<Date> windows = ArgumentCaptor.forClass(Date.class);
        ArgumentCaptor<Date> codes = ArgumentCaptor.forClass(Date.class);
        verify(limits).deleteAllWindowsBefore(windows.capture());
        verify(challenges).deleteCreatedBefore(codes.capture());
        // The longest limiter window is a day; a verified-phone token lives fifteen minutes.
        assertEquals(now.getTime() - Duration.ofDays(2).toMillis(), windows.getValue().getTime());
        assertEquals(now.getTime() - Duration.ofDays(7).toMillis(), codes.getValue().getTime());
    }
}
