package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;

import java.util.Map;

/**
 * Telleo API v1.3: counsellor and AI agent management, on the same base path and with the
 * same key, error envelope and rate limit as {@link PublicAiCallingApiController} (whose
 * catch-all route also answers 404 / 405 for these paths).
 *
 * <p>Scopes: writes need counsellors:manage or agents:manage, never part of a key's default
 * set. Reading an agent, the voices, the default agent and the numbers needs calls:read;
 * reading a counsellor needs human_calls:read or counsellors:manage.
 */
@RestController
@RequestMapping("/admin-core-service/open/ai-calling/v1")
@RequiredArgsConstructor
public class PublicAiCallingManagementController {

    private final AiCallingApiAuth auth;
    private final CounsellorApiService counsellors;
    private final AgentApiService agents;
    private final InboundNumberApiService numbers;

    // ── Counsellors ──────────────────────────────────────────────────────────────

    @PostMapping("/counsellors")
    public ResponseEntity<Map<String, Object>> createCounsellor(HttpServletRequest http,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) CounsellorBody body) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_COUNSELLORS_MANAGE);
        if (body == null) throw AiCallingApiException.invalid("Send a JSON body with name and email.");
        ApiIdempotencyStore.Outcome out = counsellors.createCounsellor(p, body.toInput(), idempotencyKey);
        return ok(out.created() ? HttpStatus.CREATED : HttpStatus.OK, out.body());
    }

    @GetMapping("/counsellors/{id}")
    public ResponseEntity<Map<String, Object>> getCounsellor(HttpServletRequest http, @PathVariable String id) {
        var p = auth.authenticateAny(http, InstituteApiKeyService.SCOPE_HUMAN_CALLS_READ,
                InstituteApiKeyService.SCOPE_COUNSELLORS_MANAGE);
        return ok(HttpStatus.OK, counsellors.getCounsellor(p, id));
    }

    @PatchMapping("/counsellors/{id}")
    public ResponseEntity<Map<String, Object>> patchCounsellor(HttpServletRequest http, @PathVariable String id,
            @RequestBody(required = false) JsonNode body) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_COUNSELLORS_MANAGE);
        return ok(HttpStatus.OK, counsellors.patchCounsellor(p, id, counsellorPatch(body)));
    }

    @DeleteMapping("/counsellors/{id}")
    public ResponseEntity<Map<String, Object>> deactivateCounsellor(HttpServletRequest http, @PathVariable String id) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_COUNSELLORS_MANAGE);
        return ok(HttpStatus.OK, counsellors.deactivateCounsellor(p, id));
    }

    // ── Agents ───────────────────────────────────────────────────────────────────

    @PostMapping("/agents")
    public ResponseEntity<Map<String, Object>> createAgent(HttpServletRequest http,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) JsonNode body) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        ApiIdempotencyStore.Outcome out = agents.createAgent(p, body, idempotencyKey);
        return ok(out.replay() ? HttpStatus.OK : HttpStatus.CREATED, out.body());
    }

    @GetMapping("/agents/{id}")
    public ResponseEntity<Map<String, Object>> getAgent(HttpServletRequest http, @PathVariable String id) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_CALLS_READ);
        return ok(HttpStatus.OK, agents.getAgent(p, id));
    }

    @PatchMapping("/agents/{id}")
    public ResponseEntity<Map<String, Object>> patchAgent(HttpServletRequest http, @PathVariable String id,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody(required = false) JsonNode body) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        return ok(HttpStatus.OK, agents.patchAgent(p, id, body, ifMatch));
    }

    @PostMapping("/agents/{id}/enable")
    public ResponseEntity<Map<String, Object>> enableAgent(HttpServletRequest http, @PathVariable String id) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        return ok(HttpStatus.OK, agents.setEnabled(p, id, true));
    }

    @PostMapping("/agents/{id}/disable")
    public ResponseEntity<Map<String, Object>> disableAgent(HttpServletRequest http, @PathVariable String id) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        return ok(HttpStatus.OK, agents.setEnabled(p, id, false));
    }

    @DeleteMapping("/agents/{id}")
    public ResponseEntity<Map<String, Object>> deleteAgent(HttpServletRequest http, @PathVariable String id) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        return ok(HttpStatus.OK, agents.deleteAgent(p, id));
    }

    @GetMapping("/voices")
    public ResponseEntity<Map<String, Object>> voices(HttpServletRequest http) {
        auth.authenticate(http, InstituteApiKeyService.SCOPE_CALLS_READ);
        return ok(HttpStatus.OK, agents.voices());
    }

    @GetMapping("/settings/default-agent")
    public ResponseEntity<Map<String, Object>> getDefaultAgent(HttpServletRequest http) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_CALLS_READ);
        return ok(HttpStatus.OK, agents.getDefaultAgent(p));
    }

    @PutMapping("/settings/default-agent")
    public ResponseEntity<Map<String, Object>> setDefaultAgent(HttpServletRequest http,
            @RequestBody(required = false) AgentRefBody body) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        return ok(HttpStatus.OK, agents.setDefaultAgent(p, body == null ? null : body.agentId));
    }

    // ── Inbound numbers ──────────────────────────────────────────────────────────

    @GetMapping("/numbers")
    public ResponseEntity<Map<String, Object>> listNumbers(HttpServletRequest http) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_CALLS_READ);
        return ok(HttpStatus.OK, numbers.listNumbers(p));
    }

    @PutMapping("/numbers/{id}/agent")
    public ResponseEntity<Map<String, Object>> setNumberAgent(HttpServletRequest http, @PathVariable String id,
            @RequestBody(required = false) AgentRefBody body) {
        var p = auth.authenticate(http, InstituteApiKeyService.SCOPE_AGENTS_MANAGE);
        return ok(HttpStatus.OK, numbers.setNumberAgent(p, id, body == null ? null : body.agentId));
    }

    // ── Bodies ───────────────────────────────────────────────────────────────────

    private static ResponseEntity<Map<String, Object>> ok(HttpStatus status, Map<String, Object> body) {
        return ResponseEntity.status(status).header("Cache-Control", "no-store").body(body);
    }

    /** PATCH /v1/counsellors/{id}: presence matters (null airtel_extension removes it). */
    static CounsellorApiService.PatchInput counsellorPatch(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw AiCallingApiException.invalid("Send a JSON object with the fields to change.");
        }
        JsonNode name = first(body, "name");
        JsonNode mobile = first(body, "mobile_number", "mobileNumber");
        JsonNode ext = first(body, "airtel_extension", "airtelExtension");
        JsonNode active = first(body, "active");
        if (active != null && !active.isNull() && !active.isBoolean()) {
            throw AiCallingApiException.invalid("active must be true or false.");
        }
        return new CounsellorApiService.PatchInput(text(name, "name"), name != null,
                text(mobile, "mobile_number"), mobile != null, text(ext, "airtel_extension"), ext != null,
                active == null || active.isNull() ? null : active.asBoolean());
    }

    private static JsonNode first(JsonNode body, String... names) {
        for (String n : names) if (body.has(n)) return body.get(n);
        return null;
    }

    private static String text(JsonNode v, String field) {
        if (v == null || v.isNull()) return null;
        if (!v.isTextual()) throw AiCallingApiException.invalid(field + " must be a string.");
        return v.asText();
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CounsellorBody {
        private String name;
        private String email;
        @JsonProperty("mobile_number")
        @JsonAlias("mobileNumber")
        private String mobileNumber;
        @JsonProperty("airtel_extension")
        @JsonAlias("airtelExtension")
        private String airtelExtension;
        @JsonProperty("send_welcome_email")
        @JsonAlias("sendWelcomeEmail")
        private Boolean sendWelcomeEmail;

        CounsellorApiService.CreateInput toInput() {
            return new CounsellorApiService.CreateInput(name, email, mobileNumber, airtelExtension, sendWelcomeEmail);
        }
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AgentRefBody {
        @JsonProperty("agent_id")
        @JsonAlias("agentId")
        private String agentId;
    }
}
