package vacademy.io.admin_core_service.features.telephony.providers.exotel;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.ProviderNumberSelector;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderNumberView;
import vacademy.io.admin_core_service.features.telephony.spi.dto.SelectionContext;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Exotel origination: the counsellor's verified mobile is the first leg, and the
 * caller-ID is a pooled ExoPhone chosen by the institute's selector strategy
 * (honouring a runtime picker override + STICKY_PER_LEAD). This is the exact
 * logic that used to live inline in {@code CallLifecycleTxOps.prepareAndPersist}
 * — moved here verbatim so the core no longer assumes Exotel's model.
 *
 * <p>Injects {@code List<ProviderNumberSelector>} directly (not the registry) to
 * avoid a construction cycle (the registry indexes resolvers).
 */
@Component
public class ExotelOriginationResolver implements OutboundOriginationResolver {

    private final UserMobileResolver userMobileResolver;
    private final TelephonyCallLogRepository callLogRepo;
    private final Map<String, ProviderNumberSelector> selectors = new HashMap<>();

    public ExotelOriginationResolver(UserMobileResolver userMobileResolver,
                                     TelephonyCallLogRepository callLogRepo,
                                     List<ProviderNumberSelector> selectorList) {
        this.userMobileResolver = userMobileResolver;
        this.callLogRepo = callLogRepo;
        selectorList.forEach(s -> this.selectors.put(s.strategyKey(), s));
    }

    @Override
    public String providerType() {
        return ProviderType.EXOTEL;
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

        List<ProviderNumberView> views = ctx.getAvailable();
        if (views == null || views.isEmpty()) {
            throw new VacademyException("No calling number is configured for this institute");
        }

        // Runtime override: a specific ExoPhone the counsellor picked, if still enabled.
        ProviderNumberView chosen = null;
        String preferred = ctx.getPreferredNumberId();
        if (preferred != null && !preferred.isBlank()) {
            chosen = views.stream().filter(n -> preferred.equals(n.getId())).findFirst().orElse(null);
        }

        if (chosen == null) {
            String selectorKey = ctx.getSelectorKey();
            Optional<String> sticky = "STICKY_PER_LEAD".equals(selectorKey)
                    ? callLogRepo.findMostRecentNumberIdForLead(ctx.getLeadUserId())
                    : Optional.empty();
            ProviderNumberSelector selector = selectors.get(selectorKey);
            if (selector == null) {
                throw new VacademyException("No selector strategy registered for " + selectorKey);
            }
            chosen = selector.select(SelectionContext.builder()
                            .instituteId(ctx.getInstituteId())
                            .leadUserId(ctx.getLeadUserId())
                            .leadPhone(ctx.getLeadPhone())
                            .available(views)
                            .lastProviderNumberIdForLead(sticky.orElse(null))
                            .build())
                    .orElseThrow(() -> new VacademyException(
                            "No eligible calling number found — check the selector strategy"));
        }

        return OriginationPlan.builder()
                .from(counsellorPhone)
                .callerId(chosen.getPhoneNumber())
                .providerNumberId(chosen.getId())
                .build();
    }
}
