package vacademy.io.admin_core_service.features.certificate.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateEligibilityDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateTestOptionDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateDashboardDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateSettingDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateSettingsResponse;
import vacademy.io.admin_core_service.features.certificate.service.CourseCertificateService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Admin certificate management for a single course, backing the Certificates tab
 * on the course page.
 *
 * <p>Settings are addressed by {@code packageId} (the course) because an override
 * applies to every batch. Everything learner-facing is addressed by
 * {@code packageSessionId}, since certificates are issued per batch.
 */
@RestController
@RequestMapping("/admin-core-service/institute/v1/certificate/course")
@RequiredArgsConstructor
public class CourseCertificateController {

    private final CourseCertificateService courseCertificateService;

    @GetMapping("/settings")
    public ResponseEntity<CourseCertificateSettingsResponse> getSettings(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageId) {
        return ResponseEntity.ok(courseCertificateService.getSettings(instituteId, packageId));
    }

    @PostMapping("/settings")
    public ResponseEntity<String> saveSettings(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageId,
            @RequestBody CourseCertificateSettingDto request) {
        courseCertificateService.saveSettings(instituteId, packageId, request);
        return ResponseEntity.ok("Updated Successfully");
    }

    @GetMapping("/dashboard")
    public ResponseEntity<CourseCertificateDashboardDto> dashboard(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestParam(required = false) String packageId) {
        return ResponseEntity.ok(courseCertificateService.getDashboard(instituteId, packageSessionId, packageId));
    }

    @GetMapping("/learners")
    public ResponseEntity<CourseCertificateService.LearnerPage> learners(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestParam(required = false) String packageId,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return ResponseEntity.ok(courseCertificateService
                .getLearners(instituteId, packageSessionId, packageId, search, status, page, size));
    }

    /**
     * Issue for a learner who has not received one, or re-render an existing
     * certificate. A re-render keeps the learner's existing certificate number.
     */
    @PostMapping("/issue")
    public ResponseEntity<String> issue(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestParam String userId,
            @RequestParam(defaultValue = "false") boolean regenerate,
            @RequestParam(required = false) String courseName,
            @RequestParam(defaultValue = "false") boolean force) {
        return ResponseEntity.ok(courseCertificateService
                .issueForLearner(user, instituteId, packageSessionId, userId, regenerate, courseName, force));
    }

    /**
     * Every quiz and assessment in the course, across its batches, in course order -
     * the choices for the "which tests count" picker in the course certificate settings.
     */
    @GetMapping("/tests")
    public ResponseEntity<List<CertificateTestOptionDto>> tests(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageId) {
        return ResponseEntity.ok(courseCertificateService.getCourseTests(user, instituteId, packageId));
    }

    /** One learner's standing against the course's certificate rule, test by test. */
    @GetMapping("/learner-eligibility")
    public ResponseEntity<CertificateEligibilityDto> learnerEligibility(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestParam String userId) {
        return ResponseEntity.ok(courseCertificateService.getEligibility(user, instituteId, packageSessionId, userId));
    }

    @PostMapping("/resend")
    public ResponseEntity<String> resend(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String certificateId) {
        courseCertificateService.resend(instituteId, certificateId);
        return ResponseEntity.ok("Certificate email sent");
    }
}
