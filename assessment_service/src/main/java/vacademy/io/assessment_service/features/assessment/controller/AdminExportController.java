package vacademy.io.assessment_service.features.assessment.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentUserFilter;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RespondentFilter;
import vacademy.io.assessment_service.features.assessment.dto.export.AiStudentReportStatusDto;
import vacademy.io.assessment_service.features.assessment.dto.export.ResultExportColumnsDto;
import vacademy.io.assessment_service.features.assessment.dto.export.zip.*;
import vacademy.io.assessment_service.features.assessment.manager.AdminExportManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/assessment-service/assessment/export")
public class AdminExportController {

    @Autowired
    AdminExportManager adminExportManager;

    @GetMapping("/csv/leaderboard")
    public ResponseEntity<byte[]> getLeaderboardCsv(@RequestAttribute(name = "user") CustomUserDetails user,
                                                    @RequestParam("assessmentId") String assessmentId,
                                                    @RequestParam("instituteId") String instituteId) {
        return adminExportManager.getLeaderBoardCsvExport(user, assessmentId, instituteId);
    }

    @GetMapping("/pdf/leaderboard")
    public ResponseEntity<InputStreamResource> getLeaderboardPdf(@RequestAttribute(name = "user") CustomUserDetails user,
                                                                 @RequestParam("assessmentId") String assessmentId,
                                                                 @RequestParam("instituteId") String instituteId) {
        return adminExportManager.getLeaderboardPdfExport(user, assessmentId, instituteId);
    }

    @GetMapping("/csv/marks-rank")
    public ResponseEntity<byte[]> getMarksRankCsv(@RequestAttribute(name = "user") CustomUserDetails user,
                                                  @RequestParam("assessmentId") String assessmentId,
                                                  @RequestParam("instituteId") String instituteId) {
        return adminExportManager.getMarksRankCsvExport(user, assessmentId, instituteId);
    }

    @GetMapping("/pdf/marks-rank")
    public ResponseEntity<InputStreamResource> getMarksRankPdf(@RequestAttribute(name = "user") CustomUserDetails user,
                                                               @RequestParam("assessmentId") String assessmentId,
                                                               @RequestParam("instituteId") String instituteId) {
        return adminExportManager.getMarksRankPdfExport(user, assessmentId, instituteId);
    }

    @PostMapping("/csv/registered-participants")
    public ResponseEntity<byte[]> getRegisteredCsv(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam(name = "instituteId") String instituteId,
                                                   @RequestParam(name = "assessmentId") String assessmentId,
                                                   @RequestBody AssessmentUserFilter filter) {
        return adminExportManager.getRegisteredCsvExport(user, instituteId, assessmentId, filter);
    }

    @GetMapping("/csv/registered-participants/columns")
    public ResponseEntity<ResultExportColumnsDto> getRegisteredCsvColumns(@RequestAttribute("user") CustomUserDetails user,
                                                                          @RequestParam(name = "instituteId") String instituteId,
                                                                          @RequestParam(name = "assessmentId") String assessmentId,
                                                                          // Which sheet the dialog is about to export. Defaults false so
                                                                          // existing callers keep getting the result columns.
                                                                          @RequestParam(name = "notAttempted", required = false, defaultValue = "false") boolean notAttempted) {
        return adminExportManager.getResultExportColumns(user, instituteId, assessmentId, notAttempted);
    }

    @PostMapping("/pdf/registered-participants")
    public ResponseEntity<InputStreamResource> getRegisteredPdf(@RequestAttribute("user") CustomUserDetails user,
                                                                @RequestParam(name = "instituteId") String instituteId,
                                                                @RequestParam(name = "assessmentId") String assessmentId,
                                                                @RequestBody AssessmentUserFilter filter) {
        return adminExportManager.getRegisteredPdfExport(user, instituteId, assessmentId, filter);
    }

    @PostMapping("/csv/respondent-list")
    public ResponseEntity<byte[]> getRespondentListCsv(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestParam(name = "instituteId") String instituteId,
                                                       @RequestParam(name = "sectionId") String sectionId,
                                                       @RequestParam(name = "questionId") String questionId,
                                                       @RequestParam(name = "assessmentId") String assessmentId,
                                                       @RequestBody RespondentFilter filter) {
        return adminExportManager.getRespondentListCsvExport(user, instituteId, sectionId, questionId, assessmentId, filter);
    }

    @PostMapping("/pdf/respondent-list")
    public ResponseEntity<InputStreamResource> getRespondentListPdf(@RequestAttribute("user") CustomUserDetails user,
                                                                    @RequestParam(name = "instituteId") String instituteId,
                                                                    @RequestParam(name = "sectionId") String sectionId,
                                                                    @RequestParam(name = "questionId") String questionId,
                                                                    @RequestParam(name = "assessmentId") String assessmentId,
                                                                    @RequestBody RespondentFilter filter) {
        return adminExportManager.getRespondentListPdfExport(user, instituteId, sectionId, questionId, assessmentId, filter);
    }

    @GetMapping("pdf/question-insights")
    public ResponseEntity<byte[]> questionInsightsPdf(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("assessmentId") String assessmentId,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestParam("sectionIds") String sectionIds) {
        return adminExportManager.getQuestionInsightsExport(user, assessmentId, instituteId, sectionIds);
    }

