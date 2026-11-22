package vacademy.io.community_service.feature.diagnostics.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.community_service.feature.diagnostics.dto.InfrastructureHealthResponse;
import vacademy.io.community_service.feature.diagnostics.service.DiagnosticsService;

/**
 * Infrastructure Diagnostics Controller
 * 
 * Placed in community-service intentionally so it remains accessible
 * even when critical services like admin-core or auth are down.
 * 
 * Provides comprehensive health and status information for:
 * - Kubernetes infrastructure (Ingress, cert-manager, Calico, Load Balancer)
 * - Application services (auth, admin, media, assessment, notification)
 * - Dependencies (Redis, PostgreSQL)
 * - Inter-service connectivity matrix
 *
 * /health and /health/quick stay open for the health dashboard; the detailed views
 * (pods, events, connectivity, database, redis) are for platform super admins.
 */
@RestController
@RequestMapping("/community-service/diagnostics")
public class DiagnosticsController {

    @Autowired
    private DiagnosticsService diagnosticsService;

    /**
     * Get complete infrastructure health status
     * This is the main endpoint for the health dashboard
     * 
     * @return Complete infrastructure health including K8s, services, dependencies
     */
    @GetMapping("/health")
    public ResponseEntity<InfrastructureHealthResponse> getInfrastructureHealth() {
        return ResponseEntity.ok(diagnosticsService.getInfrastructureHealth());
    }

    /**
     * Quick health check - lightweight endpoint
     * Returns just UP/DOWN for critical components with response times
     */
    @GetMapping("/health/quick")
    public ResponseEntity<Object> getQuickHealth() {
        return ResponseEntity.ok(diagnosticsService.getQuickHealth());
    }

    /**
     * Get detailed Kubernetes pod status for all namespaces
     * Includes: ingress-nginx, cert-manager, kube-system, default
     */
    @GetMapping("/kubernetes/pods")
    public ResponseEntity<Object> getKubernetesPodStatus(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(diagnosticsService.getKubernetesPodStatus());
    }

    /**
     * Get inter-service connectivity status
     * Tests: auth↔admin, admin↔media, admin↔assessment, etc.
     */
    @GetMapping("/connectivity")
    public ResponseEntity<Object> getConnectivityStatus(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(diagnosticsService.getConnectivityStatus());
    }

    /**
     * Get recent Kubernetes events (warnings/errors only)
     * Useful for diagnosing recent issues
     */
    @GetMapping("/kubernetes/events")
    public ResponseEntity<Object> getKubernetesEvents(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(diagnosticsService.getRecentEvents());
    }

    /**
     * Get database connectivity status for all services
     */
    @GetMapping("/database")
    public ResponseEntity<Object> getDatabaseHealth(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(diagnosticsService.getDatabaseHealth());
    }

    /**
     * Get Redis health and stats
     */
    @GetMapping("/redis")
    public ResponseEntity<Object> getRedisHealth(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(diagnosticsService.getRedisHealth());
    }
}
