package vacademy.io.admin_core_service.features.institute_learner.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.AllStudentV2Response;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.LearnerExportJobDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.LearnerLocationFilterOptionsDTO;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerExportJobService;
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

    @Autowired
    private LearnerExportJobService learnerExportJobService;

    @PostMapping("/all")
    public ResponseEntity<AllStudentV2Response> getLinkedStudentsV2(
            @RequestAttribute(name = "user") CustomUserDetails user,
            @RequestBody StudentListFilter studentListFilter,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize) {
        return studentListManager.getLinkedStudentsV2(user, studentListFilter, pageNo, pageSize);
    }

    /**
     * Starts a background export of every learner matching the filters (the same body as
     * /all). Poll /export-jobs/{jobId}, then fetch /export-jobs/{jobId}/file when it is ready.
     */
    @PostMapping("/export-jobs")
    public ResponseEntity<LearnerExportJobDTO> startExportJob(
            @RequestAttribute(name = "user") CustomUserDetails user,
            @RequestBody StudentListFilter studentListFilter) {
        return ResponseEntity.ok(learnerExportJobService.start(user, studentListFilter));
    }

    @GetMapping("/export-jobs/{jobId}")
    public ResponseEntity<LearnerExportJobDTO> getExportJob(
            @RequestAttribute(name = "user") CustomUserDetails user,
            @PathVariable("jobId") String jobId) {
        return ResponseEntity.ok(learnerExportJobService.get(user, jobId));
    }

    /** The finished export: a gzipped JSON array of the same rows /all returns. */
    @GetMapping("/export-jobs/{jobId}/file")
    public ResponseEntity<byte[]> downloadExportJob(
            @RequestAttribute(name = "user") CustomUserDetails user,
            @PathVariable("jobId") String jobId) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "application/gzip")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(learnerExportJobService.download(user, jobId));
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
