package vacademy.io.admin_core_service.features.workflow.engine.http;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.core.external.OutboundUrlGuard;
import vacademy.io.admin_core_service.features.workflow.dto.HttpRequestNodeConfigDTO;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.spel.WorkflowDateFunctions;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * Automation HTTP nodes: EXTERNAL targets that are not public addresses are logged (default) or
 * refused (flag on), redirects are re-checked hop by hop, the Authorization header never reaches
 * the log, and INTERNAL requests only go to this service's own configured service URLs, signed as
 * this service.
 */
class WorkflowHttpRequestTargetsTest {

    private static final String PUBLIC_IP = "93.184.216.34";
    private static final String BASIC_SECRET = "lms-user:lms-secret-value";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpHelperUtils helper = new HttpHelperUtils(
            new SpelEvaluator(new WorkflowDateFunctions()), objectMapper);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private Logger externalLogger;
    private Logger internalLogger;

    @BeforeEach
    void captureLogs() {
        logs.start();
        externalLogger = (Logger) LoggerFactory.getLogger(ExternalHttpRequestStrategy.class);
        internalLogger = (Logger) LoggerFactory.getLogger(InternalHttpRequestStrategy.class);
        for (Logger l : List.of(externalLogger, internalLogger)) {
            l.setLevel(Level.ALL);
            l.addAppender(logs);
        }
    }

    @AfterEach
    void release() {
        for (Logger l : List.of(externalLogger, internalLogger)) {
            l.detachAppender(logs);
            l.setLevel(null);
        }
    }

    private String allLogs() {
        StringBuilder sb = new StringBuilder();
        logs.list.forEach(e -> sb.append(e.getFormattedMessage()).append('\n'));
        return sb.toString();
    }

    // ------------------------------------------------------------ address rules

    @Test
    void nonPublicTargetsAreRecognised() {
        for (String url : List.of("http://127.0.0.1/x", "http://10.1.2.3/x", "http://172.16.0.5/x",
                "http://192.168.1.10/x", "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/x",
                "http://[::1]/x", "http://[fd00::1]/x", "http://0.0.0.0/x", "http://localhost:8072/x",
                "http://metadata.google.internal/x", "http://auth-service.vacademy.svc.cluster.local:8071/x",
                "http://auth-service:8071/x", "http://user:pw@" + PUBLIC_IP + "/x", "ftp://" + PUBLIC_IP + "/x")) {
            assertNotNull(OutboundUrlGuard.blockReason(URI.create(url)), url);
        }
        assertNull(OutboundUrlGuard.blockReason(URI.create("http://" + PUBLIC_IP + ":8080/moodle/webservice")));
        assertNull(OutboundUrlGuard.blockReason(URI.create("https://" + PUBLIC_IP + "/wp-json/wp/v2/users")));
    }

    // ------------------------------------------------------------ EXTERNAL

    private ExternalHttpRequestStrategy external(boolean block) {
        ExternalHttpRequestStrategy s = new ExternalHttpRequestStrategy(helper, objectMapper);
        ReflectionTestUtils.setField(s, "blockPrivateTargets", block);
        return s;
    }

    private static MockRestServiceServer server(ExternalHttpRequestStrategy s) {
        RestTemplate rest = (RestTemplate) ReflectionTestUtils.getField(s, "restTemplate");
        return MockRestServiceServer.bindTo(rest).build();
    }

    private static HttpRequestNodeConfigDTO.RequestConfig get(String url) {
        HttpRequestNodeConfigDTO.RequestConfig cfg = new HttpRequestNodeConfigDTO.RequestConfig();
        cfg.setUrl("'" + url + "'");
        cfg.setMethod("GET");
        HttpRequestNodeConfigDTO.AuthenticationConfig auth = new HttpRequestNodeConfigDTO.AuthenticationConfig();
        auth.setType("BASIC");
        auth.setUsername("'lms-user'");
        auth.setPassword("'lms-secret-value'");
        cfg.setAuthentication(auth);
        return cfg;
    }

    private static Map<String, Object> ctx() {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("workflowId", "wf-1");
        return ctx;
    }

    @Test
    void publicTargetIsCalledAndBasicAuthValueIsNotLogged() {
        ExternalHttpRequestStrategy s = external(true);
        MockRestServiceServer server = server(s);
        server.expect(requestTo("http://" + PUBLIC_IP + "/users"))
                .andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

        Map<String, Object> result = s.execute(ctx(), get("http://" + PUBLIC_IP + "/users"));

        server.verify();
        assertEquals(200, result.get("statusCode"));
        String logged = allLogs();
        assertTrue(logged.contains("Authorization: <redacted>"), logged);
        assertFalse(logged.contains(java.util.Base64.getEncoder().encodeToString(BASIC_SECRET.getBytes())), logged);
        assertFalse(logged.contains("lms-secret-value"), logged);
    }

