package vacademy.io.admin_core_service.features.institute_learner.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.AllStudentV2Response;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.LearnerLocationFilterOptionsDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.StudentListFilter;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentListManager;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerLocationFilterService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;

import static vacademy.io.common.auth.config.PageConstants.DEFAULT_PAGE_NUMBER;

@RestController
@RequestMapping("/admin-core-service/institute/institute_learner/get/v2")
public class StudentGetV2Controller {

    @Autowired
    private StudentListManager studentListManager;

    @Autowired
    private LearnerLocationFilterService learnerLocationFilterService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    @PostMapping("/all")
    public ResponseEntity<AllStudentV2Response> getLinkedStudentsV2(
            @RequestAttribute(name = "user") CustomUserDetails user,
            @RequestBody StudentListFilter studentListFilter,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        return studentListManager.getLinkedStudentsV2(user, studentListFilter, pageNo, pageSize);
    }

    /** Values for the learner-list City and Region filters. Staff of the institute only. */
    @GetMapping("/location-filter-options")
    public ResponseEntity<LearnerLocationFilterOptionsDTO> getLocationFilterOptions(
            @RequestAttribute(name = "user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(learnerLocationFilterService.getOptions(instituteId));
    }
}
