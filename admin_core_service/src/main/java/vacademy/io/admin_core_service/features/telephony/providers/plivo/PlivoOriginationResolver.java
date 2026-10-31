package vacademy.io.admin_core_service.features.telephony.providers.plivo;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.core.VoiceCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderNumberView;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Plivo origination for the v1 PSTN-bridge (counsellor-first) flow: the
 * counsellor's verified mobile is the leg we ring first, and the caller-ID the
 * lead sees is one of the institute's provisioned Plivo numbers.
 *
 * <p>Number choice: a runtime-picked number if the counsellor chose one, else the
 * highest-priority enabled {@code telephony_provider_number}, else the
 * {@code defaultCallerId} from VOICE_CALLING_SETTING. (Plivo declares no
 * NUMBER_POOL capability, so there's no per-call picker UI — but admins/onboarding
 * still register the institute's Plivo numbers as provider-number rows, which is
 * what {@code ctx.available} carries here.)
 */
@Component
public class PlivoOriginationResolver implements OutboundOriginationResolver {

    private final UserMobileResolver userMobileResolver;
    private final VoiceCallingSettingsService voiceSettings;

    public PlivoOriginationResolver(UserMobileResolver userMobileResolver,
                                    VoiceCallingSettingsService voiceSettings) {
        this.userMobileResolver = userMobileResolver;
        this.voiceSettings = voiceSettings;
    }

    @Override
    public String providerType() {
        return ProviderType.PLIVO;
    }

    /** Shared with the dial-time failure so the pre-flight and the toast match. */
    private static final String NO_VERIFIED_MOBILE =
            "Add a verified mobile number in your profile before placing calls";

    @Override
    public Optional<String> callerBlockedReason(String instituteId, String callerUserId) {
        // Strict lookup, so an auth_service failure THROWS here and
        // computeAvailability's catch degrades to "ready". findVerifiedMobile
        // collapses an outage into an empty Optional, indistinguishable from
        // "this person genuinely has no mobile" — using it would have disabled
        // the Call button for every working counsellor during a blip, and told
        // them to go add a mobile number they already have.
        return userMobileResolver.findVerifiedMobileStrict(callerUserId).isPresent()
                ? Optional.empty()
                : Optional.of(NO_VERIFIED_MOBILE);
    }

    @Override
    public OriginationPlan resolve(OriginationContext ctx) {
        String counsellorPhone = userMobileResolver.findVerifiedMobile(ctx.getCounsellorUserId())
                .orElseThrow(() -> new VacademyException(NO_VERIFIED_MOBILE));

        ProviderNumberView chosen = pickNumber(ctx);
        String callerId = chosen != null ? chosen.getPhoneNumber() : null;
        if (callerId == null || callerId.isBlank()) {
            callerId = voiceSettings.get(ctx.getInstituteId()).getDefaultCallerId();
        }
        if (callerId == null || callerId.isBlank()) {
            throw new VacademyException("No Vacademy Voice number is configured for this institute");
        }

        return OriginationPlan.builder()
                .from(counsellorPhone)
                .callerId(callerId)
                .providerNumberId(chosen != null ? chosen.getId() : null)
                .build();
    }

    private ProviderNumberView pickNumber(OriginationContext ctx) {
        List<ProviderNumberView> views = ctx.getAvailable();
        if (views == null || views.isEmpty()) return null;

        String preferred = ctx.getPreferredNumberId();
        if (preferred != null && !preferred.isBlank()) {
            ProviderNumberView match = views.stream()
                    .filter(n -> preferred.equals(n.getId())).findFirst().orElse(null);
            if (match != null) return match;
        }
        // Lowest priority value wins (same convention the round-robin selector uses).
        return views.stream()
                .min(Comparator.comparingInt(ProviderNumberView::getPriority))
                .orElse(null);
    }
}