    @Test
    void privateTargetIsOnlyLoggedByDefault() {
        ExternalHttpRequestStrategy s = external(false);
        MockRestServiceServer server = server(s);
        server.expect(requestTo("http://10.0.0.5/x")).andRespond(withSuccess("ok", MediaType.TEXT_PLAIN));

        Map<String, Object> result = s.execute(ctx(), get("http://10.0.0.5/x"));

        server.verify();
        assertEquals(200, result.get("statusCode"));
        assertTrue(allLogs().contains("would be refused"), allLogs());
        assertTrue(allLogs().contains("workflowId=wf-1"), allLogs());
    }

    @Test
    void privateTargetIsRefusedWhenBlockingIsOn() {
        ExternalHttpRequestStrategy s = external(true);
        MockRestServiceServer server = server(s);

        Map<String, Object> result = s.execute(ctx(), get("http://169.254.169.254/latest/meta-data"));

        server.verify(); // no request made
        assertTrue(String.valueOf(result.get("error")).contains("not allowed"), String.valueOf(result));
    }

    @Test
    void redirectsAreFollowedForGetAndEachHopIsChecked() {
        ExternalHttpRequestStrategy s = external(true);
        MockRestServiceServer server = server(s);
        HttpHeaders toPublic = new HttpHeaders();
        toPublic.setLocation(URI.create("/moved"));
        server.expect(requestTo("http://" + PUBLIC_IP + "/a")).andRespond(withStatus(HttpStatus.FOUND).headers(toPublic));
        server.expect(requestTo("http://" + PUBLIC_IP + "/moved")).andRespond(withSuccess("done", MediaType.TEXT_PLAIN));

        Map<String, Object> ok = s.execute(ctx(), get("http://" + PUBLIC_IP + "/a"));
        server.verify();
        assertEquals(200, ok.get("statusCode"));
        assertEquals("done", ok.get("body"));

        ExternalHttpRequestStrategy blocking = external(true);
        MockRestServiceServer server2 = server(blocking);
        HttpHeaders toPrivate = new HttpHeaders();
        toPrivate.setLocation(URI.create("http://127.0.0.1/admin"));
        server2.expect(requestTo("http://" + PUBLIC_IP + "/b")).andRespond(withStatus(HttpStatus.FOUND).headers(toPrivate));

        Map<String, Object> refused = blocking.execute(ctx(), get("http://" + PUBLIC_IP + "/b"));
        server2.verify(); // the private hop was never requested
        assertTrue(String.valueOf(refused.get("error")).contains("redirect target"), String.valueOf(refused));
    }

    @Test
    void crossSchemeRedirectIsNotFollowedAsBefore() {
        ExternalHttpRequestStrategy s = external(false);
        MockRestServiceServer server = server(s);
        HttpHeaders toHttps = new HttpHeaders();
        toHttps.setLocation(URI.create("https://" + PUBLIC_IP + "/a"));
        server.expect(requestTo("http://" + PUBLIC_IP + "/a")).andRespond(withStatus(HttpStatus.MOVED_PERMANENTLY).headers(toHttps));

        Map<String, Object> result = s.execute(ctx(), get("http://" + PUBLIC_IP + "/a"));

        server.verify();
        assertEquals(301, result.get("statusCode"));
    }

    // ------------------------------------------------------------ INTERNAL

    private InternalHttpRequestStrategy internal(InternalClientUtils client) {
        InternalHttpRequestStrategy s = new InternalHttpRequestStrategy(helper, client);
        ReflectionTestUtils.setField(s, "ownClientName", "admin_core_service");
        ReflectionTestUtils.setField(s, "authServerBaseUrl", "http://auth-service:8071");
        ReflectionTestUtils.setField(s, "notificationServerBaseUrl", "http://notification-service:8076");
        ReflectionTestUtils.setField(s, "assessmentServerBaseUrl", "https://backend.example.com");
        ReflectionTestUtils.setField(s, "mediaServerBaseUrl", "");
        ReflectionTestUtils.setField(s, "communityServerBaseUrl", null);
        ReflectionTestUtils.setField(s, "aiServiceUrl", "http://ai-service:8077");
        ReflectionTestUtils.setField(s, "extraAllowedOrigins", "https://backend-stage.vacademy.io,https://api.vacademy.ai");
        return s;
    }

    private static HttpRequestNodeConfigDTO.RequestConfig internalCfg(String urlExpr) {
        HttpRequestNodeConfigDTO.RequestConfig cfg = new HttpRequestNodeConfigDTO.RequestConfig();
        cfg.setRequestType("INTERNAL");
        cfg.setUrl(urlExpr);
        cfg.setMethod("POST");
        HttpRequestNodeConfigDTO.AuthenticationConfig auth = new HttpRequestNodeConfigDTO.AuthenticationConfig();
        auth.setClientName("#ctx['clientName']");
        cfg.setAuthentication(auth);
        return cfg;
    }

