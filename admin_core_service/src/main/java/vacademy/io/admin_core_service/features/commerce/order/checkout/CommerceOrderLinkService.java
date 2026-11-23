package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

/**
 * The order link of a buyer's message, opened and revoked. Opening exchanges a valid link
 * token for a short order access token (at most 24 hours, never past the link's own end), the
 * one the order page keeps the way it keeps every order token. One answer for every link that
 * cannot be used (a bad MAC, another shop's, revoked, an unknown order, an anonymised buyer); a
 * link whose time is up says so.
 */
@Slf4j
@Service
public class CommerceOrderLinkService {

    public static final String LINK_INVALID = "link_invalid";
    public static final String LINK_EXPIRED = "link_expired";
    static final Duration EXCHANGED_LIFE = Duration.ofHours(24);
    private static final Set<CommerceRole> REVOKERS = Set.of(CommerceRole.STORE_MANAGER);

    private final CommerceOrderLinkTokens linkTokens;
    private final CommerceOrderAccessTokens accessTokens;
    private final CommerceNotificationStore store;
    private final CommerceOrderDeskService desk;
    private final CommerceAccessGuard accessGuard;
    private final CommerceAuditService auditService;
    private final org.springframework.transaction.support.TransactionTemplate transaction;
    private Clock clock = Clock.systemUTC();

    public CommerceOrderLinkService(CommerceOrderLinkTokens linkTokens, CommerceOrderAccessTokens accessTokens,
                                    CommerceNotificationStore store, CommerceOrderDeskService desk,
                                    CommerceAccessGuard accessGuard, CommerceAuditService auditService,
                                    org.springframework.transaction.PlatformTransactionManager transactionManager) {
        this.linkTokens = linkTokens;
        this.accessTokens = accessTokens;
        this.store = store;
        this.desk = desk;
        this.accessGuard = accessGuard;
        this.auditService = auditService;
        this.transaction = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** {@code POST /open/commerce/v1/orders/link}. */
    public CheckoutDtos.OrderLinkExchange exchange(String instituteId, String linkToken) {
        if (!StringUtils.hasText(linkToken)) {
            throw new CheckoutException(HttpStatus.BAD_REQUEST, CheckoutException.INVALID_REQUEST,
                    "link_token is required");
        }
        if (!linkTokens.isConfigured() || !accessTokens.isConfigured()) {
            throw new CheckoutException(HttpStatus.SERVICE_UNAVAILABLE, CheckoutException.NOT_CONFIGURED,
                    "Order links are not available right now.");
        }
        CommerceOrderLinkTokens.Read read = linkTokens.verify(instituteId, linkToken.trim());
        if (read.status() == CommerceOrderLinkTokens.Status.INVALID) {
            throw invalid();
        }
        if (read.status() == CommerceOrderLinkTokens.Status.EXPIRED) {
            throw new CheckoutException(HttpStatus.GONE, LINK_EXPIRED, "This link has expired.");
        }
        CommerceNotificationStore.OrderFacts order = store.order(instituteId, read.orderId());
        if (order == null || order.linkEpoch() != read.linkEpoch() || store.customerAnonymised(order.customerId())) {
            throw invalid();
        }
        Instant longest = clock.instant().plus(EXCHANGED_LIFE);
        Instant expiresAt = read.expiresAt().isBefore(longest) ? read.expiresAt() : longest;
        String token = accessTokens.issueUntil(instituteId, order.id(), expiresAt);
        log.info("Commerce order link of order {} opened (trigger tag {})", order.id(), read.triggerTag());
        return CheckoutDtos.OrderLinkExchange.builder().orderAccessToken(token)
                .orderAccessTokenExpiresAt(expiresAt.toString()).phoneVerified(order.phoneVerified()).build();
    }

    private static CheckoutException invalid() {
        return new CheckoutException(HttpStatus.FORBIDDEN, LINK_INVALID, "This link cannot be used.");
    }

    /** {@code POST /commerce/v1/orders/{id}/links/revoke}: every link of the order not yet opened stops working. */
    public Map<String, Object> revoke(CustomUserDetails user, String instituteId, String orderId) {
        // Membership and the feature first: an outsider learns nothing about ids.
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, REVOKERS);
        String location = desk.readOrder(instituteId, orderId).getFulfilmentLocationId();
        desk.authorize(user, instituteId, location, REVOKERS);
        Integer epoch = transaction.execute(status -> {
            desk.lockOrder(instituteId, orderId);
            Integer raised = store.revokeLinks(instituteId, orderId);
            if (raised == null) {
                throw new VacademyException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND: no such order");
            }
            auditService.record(instituteId, user.getUserId(), location, "ORDER_LINKS_REVOKED", "ORDER", orderId, null,
                    "{\"link_epoch\":" + raised + "}", null);
            return raised;
        });
        return Map.of("link_epoch", epoch);
    }
}
