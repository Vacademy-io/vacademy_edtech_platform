package vacademy.io.assessment_service.features.open_evaluation.policy;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;

import java.util.Collection;

/**
 * A finalized result does not change until it is unfinalized (gate G8, spec 7.9/7.10/12).
 * "Finalized" is {@code student_attempt.report_release_status = RELEASED}, the same flag
 * the dashboard's Release Result sets.
 *
 * <p>Two strengths:
 * <ul>
 *   <li>{@link #requireNotFinalized} — unconditional; for partner API paths, which only
 *       ever touch API exams.</li>
 *   <li>{@code …ForApiExam} — applies only when the attempt's exam has
 *       {@code source = 'API'}; for shared dashboard paths (AI review override, manual
 *       evaluation, bulk marks import, revaluate, AI re-run), so dashboard exams keep
 *       today's behaviour.</li>
 * </ul>
 * Throws {@link ResultLockedException} (HTTP 409).
 */
@Slf4j
@Component
public class ResultLockGuard {

    public static boolean isFinalized(StudentAttempt attempt) {
        return attempt != null && ReleaseResultStatusEnum.RELEASED.name().equals(attempt.getReportReleaseStatus());
    }

    /** Unconditional lock, for partner API paths. */
    public void requireNotFinalized(StudentAttempt attempt) {
        if (isFinalized(attempt)) {
            throw new ResultLockedException(attempt.getId());
        }
    }

    /** Lock only when the attempt is on an API exam. */
    public void requireNotFinalizedForApiExam(StudentAttempt attempt) {
        if (isFinalized(attempt) && ApiCandidatePolicy.isOnApiExam(attempt)) {
            log.info("[result-lock] refused change to finalized API attempt {}", attempt.getId());
            throw new ResultLockedException(attempt.getId());
        }
    }

    /** Lock when {@code assessment} is an API exam and any of the attempts is finalized. */
    public void requireNoneFinalizedForApiExam(Assessment assessment, Collection<StudentAttempt> attempts) {
        if (!ApiCandidatePolicy.isApiExam(assessment) || attempts == null) {
            return;
        }
        for (StudentAttempt attempt : attempts) {
            if (isFinalized(attempt)) {
                log.info("[result-lock] refused change to finalized API attempt {} on assessment {}",
                        attempt.getId(), assessment.getId());
                throw new ResultLockedException(attempt.getId());
            }
        }
    }

    /**
     * Lock when the registration's exam is an API exam and the registration already has a
     * finalized attempt (bulk marks import would otherwise create and release another).
     */
    public void requireNoFinalizedAttemptForApiExam(AssessmentUserRegistration registration) {
        if (registration == null || !ApiCandidatePolicy.isApiExam(registration.getAssessment())) {
            return;
        }
        requireNoneFinalizedForApiExam(registration.getAssessment(), registration.getStudentAttempts());
    }
}
