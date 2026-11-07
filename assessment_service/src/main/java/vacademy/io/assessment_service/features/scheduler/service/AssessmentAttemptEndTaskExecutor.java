package vacademy.io.assessment_service.features.scheduler.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationSubmissionEnqueuer;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.common.scheduler.entity.SchedulerActivityLog;
import vacademy.io.common.scheduler.entity.TaskExecutionAudit;
import vacademy.io.common.scheduler.enums.SchedulerStatusEnum;
import vacademy.io.common.scheduler.enums.TaskTypeEnum;
import vacademy.io.common.scheduler.repository.TaskExecutionAuditRepository;
import vacademy.io.common.scheduler.service.SchedulingService;
import vacademy.io.common.scheduler.service.TaskExecutor;

import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Component
public class AssessmentAttemptEndTaskExecutor implements TaskExecutor {

    @Autowired
    private SchedulingService schedulingService;

    @Autowired
    private StudentAttemptService studentAttemptService;

    @Autowired
    private TaskExecutionAuditRepository taskExecutionAuditRepository;

    @Autowired
    private AiEvaluationSubmissionEnqueuer aiEvaluationSubmissionEnqueuer;

    @Autowired
    private TypedAnswerEvaluation typedAnswerEvaluation;

    @Override
    public TaskTypeEnum getTaskName() {
        return TaskTypeEnum.UPDATE_ATTEMPT_STATUS;
    }

    @Override
    public void execute(SchedulerActivityLog activityLog, String source) {

        List<StudentAttempt> allLiveAttempts = studentAttemptService.getAllLiveAttempt();
        // Practice tests and surveys have no clock. Before this they were ended
        // here on the hour: a missing duration is max_time 0, and start + 0 is
        // always "over" - every open practice attempt was cut off at :00.
        Set<String> untimed = studentAttemptService.getOpenUntimedAttemptIds();
        List<StudentAttempt> attempts = new ArrayList<>();

        allLiveAttempts.forEach(attempt->{
            if(!untimed.contains(attempt.getId()) && isAttemptTimeOver(attempt)){
                attempts.add(attempt);
            }
        });
        createTaskExecutionAuditFromAttemptsAndUpdateAttemptStatus(activityLog, attempts, source);

        // Auto-release results for ended assessments with result_type = AUTO_AFTER_ASSESSMENT_END
        try {
            studentAttemptService.releaseResultsForEndedAutoReleaseAssessments();
        } catch (Exception e) {
            log.error("[AUTO-RELEASE] Failed to release results for ended assessments: {}", e.getMessage());
        }
    }


    private void createTaskExecutionAuditFromAttemptsAndUpdateAttemptStatus(SchedulerActivityLog activityLog, List<StudentAttempt> attempts, String source) {
        AtomicReference<String> activityLogStatus = new AtomicReference<>(SchedulerStatusEnum.FINISHED.name());
        List<TaskExecutionAudit> allTasks =  new ArrayList<>();

        attempts.forEach(attempt->{
            // TIME_EXPIRED: this executor only picks up attempts whose clock ran out
            // (isAttemptTimeOver), so it is the one caller that can honestly label the
            // ASSESSMENT_END it causes.
            studentAttemptService.updateStudentAttemptResultAfterMarksCalculationAsync(Optional.of(attempt), "TIME_EXPIRED");
            queueTypedAiEvaluation(attempt);
            allTasks.add(TaskExecutionAudit.builder()
                    .source(source)
                    .sourceId(attempt.getId())
                    .schedulerActivityLog(activityLog)
                    .statusMessage("Completed Successfully")
                    .status(SchedulerStatusEnum.FINISHED.name()).build());
        });

        taskExecutionAuditRepository.saveAll(allTasks);
        activityLog.setStatus(activityLogStatus.get());
        schedulingService.createOrUpdateSchedulerActivityLog(activityLog);
    }

    /**
     * A timed-out online attempt is graded like a submitted one: its typed written
     * answers go to the AI when the assessment opted in. Uploaded sheets keep their
     * old path - only a learner's own submit queues those.
     */
    private void queueTypedAiEvaluation(StudentAttempt attempt) {
        try {
            Assessment assessment = attempt.getRegistration().getAssessment();
            // Checked here first so the hourly sweep opens no transaction for the
            // (almost every) attempt whose assessment never opted in.
            if (!Boolean.TRUE.equals(assessment.getAiEvaluationEnabled())) return;
            if (!typedAnswerEvaluation.isTypedAttempt(attempt, assessment)) return;
            aiEvaluationSubmissionEnqueuer.enqueueIfEnabled(attempt, assessment);
        } catch (Exception e) {
            log.error("[AI-EVAL-ENQUEUE] could not queue timed-out attempt {}: {}", attempt.getId(), e.getMessage());
        }
    }

    private boolean isAttemptTimeOver(StudentAttempt attempt) {
        try{
            // No duration means no deadline, not a deadline that passed at start.
            if (attempt.getMaxTime() == null || attempt.getMaxTime() <= 0) {
                return false;
            }
            Date currentTime = new Date();

            Date attemptEndTime = new Date(attempt.getStartTime().getTime() + attempt.getMaxTime() * 60 * 1000);

            // Check condition
            return attemptEndTime.before(currentTime);
        } catch (Exception e) {
            return false;
        }
    }

    //Retry If task Failed
    @Override
    public void retryTask(SchedulerActivityLog activityLog, Optional<List<String>> retriesSourceIds, String source) {
        //If There are no Retries Ids then Mark Task as FINISHED
        if (retriesSourceIds.isEmpty() || retriesSourceIds.get().isEmpty()) {
            activityLog.setStatus(SchedulerStatusEnum.FINISHED.name());
            schedulingService.createOrUpdateSchedulerActivityLog(activityLog);
            return;
        }

        List<String> sourceIds = retriesSourceIds.get();
        AtomicReference<String> activityLogStatus = new AtomicReference<>(SchedulerStatusEnum.FINISHED.name());

        List<TaskExecutionAudit> failedTasks = taskExecutionAuditRepository
                .findBySchedulerActivityLogAndSourceAndSourceIdIn(activityLog, source, sourceIds);

        Map<String, TaskExecutionAudit> auditMapBySourceId = failedTasks.stream()
                .collect(Collectors.toMap(TaskExecutionAudit::getSourceId, Function.identity()));

        List<StudentAttempt> failedAttempts = studentAttemptService.getAllAttemptsFromIds(sourceIds);

        List<TaskExecutionAudit> updatedTasks = new ArrayList<>();

        //Try to retry updating the task
        for (StudentAttempt attempt : failedAttempts) {
            TaskExecutionAudit taskAudit = auditMapBySourceId.get(attempt.getId());

            if (taskAudit == null) {
                continue;
            }

            attempt.setStatus(AssessmentAttemptEnum.ENDED.name());

            try {
                studentAttemptService.updateStudentAttempt(attempt);
                taskAudit.setStatus(SchedulerStatusEnum.FINISHED.name());
                taskAudit.setStatusMessage("Updated Successfully");
            } catch (Exception e) {
                log.error("Failed to update attempt ID {}: {}", attempt.getId(), e.getMessage());

                activityLogStatus.set(SchedulerStatusEnum.FAILED.name());
                taskAudit.setStatus(SchedulerStatusEnum.FAILED.name());
                taskAudit.setStatusMessage(e.getMessage());
            }

            updatedTasks.add(taskAudit);
        }

        taskExecutionAuditRepository.saveAll(updatedTasks);
        activityLog.setStatus(activityLogStatus.get());
        schedulingService.createOrUpdateSchedulerActivityLog(activityLog);
    }
}
