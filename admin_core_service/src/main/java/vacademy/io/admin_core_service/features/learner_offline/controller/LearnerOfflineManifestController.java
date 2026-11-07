package vacademy.io.admin_core_service.features.learner_offline.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeySurface;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.WithoutAnswerKeys;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineManifestDTO;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineManifestService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Learner-facing offline manifest endpoint (offline plan, Part A2). Verifies
 * the requesting learner is actively enrolled in the package session before
 * returning the tree — see OfflineManifestService.
 */
@RestController
@RequestMapping("/admin-core-service/learner-offline/v1")
@RequiredArgsConstructor
public class LearnerOfflineManifestController {

    private final OfflineManifestService offlineManifestService;

    @WithoutAnswerKeys(AnswerKeySurface.LEARNER)
    @GetMapping("/manifest")
    public ResponseEntity<OfflineManifestDTO> getManifest(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("packageSessionId") String packageSessionId) {
        return ResponseEntity.ok(offlineManifestService.buildManifest(packageSessionId, user));
    }
}
