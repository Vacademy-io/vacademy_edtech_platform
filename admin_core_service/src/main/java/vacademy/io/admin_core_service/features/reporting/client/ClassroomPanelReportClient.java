package vacademy.io.admin_core_service.features.reporting.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;

/**
 * Reads classroom panel data from auth_service.
 *
 * Panel rooms, devices and sessions live in auth_service's database, so neither
 * the weekly report section nor the daily notify job can reach them by SQL. Each
 * read is ONE call to an internal, HMAC-signed endpoint built for it
 * ({@code /auth-service/internal/panel/v1/...}), the same shape as
 * {@link AssessmentReportClient}.
 *
 * Every method returns null when the answer could not be fetched. Callers decide
 * what null means; this class never turns "we could not ask" into "there is
 * nothing", because those two must not read the same in an email.
 * {@link #usageSummary} also tells a 404 (auth's usage feature is switched off,
 * or an auth build without the route) apart from a real failure, so a report
 * can drop the section like admin_core's own switch would.
 *
 * Query values are percent-encoded here and sent through
 * {@code makeHmacRequestWithEncodedRoute}, which does not encode a second time. A
 * zone id such as {@code Etc/GMT+5} carries a '+', which the plain route would
 * deliver as a space.
 */
@Component
@Slf4j
public class ClassroomPanelReportClient {

    static final String BASE = "/auth-service/internal/panel/v1";

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;
    private final String authServiceBaseUrl;
    private final String clientName;

    /**
     * has-panels answers per institute. It runs on every load of the report
     * configuration screen, so it is cached. Only successful answers are cached;
     * a failure is asked again next time.
     */
    private final Cache<String, Boolean> hasPanelsCache;

    @Autowired
    public ClassroomPanelReportClient(
            InternalClientUtils internalClientUtils,
            ObjectMapper objectMapper,
            @Value("${auth.server.baseurl:http://auth-service:8071}") String authServiceBaseUrl,
            @Value("${spring.application.name:admin_core_service}") String clientName,
            @Value("${classroom.report.has-panels-cache-minutes:10}") long hasPanelsCacheMinutes) {
        this.internalClientUtils = internalClientUtils;
        this.objectMapper = objectMapper;
        this.authServiceBaseUrl = authServiceBaseUrl;
        this.clientName = clientName;
        this.hasPanelsCache = Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofMinutes(Math.max(1, hasPanelsCacheMinutes)))
                .maximumSize(10_000)
                .build();
    }

    /** OK with a body; FEATURE_OFF when auth answered 404; FAILED for anything else. */
    public enum Status { OK, FEATURE_OFF, FAILED }

    public record UsageResult(Status status, JsonNode body) {
        public static UsageResult ok(JsonNode body) {
            return new UsageResult(Status.OK, body);
        }

        public static UsageResult featureOff() {
            return new UsageResult(Status.FEATURE_OFF, null);
        }

        public static UsageResult failed() {
            return new UsageResult(Status.FAILED, null);
        }
    }

    /** GET /usage-summary. Totals plus short worst-first lists, for one window. */
    public UsageResult usageSummary(String instituteId, LocalDate from, LocalDate to, String tz) {
        return call("/usage-summary?institute_id=" + enc(instituteId)
                + "&from=" + from + "&to=" + to + "&tz=" + enc(tz), instituteId, "usage summary");
    }

    /** As {@link #usageSummary}, the body or null. */
    public JsonNode fetchUsageSummary(String instituteId, LocalDate from, LocalDate to, String tz) {
        UsageResult result = usageSummary(instituteId, from, to, tz);
        return result.status() == Status.OK ? result.body() : null;
    }

    /** GET /fleet. The institute's current panel alerts. */
    public JsonNode fetchFleet(String instituteId) {
        return get("/fleet?institute_id=" + enc(instituteId), instituteId, "fleet");
    }

    /** GET /institutes, one page (the server pages at 500 and sets has_more). */
    public JsonNode fetchInstitutesPage(int page) {
        return get("/institutes?page=" + Math.max(0, page), null, "institutes page " + page);
    }

    /**
     * GET /has-panels, cached.
     *
     * @return TRUE/FALSE when auth answered (FALSE also while auth's panel
     *         features are switched off), null when it could not be asked.
     */
    public Boolean hasPanels(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return Boolean.FALSE;
        Boolean cached = hasPanelsCache.getIfPresent(instituteId);
        if (cached != null) return cached;

        UsageResult result = call("/has-panels?institute_id=" + enc(instituteId), instituteId, "has-panels");
        if (result.status() == Status.FEATURE_OFF) return Boolean.FALSE;
        JsonNode body = result.body();
        if (body == null || !body.path("has_panels").isBoolean()) return null;
        Boolean answer = body.path("has_panels").asBoolean();
        hasPanelsCache.put(instituteId, answer);
        return answer;
    }

    private JsonNode get(String routeSuffix, String instituteId, String what) {
        UsageResult result = call(routeSuffix, instituteId, what);
        return result.status() == Status.OK ? result.body() : null;
    }

    UsageResult call(String routeSuffix, String instituteId, String what) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequestWithEncodedRoute(
                    clientName, "GET", authServiceBaseUrl, BASE + routeSuffix, null);
            if (response != null && response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                return UsageResult.ok(objectMapper.readTree(response.getBody()));
            }
            log.warn("[classroom] {} returned {} for institute {}", what,
                    response == null ? null : response.getStatusCode(), instituteId);
            return response != null && response.getStatusCode().value() == 404 ? UsageResult.featureOff()
                    : UsageResult.failed();
        } catch (HttpClientErrorException e) {
            log.warn("[classroom] {} returned {} for institute {}", what, e.getStatusCode(), instituteId);
            return e.getStatusCode().value() == 404 ? UsageResult.featureOff() : UsageResult.failed();
        } catch (Exception e) {
            log.warn("[classroom] {} failed for institute {}: {}", what, instituteId, e.getMessage());
            return UsageResult.failed();
        }
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }
}
