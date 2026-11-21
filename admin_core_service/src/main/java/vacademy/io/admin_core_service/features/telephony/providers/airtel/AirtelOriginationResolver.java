package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

/**
 * Airtel origination: no number pool. The caller's own VBC extension is the
 * first leg ({@code from}); the person called sees that caller's DID as
 * caller-ID. Both come from {@code telephony_counsellor_endpoint} (the
 * extension map), which holds a row for ANY platform user given an extension —
 * counsellors and admins alike, so an admin can dial a learner from the LMS
 * side-view the same way a counsellor dials a lead.
 */
@Component
public class AirtelOriginationResolver implements OutboundOriginationResolver {

    @Autowired private TelephonyCounsellorEndpointRepository endpointRepo;

    @Override
    public String providerType() {
        return ProviderType.AIRTEL;
    }

    /** Same wording the dial-time failure uses, so the pre-flight message and the
     *  error toast can never drift apart. */
    private static final String NO_ENDPOINT =
            "No Airtel extension is mapped to you — ask an admin to add one under Settings → Calling.";
    private static final String NO_EXTENSION = "Your Airtel extension is not set.";

    @Override
    public Optional<String> callerBlockedReason(String instituteId, String callerUserId) {
        if (callerUserId == null || callerUserId.isBlank()) return Optional.of(NO_ENDPOINT);
        // Written as plain branches on purpose. The first version chained
        // .map(e -> ready ? null : REASON) — and Optional.map treats a null
        // mapper result as EMPTY, so the ready case collapsed into the same
        // empty Optional as "no endpoint row at all" and then took the
        // .orElse(NO_ENDPOINT) branch. Net effect: the only people reported as
        // blocked were the ones who actually had a working extension, which
        // disabled the Call button for every correctly-configured Airtel
        // counsellor and admin. Nothing here is worth an Optional chain.
        TelephonyCounsellorEndpoint ep = endpointRepo
                .findByCounsellorUserIdAndProviderType(callerUserId, ProviderType.AIRTEL)
                .filter(e -> Boolean.TRUE.equals(e.getEnabled()))
                .filter(e -> sameInstitute(e, instituteId))
                .orElse(null);
        if (ep == null) return Optional.of(NO_ENDPOINT);
        if (ep.getExtension() == null || ep.getExtension().isBlank()) {
            return Optional.of(NO_EXTENSION);
        }
        return Optional.empty();
    }

    @Override
    public OriginationPlan resolve(OriginationContext ctx) {
        TelephonyCounsellorEndpoint ep = endpointRepo
                .findByCounsellorUserIdAndProviderType(ctx.getCounsellorUserId(), ProviderType.AIRTEL)
                .filter(e -> Boolean.TRUE.equals(e.getEnabled()))
                .filter(e -> sameInstitute(e, ctx.getInstituteId()))
                .orElseThrow(() -> new VacademyException(NO_ENDPOINT));
        if (ep.getExtension() == null || ep.getExtension().isBlank()) {
            throw new VacademyException(NO_EXTENSION);
        }
        return OriginationPlan.builder()
                .from(ep.getExtension())
                .callerId(ep.getDid())   // lead sees the counsellor's DID (may be null)
                .providerNumberId(null)  // no pool
                .build();
    }

    /**
     * The extension must be one THIS institute mapped. The row is unique per user, so a
     * person on staff at two institutes has one row; dialling from the other institute's
     * extension would bill that institute's Airtel account and file the CDR under it.
     */
    private static boolean sameInstitute(TelephonyCounsellorEndpoint e, String instituteId) {
        return instituteId != null && instituteId.equals(e.getInstituteId());
    }
}
