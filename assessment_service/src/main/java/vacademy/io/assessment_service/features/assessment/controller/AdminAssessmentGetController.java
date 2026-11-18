package vacademy.io.assessment_service.features.assessment.controller;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.repository.query.Param;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RevaluateRequest;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.AssessmentOverviewResponse;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.QuestionInsightsResponse;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportResponse;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.TotalMarksAssessmentResponse;
import vacademy.io.assessment_service.features.assessment.manager.AdminAssessmentGetManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_NUMBER;
import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_SIZE;

@RestController
@RequestMapping("/assessment-service/assessment/admin")
public class AdminAssessmentGetController {

    @Autowired
    AdminAssessmentGetManager adminAssessmentGetManager;

    @GetMapping("/assessment-admin-list-init")
    public ResponseEntity<AssessmentAdminListInitDto> assessmentAdminListInit(@RequestAttribute("user") CustomUserDetails user,
                                                                              @RequestParam(name = "instituteId", required = false) String instituteId) {
        return adminAssessmentGetManager.assessmentAdminListInit(user, instituteId);
    }

    @PostMapping("/assessment-admin-list-filter")
    public ResponseEntity<AllAdminAssessmentResponse> assessmentAdminListFilter(@RequestAttribute("user") CustomUserDetails user,
                                                                                @RequestBody AdminAssessmentFilter adminAssessmentFilter,
                                                                                @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
                                                                                @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize,
                                                                                @RequestParam(name = "instituteId", required = false) String instituteId) {
        return adminAssessmentGetManager.assessmentAdminListFilter(user, adminAssessmentFilter, instituteId, pageNo, pageSize);
    }

    @PostMapping("/get-leaderboard")
    public ResponseEntity<LeaderBoardResponse> assessmentLeaderBoard(@RequestAttribute("user") CustomUserDetails user,
                                                                     @RequestParam("assessmentId") String assessmentId,
                                                                     @RequestBody LeaderboardFilter filter,
                                                                     @RequestParam("instituteId") String instituteId,
                                                                     @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
                                                                     @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        return adminAssessmentGetManager.getLeaderBoard(user, assessmentId, filter, instituteId, pageNo, pageSize);
    }


    @GetMapping("/get-overview")
    public ResponseEntity<AssessmentOverviewResponse> overviewDetails(@RequestAttribute("user") CustomUserDetails user,
                                                                      @RequestParam("assessmentId") String assessmentId,
                                                                      @RequestParam("instituteId") String instituteId) {
        return adminAssessmentGetManager.getOverViewDetails(user, assessmentId, instituteId);
    }

    @GetMapping("/get-question-insights")
    public ResponseEntity<QuestionInsightsResponse> questionInsights(@RequestAttribute("user") CustomUserDetails user,
                                                                     @RequestParam("assessmentId") String assessmentId,
                                                                     @RequestParam("instituteId") String instituteId,
                                                                     @RequestParam("sectionId") String sectionId) {
        return adminAssessmentGetManager.getQuestionInsights(user, assessmentId, instituteId, sectionId);
    }

    @PostMapping("/get-student-report")
    public ResponseEntity<StudentReportResponse> studentReport(@RequestAttribute("user") CustomUserDetails userDetails,
                                                               @RequestParam("studentId") String studentId,
                                                               @RequestParam("instituteId") String instituteId,
                                                               @RequestBody StudentReportFilter filter,
                                                               @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
                                                               @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        return adminAssessmentGetManager.getStudentReport(userDetails, studentId, instituteId, filter, pageNo, pageSize);
    }

    @org.springframework.beans.factory.annotation.Autowired
    vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator revaluateAccessValidator;

    @PostMapping("/revaluate")
    public ResponseEntity<String> revaluateAssessment(@RequestAttribute("user") CustomUserDetails userDetails,
                                                      @RequestHeader(value = "clientId", required = false) String clientId,
                                                      @Param("assessmentId") String assessmentId,
                                                      @Param("instituteId") String instituteId,
                                                      @RequestBody RevaluateRequest request,
                                                      @Param("methodType") String methodType) {
        // Re-marking rewrites results: staff of the assessment's own institute only (a learner
        // token used to be able to trigger it).
        revaluateAccessValidator.requireActiveInstitute(clientId, instituteId);
        revaluateAccessValidator.requireStaffRole(userDetails);
        revaluateAccessValidator.requireAssessmentInInstitute(userDetails, instituteId, assessmentId);
        // The attempts named in the body must be this assessment's (else an owned assessment
        // re-marks another institute's attempts).
        if (!"ENTIRE_ASSESSMENT".equals(methodType) && request != null) {
            revaluateAccessValidator.requireAttemptsOnAssessment(assessmentId, request.getAttemptIds());
        }
        return adminAssessmentGetManager.revaluateAssessment(userDetails, assessmentId, methodType, request, instituteId);
    }

    @GetMapping("/init/total-marks")
    public ResponseEntity<TotalMarksAssessmentResponse> initAssessmentMarks(@RequestAttribute("user") CustomUserDetails user,
                                                                            @RequestParam(name = "assessmentId") String assessmentId) {
        return adminAssessmentGetManager.initTotalAssessmentMarks(user, assessmentId);
    }

    @GetMapping("/dashboard/get-count")
    public ResponseEntity<AssessmentCountResponse> getAssessmentCount(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                      @RequestParam(name = "instituteId") String instituteId) {
        return adminAssessmentGetManager.getAssessmentCount(userDetails, instituteId);
    }
}
