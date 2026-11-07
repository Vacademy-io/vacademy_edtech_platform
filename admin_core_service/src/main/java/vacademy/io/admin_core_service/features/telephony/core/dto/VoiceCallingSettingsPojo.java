package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Server-side mirror of the VOICE_CALLING_SETTING JSON — the per-institute flag +
 * config for the first-party "Vacademy Voice" (Plivo) product. Read via
 * {@code VoiceCallingSettingsService}. Lives in the institute settings envelope
 * ({@code institutes.setting_json}, key {@code VOICE_CALLING_SETTING}); the
 * onboarding state machine flips {@link #enabled} on go-live.
 *
 * <p>Forward-looking: {@link #billing} and {@link #compliance} blocks are read by
 * later phases (prepaid metering, the compliance gate); they deserialize to sane
 * defaults until those phases populate them, so older saved settings never break.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class VoiceCallingSettingsPojo {

    /** Master flag — when false the product surface + Plivo dialing are hidden for this institute. */
    private boolean enabled;

    /** The institute's Plivo subaccount id (mirror of provider_config.authId; set at onboarding). */
    private String plivoSubaccountId;

    /** The Plivo Application id the institute's numbers are bound to for inbound IVR. */
    private String appId;

    /** Default caller-ID (E.164) used on outbound calls when no per-number override applies. */
    private String defaultCallerId;

    /** Provisioned Plivo numbers (E.164) owned by this institute. */
    private List<String> numbers = new ArrayList<>();

    /** Record outbound + inbound calls (off-switch for institutes that opt out). */
    private boolean recordCalls = true;

    /** Institute timezone — drives the compliance call-window (9 PM IST cutoff) and reporting. */
    private String timezone = "Asia/Kolkata";

    private BillingConfig billing = new BillingConfig();
    private ComplianceConfig compliance = new ComplianceConfig();

    public static VoiceCallingSettingsPojo defaults() {
        return new VoiceCallingSettingsPojo();
    }

    /** Prepaid metering overrides (null = use the DB-managed global credit_pricing). Wired in P4. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BillingConfig {
        /**
         * Legacy blanket per-billable-minute override for the VOICE meters; the per-key
         * fields below win when set. null = fall through to global credit_pricing.
         */
        private Double perMinuteCreditOverride;
        /** Per-channel-per-day rental override; null = global price. */
        private Double perChannelDayCreditOverride;
        // Per-meter credits-per-minute overrides, consumed by CallBillingService.
        // null = fall through (voice keys → perMinuteCreditOverride → global
        // credit_pricing; ai keys → global credit_pricing). Set today via a manual DB
        // update on institutes.setting_json (VOICE_CALLING_SETTING.data.billing.*);
        // settings UI later. 0 disables that meter for this institute.
        /** Override: credits/min for outbound voice minutes (voice_call_out). */
        private Double voiceCallOutPerMinuteCredits;
        /** Override: credits/min for inbound voice minutes (voice_call_in). */
        private Double voiceCallInPerMinuteCredits;
        /** Override: credits/min for outbound AI-conversation minutes (ai_call_out). */
        private Double aiCallOutPerMinuteCredits;
        /** Override: credits/min for inbound AI-conversation minutes (ai_call_in). */
        private Double aiCallInPerMinuteCredits;
        /**
         * Billing granularity in SECONDS — the pulse every call is rounded up to.
         *
         * <p>null or &lt;= 0 means the platform default ({@code telephony.billing.pulse-seconds},
         * 30 = half-minute pulses). Set it per institute only to depart from that — 60 puts one
         * back on per-minute rounding. The pulse matters because most AI calls are short: under
         * per-minute rounding a 5-second call pays a full minute, and on a list where people
         * answer and hang up immediately that is the majority of the spend.
         *
         * <p>The per-meter rates below stay expressed as credits per MINUTE whatever the pulse
         * is, so a pulse change alone never silently reprices anyone: one pulse costs
         * {@code perMinute * pulseSeconds / 60}. A 30s pulse at 4 credits/min bills 2 credits
         * per half minute.
         */
        private Integer billingPulseSeconds;

        /** Concurrent channels this institute has purchased (hard dial cap). */
        private Integer purchasedChannels;
        /** The plan we sold them (free-text, for visibility in settings). */
        private String planName;
        /** Free-text notes about the plan / what was provided manually. */
        private String notes;
    }

    /** India compliance config — enforced pre-dial by the compliance gate. Wired in P5. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ComplianceConfig {
        /** Scrub NCPR/DND numbers before every dial. */
        private boolean dndScrubEnabled = true;
        /** Enforce the nightly outbound cutoff. */
        private boolean nightCutoffEnabled = true;
        /** Outbound cutoff hour (24h, institute tz). Default 21 = 9 PM IST. */
        private int cutoffHour = 21;
        /** Earliest outbound hour (24h, institute tz). Default 9 AM. */
        private int startHour = 9;
        /** Play the recording-consent + automated-call disclosure. */
        private boolean disclosureEnabled = true;
        /** DLT registration is complete — gates promotional (140-series) campaigns. */
        private boolean dltApproved = false;
    }
}
