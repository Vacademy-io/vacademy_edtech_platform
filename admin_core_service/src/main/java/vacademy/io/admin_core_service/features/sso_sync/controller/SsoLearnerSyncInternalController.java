package vacademy.io.admin_core_service.features.sso_sync.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.sso_sync.dto.SsoLearnerSyncRequest;
import vacademy.io.admin_core_service.features.sso_sync.dto.SsoLearnerSyncResponse;
import vacademy.io.admin_core_service.features.sso_sync.service.SsoLearnerSyncService;

/** auth-service → admin-core (HMAC), at each single sign-on. */
@RestController
@RequestMapping("/admin-core-service/internal/v1/sso")
public class SsoLearnerSyncInternalController {

    private final SsoLearnerSyncService syncService;

    public SsoLearnerSyncInternalController(SsoLearnerSyncService syncService) {
        this.syncService = syncService;
    }

    @PostMapping("/learner-sync")
    public ResponseEntity<SsoLearnerSyncResponse> sync(@RequestBody SsoLearnerSyncRequest request) {
        return ResponseEntity.ok(syncService.sync(request));
    }
}
