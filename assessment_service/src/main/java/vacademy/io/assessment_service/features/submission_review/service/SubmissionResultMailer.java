package vacademy.io.assessment_service.features.submission_review.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;

import java.util.List;

/**
 * Render + email the result of ONE attempt (contract 6.3): the existing release path
 * (report PDF, upload, email + WhatsApp, ASSESSMENT_RESULT_RELEASED) in a batch of one.
 * Async, after the caller's commit, so a slow PDF never holds a request or a row lock.
 */
@Slf4j
@Component
public class SubmissionResultMailer {

    private final StudentAttemptRepository attemptRepository;

    @Autowired
    @Lazy
    private AssessmentParticipantsManager participantsManager;

    public SubmissionResultMailer(StudentAttemptRepository attemptRepository) {
        this.attemptRepository = attemptRepository;
    }

    void setParticipantsManager(AssessmentParticipantsManager participantsManager) {
        this.participantsManager = participantsManager;
    }

    @Async
    public void render(String attemptId, SubmissionReleaseService.Source source, String actorUserId) {
        renderNow(attemptId, source, actorUserId);
    }

    public void renderNow(String attemptId, SubmissionReleaseService.Source source, String actorUserId) {
        try {
            StudentAttempt attempt = attemptRepository.findById(attemptId).orElse(null);
            if (attempt == null || attempt.getRegistration() == null) return;
            participantsManager.releaseAutomatically(List.of(attempt), attempt.getRegistration().getAssessment(),
                    attempt.getRegistration().getInstituteId(), true,
                    new SubmissionReleaseService.ReleaseContext(actorUserId, source, false));
        } catch (Exception e) {
            log.error("[submission-review] could not send the result of attempt {}", attemptId, e);
        }
    }
}
