package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccountSettingsRequest;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccountSummary;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleTestConnectionResponse;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Business logic for institute-scoped Google account read/settings/disconnect + connection
 * testing. Accounts are created via the OAuth connect flow ({@link GoogleOAuthService}),
 * not by pasting credentials — so there is no create() here.
 *
 * Cross-tenant safety: every read/write is scoped by instituteId so a crafted id from
 * another tenant is rejected. Mirrors {@code ZoomAccountService}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleAccountService {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String STATUS_RECONNECT = "RECONNECT_NEEDED";
    private static final Set<String> ACCESS_TYPES = Set.of("OPEN", "TRUSTED", "RESTRICTED");

    private final GoogleAccountStore store;
    private final GoogleAccessTokenService accessTokenService;
    private final GoogleOAuthService googleOAuthService;
    private final WebClient.Builder webClientBuilder;

    // ── Read ────────────────────────────────────────────────────────────────

    public List<GoogleAccountSummary> list(String instituteId) {
        return store.listByInstitute(instituteId).stream()
                .map(this::toSummary)
                .collect(Collectors.toList());
    }

    public GoogleAccountSummary getOne(String instituteId, String id) {
        return toSummary(loadOwned(instituteId, id));
    }

    // ── Mutations ───────────────────────────────────────────────────────────

    @Transactional
    public GoogleAccountSummary updateSettings(String instituteId, String id, GoogleAccountSettingsRequest req) {
        GoogleAccount account = loadOwned(instituteId, id);
        if (req.getLabel() != null) {
            account.setLabel(req.getLabel());
        }
        if (req.getRecordingEnabled() != null) {
            account.setRecordingEnabled(req.getRecordingEnabled());
        }
        if (req.getDefaultAccessType() != null) {
            String type = req.getDefaultAccessType().trim().toUpperCase();
            if (!ACCESS_TYPES.contains(type)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "defaultAccessType must be one of OPEN, TRUSTED, RESTRICTED");
            }
            account.setDefaultAccessType(type);
        }
        if (req.getDefaultTimezone() != null) {
            account.setDefaultTimezone(req.getDefaultTimezone());
        }
        GoogleAccount saved = store.update(account);
        if (Boolean.TRUE.equals(req.getSetAsDefault())) {
            saved = applyDefault(instituteId, saved.getId());
        }
        return toSummary(saved);
    }

    @Transactional
    public void disconnect(String instituteId, String id) {
        GoogleAccount account = loadOwned(instituteId, id);
        accessTokenService.evict(account.getId());
        googleOAuthService.revoke(account); // best-effort
        store.delete(account.getId());
    }

    @Transactional
    public GoogleAccountSummary setDefault(String instituteId, String id) {
        loadOwned(instituteId, id); // tenant check
        return toSummary(applyDefault(instituteId, id));
    }

    // ── Test connection ─────────────────────────────────────────────────────

    @Transactional
    public GoogleTestConnectionResponse testConnection(String instituteId, String id) {
        GoogleAccount account = loadOwned(instituteId, id);
        try {
            String token = accessTokenService.getAccessToken(account);
            JsonNode me = webClientBuilder.build()
                    .get()
                    .uri(GoogleMeetEndpoints.USERINFO_URL)
                    .header("Authorization", "Bearer " + token)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(java.time.Duration.ofSeconds(15))
                    .doOnError(e -> VendorCallLog.failed(GoogleMeetEndpoints.USERINFO_URL, "test connection userinfo", null, e))
                    .block();

            String email = me != null && me.hasNonNull("email") ? me.get("email").asText()
                    : account.getOrganizerEmail();

            account.setLastVerifiedAt(new Date());
            account.setStatus(STATUS_ACTIVE);
            store.update(account);

            return GoogleTestConnectionResponse.builder().ok(true).accountEmail(email).build();

        } catch (WebClientResponseException e) {
            int status = e.getStatusCode().value();
            if (status == 401 || status == 403) {
                account.setStatus(STATUS_RECONNECT);
                store.update(account);
                accessTokenService.evict(account.getId());
            }
            return GoogleTestConnectionResponse.builder().ok(false)
                    .error("Google returned HTTP " + status).build();
        } catch (VacademyException e) {
            // refreshAndGet already flips RECONNECT_NEEDED on invalid_grant.
            return GoogleTestConnectionResponse.builder().ok(false).error(e.getMessage()).build();
        } catch (Exception e) {
            log.error("google.test_connection accountId={} unexpected={}", account.getId(),
                    e.getClass().getSimpleName());
            return GoogleTestConnectionResponse.builder().ok(false)
                    .error("Connection failed: " + e.getClass().getSimpleName()).build();
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private GoogleAccount loadOwned(String instituteId, String id) {
        return store.findByIdAndInstitute(id, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Google account not found"));
    }

    private GoogleAccount applyDefault(String instituteId, String targetId) {
        store.clearDefault(instituteId);
        GoogleAccount target = store.findByIdAndInstitute(targetId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Google account vanished mid-update"));
        target.setIsDefault(true);
        return store.update(target);
    }

    private GoogleAccountSummary toSummary(GoogleAccount a) {
        return GoogleAccountSummary.builder()
                .id(a.getId())
                .label(a.getLabel())
                .organizerEmail(a.getOrganizerEmail())
                .status(a.getStatus())
                .isDefault(a.isDefault())
                .recordingEnabled(a.isRecordingEnabled())
                .defaultAccessType(a.getDefaultAccessType())
                .defaultTimezone(a.getDefaultTimezone())
                .lastVerifiedAt(a.getLastVerifiedAt())
                .createdAt(a.getCreatedAt())
                .build();
    }
}
