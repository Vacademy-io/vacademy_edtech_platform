package vacademy.io.assessment_service.features.assessment.controller.evaluation_ai;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AdoptQuestionsRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AdoptQuestionsResponse;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiEvaluationTriggerRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.EvaluationProcessSummaryDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.EvaluationProgressDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionEvaluationResultDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationProgressService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationRetrofitService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AssessmentChoiceService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.DashboardChoiceGroups;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/assessment-service/assessment/evaluation-ai")
@RequiredArgsConstructor
public class AiEvaluationController {

        private final AiEvaluationService aiEvaluationService;
        private final AiEvaluationProgressService progressService;
        private final AiEvaluationReviewService reviewService;
        private final AiEvaluationRetrofitService retrofitService;
        private final EvaluationAccessValidator accessValidator;
        private final AssessmentChoiceService choiceService;

        /**
         * Is this test AI-checkable, or does it only hold the manual-upload
         * placeholder? Lets the UI offer "Enable AI checking" instead of a button
         * that fails.
         */
        @GetMapping("/gradable")
        public ResponseEntity<java.util.Map<String, Object>> isGradable(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @RequestParam String assessmentId) {
                accessValidator.requireInstituteMembership(user, instituteId);
                boolean placeholderOnly = retrofitService.isPlaceholderOnly(instituteId, assessmentId);
                return ResponseEntity.ok(java.util.Map.of(
                                "assessment_id", assessmentId,
                                "placeholder_only", placeholderOnly,
                                "message", placeholderOnly ? AiEvaluationService.PLACEHOLDER_ONLY_MESSAGE : ""));
        }

        /**
         * Replace the placeholder question of an existing offline test with real
         * questions (the digitised paper), turn AI checking on, and prepare every
         * uploaded sheet for it.
         */
        @PostMapping("/adopt-questions")
        public ResponseEntity<AdoptQuestionsResponse> adoptQuestions(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @RequestParam String assessmentId,
                        @RequestBody AdoptQuestionsRequest request) {
                accessValidator.requireStaffRole(user);
                return ResponseEntity.ok(retrofitService.adoptQuestions(user, instituteId, assessmentId, request));
        }

        /** Internal choice of a dashboard test: its groups and what the paper is out of. */
        @GetMapping("/choice-groups")
        public ResponseEntity<java.util.Map<String, Object>> getChoiceGroups(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @RequestParam String assessmentId) {
                accessValidator.requireStaffRole(user);
                accessValidator.requireInstituteMembership(user, instituteId);
                return ResponseEntity.ok(choiceService.view(instituteId, assessmentId));
        }

        /**
         * Set (or clear, with an empty list) a dashboard test's internal choice - "Answer
         * any FOUR of these five". Updates what the paper is out of and every unreleased
         * result; released results are left as they are and counted in the reply.
         */
        @PutMapping("/choice-groups")
        public ResponseEntity<java.util.Map<String, Object>> replaceChoiceGroups(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @RequestParam String assessmentId,
                        @RequestBody AdoptQuestionsRequest request) {
                accessValidator.requireStaffRole(user);
                accessValidator.requireInstituteMembership(user, instituteId);
                List<DashboardChoiceGroups.GroupInput> groups = request == null || request.getChoiceGroups() == null
                                ? List.of()
                                : request.getChoiceGroups().stream()
                                                .map(g -> new DashboardChoiceGroups.GroupInput(g.getLabel(), g.getQuestionIds(),
                                                                g.getAttempt(), g.getPolicy()))
                                                .toList();
                return ResponseEntity.ok(choiceService.replace(instituteId, assessmentId, groups));
        }

        @PostMapping("/trigger-evaluation")
        public ResponseEntity<List<String>> triggerEvaluation(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @RequestBody AiEvaluationTriggerRequest request) {
                accessValidator.requireStaffRole(user);
                return ResponseEntity.ok(aiEvaluationService.triggerEvaluation(request, user, instituteId));
        }

        /**
         * List all AI-evaluation runs for an assessment (evaluations dashboard).
         * Scoped to the caller's institute — a running/failed run stays findable
         * after the teacher navigates away.
         */
        @GetMapping("/processes")
        public ResponseEntity<List<EvaluationProcessSummaryDto>> listProcesses(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @RequestParam String assessmentId) {
                accessValidator.requireInstituteMembership(user, instituteId);
                // Staff only: these return every student's AI marks and feedback.
                accessValidator.requireStaffRole(user);
                return ResponseEntity.ok(progressService.listProcessesForAssessment(assessmentId, instituteId));
        }

        /**
         * Get real-time progress for an evaluation
         */
        @GetMapping("/progress/{processId}")
        public ResponseEntity<EvaluationProgressDto> getProgress(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @PathVariable String processId) {
                accessValidator.requireProcessAccess(user, instituteId, processId);
                accessValidator.requireStaffRole(user);
                return ResponseEntity.ok(progressService.getEvaluationProgress(processId));
        }

        /**
         * Get only completed questions (for viewing partial results)
         */
        @GetMapping("/completed-questions/{processId}")
        public ResponseEntity<List<QuestionEvaluationResultDto>> getCompletedQuestions(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @PathVariable String processId) {
                accessValidator.requireProcessAccess(user, instituteId, processId);
                accessValidator.requireStaffRole(user);
                return ResponseEntity.ok(progressService.getCompletedQuestions(processId));
        }

        /**
         * Stop an ongoing evaluation process
         */
        @PostMapping("/stop/{processId}")
        public ResponseEntity<String> stopEvaluation(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @PathVariable String processId) {
                accessValidator.requireProcessAccess(user, instituteId, processId);
                accessValidator.requireStaffRole(user);
                progressService.stopEvaluationProcess(processId);
                return ResponseEntity.ok("Evaluation process stopped successfully");
        }

        /**
         * Teacher review: override a single question's marks/feedback before the
         * result is released. The AI verdict becomes a draft the teacher approves.
         */
        @PutMapping("/review/{processId}/question/{questionId}")
        public ResponseEntity<String> overrideQuestion(
                        @RequestAttribute("user") CustomUserDetails user,
                        @RequestHeader(value = "clientId", required = false) String instituteId,
                        @PathVariable String processId,
                        @PathVariable String questionId,
                        @RequestBody QuestionOverrideRequest request) {
                accessValidator.requireProcessAccess(user, instituteId, processId);
                accessValidator.requireStaffRole(user);
                reviewService.overrideQuestion(processId, questionId, request.getMarksAwarded(),
                                request.getFeedback(), user.getUserId());
                return ResponseEntity.ok("Question evaluation updated");
        }
}
