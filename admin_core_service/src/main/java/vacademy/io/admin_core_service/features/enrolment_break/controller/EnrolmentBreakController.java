package vacademy.io.admin_core_service.features.enrolment_break.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.enrolment_break.dto.BreakPreviewDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakEndRequestDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakRequestDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakUpdateDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.LearnerBreaksDTO;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Breaks and holds for a learner (docs/ENROLMENT_BREAKS.md). Staff of the institute only. */
@RestController
@RequestMapping("/admin-core-service/v1/enrolment-breaks")
@RequiredArgsConstructor
public class EnrolmentBreakController {

    private final EnrolmentBreakService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/learner/{userId}")
    public ResponseEntity<LearnerBreaksDTO> forLearner(@PathVariable String userId,
                                                       @RequestParam String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.forLearner(userId, instituteId));
    }

    /** What a new break would do. Saves nothing. */
    @PostMapping("/preview")
    public ResponseEntity<BreakPreviewDTO> preview(@RequestParam String instituteId,
                                                   @RequestBody EnrolmentBreakRequestDTO request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.preview(request, instituteId));
    }

    @PostMapping
    @Auditable(entityType = "LEARNER", action = "ACCESS_CHANGE", entityIdExpr = "#request?.userId",
            descriptionExpr = "'started a ' + (#request?.kind == 'PAUSE' ? 'pause' : 'reminder hold') + ' for learner ' + #request?.userId")
    public ResponseEntity<EnrolmentBreakDTO> create(@RequestParam String instituteId,
                                                    @RequestBody EnrolmentBreakRequestDTO request,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.create(request, instituteId, user));
    }

    @PutMapping("/{id}")
    @Auditable(entityType = "LEARNER", action = "ACCESS_CHANGE", entityIdExpr = "#id",
            descriptionExpr = "'changed break ' + #id")
    public ResponseEntity<EnrolmentBreakDTO> update(@PathVariable String id,
                                                    @RequestParam String instituteId,
                                                    @RequestBody EnrolmentBreakUpdateDTO request,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.update(id, request, instituteId, user));
    }

    /** What resuming now would change. Saves nothing. */
    @PostMapping("/{id}/end/preview")
    public ResponseEntity<BreakPreviewDTO> endPreview(@PathVariable String id,
                                                      @RequestParam String instituteId,
                                                      @RequestBody(required = false) EnrolmentBreakEndRequestDTO request,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.endPreview(id, request, instituteId));
    }

    @PostMapping("/{id}/end")
    @Auditable(entityType = "LEARNER", action = "ACCESS_CHANGE", entityIdExpr = "#id",
            descriptionExpr = "'resumed break ' + #id")
    public ResponseEntity<EnrolmentBreakDTO> end(@PathVariable String id,
                                                 @RequestParam String instituteId,
                                                 @RequestBody(required = false) EnrolmentBreakEndRequestDTO request,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.end(id, request, instituteId, user));
    }

    @PostMapping("/{id}/cancel")
    @Auditable(entityType = "LEARNER", action = "ACCESS_CHANGE", entityIdExpr = "#id",
            descriptionExpr = "'cancelled break ' + #id")
    public ResponseEntity<EnrolmentBreakDTO> cancel(@PathVariable String id,
                                                    @RequestParam String instituteId,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(service.cancel(id, instituteId, user));
    }
}
