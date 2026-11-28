package vacademy.io.admin_core_service.features.assignment_ai_evaluation.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluation;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluationBatch;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationBatchRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.*;

/**
 * Tells the teacher who pressed "Evaluate with AI" that the run is over - a bell alert
 * and an email - so they review it. Nothing reaches the learner from here: the AI result
 * stays a suggestion until that teacher saves the grade.
 *
 * <p>Async and best-effort: it runs off the ai_service callback thread (whose client gives
 * up after 10 s) and a failed notice never touches the evaluation itself.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssignmentAiEvaluationNotifier {

    /** Brand-neutral, used only when the institute has no theme colour. */
    private static final String NEUTRAL_COLOR = "#333333";
    private static final String EMAIL_TYPE = "UTILITY_EMAIL";

    private final AssignmentAiEvaluationRepository evaluationRepository;
    private final AssignmentAiEvaluationBatchRepository batchRepository;
    private final SlideRepository slideRepository;
    private final InstituteRepository instituteRepository;
    private final AuthService authService;
    private final NotificationService notificationService;

    @Async
    public void notifyFinished(String evaluationId) {
        try {
            evaluationRepository.findById(evaluationId).ifPresent(this::send);
        } catch (Exception e) {
            log.warn("[assignment-ai-eval] completion notice for {} failed: {}", evaluationId, e.getMessage());
        }
    }

    /**
     * "Check all with AI": ONE notice when the batch's last copy is done, not one per
     * learner. Claimed in the database, so the notice goes out once even when the last
     * two copies finish together or the queue job sweeps it as well.
     */
    @Async
    public void notifyBatchFinished(String batchId) {
        try {
            if (batchRepository.claimNotice(batchId) == 1) {
                batchRepository.findById(batchId).ifPresent(this::sendBatch);
            }
        } catch (Exception e) {
            log.warn("[assignment-ai-eval] batch notice for {} failed: {}", batchId, e.getMessage());
        }
    }

    void sendBatch(AssignmentAiEvaluationBatch batch) {
        int completed = 0;
        int failed = 0;
        for (Object[] row : evaluationRepository.countByStatusForBatch(batch.getId())) {
            int count = ((Number) row[1]).intValue();
            if (AssignmentAiEvaluation.STATUS_COMPLETED.equals(String.valueOf(row[0]))) {
                completed += count;
            } else if (AssignmentAiEvaluation.STATUS_FAILED.equals(String.valueOf(row[0]))) {
                failed += count;
            }
        }
        String assignmentTitle = slideRepository.findById(batch.getSlideId())
                .map(Slide::getTitle).filter(AssignmentAiEvaluationNotifier::notBlank)
                .map(String::trim).orElse("the assignment");
        deliver(batch.getInstituteId(), batch.getTriggeredBy(), batchMessage(completed, failed, assignmentTitle), null);
    }

    static Message batchMessage(int completed, int failed, String assignmentTitle) {
        int total = completed + failed;
        String failedPart = failed == 0 ? "" : " " + failed + " could not be checked - grade "
                + (failed == 1 ? "it" : "them") + " yourself or check again.";
        return new Message(
                "AI checked " + completed + " of " + total + " submissions - review them",
                "The AI Evaluator checked " + completed + " of " + total + " submissions for \"" + assignmentTitle
                        + "\"." + failedPart + " Open the assignment's Activity Stats, review each learner's "
                        + "marks and feedback, then press Save Grade. Learners see nothing until you do.",
                completed > 0);
    }

    void send(AssignmentAiEvaluation evaluation) {
        String teacherId = evaluation.getTriggeredBy();
        if (teacherId == null || teacherId.isBlank() || !evaluation.isTerminal()) {
            return;
        }
        UserDTO learner = evaluation.getUserId() == null ? null
                : authService.getUsersFromAuthServiceByUserIds(List.of(evaluation.getUserId())).stream()
                        .filter(u -> u != null && evaluation.getUserId().equals(u.getId())).findFirst().orElse(null);
        String learnerName = learner != null && notBlank(learner.getFullName()) ? learner.getFullName().trim() : "A learner";
        String assignmentTitle = slideRepository.findById(evaluation.getSlideId())
                .map(Slide::getTitle).filter(AssignmentAiEvaluationNotifier::notBlank)
                .map(String::trim).orElse("the assignment");

        Message message = message(evaluation, learnerName, assignmentTitle);
        deliver(evaluation.getInstituteId(), teacherId, message, evaluation);
    }

    /** Bell alert + institute-branded email to one teacher. {@code evaluation} adds its AI feedback to the mail. */
    private void deliver(String instituteId, String teacherId, Message message, AssignmentAiEvaluation evaluation) {
        if (teacherId == null || teacherId.isBlank()) {
            return;
        }
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        try {
            Map<String, Object> settings = new HashMap<>();
            settings.put("priority", 2);
            settings.put("isDismissible", true);
            settings.put("showBadge", true);
            settings.put("isActive", true);
            notificationService.createSystemAlertAnnouncement(
                    instituteId, List.of(teacherId), message.title(), message.text(),
                    "system", institute.map(Institute::getInstituteName).filter(AssignmentAiEvaluationNotifier::notBlank)
                            .orElse("System"),
                    null, settings);
        } catch (Exception e) {
            log.warn("[assignment-ai-eval] bell alert to {} failed: {}", teacherId, e.getMessage());
        }

        // The mail goes out under the institute's own name and sender (notification_service
        // picks the configured sender when fromEmail is null) - never a platform default.
        String instituteName = institute.map(Institute::getInstituteName).filter(AssignmentAiEvaluationNotifier::notBlank)
                .map(String::trim).orElse(null);
        if (instituteName == null) {
            return;
        }
        UserDTO teacher = authService.getUsersFromAuthServiceByUserIds(List.of(teacherId)).stream()
                .filter(u -> u != null && teacherId.equals(u.getId())).findFirst().orElse(null);
        if (teacher == null || !notBlank(teacher.getEmail())) {
            return;
        }
        String color = institute.map(Institute::getInstituteThemeCode).filter(AssignmentAiEvaluationNotifier::notBlank)
                .map(String::trim).map(c -> c.matches("^[0-9A-Fa-f]{6}$") ? "#" + c : c).orElse(NEUTRAL_COLOR);
        String teacherName = notBlank(teacher.getFullName()) ? teacher.getFullName().trim() : "there";
        try {
            notificationService.sendHtmlEmailViaUnified(teacher.getEmail(), message.title(),
                    emailHtml(message, teacherName, instituteName, color, evaluation),
                    instituteId, null, instituteName, EMAIL_TYPE);
        } catch (Exception e) {
            log.warn("[assignment-ai-eval] email to {} failed: {}", teacherId, e.getMessage());
        }
    }

    record Message(String title, String text, boolean completed) {
    }

    static Message message(AssignmentAiEvaluation evaluation, String learnerName, String assignmentTitle) {
        if (AssignmentAiEvaluation.STATUS_COMPLETED.equals(evaluation.getStatus())) {
            return new Message(
                    "AI checked " + learnerName + "'s assignment - review it",
                    "The AI Evaluator suggests " + score(evaluation) + " for " + learnerName + " on \""
                            + assignmentTitle + "\". Open the assignment's Activity Stats, review the marks "
                            + "and feedback, then press Save Grade. The learner sees nothing until you do.",
                    true);
        }
        String reason = notBlank(evaluation.getErrorMessage()) ? " (" + evaluation.getErrorMessage().trim() + ")" : "";
        return new Message(
                "AI could not check " + learnerName + "'s assignment",
                "The AI Evaluator could not check " + learnerName + "'s submission for \"" + assignmentTitle
                        + "\"" + reason + ". Grade it yourself or try the AI Evaluator again.",
                false);
    }

    private static String score(AssignmentAiEvaluation e) {
        String awarded = e.getMarksAwarded() == null ? "-" : formatMarks(e.getMarksAwarded());
        return e.getMaxMarks() == null ? awarded + " marks" : awarded + " / " + formatMarks(e.getMaxMarks());
    }

    private static String formatMarks(double marks) {
        return marks == Math.rint(marks) ? String.valueOf((long) marks) : String.valueOf(marks);
    }

    static String emailHtml(Message message, String teacherName, String instituteName, String color,
                            AssignmentAiEvaluation evaluation) {
        StringBuilder html = new StringBuilder();
        html.append("<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222222\">")
                .append("<div style=\"background:").append(HtmlUtils.htmlEscape(color))
                .append(";color:#ffffff;padding:16px 20px;font-size:18px;font-weight:bold\">")
                .append(HtmlUtils.htmlEscape(instituteName)).append("</div>")
                .append("<div style=\"padding:20px;border:1px solid #e5e5e5;border-top:none\">")
                .append("<p>Hi ").append(HtmlUtils.htmlEscape(teacherName)).append(",</p>")
                .append("<p>").append(HtmlUtils.htmlEscape(message.text())).append("</p>");
        if (message.completed() && evaluation != null && notBlank(evaluation.getFeedback())) {
            html.append("<p style=\"margin:16px 0 4px;font-weight:bold\">AI feedback</p>")
                    .append("<p style=\"background:#f6f6f6;padding:12px;margin:0;white-space:pre-wrap\">")
                    .append(HtmlUtils.htmlEscape(evaluation.getFeedback().trim())).append("</p>");
        }
        html.append("<p style=\"color:#666666;font-size:12px;margin-top:20px\">You are receiving this because you ")
                .append("started the AI evaluation.</p></div></div>");
        return html.toString();
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
