package vacademy.io.admin_core_service.features.telephony.controller.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * What line this institute's Vacademy AI calls go out on, and whether that line
 * can actually place one. Rendered by the "AI calling line" card.
 *
 * <p>Never carries a secret: {@code authTokenSet} / {@code webhookTokenSet} report
 * only whether one is stored, exactly like {@link TelephonyConfigViewDTO}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiVoiceCarrierViewDTO {

    /** {@code PRIMARY} — AI shares the team's calling account. {@code DEDICATED} — its own line. */
    private String mode;

    // ── The institute's human-calling provider (context for the choice) ──────────
    /** e.g. AIRTEL. Null when the institute has no calling provider configured at all. */
    private String primaryProviderType;
    /** e.g. "Airtel IQ Business Connect". */
    private String primaryProviderName;
    /**
     * Whether the primary provider can carry an AI conversation — i.e. it is Vacademy
     * Voice (Plivo). False for Airtel/Exotel, which expose no media stream, and is why
     * the "share the team's line" option is offered or refused.
     */
    private boolean primaryCanCarryAi;

    // ── The dedicated line, when there is one ───────────────────────────────────
    private boolean dedicatedConfigured;
    /**
     * Set up by us on the platform's account (a Telleo trial line): shown, but not editable,
     * and its account id is withheld.
     */
    private boolean platformManaged;
    private boolean dedicatedEnabled;
    /** Plivo subaccount Auth ID (not a secret — it's the username half). */
    private String authId;
    private boolean authTokenSet;
    private boolean webhookTokenSet;
    /** The number AI calls are placed from. */
    private String callerId;
    /** Optional Plivo Application id, only needed if inbound is ever pointed here. */
    private String appId;
    private Boolean recordCalls;
    private String updatedAt;

    // ── The verdict ─────────────────────────────────────────────────────────────
    /** The provider AI calls will actually dial on right now, or null if none can. */
    private String effectiveProviderType;
    /** True when an AI call placed this second would reach the carrier. */
    private boolean ready;
    /** Why not, in words an admin can act on. Null when {@code ready}. */
    private String blockingReason;
}
