package vacademy.io.admin_core_service.features.telephony.core.inbound;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.enums.InboundRouterStrategy;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.InboundLeadRouter;
import vacademy.io.admin_core_service.features.telephony.spi.dto.InboundRouteDecision;
import vacademy.io.admin_core_service.features.telephony.spi.dto.InboundRouteRequest;

import java.util.List;
import java.util.Optional;

/**
 * Primary inbound strategy — ring the counsellor who most recently called this
 * lead. Builds caller-recognition on both sides: the counsellor sees the lead
 * they spoke to two days ago, the lead reaches the human they already trust.
 *
 * Pure DB lookup on the miss path, one auth-service hit on the hit path
 * (resolving the counsellor's mobile). Returns empty when no prior outbound
 * call exists or auth-service has no mobile on file for the counsellor.
 *
 * No opt-out / mobile-override layer: if a counsellor doesn't want callbacks
 * on a given number, they update their auth-service profile mobile. A
 * dedicated per-(user, institute) preferences table is a Phase 2 concern
 * that should serve more than just telephony when it lands.
 */
@Component
public class LastCounsellorInboundRouter implements InboundLeadRouter {

    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private UserMobileResolver mobileResolver;
    @Autowired private AuthService authService;

    private static final Logger log = LoggerFactory.getLogger(LastCounsellorInboundRouter.class);

    @Override
    public String strategyKey() {
        return InboundRouterStrategy.LAST_COUNSELLOR;
    }

    @Override
    public Optional<InboundRouteDecision> route(InboundRouteRequest req) {
        if (req.getInstituteId() == null || req.getFromNumber() == null) return Optional.empty();

        // Native query returns rows of [counsellor_user_id, user_id, response_id]
        // — LIMIT 1, so at most one. Take the first defensively if present.
        List<Object[]> rows = callLogRepo.findRecentOutboundAttributionByLeadPhone(
                req.getInstituteId(), req.getFromNumber());
        if (rows == null || rows.isEmpty()) return Optional.empty();
        Object[] row = rows.get(0);
        if (row == null || row.length == 0) return Optional.empty();

        String counsellorUserId = asString(row[0]);
        String leadUserId       = row.length > 1 ? asString(row[1]) : null;
        String responseId       = row.length > 2 ? asString(row[2]) : null;
        if (counsellorUserId == null) return Optional.empty();
        // A counsellor who no longer works here (role disabled or removed in this institute,
        // e.g. deactivated through the public API) must not keep receiving their old leads'
        // calls: fall through to the next strategy.
        if (!activeInInstitute(req.getInstituteId(), counsellorUserId)) return Optional.empty();

        Optional<String> mobile = mobileResolver.findVerifiedMobile(counsellorUserId);
        if (mobile.isEmpty()) return Optional.empty();

        InboundRouteDecision.DialLeg leg = InboundRouteDecision.DialLeg.builder()
                .number(mobile.get())
                .counsellorUserId(counsellorUserId)
                .label("Last counsellor")
                .build();

        return Optional.of(InboundRouteDecision.builder()
                .strategyKey(strategyKey())
                .attributedCounsellorUserId(counsellorUserId)
                .attributedLeadUserId(leadUserId)
                .attributedResponseId(responseId)
                .numbersToDial(List.of(leg))
                .reason("Most recent outbound call to this lead was made by this counsellor")
                .build());
    }

    /**
     * True when the user holds an ACTIVE or INVITED role in the institute (an invited counsellor
     * who has not signed in yet still owns their leads). DISABLED / DELETED / no role = false.
     * Unknown (auth_service down) counts as active, as before this check existed.
     */
    boolean activeInInstitute(String instituteId, String userId) {
        if (authService == null) return true;
        try {
            for (java.util.Map<String, String> r : authService.getRoleMembershipsStrict(userId)) {
                if (r == null || !instituteId.equals(r.get("institute_id"))) continue;
                String status = r.get("status") == null ? "" : r.get("status").toUpperCase(java.util.Locale.ROOT);
                if ("ACTIVE".equals(status) || "INVITED".equals(status)) return true;
            }
            return false;
        } catch (RuntimeException e) {
            log.warn("inbound last-counsellor: could not check {} in {}: {}", userId, instituteId, e.getMessage());
            return true;
        }
    }

    private static String asString(Object o) {
        return o == null ? null : o.toString();
    }
}
