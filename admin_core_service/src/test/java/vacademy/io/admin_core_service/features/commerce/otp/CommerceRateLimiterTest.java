package vacademy.io.admin_core_service.features.commerce.otp;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceRateLimitRepository;

import java.time.Duration;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Fixed windows over commerce_rate_limit: the count is the database's, one for all pods. */
class CommerceRateLimiterTest {

    private final Map<String, Integer> counts = new HashMap<>();
    private CommerceRateLimitRepository repository;
    private PlatformTransactionManager transactions;
    private CommerceRateLimiter limiter;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceRateLimitRepository.class);
        when(repository.hit(anyString(), anyString(), anyString(), anyString(), any())).thenAnswer(call -> {
            Date window = call.getArgument(4);
            String key = call.getArgument(1) + "|" + call.getArgument(2) + "|" + call.getArgument(3) + "|"
                    + window.getTime();
            return counts.merge(key, 1, Integer::sum);
        });
        transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        limiter = new CommerceRateLimiter(repository, transactions);
    }

    @Test
    void hitsUpToTheLimitPassAndTheNextOneDoesNot() {
        long now = 1_800_000_000_000L;
        Duration tenMinutes = Duration.ofMinutes(10);

        assertTrue(limiter.allow("inst-1", "otp-send-phone", "hash", tenMinutes, 3, now));
        assertTrue(limiter.allow("inst-1", "otp-send-phone", "hash", tenMinutes, 3, now + 1000));
        assertTrue(limiter.allow("inst-1", "otp-send-phone", "hash", tenMinutes, 3, now + 2000));
        assertFalse(limiter.allow("inst-1", "otp-send-phone", "hash", tenMinutes, 3, now + 3000));
        // Another phone, another institute and the next window each have a count of their own.
        assertTrue(limiter.allow("inst-1", "otp-send-phone", "other", tenMinutes, 3, now + 3000));
        assertTrue(limiter.allow("inst-2", "otp-send-phone", "hash", tenMinutes, 3, now + 3000));
        assertTrue(limiter.allow("inst-1", "otp-send-phone", "hash", tenMinutes, 3, now + tenMinutes.toMillis()));
    }

    @Test
    void theWindowStartsOnAMultipleOfItsLength() {
        long now = 1_800_000_123_456L;

        limiter.allow("inst-1", "otp-send-ip", "203.0.113.7", Duration.ofMinutes(10), 10, now);

        ArgumentCaptor<Date> window = ArgumentCaptor.forClass(Date.class);
        verify(repository).hit(anyString(), anyString(), anyString(), anyString(), window.capture());
        assertEquals(0, window.getValue().getTime() % 600_000L);
        assertTrue(window.getValue().getTime() <= now && now - window.getValue().getTime() < 600_000L);
    }

    @Test
    void theCountRunsInATransactionOfItsOwn() {
        limiter.allow("inst-1", "otp-send-ip", "203.0.113.7", Duration.ofMinutes(10), 10);

        ArgumentCaptor<TransactionDefinition> definition = ArgumentCaptor.forClass(TransactionDefinition.class);
        verify(transactions).getTransaction(definition.capture());
        assertEquals(TransactionDefinition.PROPAGATION_REQUIRES_NEW, definition.getValue().getPropagationBehavior());
    }

    @Test
    void anEmptySubjectIsTheWholeScopeAndALongOneIsHashed() {
        limiter.allow("inst-1", "otp-send-institute", null, Duration.ofHours(1), 300);
        limiter.allow("inst-1", "otp-send-ip", "x".repeat(200), Duration.ofHours(1), 300);

        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        verify(repository, org.mockito.Mockito.times(2)).hit(anyString(), anyString(), anyString(), subject.capture(),
                any());
        assertEquals("*", subject.getAllValues().get(0));
        assertEquals(64, subject.getAllValues().get(1).length());
    }

    @Test
    void theRetryTimeIsTheRestOfTheWindow() {
        assertEquals(600, CommerceRateLimiter.secondsToNextWindow(Duration.ofMinutes(10), 1_800_000_000_000L - 1_800_000_000_000L % 600_000L));
        assertEquals(1, CommerceRateLimiter.secondsToNextWindow(Duration.ofMinutes(10), 599_500L));
    }

    @Test
    void aPhoneIsStoredAsAHash() {
        String hash = CommerceRateLimiter.hash("inst-1|919876543210");
        assertEquals(64, hash.length());
        assertEquals(hash, CommerceRateLimiter.hash("inst-1|919876543210"));
        assertFalse(hash.contains("9876543210"));
    }
}
