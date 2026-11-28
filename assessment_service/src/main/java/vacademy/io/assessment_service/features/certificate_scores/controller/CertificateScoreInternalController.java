package vacademy.io.assessment_service.features.certificate_scores.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.certificate_scores.dto.CertificateScoreRequest;
import vacademy.io.assessment_service.features.certificate_scores.dto.CertificateScoreRow;
import vacademy.io.assessment_service.features.certificate_scores.service.CertificateScoreService;

import java.util.List;

/**
 * Best final marks per learner per assessment, for admin_core's course certificate
 * criteria. Internal (HMAC) only - it sits under {@code /internal/**}.
 *
 * <p>POST rather than GET because a whole batch of learner ids does not fit in a
 * query string. Read-only.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/assessment-service/internal/certificate/v1")
public class CertificateScoreInternalController {

    private final CertificateScoreService certificateScoreService;

    @PostMapping("/learner-scores")
    public ResponseEntity<List<CertificateScoreRow>> learnerScores(@RequestBody CertificateScoreRequest request) {
        if (request == null) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(certificateScoreService.bestScores(request.getUserIds(), request.getAssessmentIds()));
    }
}
