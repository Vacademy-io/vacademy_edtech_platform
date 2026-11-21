package vacademy.io.admin_core_service.features.learner.controller.v2;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.MultiPackageLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.service.MultiPackageLearnerEnrollService;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

/**
 * Admin multi-item enrollment (the admin wizard: side panel → Enroll → Buy / Rent Books,
 * Membership), which sends {@code enrollment_type = MANUAL}: payment is skipped and forced PAID.
 * Not on the public path list, so Spring Security requires a login; on top of that the caller
 * must be an ADMIN of the request's institute, and every item's invite must belong to that
 * institute — the enrollment follows the invite's institute, so a foreign invite would let an
 * admin of one institute enroll learners free into another's courses.
 */
@RestController
@RequestMapping("/admin-core-service/v2/admin/learner/enroll")
public class AdminMultiPackageLearnerEnrollController {

    @Autowired
    private MultiPackageLearnerEnrollService multiPackageLearnerEnrollService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @PostMapping
    public ResponseEntity<LearnerEnrollResponseDTO> enrollMultiPackage(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody MultiPackageLearnerEnrollRequestDTO request) {
        instituteAccessValidator.requireInstituteAdmin(user, request.getInstituteId());
        requireInvitesOfInstitute(request);
        return ResponseEntity.ok(multiPackageLearnerEnrollService.enrollMultiPackage(request));
    }

    private void requireInvitesOfInstitute(MultiPackageLearnerEnrollRequestDTO request) {
        if (request.getLearnerPackageSessionEnrollments() == null) {
            return;
        }
        for (LearnerPackageSessionEnrollmentItemDTO item : request.getLearnerPackageSessionEnrollments()) {
            if (!StringUtils.hasText(item.getEnrollInviteId())) {
                continue;
            }
            String inviteInstituteId = enrollInviteRepository.findById(item.getEnrollInviteId())
                    .map(EnrollInvite::getInstituteId)
                    .orElse(null);
            if (StringUtils.hasText(inviteInstituteId) && !inviteInstituteId.equals(request.getInstituteId())) {
                throw new ForbiddenException("Access denied: enrollment link belongs to another institute");
            }
        }
    }
}
