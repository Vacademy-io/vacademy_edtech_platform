package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/**
 * Filter for the team calling dashboard's paginated call search
 * ({@code POST /telephony/calls/search}).
 *
 * <p>Scope is NOT a field here — it's derived from the authenticated caller via
 * {@link vacademy.io.admin_core_service.features.audience.service.ReportScopeResolver}
 * (a leaf counsellor sees only their own calls; a team head sees their whole
 * downstream; an admin sees the institute). {@code counsellorUserId}/{@code teamId}
 * narrow WITHIN that scope (and 403 if out of scope).
 *
 * <p>Dates are institute-timezone calendar dates (yyyy-MM-dd, both inclusive);
 * omitted ⇒ trailing 30 days, same as the report endpoints.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CallSearchFilterDTO {

    private String instituteId;

    private String fromDate;
    private String toDate;
    /**
     * Optional instant window (UTC epoch millis) that overrides fromDate/toDate —
     * the "last 1 h / 3 h / 24 h" presets. toTs omitted = now.
     */
    private Long fromTs;
    private Long toTs;

    /** INBOUND | OUTBOUND (null = both). */
    private String direction;

    /** telephony_call_log.status values (COMPLETED, NO_ANSWER, …); null/empty = any. */
    private List<String> statuses;

    /** EXOTEL | AAVTAAR | AIRTEL | … ; null = any provider. */
    private String providerType;

    /** AI | HUMAN — AI = an Aavtaar call or any call with an ai_call_result; null = both. */
    private String callType;

    /** Manual disposition keys to include; null/empty = any. */
    private List<String> dispositionKeys;

    /** Narrow to one counsellor within the caller's scope. */
    private String counsellorUserId;

    /** Narrow to one team's subtree within the caller's scope. */
    private String teamId;

    /** Last-10-digit match on the call's from_number. */
    private String fromNumber;

    /** Last-10-digit match on the call's to_number. */
    private String toNumber;

    /** Substring match on the lead's name (audience_response.parent_name). */
    private String leadName;

    private Boolean hasRecording;

    // ── Worklist chips ────────────────────────────────────────────────────────
    /** Inbound calls that didn't connect and have no later connected call to the lead. */
    private Boolean missedInbound;
    /** Calls with a due/overdue promised call-back (human Callback or AI callback) not yet returned. */
    private Boolean callbacksDue;

    /** TIME (default) | DURATION | STATUS. */
    private String sortBy;
    /** ASC | DESC (default). */
    private String sortDirection;

    private int page = 0;
    private int size = 25;
}
