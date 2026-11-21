package vacademy.io.assessment_service.features.submission_review.service;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;

/**
 * The paper of an assessment (contract 4.1), cached per pod for 60 s in
 * {@code submissionPaper}. In 1a every attempt answers the same paper (cut C7).
 */
@Component
public class PaperOutline {

    static final String CACHE = "submissionPaper";

    private final SubmissionReviewStore store;
    private final CacheManager cacheManager;

    public PaperOutline(SubmissionReviewStore store, CacheManager cacheManager) {
        this.store = store;
        this.cacheManager = cacheManager;
    }

    public Review.Paper get(String assessmentId) {
        Cache cache = cacheManager == null ? null : cacheManager.getCache(CACHE);
        if (cache != null) {
            Review.Paper cached = cache.get(assessmentId, Review.Paper.class);
            if (cached != null) return cached;
        }
        Review.Paper paper = store.paper(assessmentId);
        if (cache != null) cache.put(assessmentId, paper);
        return paper;
    }
}
