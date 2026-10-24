package vacademy.io.assessment_service.features.assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.common.core.utils.DateUtil;

import java.util.Collection;
import java.util.Date;
import java.util.List;

/**
 * The state change behind "Release Result": {@code report_release_status = RELEASED},
 * {@code report_last_release_date = now}, saved, then the {@code comparisonData} cache
 * cleared so a freshly released result is not masked by a stale pre-scoring entry.
 *
 * <p>Extracted from {@code AssessmentParticipantsManager.updateAttemptDataReleaseData} so the
 * dashboard release path and the partner API's finalize share one writer (spec 7.10,
 * T1.27). It does only the state change: no report PDF, no email, no notification, no
 * workflow event — callers decide those.
 *
 * <p>The cache is cleared <b>once per call</b>. The dashboard path calls it per attempt, as it
 * always did; a batch caller (finalize) clears it once for the whole batch.
 */
@Slf4j
@Component
public class ReleaseStateWriter {

    static final String COMPARISON_CACHE = "comparisonData";

    private final StudentAttemptRepository studentAttemptRepository;
    private final CacheManager cacheManager;

    /**
     * Partner API submission feed: a release (from either channel) is a change the partner
     * must see in {@code GET /submissions?updated_since=}. Optional; null in unit tests.
     */
    private vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed submissionFeed;

    public ReleaseStateWriter(StudentAttemptRepository studentAttemptRepository, CacheManager cacheManager) {
        this.studentAttemptRepository = studentAttemptRepository;
        this.cacheManager = cacheManager;
    }

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setSubmissionFeed(
            vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed submissionFeed) {
        this.submissionFeed = submissionFeed;
    }

    /** Releases one attempt (one save, one cache clear). */
    public void release(StudentAttempt attempt) {
        if (attempt == null) {
            return;
        }
        release(List.of(attempt));
    }

    /** Releases every attempt with one release time, then clears the cache once. */
    public void release(Collection<StudentAttempt> attempts) {
        if (attempts == null || attempts.isEmpty()) {
            return;
        }
        Date now = DateUtil.getCurrentUtcTime();
        for (StudentAttempt attempt : attempts) {
            if (attempt == null) {
                continue;
            }
            attempt.setReportReleaseStatus(ReleaseResultStatusEnum.RELEASED.name());
            attempt.setReportLastReleaseDate(now);
            studentAttemptRepository.save(attempt);
        }
        clearComparisonCache();
        touchFeed(attempts);
    }

    /**
     * The partner API's unfinalize (spec 7.10): the result goes back to held,
     * {@code report_release_status = PENDING}. The last release date is kept as history.
     * No email, notification or workflow event.
     */
    public void withdraw(StudentAttempt attempt) {
        if (attempt == null) {
            return;
        }
        attempt.setReportReleaseStatus(ReleaseResultStatusEnum.PENDING.name());
        studentAttemptRepository.save(attempt);
        clearComparisonCache();
        touchFeed(List.of(attempt));
    }

    private void touchFeed(Collection<StudentAttempt> attempts) {
        if (submissionFeed == null) {
            return;
        }
        List<String> ids = attempts.stream().filter(a -> a != null && a.getId() != null)
                .map(StudentAttempt::getId).toList();
        submissionFeed.touch(ids);
    }

    private void clearComparisonCache() {
        // Bust the per-attempt comparison cache so freshly-released results
        // don't get masked by a stale studentMarks=0 entry from before scoring.
        try {
            Cache cache = cacheManager.getCache(COMPARISON_CACHE);
            if (cache != null) {
                cache.clear();
            }
        } catch (Exception e) {
            log.warn("Failed to evict comparisonData cache after release: {}", e.getMessage());
        }
    }
}
