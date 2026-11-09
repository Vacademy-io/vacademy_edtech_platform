package vacademy.io.admin_core_service.features.marketing.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.MarketingConnectionRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * Owns marketing_connection rows: storing a fresh OAuth grant, handing out the Meta user token,
 * and flipping a grant to RECONNECT_NEEDED when the platform rejects it.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MarketingConnectionService {

    private final MarketingConnectionRepository connectionRepository;
    private final TokenEncryptionService tokenEncryptionService;

    /** What a successful OAuth callback produced. Tokens are plaintext here and encrypted on save. */
    public record OAuthGrant(String externalUserId, String externalUserName, String accessToken,
                             String refreshToken, Instant tokenExpiresAt, String scopes) {
    }

    /**
     * Decrypted Meta user token of a connection. Throws an auth MarketingApiException when the grant
     * is not ACTIVE or the token has expired (the connection is then marked RECONNECT_NEEDED).
     */
    public String metaUserToken(MarketingConnection connection) {
        if (connection == null) {
            throw new MarketingApiException("NO_CONNECTION", "Meta is not connected. Connect Meta again.", false, true);
        }
        if (!MarketingConstants.STATUS_ACTIVE.equals(connection.getStatus())) {
            throw new MarketingApiException(connection.getStatus(),
                    "Meta access needs to be renewed. Reconnect Meta.", false, true);
        }
        if (connection.getAccessTokenEnc() == null || connection.getAccessTokenEnc().isBlank()) {
            throw new MarketingApiException("NO_TOKEN", "Meta access is missing. Reconnect Meta.", false, true);
        }
        if (connection.getTokenExpiresAt() != null && connection.getTokenExpiresAt().isBefore(Instant.now())) {
            String detail = "Meta access expired. Reconnect Meta.";
            markReconnect(connection.getId(), detail);
            connection.setStatus(MarketingConstants.STATUS_RECONNECT_NEEDED);
            connection.setStatusDetail(detail);
            throw new MarketingApiException("TOKEN_EXPIRED", detail, false, true);
        }
        return tokenEncryptionService.decrypt(connection.getAccessTokenEnc());
    }

    /** Decrypted Google refresh token, or null when none is stored. */
    public String googleRefreshToken(MarketingConnection connection) {
        if (connection == null || connection.getRefreshTokenEnc() == null || connection.getRefreshTokenEnc().isBlank()) {
            return null;
        }
        return tokenEncryptionService.decrypt(connection.getRefreshTokenEnc());
    }

    /** Marks a grant RECONNECT_NEEDED with a reason the UI can show (a REVOKED grant stays REVOKED). */
    @Transactional
    public void markReconnect(String connectionId, String detail) {
        if (connectionId == null) return;
        int changed = connectionRepository.markReconnect(connectionId, detail);
        if (changed > 0) {
            log.warn("Marketing connection {} marked RECONNECT_NEEDED: {}", connectionId, detail);
        }
    }

    public Optional<MarketingConnection> findById(String connectionId) {
        return connectionId == null ? Optional.empty() : connectionRepository.findById(connectionId);
    }

    /** Connections by id, for mapping many ad/social accounts to DTOs in one query. */
    public Map<String, MarketingConnection> findByIds(Collection<String> connectionIds) {
        Map<String, MarketingConnection> byId = new HashMap<>();
        List<String> ids = connectionIds == null ? List.of()
                : connectionIds.stream().filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return byId;
        for (MarketingConnection c : connectionRepository.findByIdIn(ids)) byId.put(c.getId(), c);
        return byId;
    }

    /**
     * Creates or refreshes the grant for (institute, provider, external user): new tokens,
     * status ACTIVE, oauth_state_id = the state that produced it. A Google refresh token is only
     * replaced when a new one is given.
     */
    @Transactional
    public MarketingConnection upsertFromOAuth(String instituteId, String provider, OAuthGrant grant,
                                               String oauthStateId, String connectedByUserId) {
        MarketingConnection connection = connectionRepository
                .findFirstByInstituteIdAndProviderAndExternalUserIdOrderByUpdatedAtDesc(
                        instituteId, provider, grant.externalUserId())
                .orElseGet(() -> MarketingConnection.builder()
                        .instituteId(instituteId)
                        .provider(provider)
                        .externalUserId(grant.externalUserId())
                        .build());
        connection.setExternalUserName(grant.externalUserName());
        connection.setAccessTokenEnc(grant.accessToken() == null ? null
                : tokenEncryptionService.encrypt(grant.accessToken()));
        if (grant.refreshToken() != null && !grant.refreshToken().isBlank()) {
            connection.setRefreshTokenEnc(tokenEncryptionService.encrypt(grant.refreshToken()));
        }
        connection.setTokenExpiresAt(grant.tokenExpiresAt());
        connection.setScopes(grant.scopes());
        connection.setStatus(MarketingConstants.STATUS_ACTIVE);
        connection.setStatusDetail(null);
        connection.setOauthStateId(oauthStateId);
        if (connectedByUserId != null) connection.setConnectedByUserId(connectedByUserId);
        return connectionRepository.save(connection);
    }
}
