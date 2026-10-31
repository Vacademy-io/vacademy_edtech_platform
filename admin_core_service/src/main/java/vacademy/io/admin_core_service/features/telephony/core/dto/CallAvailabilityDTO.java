package vacademy.io.admin_core_service.features.telephony.core.dto;

import lombok.Builder;
import lombok.Data;

/**
 * Response for {@code GET /v1/telephony/calls/availability} — "can this person
 * place a call right now, and if not, why?".
 *
 * <p>Exists because the only previous way to ask was {@code /calls/options},
 * which THROWS when the institute has calling switched off. That is the right
 * shape for the picker (it opens only after a deliberate click) but the wrong
 * one for deciding whether to render a Call button at all: every learner
 * side-view on every non-calling institute would fire a request that 510s,
 * logging a server-side error and feeding the latency indicator a failure
 * sample, purely to learn "no". This endpoint always answers 200.
 *
 * <p>Two independent gates, reported separately because the fixes differ and
 * belong to different people:
 * <ul>
 *   <li>{@code enabled} — the INSTITUTE has a provider configured and switched
 *       on. Off means nobody here can call; the UI shows no button at all,
 *       since a learner-facing admin can do nothing about it.</li>
 *   <li>{@code callerReady} — THIS person is set up to originate (an extension
 *       for Airtel, a verified mobile for Exotel/Plivo). Not ready means the
 *       button shows but is disabled, carrying {@code reason} as its tooltip —
 *       an actionable "ask an admin for an extension", not a silent absence
 *       that reads like a broken page.</li>
 * </ul>
 */
@Data
@Builder
public class CallAvailabilityDTO {
    /** Institute-level: a provider is configured AND enabled. */
    private boolean enabled;
    /** Caller-level: this user can originate. Always false when !enabled. */
    private boolean callerReady;
    /** Why the caller cannot dial — user-facing, null when they can. */
    private String reason;
    /** Active provider (EXOTEL / AIRTEL / …), null when not enabled. */
    private String providerType;
}