    @Test
    void internalRequestToOwnServiceUrlIsSentAsThisService() {
        InternalClientUtils client = mock(InternalClientUtils.class);
        when(client.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any(), any(HttpHeaders.class)))
                .thenReturn(ResponseEntity.ok("[]"));
        InternalHttpRequestStrategy s = internal(client);
        Map<String, Object> ctx = ctx();
        ctx.put("authServiceBaseUrl", "http://auth-service:8071");
        ctx.put("clientName", "some_other_service");

        Map<String, Object> result = s.execute(ctx,
                internalCfg("#ctx['authServiceBaseUrl'] + '/internal/user/get-users-of-roles-of-institute'"));

        assertEquals(200, result.get("statusCode"), String.valueOf(result));
        verify(client).makeHmacRequest(eq("admin_core_service"), eq("POST"),
                eq("http://auth-service:8071/internal/user/get-users-of-roles-of-institute"), eq(""), any(), any(HttpHeaders.class));
    }

    @Test
    void internalRequestThroughOurPublicApiHostIsSentAsThisService() {
        // The shape the live INTERNAL nodes use: trigger data holds the public auth-service base URL.
        InternalClientUtils client = mock(InternalClientUtils.class);
        when(client.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any(), any(HttpHeaders.class)))
                .thenReturn(ResponseEntity.ok("[]"));
        InternalHttpRequestStrategy s = internal(client);
        Map<String, Object> ctx = ctx();
        ctx.put("authServiceBaseUrl", "https://backend-stage.vacademy.io/auth-service");
        ctx.put("clientName", "admin_core_service");

        Map<String, Object> result = s.execute(ctx,
                internalCfg("#ctx['authServiceBaseUrl'] + '/internal/user/get-users-of-roles-of-institute'"));

        assertEquals(200, result.get("statusCode"), String.valueOf(result));
        verify(client).makeHmacRequest(eq("admin_core_service"), eq("POST"),
                eq("https://backend-stage.vacademy.io/auth-service/internal/user/get-users-of-roles-of-institute"),
                eq(""), any(), any(HttpHeaders.class));

        ctx.put("authServiceBaseUrl", "https://elsewhere.example/auth-service");
        Map<String, Object> refused = s.execute(ctx,
                internalCfg("#ctx['authServiceBaseUrl'] + '/internal/user/get-users-of-roles-of-institute'"));
        assertTrue(String.valueOf(refused.get("error")).contains("not an allowed service URL"), String.valueOf(refused));
        verify(client, org.mockito.Mockito.times(1))
                .makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any(), any(HttpHeaders.class));
    }

    @Test
    void internalRequestToAnyOtherHostIsRefused() {
        InternalClientUtils client = mock(InternalClientUtils.class);
        InternalHttpRequestStrategy s = internal(client);
        Map<String, Object> ctx = ctx();
        ctx.put("clientName", "admin_core_service");

        for (String url : List.of("'https://elsewhere.example.net/collect'", "'http://auth-service:9999/x'",
                "'https://auth-service:8071/x'", "'http://169.254.169.254/latest'")) {
            Map<String, Object> result = s.execute(ctx, internalCfg(url));
            assertTrue(String.valueOf(result.get("error")).contains("not an allowed service URL"), url + " -> " + result);
        }
        verify(client, never()).makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any(), any(HttpHeaders.class));
        assertTrue(allLogs().contains("workflowId=wf-1"));
    }

    @Test
    void ownServiceUrlMatchUsesSchemeHostAndPort() {
        InternalHttpRequestStrategy s = internal(mock(InternalClientUtils.class));
        assertTrue(s.isOwnServiceUrl("http://auth-service:8071/internal/x?y=1"));
        assertTrue(s.isOwnServiceUrl("HTTP://Auth-Service:8071/a"));
        assertTrue(s.isOwnServiceUrl("https://backend.example.com:443/assessment-service/x"));
        assertTrue(s.isOwnServiceUrl("https://api.vacademy.ai/auth-service/internal/x"));
        assertFalse(s.isOwnServiceUrl("http://backend-stage.vacademy.io/auth-service/internal/x"));
        assertFalse(s.isOwnServiceUrl("https://backend-stage.vacademy.io.elsewhere.example/x"));
        assertFalse(s.isOwnServiceUrl("http://auth-service/internal/x"));
        assertFalse(s.isOwnServiceUrl("http://auth-service:8071@evil.example.net/x"));
        assertFalse(s.isOwnServiceUrl("http://backend.example.com/x"));
        assertFalse(s.isOwnServiceUrl(null));
    }
}
