package vacademy.io.assessment_service.features.assessment.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportBulkService;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService;
import vacademy.io.assessment_service.features.assessment.service.aireport.ReportProfileService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Report profiles (pages before/after a student's report) and the AI report bulk job.
 * Staff of the owning institute only.
 */
@RestController
@RequestMapping("/assessment-service/assessment/report-profile/v1")
public class ReportProfileController {

    @Autowired
    private EvaluationAccessValidator access;
    @Autowired
    private ReportProfileService profiles;
    @Autowired
    private AiReportPdfService aiReportPdfService;
    @Autowired
    private AiReportBulkService bulk;
    @Autowired
    private AssessmentParticipantsManager participantsManager;
    @Autowired
    private StudentAttemptRepository attempts;
    @Autowired
    private ReportPdfRenderService reportPdfRenderService;
    @Autowired
    private LearnerReportService learnerReportService;
    @Autowired
    private vacademy.io.assessment_service.features.assessment.notification.ResultResendService resultResend;
    @Autowired
    private vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService resultNotifications;

    private void staff(CustomUserDetails user, String clientId, String instituteId) {
        access.requireActiveInstitute(clientId, instituteId);
        access.requireInstituteMembership(user, instituteId);
        access.requireStaffRole(user);
    }

    @GetMapping("/list")
    public ResponseEntity<List<Map<String, Object>>> list(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam String instituteId) {
        staff(user, clientId, instituteId);
        return ResponseEntity.ok(profiles.list(instituteId));
    }

    @GetMapping("/get")
    public ResponseEntity<Map<String, Object>> get(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestHeader(value = "clientId", required = false) String clientId,
                                                   @RequestParam String instituteId, @RequestParam String profileId) {
        staff(user, clientId, instituteId);
        ReportProfileService.Profile p = profiles.get(profileId, instituteId);
        if (p == null) throw new VacademyException("Report profile not found");
        return ResponseEntity.ok(Map.of("id", p.id(), "name", p.name(), "institute_default", p.instituteDefault(), "config", p.config()));
    }

    /** Body: {"id": optional, "name": "...", "institute_default": false, "config": {...}} */
    @PostMapping("/save")
    public ResponseEntity<Map<String, String>> save(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                    @RequestParam String instituteId, @RequestBody JsonNode body) {
        staff(user, clientId, instituteId);
        try {
            String id = profiles.save(instituteId, body.path("id").asText(null), body.path("name").asText("Report profile"),
                    body.path("config"), body.path("institute_default").asBoolean(false));
            return ResponseEntity.ok(Map.of("id", id));
        } catch (IllegalArgumentException e) {
            throw new VacademyException(e.getMessage());
        }
    }

    /** Body: {"assessment_ids": [...], "profile_id": "<id>" | "NONE" | null (institute default)} */
    @PostMapping("/link")
    public ResponseEntity<String> link(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestHeader(value = "clientId", required = false) String clientId,
                                       @RequestParam String instituteId, @RequestBody JsonNode body) {
        staff(user, clientId, instituteId);
        List<String> ids = new ArrayList<>();
        body.path("assessment_ids").forEach(n -> ids.add(n.asText()));
        if (ids.isEmpty()) throw new VacademyException("assessment_ids is required");
        for (String a : ids) access.requireAssessmentInInstitute(user, instituteId, a);
        String profileId = body.hasNonNull("profile_id") ? body.get("profile_id").asText() : null;
        try {
            profiles.link(instituteId, ids, profileId);
        } catch (IllegalArgumentException e) {
            throw new VacademyException(e.getMessage());
        }
        return ResponseEntity.ok("Done");
    }

    /**
     * The exact PDF a student would get for this attempt (AI report when it exists, else the
     * normal one, plus profile pages). profileId previews an unlinked profile ("NONE" = none).
     */
    @GetMapping("/preview")
    public ResponseEntity<byte[]> preview(@RequestAttribute("user") CustomUserDetails user,
                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                          @RequestParam String instituteId, @RequestParam String assessmentId,
                                          @RequestParam String attemptId,
                                          @RequestParam(required = false) String profileId) {
        staff(user, clientId, instituteId);
        access.requireAssessmentInInstitute(user, instituteId, assessmentId);
        StudentAttempt attempt = attempts.findById(attemptId).orElseThrow(() -> new VacademyException("Attempt not found"));
        if (attempt.getRegistration() == null || attempt.getRegistration().getAssessment() == null
                || !assessmentId.equals(attempt.getRegistration().getAssessment().getId())) {
            throw new VacademyException("Attempt is not part of this assessment");
        }
        String userId = attempt.getRegistration().getUserId();
        StudentReportOverallDetailDto detail = participantsManager.createStudentReportDetailResponse(assessmentId, attemptId, instituteId);
        AiReportPdfService.NormalReport normal = () -> reportPdfRenderService.render(detail,
                learnerReportService.buildComparisonData(userId, assessmentId, attemptId, instituteId),
                learnerReportService.loadClassContext(assessmentId, instituteId));
        try {
            byte[] pdf;
            if (profileId == null) {
                pdf = aiReportPdfService.renderStudentReport(userId, assessmentId, attemptId, instituteId, detail, null, normal);
            } else {
                ReportProfileService.Profile p = ReportProfileService.NONE.equals(profileId) ? null : profiles.get(profileId, instituteId);
                if (p == null && !ReportProfileService.NONE.equals(profileId)) throw new VacademyException("Report profile not found");
                pdf = aiReportPdfService.renderWithProfile(userId, assessmentId, attemptId, instituteId, detail, null, normal, p);
            }
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=report-preview.pdf")
                    .contentType(MediaType.APPLICATION_PDF)
                    .body(pdf);
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("Preview failed: " + e.getMessage());
        }
    }

    /**
     * Generates missing AI analyses for an assessment's submitted learners (spends AI
     * credits). dryRun=true only counts. limit caps how many are generated.
     */
    @PostMapping("/ai-reports/generate-missing")
    public ResponseEntity<Map<String, Object>> generateMissing(@RequestAttribute("user") CustomUserDetails user,
                                                               @RequestHeader(value = "clientId", required = false) String clientId,
                                                               @RequestParam String instituteId, @RequestParam String assessmentId,
                                                               @RequestParam(defaultValue = "true") boolean dryRun,
                                                               @RequestParam(defaultValue = "4") int concurrency,
                                                               @RequestParam(required = false) Integer limit,
                                                               @RequestParam(defaultValue = "MISSING") String mode,
                                                               @RequestParam(required = false) List<String> attemptIds) {
        staff(user, clientId, instituteId);
        access.requireAssessmentInInstitute(user, instituteId, assessmentId);
        return ResponseEntity.ok(bulk.start(assessmentId, instituteId, dryRun, concurrency, limit,
                "ALL".equalsIgnoreCase(mode), attemptIds == null ? java.util.Set.of() : new java.util.HashSet<>(attemptIds)));
    }

    @GetMapping("/ai-reports/job")
    public ResponseEntity<Map<String, Object>> job(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestHeader(value = "clientId", required = false) String clientId,
                                                   @RequestParam String instituteId, @RequestParam String jobId) {
        staff(user, clientId, instituteId);
        Map<String, Object> v = bulk.status(jobId);
        if (v == null) throw new VacademyException("Job not found (jobs live in one pod's memory; retry if it was restarted)");
        return ResponseEntity.ok(v);
    }

    /** Which email / WhatsApp template a release of this assessment would use (and at which level). */
    @GetMapping("/result-notification/templates")
    public ResponseEntity<Map<String, Object>> resultTemplates(@RequestAttribute("user") CustomUserDetails user,
                                                               @RequestHeader(value = "clientId", required = false) String clientId,
                                                               @RequestParam String instituteId, @RequestParam String assessmentId) {
        staff(user, clientId, instituteId);
        access.requireAssessmentInInstitute(user, instituteId, assessmentId);
        var t = resultNotifications.resolve(instituteId, assessmentId);
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("email", t.email() == null ? Map.of("name", "built-in", "level", "CODE") : summary(t.email()));
        out.put("whatsapp", t.whatsapp() == null ? null : summary(t.whatsapp()));
        return ResponseEntity.ok(out);
    }

    private static Map<String, Object> summary(Map<String, Object> t) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (String k : new String[]{"template_id", "name", "subject", "level"}) m.put(k, t.get(k));
        return m;
    }

    /**
     * Sends the result email and/or WhatsApp again to released attempts (stored PDF). dryRun
     * (default) only counts and shows which templates apply.
     */
    @PostMapping("/result-notification/send")
    public ResponseEntity<Map<String, Object>> resendResults(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestHeader(value = "clientId", required = false) String clientId,
                                                             @RequestParam String instituteId, @RequestParam String assessmentId,
                                                             @RequestParam(defaultValue = "false") boolean email,
                                                             @RequestParam(defaultValue = "false") boolean whatsapp,
                                                             @RequestParam(defaultValue = "true") boolean dryRun,
                                                             @RequestParam(required = false) List<String> attemptIds) {
        staff(user, clientId, instituteId);
        access.requireAssessmentInInstitute(user, instituteId, assessmentId);
        if (!email && !whatsapp) throw new VacademyException("Choose email and/or whatsapp");
        return ResponseEntity.ok(resultResend.start(assessmentId, instituteId, email, whatsapp,
                attemptIds == null ? java.util.Set.of() : new java.util.HashSet<>(attemptIds), dryRun));
    }

    /** One attempt's result email / WhatsApp, built fresh and sent only to the given address and number. */
    @PostMapping("/result-notification/test")
    public ResponseEntity<Map<String, Object>> testResult(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestHeader(value = "clientId", required = false) String clientId,
                                                          @RequestParam String instituteId, @RequestParam String assessmentId,
                                                          @RequestParam String attemptId,
                                                          @RequestParam(required = false) String email,
                                                          @RequestParam(required = false) String phone,
                                                          @RequestParam(required = false) String whatsappTemplate) {
        staff(user, clientId, instituteId);
        access.requireAssessmentInInstitute(user, instituteId, assessmentId);
        try {
            return ResponseEntity.ok(resultResend.testSend(assessmentId, instituteId, attemptId, email, phone, whatsappTemplate));
        } catch (IllegalArgumentException e) {
            throw new VacademyException(e.getMessage());
        } catch (Exception e) {
            throw new VacademyException("Test send failed: " + e.getMessage());
        }
    }

    @GetMapping("/result-notification/job")
    public ResponseEntity<Map<String, Object>> resendJob(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestHeader(value = "clientId", required = false) String clientId,
                                                         @RequestParam String instituteId, @RequestParam String jobId) {
        staff(user, clientId, instituteId);
        Map<String, Object> v = resultResend.status(jobId);
        if (v == null) throw new VacademyException("Job not found (jobs live in one pod's memory)");
        return ResponseEntity.ok(v);
    }
}
