package vacademy.io.assessment_service.features.learner_assessment.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.StudentReportFilter;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.SmartLeaderboardDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_NUMBER;
import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_SIZE;

@RestController
@RequestMapping("/assessment-service/assessment/learner/report")
public class LearnerReportController {

    @Autowired
    private LearnerReportService learnerReportService;

    @PostMapping("/list")
    public ResponseEntity<Page<StudentReportDto>> getStudentReportList(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody StudentReportFilter filter,
            @RequestParam(name = "instituteId") String instituteId,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        return learnerReportService.getStudentReportList(user, instituteId, filter, pageNo, pageSize);
    }

    @GetMapping("/detail")
    public ResponseEntity<StudentReportOverallDetailDto> getStudentReportDetail(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId") String attemptId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getStudentReportDetail(user, assessmentId, attemptId, instituteId);
    }

    @GetMapping("/comparison")
    public ResponseEntity<StudentComparisonDto> getComparisonData(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId") String attemptId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getComparisonData(user, assessmentId, attemptId, instituteId);
    }

    /** AI-annotated copy data: OCR layout map + all annotations for the attempt. */
    @GetMapping("/annotated-copy")
    public ResponseEntity<vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAnnotatedCopyDto> getAnnotatedCopy(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId") String attemptId) {
        return ResponseEntity.ok(learnerReportService.getAnnotatedCopy(user, assessmentId, attemptId));
    }

    @GetMapping("/leaderboard")
    public ResponseEntity<SmartLeaderboardDto> getStudentLeaderboard(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getStudentLeaderboard(user, assessmentId, instituteId);
    }

    @GetMapping("/option-distribution")
    public ResponseEntity<Map<String, Map<String, Double>>> getOptionDistribution(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId") String attemptId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getOptionDistribution(user, assessmentId, attemptId, instituteId);
    }

    @GetMapping("/pdf")
    public ResponseEntity<byte[]> getStudentReportPdf(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId") String attemptId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getStudentReportPdf(user, assessmentId, attemptId, instituteId);
    }

    @GetMapping("/ai-pdf")
    public ResponseEntity<byte[]> getAiReportPdf(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId", required = false) String attemptId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getAiReportPdf(user, assessmentId, attemptId, instituteId);
    }

    /** The same AI report as /ai-pdf, as an HTML page ({"html": ...}) for the learner app's screen. */
    @GetMapping("/ai-html")
    public ResponseEntity<Map<String, String>> getAiReportWebHtml(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "assessmentId") String assessmentId,
            @RequestParam(name = "attemptId", required = false) String attemptId,
            @RequestParam(name = "instituteId") String instituteId) {
        return learnerReportService.getAiReportWebHtml(user, assessmentId, attemptId, instituteId);
    }
}
