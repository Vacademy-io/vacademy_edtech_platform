package vacademy.io.admin_core_service.features.telephony.spi;

import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;

import java.util.Optional;

/**
 * Decides the outbound origination (first-leg {@code from} + caller-ID +
 * provider-number) for a provider, so the core orchestration stops baking in
 * Exotel's verified-mobile + pooled-ExoPhone model.
 *
 * Every provider registers exactly one; the registry resolves it by
 * {@link #providerType()}. Exotel's resolver reproduces the old inline logic
 * (verified mobile + selector over the number pool); Airtel/Vonage's derives the
 * counsellor's extension + DID from the per-counsellor endpoint map (no pool).
 */
public interface OutboundOriginationResolver {

    /** Matches institute_telephony_config.provider_type, e.g. "EXOTEL". */
    String providerType();

    /**
     * Resolve the origination for one outbound call. Throws a
     * {@code VacademyException} with an actionable message when origination
     * cannot be determined (no verified mobile, no number, no extension mapped).
     */
    OriginationPlan resolve(OriginationContext ctx);

    /**
     * Pre-flight: can THIS person originate a call at all, before we know who
     * they are dialling? Returns the reason they cannot, or empty when ready.
     *
     * <p>Every provider needs something set up per-caller — Airtel/Vonage an
     * extension, Exotel/Plivo a verified mobile on the profile — and until this
     * existed the only way to discover it was to click Call and read the error
     * toast. That is a bad trade for a click that may cost provider credits, and
     * it was actively confusing for admins, whose extension the settings picker
     * could not even create. The UI now asks first and shows the same sentence
     * up front, on a disabled button.
     *
     * <p>Advisory only, and deliberately NOT a replacement for the checks inside
     * {@link #resolve}: it runs against different inputs (no lead, no picked
     * number) and its answer can go stale between the check and the dial.
     * {@code resolve} stays the authority.
     *
     * <p>Default: ready. A provider that needs nothing per-caller says nothing.
     */
    default Optional<String> callerBlockedReason(String instituteId, String callerUserId) {
        return Optional.empty();
    }
}
