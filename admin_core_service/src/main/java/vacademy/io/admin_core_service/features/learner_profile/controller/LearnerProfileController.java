package vacademy.io.admin_core_service.features.learner_profile.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_profile.dto.LearnerProfileSignalDto;
import vacademy.io.admin_core_service.features.learner_profile.service.LearnerProfileService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * What the Student AI has learned about a learner, for staff of the learner's institute.
 *
 *   GET  /learner-profile/v1/users/{userId}/signals      observations, newest first
 *   POST /learner-profile/v1/signals/{signalId}/dismiss  hide a wrong one
 *
 * Institute is the clientId header, after checking the caller is staff there (no root bypass):
 * these are observations about a (usually minor) learner and must never reach a learner,
 * a parent or another institute.
 */
@RestController
@RequestMapping("/admin-core-service/learner-profile/v1")
@RequiredArgsConstructor
public class LearnerProfileController {

    private final LearnerProfileService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/users/{userId}/signals")
    public ResponseEntity<List<LearnerProfileSignalDto>> signals(
            HttpServletRequest request,
            @PathVariable String userId,
            @RequestParam(defaultValue = "false") boolean includeDismissed) {
        String instituteId = requireInstituteStaff(request);
        return ResponseEntity.ok(service.signals(instituteId, userId, includeDismissed));
    }

    @PostMapping("/signals/{signalId}/dismiss")
    public ResponseEntity<Void> dismiss(HttpServletRequest request, @PathVariable long signalId) {
        String instituteId = requireInstituteStaff(request);
        Object user = request.getAttribute("user");
        String by = user instanceof CustomUserDetails details ? details.getUserId() : null;
        return service.dismiss(instituteId, signalId, by)
                ? ResponseEntity.noContent().build()
                : ResponseEntity.notFound().build();
    }

    private String requireInstituteStaff(HttpServletRequest request) {
        String instituteId = request.getHeader("clientId");
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Missing clientId header");
        }
        Object user = request.getAttribute("user");
        instituteAccessValidator.requireInstituteStaff(
                user instanceof CustomUserDetails details ? details : null, instituteId);
        return instituteId;
    }
}
