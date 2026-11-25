package vacademy.io.admin_core_service.features.learner.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerBatchDetail;
import vacademy.io.admin_core_service.features.learner.dto.LearnerDetailsDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerDetailsEditDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerPaymentPlanStatusDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileCustomFieldDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileCustomFieldValueDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileUpdateRequestDTO;
import vacademy.io.admin_core_service.features.learner.manager.LearnerProfileManager;
import vacademy.io.admin_core_service.features.learner.manager.LearnerProfileUpdateManager;
import vacademy.io.admin_core_service.features.learner.service.LearnerProfileCustomFieldService;
import vacademy.io.admin_core_service.features.learner.service.LearnerService;
import vacademy.io.admin_core_service.features.learner.service.LearnerUserPlanService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/learner/info/v1")
public class LearnerUserInfoController {

    @Autowired
    LearnerProfileManager learnerProfileManager;

    @Autowired
    private LearnerService learnerService;

    @Autowired
    private LearnerUserPlanService learnerUserPlanService;

    @Autowired
    private LearnerProfileUpdateManager learnerProfileUpdateManager;

    @Autowired
    private LearnerProfileCustomFieldService learnerProfileCustomFieldService;

    @GetMapping("/details")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PRIVATE, varyHeaders = {"X-Institute-Id", "X-User-Id"})
    public ResponseEntity<List<StudentDTO>> getLearnerInfo(@RequestAttribute("user") CustomUserDetails user, @RequestParam("instituteId") String instituteId) {

        return learnerProfileManager.getLearnerInfo(user, instituteId);
    }


    @PutMapping("/edit")
    public ResponseEntity<String> editLearnerDetails(@RequestBody LearnerDetailsEditDTO learnerDetailsEditDTO,
                                                     @RequestAttribute("user") CustomUserDetails user) {

        return ResponseEntity.ok(learnerService.editLearnerDetails(learnerDetailsEditDTO, user));

    }

    @PutMapping("/edit-face-file")
    public ResponseEntity<String> editFaceFile(@RequestParam String faceFileId,
                                               @RequestAttribute("user") CustomUserDetails user) {

        return ResponseEntity.ok(learnerService.updateFaceFileId(faceFileId, user));

    }

    @GetMapping("/learner-details")
    public ResponseEntity<List<LearnerDetailsDTO>> getLearnerDetails(@RequestParam("packageSessionId") String packageSessionId, @RequestParam("instituteId") String instituteId, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerService.getStudentsByPackageSessionId(packageSessionId, instituteId, user));
    }

    @GetMapping("/batch-details")
    public ResponseEntity<LearnerBatchDetail> getBatchDetails(@RequestParam("packageSessionId") String packageSessionId, @RequestParam("instituteId") String instituteId, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerProfileManager.getLearnerBatchDetail(user, packageSessionId, instituteId));
    }

    @GetMapping("user-plan-status")
    public ResponseEntity<LearnerPaymentPlanStatusDTO> getUserPlanStatus(@RequestParam("packageSessionId") String packageSessionId, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(learnerUserPlanService.getUserPaymentPlanStatus(packageSessionId, user));
    }

    @PutMapping("/profile")
    public ResponseEntity<String> updateLearnerProfile(@RequestBody LearnerProfileUpdateRequestDTO request,
                                                     @RequestAttribute("user") CustomUserDetails actor) {
        learnerProfileUpdateManager.updateLearnerProfile(request, actor);
        return ResponseEntity.ok("Done");
    }

    /** The signed-in learner's own custom fields (School, Roll No…) for their profile page. Not cached: they edit these. */
    @GetMapping("/custom-fields")
    public ResponseEntity<List<LearnerProfileCustomFieldDTO>> getProfileCustomFields(@RequestAttribute("user") CustomUserDetails user,
                                                                                  @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(learnerProfileCustomFieldService.getProfileFields(user.getUserId(), instituteId));
    }

    /** Saves the signed-in learner's own values for fields on their profile; returns the refreshed list. */
    @PutMapping("/custom-fields")
    public ResponseEntity<List<LearnerProfileCustomFieldDTO>> saveProfileCustomFields(@RequestAttribute("user") CustomUserDetails user,
                                                                                   @RequestParam("instituteId") String instituteId,
                                                                                   @RequestBody List<LearnerProfileCustomFieldValueDTO> values) {
        return ResponseEntity.ok(learnerProfileCustomFieldService.saveProfileFields(user.getUserId(), instituteId, values));
    }

}
