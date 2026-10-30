package vacademy.io.admin_core_service.features.learner.controller.v2;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner.dto.v2.MultiPackageLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.service.MultiPackageLearnerEnrollService;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.exceptions.ForbiddenException;

/**
 * Public (no login) multi-item checkout: the learner storefront. A MANUAL enrollment skips
 * payment and forces it PAID, so it is refused here and only accepted on the admin endpoint
 * ({@link AdminMultiPackageLearnerEnrollController}), which needs an institute admin's login.
 */
@RestController
@RequestMapping("/admin-core-service/v2/learner/enroll")
public class MultiPackageLearnerEnrollController {

    @Autowired
    private MultiPackageLearnerEnrollService multiPackageLearnerEnrollService;

    @PostMapping
    public ResponseEntity<LearnerEnrollResponseDTO> enrollMultiPackage(
            @RequestBody MultiPackageLearnerEnrollRequestDTO request) {
        if ("MANUAL".equalsIgnoreCase(request.getEnrollmentType())) {
            throw new ForbiddenException("Manual enrollment needs an admin login");
        }
        return ResponseEntity.ok(multiPackageLearnerEnrollService.enrollMultiPackage(request));
    }
}
