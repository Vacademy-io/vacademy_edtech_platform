package vacademy.io.community_service.feature.diagnostics.service;

import io.kubernetes.client.openapi.ApiClient;
import io.kubernetes.client.openapi.ApiException;
import io.kubernetes.client.openapi.Configuration;
import io.kubernetes.client.openapi.apis.CoreV1Api;
import io.kubernetes.client.openapi.apis.AppsV1Api;
import io.kubernetes.client.openapi.models.*;
import io.kubernetes.client.util.Config;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import vacademy.io.community_service.feature.diagnostics.dto.InfrastructureHealthResponse;
import vacademy.io.community_service.feature.diagnostics.dto.InfrastructureHealthResponse.*;

import jakarta.annotation.PostConstruct;
import javax.sql.DataSource;
import java.io.IOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/**
 * Diagnostics Service - Provides comprehensive infrastructure health monitoring
 * 
 * This service queries:
 * 1. Kubernetes API for pod/deployment status
 * 2. All application services for health checks
 * 3. Redis for connectivity
 * 4. PostgreSQL for database health
 * 5. Inter-service connectivity
 */
@Slf4j
@Service
public class DiagnosticsService {

    @Value("${REDIS_HOST:redis}")
    private String redisHost;

    @Value("${REDIS_PORT:6379}")
    private int redisPort;

    @Autowired
    private DataSource dataSource;

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    private RestTemplate restTemplate;

    private CoreV1Api coreV1Api;
    private AppsV1Api appsV1Api;
    private boolean k8sAvailable = false;

