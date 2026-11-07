package vacademy.io.admin_core_service.features.course_settings.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;

/**
 * Live health of every LMS connection the institute has saved — what the dashboard's
 * "LMS connection health" widget renders.
 *
 * <p>Each entry is the result of actually calling the remote LMS, server-side. The test runs
 * on the backend rather than the browser for two reasons: the credentials never leave the
 * server, and the LMS sites are not CORS-open to the dashboard origin.</p>
 *
 * <p><b>No secrets here.</b> Only the connection's host is exposed ({@code target}), never the
 * API key, application password or Moodle token.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LmsConnectionHealthDTO {

    /** When the checks ran. The widget shows this as "checked N minutes ago". */
    private Instant checkedAt;

    /** Where the connections came from: INSTITUTE / COURSE / NONE (mirrors the settings page). */
    private String configSource;

    private int total;
    private int healthy;
    private int unhealthy;
    /** Connections with no automated test (built-in Vacademy, custom LMSes). Not a failure. */
    private int notApplicable;

    private List<ConnectionHealth> connections;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ConnectionHealth {

        private String id;
        /** Admin-given connection name, falling back to the provider name. */
        private String name;
        /** LEARNDASH / MOODLE / VACADEMY / custom. */
        private String type;

        /** HEALTHY | UNHEALTHY | NOT_APPLICABLE. */
        private String status;

        /** Human-readable, safe to show verbatim — comes straight from the connection test. */
        private String message;
        /** Technical reason (HTTP status, exception text). Shown behind a disclosure. */
        private String detail;

        /** Host only, e.g. "myvtc.com.au". Never the credentials. */
        private String target;

        /** Round-trip time of the check, milliseconds. Null when nothing was called. */
        private Long latencyMs;

        /**
         * True when this is the institute's default connection.
         *
         * <p>The explicit {@code @JsonProperty} is load-bearing: Lombok generates
         * {@code isDefault()} for this field, and Jackson strips the {@code is} prefix from a
         * boolean getter, so the property would otherwise serialize as {@code "default"} — the
         * snake-case strategy never sees an {@code isDefault} name to convert. Naming it here
         * pins the wire format the client actually reads.</p>
         */
        @JsonProperty("is_default")
        private boolean isDefault;
    }
}
