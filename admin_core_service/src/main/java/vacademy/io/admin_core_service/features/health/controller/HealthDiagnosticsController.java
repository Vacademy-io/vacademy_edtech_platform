package vacademy.io.admin_core_service.features.health.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.health.controller.BaseHealthController;
import vacademy.io.common.health.dto.HealthDbResponse;

import javax.sql.DataSource;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Health endpoints for admin-core-service.
 *
 * Inherits from BaseHealthController:
 * GET /admin-core-service/health/ping → ping + JVM metrics
 * GET /admin-core-service/health/db → master DB pool breakdown
 * GET /admin-core-service/health/complete → aggregated health
 *
 * Added here:
 * GET /admin-core-service/health/db/read-replica → read-replica pool breakdown
 * GET /admin-core-service/health/connectivity/* → inter-service mesh checks
 */
@RestController
@RequestMapping("/admin-core-service/health")
public class HealthDiagnosticsController extends BaseHealthController {

    @Autowired
    @Qualifier("slaveDataSource")
    private DataSource replicaDataSource;

    @Value("${auth.server.baseurl:http://auth-service:8071}")
    private String authServiceUrl;

    @Value("${media.server.baseurl:http://media-service:8075}")
    private String mediaServiceUrl;

    @Value("${assessment.server.baseurl:http://assessment-service:8074}")
    private String assessmentServiceUrl;

    @Value("${notification.server.baseurl:http://notification-service:8076}")
    private String notificationServiceUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    // ── Read Replica ──────────────────────────────────────────────────────────

    @GetMapping("/db/read-replica")
    public ResponseEntity<HealthDbResponse> getReplicaHealth() {
        return ResponseEntity.ok(healthService.checkReplicaDb(replicaDataSource));
    }

    // ── Connectivity ──────────────────────────────────────────────────────────

    @GetMapping("/connectivity/auth")
    public ResponseEntity<Map<String, Object>> checkAuthConnectivity() {
        return ResponseEntity.ok(ping("auth-service", authServiceUrl + "/auth-service/health/ping"));
    }

    @GetMapping("/connectivity/media")
    public ResponseEntity<Map<String, Object>> checkMediaConnectivity() {
        return ResponseEntity.ok(ping("media-service", mediaServiceUrl + "/media-service/health/ping"));
    }

    @GetMapping("/connectivity/assessment")
    public ResponseEntity<Map<String, Object>> checkAssessmentConnectivity() {
        return ResponseEntity.ok(ping("assessment-service", assessmentServiceUrl + "/assessment-service/health/ping"));
    }

    @GetMapping("/connectivity/notification")
    public ResponseEntity<Map<String, Object>> checkNotificationConnectivity() {
        return ResponseEntity
                .ok(ping("notification-service", notificationServiceUrl + "/notification-service/health/ping"));
    }

    /** Result map consumed by DiagnosticsService in community-service */
    @GetMapping("/connectivity/all")
    public ResponseEntity<Map<String, Object>> checkAllConnectivity() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", "admin-core-service");
        response.put("timestamp", Instant.now());
        response.put("auth_service", ping("auth-service", authServiceUrl + "/auth-service/health/ping"));
        response.put("media_service", ping("media-service", mediaServiceUrl + "/media-service/health/ping"));
        response.put("assessment_service",
                ping("assessment-service", assessmentServiceUrl + "/assessment-service/health/ping"));
        response.put("notification_service",
                ping("notification-service", notificationServiceUrl + "/notification-service/health/ping"));
        return ResponseEntity.ok(response);
    }

    private Map<String, Object> ping(String target, String url) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source", "admin-core-service");
        m.put("target", target);
        m.put("timestamp", Instant.now());
        long start = System.currentTimeMillis();
        try {
            ResponseEntity<String> res = restTemplate.getForEntity(url, String.class);
            m.put("status", res.getStatusCode().is2xxSuccessful() ? "OK" : "FAILED");
            m.put("latency_ms", System.currentTimeMillis() - start);
            m.put("http_status", res.getStatusCode().value());
        } catch (Exception e) {
            m.put("status", "FAILED");
            m.put("latency_ms", System.currentTimeMillis() - start);
            m.put("error", e.getMessage());
        }
        return m;
    }
}
