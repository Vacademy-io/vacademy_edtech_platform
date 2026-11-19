package vacademy.io.admin_core_service.core.external;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.external.ExternalCallLog;
import vacademy.io.common.external.IntegratedVendors;

import java.time.Instant;
import java.util.Map;

/**
 * Failed third-party calls from the other Java services (notification, assessment, media,
 * community, auth), posted by their ExternalCallLog. Internal only: {@code InternalAuthFilter}
 * guards /admin-core-service/internal/** with the HMAC client headers.
 */
@RestController
@RequestMapping("/admin-core-service/internal/external-calls/v1")
public class ExternalCallFailureController {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final ExternalCallStore store;

    public ExternalCallFailureController(ExternalCallStore store) {
        this.store = store;
    }

    @PostMapping("/failure")
    public ResponseEntity<Map<String, Boolean>> failure(@RequestBody Map<String, Object> body) {
        ExternalCallLog.Failure f = parse(body);
        if (f == null) return ResponseEntity.badRequest().body(Map.of("recorded", false));
        store.write(f);
        return ResponseEntity.ok(Map.of("recorded", true));
    }

    /** The posted row, or null when it is not an integrated vendor's failure. */
    static ExternalCallLog.Failure parse(Map<String, Object> body) {
        String vendor = text(body.get("vendor"), 255);
        String source = text(body.get("sourceService"), 64);
        if (vendor == null || source == null || !IntegratedVendors.isIntegrated(vendor)) return null;
        Instant at;
        try {
            at = Instant.parse(String.valueOf(body.get("occurredAt")));
        } catch (Exception e) {
            at = Instant.now();
        }
        Integer status = body.get("httpStatus") instanceof Number n ? n.intValue() : null;
        return new ExternalCallLog.Failure(at, vendor.toLowerCase(), source, text(body.get("operation"), 64), status,
                text(body.get("error"), 500), json(body.get("request")), json(body.get("response")));
    }

    private static String text(Object v, int max) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    /** Valid JSON text of at most 12,000 characters, or null: it is cast to jsonb. */
    private static String json(Object v) {
        if (!(v instanceof String s) || s.isBlank() || s.length() > 12_000) return null;
        try {
            JSON.readTree(s);
            return s;
        } catch (Exception e) {
            return null;
        }
    }
}
