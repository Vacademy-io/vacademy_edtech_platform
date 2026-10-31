package vacademy.io.assessment_service.features.assessment.copy_intake.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeBatchRepository;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.assessment_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.assessment_service.features.notification.service.StaffNoticeEmails;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Tells the admin a bulk AI check has settled - by email, by the bell (system
 * alert), and to automations (workflow event). Each channel is independent
 * and best-effort; an email that could not be sent becomes its own alert, so
 * silence is never mistaken for "nothing happened".
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CopyIntakeNotifier {

    private final NotificationService notificationService;
    private final AssessmentWorkflowEventPublisher workflowEventPublisher;
    private final AssessmentRepository assessmentRepository;
    private final AiCopyIntakeBatchRepository batchRepository;

    @Value("${assessment.copy-intake.dashboard-base-url:https://dash.vacademy.io}")
    private String dashboardBaseUrl;

    /**
     * Announce a settled batch on every channel. The caller guarantees this
     * runs once per settled status (see CopyIntakeService#finalizeIfDone).
     */
    /** The counts of the batch being announced; set by batchSettled for sendEmail. */
    private CopyIntakeService.Counts lastCounts;

    public void batchSettled(AiCopyIntakeBatch batch, CopyIntakeService.Counts counts) {
        this.lastCounts = counts;
        Assessment assessment = assessmentRepository.findById(batch.getAssessmentId()).orElse(null);
        String name = assessment != null ? assessment.getName() : batch.getAssessmentId();
        boolean needsReview = AiCopyIntakeBatch.NEEDS_REVIEW.equals(batch.getStatus());
        int waiting = counts.waiting();

        String title = needsReview
                ? "AI check finished - " + waiting + " " + (waiting == 1 ? "copy needs" : "copies need") + " your review"
                : "AI check finished for " + name;
        String summary = counts.completed() + " of " + batch.getTotalItems() + " copies checked"
                + (counts.failed() > 0 ? ", " + counts.failed() + " failed" : "")
                + (counts.skipped() > 0 ? ", " + counts.skipped() + " skipped" : "")
                + (waiting > 0 ? ", " + waiting + " waiting for a student to be chosen" : "")
                + ".";
        // The details route is /{assessmentId}/{play_mode}/{assessment_visibility}/{tab};
        // the tab segment is the details tab itself ('submissions'), and the
        // Submissions tab opens the batch named by ?intake=.
        String playMode = assessment != null && StringUtils.hasText(assessment.getPlayMode())
                ? assessment.getPlayMode() : "EXAM";
        String visibility = assessment != null && StringUtils.hasText(assessment.getAssessmentVisibility())
                ? assessment.getAssessmentVisibility() : "PRIVATE";
        String link = dashboardBaseUrl + "/assessment/assessment-list/assessment-details/" + batch.getAssessmentId()
                + "/" + playMode + "/" + visibility + "/submissions?intake=" + batch.getId();

        // 1. Bell / system alert (also what the dashboard toasts from).
        try {
            notificationService.sendSystemAlertToUsers(batch.getInstituteId(), List.of(batch.getCreatedBy()),
                    title, name + ": " + summary);
        } catch (Exception e) {
            log.warn("[copy-intake] system alert failed for batch {}: {}", batch.getId(), e.getMessage());
        }

        // 2. Email to the person who started it.
        String emailStatus = "SKIPPED";
        if (batch.isNotifyEmail() && StringUtils.hasText(batch.getCreatedByEmail()) && batch.getCreatedByEmail().contains("@")) {
            emailStatus = sendEmail(batch, name, title, summary, link, waiting) ? "SENT" : "FAILED";
            if ("FAILED".equals(emailStatus)) {
                // The mail did not go: say so where it will be seen.
                try {
                    notificationService.sendSystemAlertToUsers(batch.getInstituteId(), List.of(batch.getCreatedBy()),
                            "Email could not be sent", "The completion email for the AI check of " + name
                                    + " was not delivered. The results are on the dashboard.");
                } catch (Exception e) {
                    log.warn("[copy-intake] alert about failed email also failed: {}", e.getMessage());
                }
            }
        }
        batch.setEmailStatus(emailStatus);
        batch.setNotifiedStatus(batch.getStatus());
        batch.setNotifiedAt(new Date());
        batchRepository.save(batch);

        // 3. Automations.
        if (assessment != null) {
            Map<String, Object> payload = new HashMap<>();
            payload.put("totalCopies", batch.getTotalItems());
            payload.put("checkedCopies", counts.completed());
            payload.put("failedCopies", counts.failed());
            payload.put("skippedCopies", counts.skipped());
            payload.put("copiesNeedingReview", waiting);
            payload.put("batchStatus", batch.getStatus());
            payload.put("startedBy", batch.getCreatedBy());
            try {
                workflowEventPublisher.publishAiEvaluationBatchCompleted(assessment, batch.getInstituteId(), batch.getId(), payload);
            } catch (Exception e) {
                log.warn("[copy-intake] workflow event failed for batch {}: {}", batch.getId(), e.getMessage());
            }
        }
    }

    private boolean sendEmail(AiCopyIntakeBatch batch, String assessmentName, String title, String summary, String link,
                              int waiting) {
        try {
            Map<String, Long> counts = StaffNoticeEmails.counts();
            counts.put(batch.isFromSubmissions() ? "Copies submitted" : "Copies uploaded", (long) batch.getTotalItems());
            counts.put("Checked by AI", (long) lastCounts.completed());
            counts.put("Could not be checked", (long) lastCounts.failed());
            counts.put("Skipped", (long) lastCounts.skipped());
            counts.put("Waiting for a student to be picked", (long) waiting);
            String body = StaffNoticeEmails.aiCheckFinished(
                    firstName(batch.getCreatedByName()), assessmentName, counts,
                    waiting > 0
                            ? "Some copies could not be matched to a student automatically (no name on the sheet, or two students with that name). "
                              + "Open the batch to pick the student for each; they will be checked right after."
                            : null,
                    link);
            NotificationToUserDTO to = NotificationToUserDTO.builder()
                    .userId(batch.getCreatedBy())
                    .channelId(batch.getCreatedByEmail())
                    .placeholders(Map.of())
                    .build();
            NotificationDTO dto = NotificationDTO.builder()
                    .subject(title)
                    .body(body)
                    .notificationType("EMAIL")
                    .source("AI_COPY_CHECK")
                    .sourceId(batch.getId())
                    .users(List.of(to))
                    .build();
            return notificationService.sendEmailToUsersReporting(dto, batch.getInstituteId());
        } catch (Exception e) {
            log.warn("[copy-intake] email failed for batch {}: {}", batch.getId(), e.getMessage());
            return false;
        }
    }

    private static String firstName(String full) {
        if (!StringUtils.hasText(full)) return "there";
        return full.trim().split("\\s+")[0];
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
