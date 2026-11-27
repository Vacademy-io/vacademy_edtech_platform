package vacademy.io.admin_core_service.features.one_off_due.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.one_off_due.dto.LearnerOneOffDuesDTO;
import vacademy.io.admin_core_service.features.one_off_due.dto.OneOffDueCancelRequestDTO;
import vacademy.io.admin_core_service.features.one_off_due.dto.OneOffDueDTO;
import vacademy.io.admin_core_service.features.one_off_due.dto.OneOffDueRequestDTO;
import vacademy.io.admin_core_service.features.one_off_due.entity.OneOffDue;
import vacademy.io.admin_core_service.features.one_off_due.service.OneOffDueService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

/**
 * One-off charges for a learner. Staff of the institute only: no root-user
 * bypass (learners can carry the root flag), platform super admins allowed. The clientId header
 * must equal the institute id.
 */
@RestController
@RequestMapping("/admin-core-service/v1/one-off-dues")
@RequiredArgsConstructor
public class OneOffDueController {

    private final OneOffDueService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/learner/{userId}")
    public ResponseEntity<LearnerOneOffDuesDTO> forLearner(@PathVariable String userId,
                                                           @RequestParam String instituteId,
                                                           @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        return ResponseEntity.ok(service.forStaff(userId, instituteId));
    }

    @PostMapping
    @Auditable(entityType = "INVOICE", action = "CREATE", entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'added a one-off charge for learner ' + #request?.userId")
    public ResponseEntity<OneOffDueDTO> create(@RequestParam String instituteId,
                                               @RequestBody OneOffDueRequestDTO request,
                                               @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        if (request == null) throw new VacademyException("Request body is required.");
        String id = service.create(instituteId, request.getUserId(), request.getPackageSessionId(),
                request.getAmount(), request.getDueDate(), request.getTitle(), request.getNote(),
                OneOffDue.SOURCE_MANUAL, null, user);
        return ResponseEntity.ok(service.forStaff(request.getUserId(), instituteId).getDues().stream()
                .filter(d -> d.getId().equals(id)).findFirst()
                .orElseGet(() -> OneOffDueDTO.builder().id(id).build()));
    }

    @PostMapping("/{id}/cancel")
    @Auditable(entityType = "INVOICE", action = "CANCEL", entityIdExpr = "#id",
            descriptionExpr = "'cancelled one-off charge ' + #id")
    public ResponseEntity<OneOffDueDTO> cancel(@PathVariable String id,
                                               @RequestParam String instituteId,
                                               @RequestBody(required = false) OneOffDueCancelRequestDTO request,
                                               @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        return ResponseEntity.ok(service.cancel(id, instituteId, request == null ? null : request.getReason(), user));
    }
}