    @GetMapping("pdf/student-report")
    public ResponseEntity<byte[]> studentReportPdf(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("assessmentId") String assessmentId,
                                                   @RequestParam("attemptId") String attemptId,
                                                   @RequestParam("instituteId") String instituteId) {
        return adminExportManager.getStudentReportPdf(user, assessmentId, attemptId, instituteId);
    }

    /**
     * Is the AI diagnostic report for this attempt ready, or would downloading
     * it spend AI credits? Free and read-only — the submissions menu calls it
     * before showing the download so the teacher knows which they are getting.
     */
    @GetMapping("/ai-student-report/status")
    public ResponseEntity<AiStudentReportStatusDto> aiStudentReportStatus(@RequestAttribute("user") CustomUserDetails user,
                                                                          @RequestParam("assessmentId") String assessmentId,
                                                                          @RequestParam("attemptId") String attemptId,
                                                                          @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(adminExportManager.getAiStudentReportStatus(user, assessmentId, attemptId, instituteId));
    }

    /**
     * The teacher's AI diagnostic PDF for one attempt: weakness by section,
     * topic and question, misconceptions, and a prioritised action plan.
     *
     * <p>Generates the analysis if it does not exist yet, which is what
     * <b>spends the institute's AI credits</b> — pass {@code generate=false} to
     * download only an analysis that already exists. Subsequent downloads of the
     * same attempt reuse the stored analysis and cost nothing.
     */
    @GetMapping("pdf/ai-student-report")
    public ResponseEntity<byte[]> aiStudentReportPdf(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam("assessmentId") String assessmentId,
                                                     @RequestParam("attemptId") String attemptId,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @RequestParam(name = "generate", required = false, defaultValue = "true")
                                                     boolean generate) {
        return adminExportManager.getAiStudentReportPdf(user, assessmentId, attemptId, instituteId, generate);
    }

    /**
     * Whether a class AI report already exists for this assessment, when it was
     * made, whether the results have changed since, and what a new one costs.
     *
     * <p>Free and read-only — the dialog calls it before offering Generate so
     * the teacher sees the price and their balance first.
     */
    @GetMapping("/ai-assessment-report/status")
    public ResponseEntity<Map<String, Object>> aiAssessmentReportStatus(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(
                adminExportManager.getAiAssessmentReportStatus(user, assessmentId, instituteId));
    }

    /**
     * The ONE AI diagnostic report for a whole assessment — class-wide weakness
     * by section, topic and question, shared misconceptions, a written analysis
     * and a prioritised action plan.
     *
     * <p><b>Charged once.</b> The first generation makes a real model call and
     * deducts the institute's AI credits; every later download re-serves the
     * stored report free. {@code regenerate=true} is a deliberate paid refresh.
     *
     * @param generate   false to download only an existing report, never to
     *                   generate (and therefore never to spend)
     * @param regenerate true to re-run and re-charge; the previous report is kept
     *                   in history rather than discarded
     * @param versionId  download one specific past version from the history —
     *                   always free, it was paid for when it was generated
     */
    @GetMapping("pdf/ai-assessment-report")
    public ResponseEntity<byte[]> aiAssessmentReportPdf(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestParam("assessmentId") String assessmentId,
                                                        @RequestParam("instituteId") String instituteId,
                                                        @RequestParam(name = "generate", required = false,
                                                                defaultValue = "true") boolean generate,
                                                        @RequestParam(name = "regenerate", required = false,
                                                                defaultValue = "false") boolean regenerate,
                                                        @RequestParam(name = "versionId", required = false)
                                                        String versionId) {
        return adminExportManager.getAiAssessmentReportPdf(user, assessmentId, instituteId,
                generate, regenerate, versionId);
    }

    // ==================================================================
    // Bulk Assessment Report Export (ZIP)
    // ==================================================================

    @PostMapping("/reports/zip/initiate")
    public ResponseEntity<ReportZipInitiateResponse> initiateReportZipExport(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody ReportZipInitiateRequest request) {
        return ResponseEntity.ok(adminExportManager.initiateReportZipExport(user, request));
    }

    @GetMapping("/reports/zip/status")
    public ResponseEntity<ReportZipStatusResponse> getReportZipExportStatus(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("jobId") String jobId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(adminExportManager.getReportZipExportStatus(user, jobId, instituteId));
    }

    @PostMapping("/reports/zip/continue")
    public ResponseEntity<ReportZipContinueResponse> continueReportZipExport(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("jobId") String jobId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(adminExportManager.continueReportZipExport(user, jobId, instituteId));
    }

    @PostMapping("/reports/zip/assemble")
    public ResponseEntity<ReportZipAssembleResponse> assembleReportZipExport(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("jobId") String jobId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(adminExportManager.assembleReportZipExport(user, jobId, instituteId));
    }

    @GetMapping("/reports/zip/recent")
    public ResponseEntity<ReportZipRecentResponse> getRecentReportZipExports(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(name = "limit", defaultValue = "5") int limit) {
        return ResponseEntity.ok(adminExportManager.getRecentReportZipExports(user, assessmentId, instituteId, limit));
    }

    @PostMapping("/reports/zip/cancel")
    public ResponseEntity<ReportZipCancelResponse> cancelReportZipExport(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("jobId") String jobId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(adminExportManager.cancelReportZipExport(user, jobId, instituteId));
    }
}