    @PostConstruct
    public void init() {

        // Initialize Kubernetes client (works when running in-cluster)
        try {
            ApiClient client = Config.fromCluster();
            client.setReadTimeout(10000);
            Configuration.setDefaultApiClient(client);
            this.coreV1Api = new CoreV1Api();
            this.appsV1Api = new AppsV1Api();
            this.k8sAvailable = true;
            log.info("Kubernetes API client initialized successfully");
        } catch (IOException e) {
            log.warn("Running outside Kubernetes cluster, K8s features disabled: {}", e.getMessage());
            this.k8sAvailable = false;
        }

        // Initialize RestTemplate with timeout
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3000);
        factory.setReadTimeout(3000);
        this.restTemplate = new RestTemplate(factory);
    }

    /**
     * Get complete infrastructure health
     */
    public InfrastructureHealthResponse getInfrastructureHealth() {
        Instant start = Instant.now();

        // Run all checks in parallel
        // Run checks
        CompletableFuture<KubernetesInfrastructure> k8sFuture = CompletableFuture
                .supplyAsync(this::getKubernetesInfrastructure);
        CompletableFuture<DependencyHealth> depsFuture = CompletableFuture.supplyAsync(this::checkDependencies);
        CompletableFuture<List<KubernetesEvent>> eventsFuture = CompletableFuture
                .supplyAsync(this::getRecentKubernetesEvents);

        // Services and Connectivity are now static/client-side focused, no need for
        // async fetch
        // Services check (now async)
        CompletableFuture<List<ServiceHealth>> servicesFuture = CompletableFuture.supplyAsync(this::checkAllServices);

        List<ConnectivityCheck> connectivity = checkConnectivity();

        // Wait for async checks
        CompletableFuture.allOf(k8sFuture, depsFuture, eventsFuture, servicesFuture).join();

        KubernetesInfrastructure k8sHealth = k8sFuture.join();
        DependencyHealth deps = depsFuture.join();
        List<KubernetesEvent> events = eventsFuture.join();
        List<ServiceHealth> services = servicesFuture.join();

        // Determine overall status
        String overallStatus = determineOverallStatus(k8sHealth, services, deps, connectivity);

        return InfrastructureHealthResponse.builder()
                .timestamp(Instant.now())
                .overallStatus(overallStatus)
                .kubernetesInfrastructure(k8sHealth)
                .applicationServices(services)
                .dependencies(deps)
                .connectivityMatrix(connectivity)
                .recentEvents(events)
                .build();
    }

    /**
     * Quick health check - lightweight
     */
    public Map<String, Object> getQuickHealth() {
        Map<String, Object> health = new LinkedHashMap<>();
        health.put("timestamp", Instant.now());

        // Check services quickly
        // Return service configurations for frontend to check
        Map<String, Object> services = new LinkedHashMap<>();
        services.put("auth-service", createQuickServiceConfig("/auth-service/actuator/health"));
        services.put("admin-core-service", createQuickServiceConfig("/admin-core-service/actuator/health"));
        services.put("media-service", createQuickServiceConfig("/media-service/actuator/health"));
        services.put("assessment-service", createQuickServiceConfig("/assessment-service/actuator/health"));
        services.put("notification-service", createQuickServiceConfig("/notification-service/actuator/health"));

        // Community service is UP (we are here)
        services.put("community-service", Map.of(
                "status", "UP",
                "response_time_ms", 0,
                "public_endpoint", "/community-service/actuator/health"));

        health.put("services", services);

        // Check Redis
        health.put("redis", checkRedisQuick());

        // Check Database
        health.put("database", checkDatabaseQuick());

        // Overall
        // Overall status depends on local dependencies (services are checked
        // client-side)
        @SuppressWarnings("unchecked")
        Map<String, Object> redisHealth = (Map<String, Object>) health.get("redis");
        @SuppressWarnings("unchecked")
        Map<String, Object> dbHealth = (Map<String, Object>) health.get("database");

        boolean redisUp = "UP".equals(redisHealth.get("status"));
        boolean dbUp = "UP".equals(dbHealth.get("status"));

        health.put("overall_status", (redisUp && dbUp) ? "HEALTHY" : "DEGRADED");

        return health;
    }

    /**
     * Get Kubernetes pod status
     */
    public Map<String, Object> getKubernetesPodStatus() {
        Map<String, Object> result = new LinkedHashMap<>();

        if (!k8sAvailable) {
            result.put("status", "K8S_UNAVAILABLE");
            result.put("message", "Running outside Kubernetes cluster");
            return result;
        }

        try {
            // Get pods from all relevant namespaces
            result.put("default", getPodsInNamespace("default"));
            result.put("ingress-nginx", getPodsInNamespace("ingress-nginx"));
            result.put("cert-manager", getPodsInNamespace("cert-manager"));
            result.put("kube-system", getPodsInNamespace("kube-system"));
        } catch (ApiException e) {
            log.error("Failed to get K8s pods: {}", e.getMessage());
            result.put("error", e.getMessage());
        }

        return result;
    }

    /**
     * Get connectivity status between services
     */
    public List<ConnectivityCheck> getConnectivityStatus() {
        return checkConnectivity();
    }

    /**
     * Get recent Kubernetes events
     */
    public List<KubernetesEvent> getRecentEvents() {
        return getRecentKubernetesEvents();
    }

    /**
     * Get database health
     */
    public Map<String, Object> getDatabaseHealth() {
        Map<String, Object> result = new LinkedHashMap<>();

        try {
            long start = System.currentTimeMillis();
            try (Connection conn = dataSource.getConnection()) {
                boolean valid = conn.isValid(5);
                long responseTime = System.currentTimeMillis() - start;

                result.put("status", valid ? "UP" : "DOWN");
                result.put("connected", valid);
                result.put("response_time_ms", responseTime);
                result.put("database", conn.getCatalog());
                result.put("url", conn.getMetaData().getURL().replaceAll("password=.*?(&|$)", "password=***$1"));
            }
        } catch (SQLException e) {
            result.put("status", "DOWN");
            result.put("connected", false);
            result.put("error", e.getMessage());
        }

        return result;
    }

    /**
     * Get Redis health
     */
    public Map<String, Object> getRedisHealth() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("host", redisHost);
        result.put("port", redisPort);

        if (redisTemplate == null) {
            result.put("status", "UNAVAILABLE");
            result.put("message", "Redis not configured");
            return result;
        }

        try {
            long start = System.currentTimeMillis();
            String pong = redisTemplate.getConnectionFactory().getConnection().ping();
            long responseTime = System.currentTimeMillis() - start;

            result.put("status", "PONG".equals(pong) ? "UP" : "DOWN");
            result.put("connected", true);
            result.put("response_time_ms", responseTime);
        } catch (Exception e) {
            result.put("status", "DOWN");
            result.put("connected", false);
            result.put("error", e.getMessage());
        }

        return result;
    }

    // ========== Private Helper Methods ==========

    private KubernetesInfrastructure getKubernetesInfrastructure() {
        if (!k8sAvailable) {
            return KubernetesInfrastructure.builder()
                    .ingressNginx(ComponentHealth.builder().status("UNKNOWN").build())
                    .certManager(ComponentHealth.builder().status("UNKNOWN").build())
                    .calicoNetwork(ComponentHealth.builder().status("UNKNOWN").build())
                    .coredns(ComponentHealth.builder().status("UNKNOWN").build())
                    .loadBalancer(LoadBalancerHealth.builder().status("UNKNOWN").build())
                    .build();
        }

        try {
            return KubernetesInfrastructure.builder()
                    .ingressNginx(getComponentHealth("ingress-nginx", "app.kubernetes.io/name=ingress-nginx"))
                    .certManager(getComponentHealth("cert-manager", "app.kubernetes.io/name=cert-manager"))
                    .calicoNetwork(getComponentHealth("kube-system", "k8s-app=calico-node"))
                    .coredns(getComponentHealth("kube-system", "k8s-app=kube-dns"))
                    .loadBalancer(getLoadBalancerHealth())
                    .build();
        } catch (Exception e) {
            log.error("Failed to get K8s infrastructure health: {}", e.getMessage());
            return KubernetesInfrastructure.builder()
                    .ingressNginx(ComponentHealth.builder().status("ERROR").build())
                    .build();
        }
    }

    private ComponentHealth getComponentHealth(String namespace, String labelSelector) {
        try {
            V1PodList podList = coreV1Api.listNamespacedPod(
                    namespace, null, null, null, null, labelSelector,
                    null, null, null, null, null);

            List<PodInfo> pods = new ArrayList<>();
            int totalRestarts = 0;
            int readyCount = 0;

            for (V1Pod pod : podList.getItems()) {
                pods.add(enrichedPodInfo(pod));
            }

            String statusStr = readyCount == pods.size() ? "UP" : (readyCount > 0 ? "DEGRADED" : "DOWN");

            return ComponentHealth.builder()
                    .status(statusStr)
                    .readyReplicas(readyCount)
                    .totalReplicas(pods.size())
                    .restartCount(totalRestarts)
                    .pods(pods)
                    .build();
        } catch (ApiException e) {
            log.error("Failed to get component health for {}/{}: {}", namespace, labelSelector, e.getMessage());
            return ComponentHealth.builder()
                    .status("ERROR")
                    .build();
        }
    }

    private LoadBalancerHealth getLoadBalancerHealth() {
        try {
            V1Service svc = coreV1Api.readNamespacedService(
                    "ingress-nginx-controller", "ingress-nginx", null);

            V1ServiceStatus status = svc.getStatus();
            if (status != null && status.getLoadBalancer() != null &&
                    status.getLoadBalancer().getIngress() != null &&
                    !status.getLoadBalancer().getIngress().isEmpty()) {

                V1LoadBalancerIngress ingress = status.getLoadBalancer().getIngress().get(0);
                List<String> ports = svc.getSpec().getPorts().stream()
                        .map(p -> p.getPort() + "/" + p.getProtocol())
                        .collect(Collectors.toList());

                return LoadBalancerHealth.builder()
                        .status("ACTIVE")
                        .externalIp(ingress.getIp())
                        .hostname(ingress.getHostname())
                        .ports(ports)
                        .build();
            }
            return LoadBalancerHealth.builder().status("PENDING").build();
        } catch (ApiException e) {
            log.error("Failed to get LoadBalancer health: {}", e.getMessage());
            return LoadBalancerHealth.builder().status("ERROR").build();
        }
    }

    private List<PodInfo> getPodsInNamespace(String namespace) throws ApiException {
        V1PodList podList = coreV1Api.listNamespacedPod(
                namespace, null, null, null, null, null,
                null, null, null, null, null);

        return podList.getItems().stream()
                .map(this::enrichedPodInfo)
                .collect(Collectors.toList());
    }

    private List<ServiceHealth> checkAllServices() {
        List<CompletableFuture<ServiceHealth>> futures = new ArrayList<>();

        futures.add(checkServiceHealthAsync("auth-service", 8071, "/auth-service/actuator/health"));
        futures.add(checkServiceHealthAsync("admin-core-service", 8072, "/admin-core-service/actuator/health"));
        futures.add(checkServiceHealthAsync("media-service", 8075, "/media-service/actuator/health"));
        futures.add(checkServiceHealthAsync("assessment-service", 8074, "/assessment-service/actuator/health"));
        futures.add(checkServiceHealthAsync("notification-service", 8076, "/notification-service/actuator/health"));
        futures.add(checkServiceHealthAsync("ai-service", 8077, "/ai-service/actuator/health"));

        // Community service (self)
        futures.add(CompletableFuture.completedFuture(ServiceHealth.builder()
                .name("community-service")
                .status("UP")
                .responseTimeMs(0L)
                .healthEndpoint("/community-service/actuator/health")
                .publicHealthEndpoint("/community-service/actuator/health")
                .lastCheck(Instant.now())
                .build()));

        return futures.stream()
                .map(CompletableFuture::join)
                .collect(Collectors.toList());
    }

    private CompletableFuture<ServiceHealth> checkServiceHealthAsync(String name, int port, String path) {
        return CompletableFuture.supplyAsync(() -> {
            String url = String.format("http://%s:%d%s", name, port, path);
            long start = System.currentTimeMillis();
            try {
                ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
                long duration = System.currentTimeMillis() - start;
                boolean up = response.getStatusCode().is2xxSuccessful();
                return ServiceHealth.builder()
                        .name(name)
                        .status(up ? "UP" : "DOWN")
                        .responseTimeMs(duration)
                        .healthEndpoint(path)
                        .publicHealthEndpoint(path)
                        .lastCheck(Instant.now())
                        .build();
            } catch (Exception e) {
                log.error("Health check failed for {}: {}", name, e.getMessage());
                return ServiceHealth.builder()
                        .name(name)
                        .status("DOWN")
                        .responseTimeMs(System.currentTimeMillis() - start)
                        .healthEndpoint(path)
                        .publicHealthEndpoint(path)
                        .lastCheck(Instant.now())
                        .build();
            }
        });
    }

    private Map<String, Object> createQuickServiceConfig(String publicPath) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "Check Detail");
        result.put("public_endpoint", publicPath);
        return result;
    }

    private DependencyHealth checkDependencies() {
        return DependencyHealth.builder()
                .redis(checkRedisHealth())
                .postgresql(checkDatabaseHealth())
                .build();
    }

    private RedisHealth checkRedisHealth() {
        if (redisTemplate == null) {
            return RedisHealth.builder()
                    .status("UNAVAILABLE")
                    .connected(false)
                    .host(redisHost)
                    .port(redisPort)
                    .build();
        }

        try {
            long start = System.currentTimeMillis();
            String pong = redisTemplate.getConnectionFactory().getConnection().ping();
            long responseTime = System.currentTimeMillis() - start;

            return RedisHealth.builder()
                    .status("PONG".equals(pong) ? "UP" : "DOWN")
                    .connected(true)
                    .responseTimeMs(responseTime)
                    .host(redisHost)
                    .port(redisPort)
                    .build();
        } catch (Exception e) {
            return RedisHealth.builder()
                    .status("DOWN")
                    .connected(false)
                    .host(redisHost)
                    .port(redisPort)
                    .build();
        }
    }

    private DatabaseHealth checkDatabaseHealth() {
        try {
            long start = System.currentTimeMillis();
            try (Connection conn = dataSource.getConnection()) {
                boolean valid = conn.isValid(5);
                long responseTime = System.currentTimeMillis() - start;

                return DatabaseHealth.builder()
                        .status(valid ? "UP" : "DOWN")
                        .connected(valid)
                        .responseTimeMs(responseTime)
                        .databaseName(conn.getCatalog())
                        .build();
            }
        } catch (SQLException e) {
            return DatabaseHealth.builder()
                    .status("DOWN")
                    .connected(false)
                    .build();
        }
    }

    private Map<String, Object> checkRedisQuick() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("host", redisHost);

        if (redisTemplate == null) {
            result.put("status", "UNAVAILABLE");
            return result;
        }

        try {
            long start = System.currentTimeMillis();
            redisTemplate.getConnectionFactory().getConnection().ping();
            result.put("status", "UP");
            result.put("response_time_ms", System.currentTimeMillis() - start);
        } catch (Exception e) {
            result.put("status", "DOWN");
            result.put("error", e.getMessage());
        }
        return result;
    }

    private Map<String, Object> checkDatabaseQuick() {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            long start = System.currentTimeMillis();
            try (Connection conn = dataSource.getConnection()) {
                result.put("status", conn.isValid(5) ? "UP" : "DOWN");
                result.put("response_time_ms", System.currentTimeMillis() - start);
            }
        } catch (Exception e) {
            result.put("status", "DOWN");
            result.put("error", e.getMessage());
        }
        return result;
    }

    private List<KubernetesEvent> getRecentKubernetesEvents() {
        if (!k8sAvailable) {
            return Collections.emptyList();
        }

        try {
            // Get events from last hour, warnings only
            CoreV1EventList eventList = coreV1Api.listEventForAllNamespaces(
                    null, null, "type=Warning", null, null, null, null, null, null, null);

            return eventList.getItems().stream()
                    .sorted((a, b) -> {
                        OffsetDateTime aTime = a.getLastTimestamp() != null ? a.getLastTimestamp() : a.getEventTime();
                        OffsetDateTime bTime = b.getLastTimestamp() != null ? b.getLastTimestamp() : b.getEventTime();
                        if (aTime == null || bTime == null)
                            return 0;
                        return bTime.compareTo(aTime);
                    })
                    .limit(20)
                    .map(event -> KubernetesEvent.builder()
                            .type(event.getType())
                            .reason(event.getReason())
                            .message(event.getMessage())
                            .object(event.getInvolvedObject().getName())
                            .namespace(event.getInvolvedObject().getNamespace())
                            .timestamp(event.getLastTimestamp() != null ? event.getLastTimestamp().toInstant()
                                    : Instant.now())
                            .count(event.getCount() != null ? event.getCount() : 1)
                            .build())
                    .collect(Collectors.toList());
        } catch (ApiException e) {
            log.error("Failed to get K8s events: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    private String determineOverallStatus(KubernetesInfrastructure k8s, List<ServiceHealth> services,
            DependencyHealth deps, List<ConnectivityCheck> connectivity) {
        // Check if any critical component is down
        if (deps.getPostgresql() != null && !"UP".equals(deps.getPostgresql().getStatus())) {
            return "UNHEALTHY";
        }

        long downServices = services.stream()
                .filter(s -> "DOWN".equals(s.getStatus()))
                .count();

        if (downServices > 2)
            return "UNHEALTHY";
        if (downServices > 0)
            return "DEGRADED";

        long failedConnections = connectivity.stream()
                .filter(c -> "FAILED".equals(c.getStatus()))
                .count();

        if (failedConnections > 2)
            return "DEGRADED";

        return "HEALTHY";
    }

    private List<ConnectivityCheck> checkConnectivity() {
        List<ConnectivityCheck> checks = new ArrayList<>();

        // 1. Check connectivity from Community Service (this service) to others
        checks.add(performDirectConnectivityCheck("community-service", "auth-service",
                "http://auth-service:8071/auth-service/health/ping"));
        checks.add(performDirectConnectivityCheck("community-service", "admin-core-service",
                "http://admin-core-service:8072/admin-core-service/health/ping"));
        checks.add(performDirectConnectivityCheck("community-service", "media-service",
                "http://media-service:8075/media-service/health/ping"));

        // 2. Ask Admin Core Service about its connectivity (since it's a central hub)
        try {
            String url = "http://admin-core-service:8072/admin-core-service/health/connectivity/all";
            ResponseEntity<Map> response = restTemplate.getForEntity(url, Map.class);
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Map<String, Object> body = response.getBody();
                processRemoteConnectivityCheck(checks, body, "auth_service");
                processRemoteConnectivityCheck(checks, body, "media_service");
                processRemoteConnectivityCheck(checks, body, "assessment_service");
            }
        } catch (Exception e) {
            log.error("Failed to fetch connectivity from admin-core-service: {}", e.getMessage());
        }

        return checks;
    }

    private ConnectivityCheck performDirectConnectivityCheck(String source, String target, String url) {
        long start = System.currentTimeMillis();
        try {
            restTemplate.getForEntity(url, String.class);
            return ConnectivityCheck.builder()
                    .source(source)
                    .target(target)
                    .status("OK")
                    .responseTimeMs(System.currentTimeMillis() - start)
                    .lastCheck(Instant.now())
                    .build();
        } catch (Exception e) {
            return ConnectivityCheck.builder()
                    .source(source)
                    .target(target)
                    .status("FAILED")
                    .responseTimeMs(System.currentTimeMillis() - start)
                    .errorMessage(e.getMessage())
                    .lastCheck(Instant.now())
                    .build();
        }
    }

    @SuppressWarnings("unchecked")
    private void processRemoteConnectivityCheck(List<ConnectivityCheck> checks, Map<String, Object> body, String key) {
        if (body.containsKey(key)) {
            Map<String, Object> data = (Map<String, Object>) body.get(key);
            checks.add(ConnectivityCheck.builder()
                    .source((String) data.get("source"))
                    .target((String) data.get("target"))
                    .status((String) data.get("status"))
                    .responseTimeMs(((Number) data.get("latency_ms")).longValue())
                    .errorMessage((String) data.get("error"))
                    .lastCheck(Instant.now())
                    .build());
        }
    }

    private boolean isPodReady(V1PodStatus status) {
        if (status == null || status.getConditions() == null)
            return false;
        return status.getConditions().stream()
                .anyMatch(c -> "Ready".equals(c.getType()) && "True".equals(c.getStatus()));
    }

    private int getPodRestarts(V1PodStatus status) {
        if (status == null || status.getContainerStatuses() == null)
            return 0;
        return status.getContainerStatuses().stream()
                .mapToInt(V1ContainerStatus::getRestartCount)
                .sum();
    }

    private PodInfo enrichedPodInfo(V1Pod pod) {
        if (pod == null || pod.getMetadata() == null) {
            return null;
        }

        V1PodStatus status = pod.getStatus();
        boolean ready = isPodReady(status);
        int restarts = getPodRestarts(status);

        // Get termination details and logs if there are issues
        String terminationReason = null;
        Integer lastExitCode = null;
        List<String> logs = new ArrayList<>();

        if (status != null && status.getContainerStatuses() != null) {
            for (V1ContainerStatus cs : status.getContainerStatuses()) {
                if (cs.getState() != null && cs.getState().getTerminated() != null) {
                    terminationReason = cs.getState().getTerminated().getReason();
                    lastExitCode = cs.getState().getTerminated().getExitCode();
                } else if (cs.getLastState() != null && cs.getLastState().getTerminated() != null) {
                    terminationReason = cs.getLastState().getTerminated().getReason();
                    lastExitCode = cs.getLastState().getTerminated().getExitCode();
                }

                // Fetch logs if restarts > 0 or not ready
                if (restarts > 0) {
                    logs.addAll(fetchPodLogs(pod.getMetadata().getName(), pod.getMetadata().getNamespace(),
                            cs.getName(), true));
                } else if (!ready) {
                    logs.addAll(fetchPodLogs(pod.getMetadata().getName(), pod.getMetadata().getNamespace(),
                            cs.getName(), false));
                }
            }
        }

        return PodInfo.builder()
                .name(pod.getMetadata().getName())
                .status(status != null ? status.getPhase() : "Unknown")
                .ready(ready)
                .restarts(restarts)
                .age(getAge(pod.getMetadata().getCreationTimestamp()))
                .node(pod.getSpec() != null ? pod.getSpec().getNodeName() : null)
                .terminationReason(terminationReason)
                .lastExitCode(lastExitCode)
                .logs(logs.isEmpty() ? null : logs)
                .build();
    }

    private List<String> fetchPodLogs(String podName, String namespace, String container, boolean previous) {
        try {
            // Fetch last 50 lines
            String logContent = coreV1Api.readNamespacedPodLog(
                    podName,
                    namespace,
                    container,
                    false,
                    null,
                    null,
                    null,
                    previous,
                    null,
                    50,
                    true);

            if (logContent != null) {
                return Arrays.asList(logContent.split("\n"));
            }
        } catch (ApiException e) {
            // If requesting previous logs and they don't exist, we might want current logs?
            // But for now, just logging warning is fine.
            if (!previous) {
                log.warn("Failed to fetch logs for {}/{}: {}", namespace, podName, e.getMessage());
            }
        }
        return Collections.emptyList();
    }

    private String getAge(OffsetDateTime creationTimestamp) {
        if (creationTimestamp == null)
            return "unknown";
        Duration duration = Duration.between(creationTimestamp.toInstant(), Instant.now());
        long days = duration.toDays();
        if (days > 0)
            return days + "d";
        long hours = duration.toHours();
        if (hours > 0)
            return hours + "h";
        return duration.toMinutes() + "m";
    }
}
