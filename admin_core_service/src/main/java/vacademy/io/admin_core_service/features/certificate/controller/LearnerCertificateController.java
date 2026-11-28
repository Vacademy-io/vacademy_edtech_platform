package vacademy.io.admin_core_service.features.certificate.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateEligibilityDto;
import vacademy.io.admin_core_service.features.certificate.dto.IssuedCertificateDTO;
import vacademy.io.admin_core_service.features.certificate.dto.LearnerCertificateConfigDto;
import vacademy.io.admin_core_service.features.certificate.service.CertificateReadService;
import vacademy.io.admin_core_service.features.certificate.service.LearnerCertificateConfigService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Learner-facing certificate listing. Mirrors {@code LearnerBadgeController}'s
 * {@code /learner/v1/my-badges} shape — userId is JWT-derived, so a learner can
 * only ever list their own certificates. The parent portal reuses
 * {@link CertificateReadService} in-process behind the guardian guard.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/certificate/learner/v1")
@RequiredArgsConstructor
public class LearnerCertificateController {

    private final CertificateReadService certificateReadService;
    private final LearnerCertificateConfigService learnerCertificateConfigService;

    /** Learner: the authenticated learner's own certificates in an institute. */
    @GetMapping("/my-certificates")
    public ResponseEntity<List<IssuedCertificateDTO>> getMyCertificates(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(certificateReadService.listForUser(user.getUserId(), instituteId));
    }

    /**
     * Whether certificates are switched on for this batch, and at what completion
     * threshold — the single source of truth the learner app gates on.
     *
     * <p>Before this, the client read {@code STUDENT_DISPLAY_SETTINGS.certificates},
     * a separate copy of the same two values that could (and did) disagree with
     * the flag the server enforced.
     */
    @GetMapping("/config")
    public ResponseEntity<LearnerCertificateConfigDto> getConfig(
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerCertificateConfigService.resolveForBatch(instituteId, packageSessionId,
                user != null ? user.getUserId() : null));
    }

    /**
     * Where the authenticated learner stands against the course's certificate rule:
     * progress and, for a test-score rule, each quiz/assessment that counts with their
     * best result. userId is JWT-derived, so a learner only ever sees their own.
     */
    @GetMapping("/eligibility")
    public ResponseEntity<CertificateEligibilityDto> getEligibility(
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerCertificateConfigService
                .eligibilityFor(instituteId, packageSessionId, user.getUserId()));
    }
}
