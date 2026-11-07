package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed;

import java.util.Date;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Unfinalize (spec 7.10) and the partner feed bump on every release. */
class ReleaseStateWriterWithdrawTest {

    @Test
    void withdraw_puts_the_result_back_on_hold_and_touches_the_feed() {
        StudentAttemptRepository attempts = mock(StudentAttemptRepository.class);
        CacheManager cacheManager = mock(CacheManager.class);
        Cache cache = mock(Cache.class);
        when(cacheManager.getCache("comparisonData")).thenReturn(cache);
        ApiSubmissionFeed feed = mock(ApiSubmissionFeed.class);
        ReleaseStateWriter writer = new ReleaseStateWriter(attempts, cacheManager);
        writer.setSubmissionFeed(feed);
        StudentAttempt a = new StudentAttempt();
        a.setId("a1");
        a.setReportReleaseStatus("RELEASED");
        Date released = new Date(0);
        a.setReportLastReleaseDate(released);

        writer.withdraw(a);

        assertThat(a.getReportReleaseStatus()).isEqualTo("PENDING");
        assertThat(a.getReportLastReleaseDate()).isEqualTo(released);
        verify(attempts).save(a);
        verify(cache).clear();
        verify(feed).touch(List.of("a1"));

        StudentAttempt b = new StudentAttempt();
        b.setId("b1");
        writer.release(List.of(b));
        verify(feed).touch(List.of("b1"));
    }
}
