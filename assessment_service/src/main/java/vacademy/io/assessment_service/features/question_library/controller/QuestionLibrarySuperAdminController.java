package vacademy.io.assessment_service.features.question_library.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAccessDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAccessRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryActionResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryInstituteAccessDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTreeResponse;
import vacademy.io.assessment_service.features.question_library.service.QuestionLibrarySuperAdminService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

/**
 * Content Library for the platform portal: per institute, which courses and topics are
 * hidden from it (it sees everything else). Platform staff only (SUPER_ADMIN_USER_IDS), never institute admins.
 */
@RestController
@RequestMapping("/assessment-service/super-admin/v1/content-library")
public class QuestionLibrarySuperAdminController {

    @Autowired
    private QuestionLibrarySuperAdminService superAdminService;

    @GetMapping("/tree")
    public ResponseEntity<LibraryTreeResponse> tree(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(superAdminService.tree());
    }

    @GetMapping("/institutes/{instituteId}")
    public ResponseEntity<LibraryInstituteAccessDto> accessOf(@RequestAttribute("user") CustomUserDetails user,
                                                              @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(superAdminService.accessOf(instituteId));
    }

    /** Hides a course or topic, with everything below it. Body: node_id. */
    @PostMapping("/institutes/{instituteId}/hide")
    public ResponseEntity<LibraryAccessDto> hide(@RequestAttribute("user") CustomUserDetails user,
                                                  @PathVariable("instituteId") String instituteId,
                                                  @RequestBody LibraryAccessRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(superAdminService.hide(user, instituteId, request == null ? null : request.getNodeId()));
    }

    /** Shows a hidden course or topic again. Body: node_id. */
    @PostMapping("/institutes/{instituteId}/show")
    public ResponseEntity<LibraryActionResponse> show(@RequestAttribute("user") CustomUserDetails user,
                                                        @PathVariable("instituteId") String instituteId,
                                                        @RequestBody LibraryAccessRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(superAdminService.show(instituteId, request == null ? null : request.getNodeId()));
    }
}
