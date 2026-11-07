package vacademy.io.admin_core_service.features.institute_learner.controller;

import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountPermissionService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDTO;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.notification.LearnerEnrollmentNotificationService;
import vacademy.io.admin_core_service.features.institute_learner.service.AdminDirectEnrollService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;

import java.util.Collections;

@RestController
@RequestMapping("/admin-core-service/institute/institute_learner/v1")
public class InstituteStudentController {

    @Autowired
    private StudentRegistrationManager studentRegistrationManager;

    @Autowired
    private LearnerEnrollmentNotificationService learnerEnrollmentNotificationService;

    @Autowired
    private AdminDirectEnrollService adminDirectEnrollService;

    @Autowired
    private AdminDiscountPermissionService adminDiscountPermissionService;

    // Add User to Institute
    @PostMapping("/add-institute_learner")
    @Auditable(
            entityType = "LEARNER",
            action = "ENROLL",
            descriptionExpr = "@auditNarrator.enrollmentOf('enrolled', "
                    + "#instituteStudentDTO?.userDetails?.fullName ?: #instituteStudentDTO?.userDetails?.email, "
                    + "{#instituteStudentDTO?.instituteStudentDetails?.packageSessionId})")
    public ResponseEntity<String> addStudentToInstitute(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "notify", required = false, defaultValue = "true") boolean notify,
            @RequestBody InstituteStudentDTO instituteStudentDTO) {
        InstituteStudentDTO instituteStudentDTO1 = studentRegistrationManager.addStudentToInstitute(user,
                instituteStudentDTO, null);
        if (notify) {
            learnerEnrollmentNotificationService.sendLearnerEnrollmentNotification(
                    Collections.singletonList(instituteStudentDTO),
                    instituteStudentDTO.getInstituteStudentDetails().getInstituteId());
        }
        return ResponseEntity.ok("Student added successfully.");
    }

    @PostMapping("/learner/enroll")
    @Auditable(
            entityType = "LEARNER",
            action = "ENROLL",
            descriptionExpr = "@auditNarrator.enrollmentOf('enrolled', "
                    + "#request?.user?.fullName ?: #request?.user?.email, "
                    + "#request?.learnerPackageSessionEnroll?.packageSessionIds)")
    public ResponseEntity<LearnerEnrollResponseDTO> adminEnrollLearner(
            @RequestAttribute("user") CustomUserDetails admin,
            @RequestBody LearnerEnrollRequestDTO request) {
        // Only roles allowed to by Display Settings (learnerManagement.canApplyDiscounts).
        if (request.getLearnerPackageSessionEnroll() != null
                && AdminDiscountService.isRequested(request.getLearnerPackageSessionEnroll().getAdminDiscount())) {
            adminDiscountPermissionService.requireCanApplyDiscounts(admin, request.getInstituteId());
        }
        return ResponseEntity.ok(adminDirectEnrollService.adminEnrollLearner(request, admin));
    }

}
