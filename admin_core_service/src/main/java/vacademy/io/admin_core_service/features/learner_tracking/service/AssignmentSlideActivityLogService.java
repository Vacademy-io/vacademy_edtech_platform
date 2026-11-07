package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.AssignmentSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.GradeAssignmentDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.slide.entity.AssignmentSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;

@RequiredArgsConstructor
@Service
public class AssignmentSlideActivityLogService {

    private final AnswerKeyAccess answerKeyAccess;

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(AssignmentSlideActivityLogService.class);

    private final AssignmentSlideTrackedRepository assignmentSlideTrackedRepository;
    private final ActivityLogRepository activityLogRepository;
    private final ActivityLogService activityLogService;
    private final LearnerTrackingAsyncService learnerTrackingAsyncService;
    private final AssignmentSlideRepository assignmentSlideRepository;
    private final SlideRepository slideRepository;
    private final vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    private final vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService workflowTriggerService;

    // Last-resort formatter for error toasts when a learner bypasses the
    // frontend gate (typically only DevTools users see this). Renders in
    // institute time (IST). Normal UX is the learner-side countdown which
    // formats in the learner's browser timezone.
    private static final DateTimeFormatter HUMAN_DATE_TIME =
            DateTimeFormatter.ofPattern("MMM d, yyyy 'at' h:mm a 'IST'")
                    .withZone(ZoneId.of("Asia/Kolkata"));

    public void addAssigmentSlideActivityLog(ActivityLog activityLog,
            List<AssignmentSlideActivityLogDTO> assignmentSlideActivityLogDTOS) {
        assignmentSlideTrackedRepository.deleteByActivityId(activityLog.getId());
        List<AssignmentSlideTracked> questionSlideTrackeds = assignmentSlideActivityLogDTOS
                .stream()
                .map(assignmentSlideActivityLogDTO -> new AssignmentSlideTracked(assignmentSlideActivityLogDTO,
                        activityLog))
                .toList();
        assignmentSlideTrackedRepository.saveAll(questionSlideTrackeds);
    }

    public String addOrUpdateAssignmentSlideSlideActivityLog(ActivityLogDTO activityLogDTO, String slideId,
            String chapterId, String moduleId, String subjectId, String packageSessionId, String userId,
            CustomUserDetails user) {
        // Temporal window enforcement.
        // - Before live_date: hard block (assignment isn't released yet).
        // - After end_date: accept the submission but stamp `late_submission`
        //   on each tracked row so the learner UI / grading dashboard can
        //   surface a "Late" badge. Soft-warning model per product decision.
        // `slideId` is the parent Slide table id; the AssignmentSlide row is
        // referenced via slide.sourceId. (Don't trust DTO.source_id — client
        // could spoof to point at a different, still-open assignment.)
        Slide parentSlide = slideRepository.findById(slideId)
                .orElseThrow(() -> new ResourceNotFoundException("Slide " + slideId + " not found"));
        AssignmentSlide slide = assignmentSlideRepository.findById(parentSlide.getSourceId())
                .orElseThrow(() -> new ResourceNotFoundException("Assignment slide not found for slide " + slideId));
        Instant now = Instant.now();
        if (slide.getLiveDate() != null && now.isBefore(slide.getLiveDate())) {
            throw new ForbiddenException(
                    "Assignment opens on " + HUMAN_DATE_TIME.format(slide.getLiveDate()));
        }
        boolean late = slide.getEndDate() != null && now.isAfter(slide.getEndDate());
        if (late && activityLogDTO.getAssignmentSlides() != null) {
            activityLogDTO.getAssignmentSlides().forEach(s -> s.setLateSubmission(true));
        }

        // Identity comes from the token, never from the userId request param —
        // a learner could otherwise submit (or overwrite) as someone else.
        ActivityLog activityLog = null;
        if (activityLogDTO.isNewActivity()) {
            activityLog = activityLogService.saveActivityLog(activityLogDTO, user.getUserId(), slideId);
        } else {
            activityLog = activityLogService.updateActivityLog(activityLogDTO, user.getUserId());
        }
        addAssigmentSlideActivityLog(activityLog, activityLogDTO.getAssignmentSlides());
        learnerTrackingAsyncService.updateLearnerOperationsForAssignment(user.getUserId(), slideId, chapterId, moduleId,
                subjectId, packageSessionId, activityLogDTO);

        // Save raw data for LLM analytics (async, non-blocking)
        learnerTrackingAsyncService.saveLLMAssignmentDataAsync(
                activityLog.getId(),
                slideId,
                chapterId,
                packageSessionId,
                subjectId,
                activityLogDTO);

        // Fire ASSIGNMENT_SUBMITTED workflow trigger — first-time submissions
        // only (re-submissions / saves don't fire). Institute is resolved off
        // the package session via the existing faculty-mapping query (same
        // pattern DoubtsManager uses). Wrapped so workflow failures can't
        // affect the submission write.
        if (activityLogDTO.isNewActivity() && packageSessionId != null && !packageSessionId.isBlank()) {
            try {
                String instituteId = facultyMappingRepository
                        .findInstituteIdByPackageSessionId(packageSessionId)
                        .orElse(null);
                if (instituteId != null && !instituteId.isBlank()) {
                    java.util.Map<String, Object> ctx = new java.util.HashMap<>();
                    ctx.put("activityLogId", activityLog.getId());
                    ctx.put("userId", userId);
                    ctx.put("slideId", slideId);
                    ctx.put("chapterId", chapterId);
                    ctx.put("moduleId", moduleId);
                    ctx.put("subjectId", subjectId);
                    ctx.put("packageSessionId", packageSessionId);
                    workflowTriggerService.handleTriggerEvents(
                            vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.ASSIGNMENT_SUBMITTED.name(),
                            slideId,
                            instituteId,
                            ctx);
                }
            } catch (Exception wfe) {
                log.warn("Failed to trigger ASSIGNMENT_SUBMITTED for slide {} user {}: {}",
                        slideId, userId, wfe.getMessage());
            }
        }

        return activityLog.getId();
    }

    public void gradeAssignment(GradeAssignmentDTO gradeDTO) {
        AssignmentSlideTracked tracked = assignmentSlideTrackedRepository
                .findById(gradeDTO.getTrackedId())
                .orElseThrow(() -> new RuntimeException("Assignment submission not found"));
        tracked.setMarks(gradeDTO.getMarks());
        tracked.setFeedback(gradeDTO.getFeedback());
        tracked.setCheckedFileId(gradeDTO.getCheckedFileId());
        assignmentSlideTrackedRepository.save(tracked);

        // Grading is the first point at which an assignment has anything to analyse -
        // the submission itself is a set of uploaded files the model cannot read. Rebuild
        // the LLM payload from the marked-up picture and let the scheduler regenerate the
        // report. Async and self-contained: analytics must never fail a grade save.
        learnerTrackingAsyncService.refreshLLMAssignmentDataAfterGradingAsync(tracked.getId());
    }

    public Page<ActivityLogDTO> getAssignmentSlideActivityLogs(String userId, String slideId, Pageable pageable,
            CustomUserDetails userDetails) {
        Page<ActivityLog> activityLogs = activityLogRepository.findActivityLogsWithAssignmentSlide(userId, slideId,
                pageable);
        return activityLogs.map(activityLog -> answerKeyAccess.withoutQuizSidesWhenStripping(activityLog.toActivityLogDTO()));
    }
}
