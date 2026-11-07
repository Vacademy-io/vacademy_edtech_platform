package vacademy.io.admin_core_service.features.packages.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailDTO;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.service.LearnerPackageService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/learner-packages/v1")
public class LearnerPackageDetailController {

    @Autowired
    private LearnerPackageService learnerPackageService;

    @PostMapping("/search")
    @ClientCacheable(maxAgeSeconds = 60, scope = CacheScope.PRIVATE, varyHeaders = { "X-Institute-Id", "X-User-Id" })
    public ResponseEntity<Page<PackageDetailDTO>> getLearnerPackages(
            @RequestBody LearnerPackageFilterDTO filterDTO,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int page,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int size) {
        String authUserId = org.springframework.util.StringUtils.hasText(user.getUserId()) ? user.getUserId()
                : user.getId();
        // Shipping and deposits are enrolments only so they flow through the payment plumbing;
        // the learner never studies them. The admin endpoint below still lists them.
        filterDTO.setExcludeChargePackages(true);
        Page<PackageDetailDTO> result = learnerPackageService.getLearnerPackageDetail(filterDTO, authUserId,
                instituteId, page, size);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/search-by-user-id")
    public ResponseEntity<Page<PackageDetailDTO>> getLearnerPackagesByUserId(
            @RequestBody LearnerPackageFilterDTO filterDTO,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("userId") String userId,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int page,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int size) {
        // Admin view: include INACTIVE enrollments by default so deactivated courses
        // still surface for an admin (tagged with enrollment_status). The learner-facing
        // /search endpoint keeps the ACTIVE-only default.
        //
        // Exception for the PROGRESS and COMPLETED buckets: those mean "live for this
        // learner right now", and a deactivated enrollment is already returned by the PAST
        // bucket (getPastLearnerPackages matches status INACTIVE). Defaulting them to
        // ACTIVE + INACTIVE would list the same course twice — once as in-progress or
        // completed, once as past. Defaulted here rather than left to each caller so the
        // behaviour holds for every consumer (the student side-view, the mentorship
        // mentee dialog, anything added later) without a coordinated frontend release.
        if (filterDTO.getStatus() == null || filterDTO.getStatus().isEmpty()) {
            String type = filterDTO.getType();
            boolean liveOnlyBucket = "PROGRESS".equalsIgnoreCase(type)
                    || "COMPLETED".equalsIgnoreCase(type);
            filterDTO.setStatus(liveOnlyBucket
                    ? List.of(LearnerSessionStatusEnum.ACTIVE.name())
                    : List.of(
                            LearnerSessionStatusEnum.ACTIVE.name(),
                            LearnerSessionStatusEnum.INACTIVE.name()));
        }
        Page<PackageDetailDTO> result = learnerPackageService.getLearnerPackageDetail(filterDTO, userId, instituteId,
                page, size);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/package-detail")
    @ClientCacheable(maxAgeSeconds = 120, scope = CacheScope.PUBLIC)
    public ResponseEntity<PackageDetailDTO> getPackageDetailById(@RequestParam("packageId") String packageId) {
        PackageDetailDTO result = learnerPackageService.getPackageDetailById(packageId);
        return ResponseEntity.ok(result);
    }
}
