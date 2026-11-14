package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The release state change shared by Release Result and the partner API's finalize. */
class ReleaseStateWriterTest {

    private StudentAttemptRepository attempts;
    private Cache comparisonCache;
    private ReleaseStateWriter writer;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptRepository.class);
        CacheManager cacheManager = mock(CacheManager.class);
        comparisonCache = mock(Cache.class);
        when(cacheManager.getCache("comparisonData")).thenReturn(comparisonCache);
        writer = new ReleaseStateWriter(attempts, cacheManager);
    }

    private static StudentAttempt attempt(String id) {
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setReportReleaseStatus("PENDING");
        return a;
    }

    @Test
    void single_attempt_is_released_saved_and_cache_cleared_once() {
        StudentAttempt a = attempt("a1");

        writer.release(a);

        assertThat(a.getReportReleaseStatus()).isEqualTo("RELEASED");
        assertThat(a.getReportLastReleaseDate()).isNotNull();
        verify(attempts).save(a);
        verify(comparisonCache, times(1)).clear();
    }

    @Test
    void a_batch_clears_the_cache_once_not_per_attempt() {
        StudentAttempt a = attempt("a1");
        StudentAttempt b = attempt("a2");

        writer.release(List.of(a, b));

        assertThat(a.getReportReleaseStatus()).isEqualTo("RELEASED");
        assertThat(b.getReportReleaseStatus()).isEqualTo("RELEASED");
        assertThat(a.getReportLastReleaseDate()).isEqualTo(b.getReportLastReleaseDate());
        verify(attempts, times(2)).save(org.mockito.ArgumentMatchers.any(StudentAttempt.class));
        verify(comparisonCache, times(1)).clear();
    }

    @Test
    void a_release_clears_the_queued_submit_time_result_email() {
        writer.release(List.of(attempt("a1"), attempt("a2")));
        verify(attempts).clearResultNoticePending(List.of("a1", "a2"));
    }

    @Test
    void inside_a_transaction_the_queue_clear_waits_for_the_commit() {
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            writer.release(attempt("a1"));
            verify(attempts, never()).clearResultNoticePending(org.mockito.ArgumentMatchers.anyCollection());
            org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations()
                    .forEach(org.springframework.transaction.support.TransactionSynchronization::afterCommit);
            verify(attempts).clearResultNoticePending(List.of("a1"));
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void a_failed_queue_clear_does_not_undo_the_release() {
        org.mockito.Mockito.doThrow(new IllegalStateException("db"))
                .when(attempts).clearResultNoticePending(org.mockito.ArgumentMatchers.anyCollection());
        StudentAttempt a = attempt("a1");
        writer.release(a);
        assertThat(a.getReportReleaseStatus()).isEqualTo("RELEASED");
        verify(comparisonCache, times(1)).clear();
    }

    @Test
    void nothing_to_release_touches_nothing() {
        writer.release(List.of());
        writer.release((StudentAttempt) null);
        verify(attempts, never()).save(org.mockito.ArgumentMatchers.any());
        verify(attempts, never()).clearResultNoticePending(org.mockito.ArgumentMatchers.anyCollection());
        verify(comparisonCache, never()).clear();
    }

    @Test
    void a_cache_failure_does_not_undo_the_release() {
        org.mockito.Mockito.doThrow(new IllegalStateException("cache down")).when(comparisonCache).clear();
        StudentAttempt a = attempt("a1");
        writer.release(a);
        assertThat(a.getReportReleaseStatus()).isEqualTo("RELEASED");
        verify(attempts).save(a);
    }
}
