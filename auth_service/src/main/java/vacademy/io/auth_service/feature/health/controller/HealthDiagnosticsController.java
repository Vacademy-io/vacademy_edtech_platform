package vacademy.io.auth_service.feature.health.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.health.controller.BaseHealthController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Health endpoints for auth-service.
 *
 * /ping, /db, /complete are inherited from BaseHealthController.
 * auth-service adds /connectivity/admin on top.
 */
@RestController
@RequestMapping("/auth-service/health")
public class HealthDiagnosticsController extends BaseHealthController {

    @Value("${admin.core.service.base_url:http://admin-core-service:8072}")
    private String adminCoreServiceUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    /** Inter-service connectivity check to admin-core-service */
    @GetMapping("/connectivity/admin")
    public ResponseEntity<Map<String, Object>> checkAdminConnectivity() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", "auth-service");
        response.put("target", "admin-core-service");
        response.put("timestamp", Instant.now());

        long start = System.currentTimeMillis();
        try {
            String url = adminCoreServiceUrl + "/admin-core-service/health/ping";
            ResponseEntity<String> result = restTemplate.getForEntity(url, String.class);
            long latency = System.currentTimeMillis() - start;
            response.put("status", result.getStatusCode().is2xxSuccessful() ? "OK" : "FAILED");
            response.put("latency_ms", latency);
            response.put("http_status", result.getStatusCode().value());
        } catch (Exception e) {
            response.put("status", "FAILED");
            response.put("latency_ms", System.currentTimeMillis() - start);
            response.put("error", e.getMessage());
        }
        return ResponseEntity.ok(response);
    }
}
