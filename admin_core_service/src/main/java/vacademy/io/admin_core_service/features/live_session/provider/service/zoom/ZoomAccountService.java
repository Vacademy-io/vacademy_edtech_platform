package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccountRequest;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccountSummary;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomTestConnectionResponse;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Business logic for institute-scoped Zoom account CRUD + connection testing.
 *
 * Accounts are persisted on the shared provider-mapping table via
 * {@link ZoomAccountStore}; this service owns encryption and the leave-blank-to-
 * preserve update semantics. Cross-tenant safety: every read/write is scoped by
 * instituteId so a crafted id from another tenant is rejected.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZoomAccountService {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String STATUS_INVALID = "INVALID_CREDENTIALS";

    private final ZoomAccountStore store;
    private final TokenEncryptionService encryption;
    private final ZoomAccessTokenService accessTokenService;
    private final WebClient.Builder webClientBuilder;


    // ── Read ────────────────────────────────────────────────────────────────

    public List<ZoomAccountSummary> list(String instituteId) {
        return store.listByInstitute(instituteId).stream()
                .map(this::toSummary)
                .collect(Collectors.toList());
    }

    public ZoomAccountSummary getOne(String instituteId, String id) {
        return toSummary(loadOwned(instituteId, id));
    }

    // ── Mutations ───────────────────────────────────────────────────────────

    @Transactional
    public ZoomAccountSummary create(String instituteId, ZoomAccountRequest req) {
        requireSecret(req.getS2sClientSecret(), "s2sClientSecret");
        // SDK credentials are optional: an account may rely on a platform-owned Meeting
        // SDK app (zoom.sdk.client-id/secret) for signing. Per-institute SDK creds stay
        // the default for learner-facing institutes (see ZoomSdkSignatureService).

        store.findByInstituteAndZoomAccountId(instituteId, req.getZoomAccountId())
                .ifPresent(a -> {
                    throw new VacademyException(HttpStatus.CONFLICT,
                            "This Zoom account is already registered for the institute");
                });

        ZoomAccount account = ZoomAccount.builder()
                .instituteId(instituteId)
                .label(req.getLabel())
                .zoomAccountId(req.getZoomAccountId())
                .s2sClientId(req.getS2sClientId())
                .s2sClientSecretEnc(encryption.encrypt(req.getS2sClientSecret()))
                .sdkClientKey(req.getSdkClientKey())
                .sdkClientSecretEnc(isBlank(req.getSdkClientSecret())
                        ? null : encryption.encrypt(req.getSdkClientSecret()))
                .webhookVerificationTokenEnc(isBlank(req.getWebhookVerificationToken())
                        ? null : encryption.encrypt(req.getWebhookVerificationToken()))
                .status(STATUS_ACTIVE)
                .isDefault(false)
                .build();

        ZoomAccount saved = store.create(account);

        if (Boolean.TRUE.equals(req.getSetAsDefault())) {
            saved = applyDefault(instituteId, saved.getId());
        }
        return toSummary(saved);
    }

    @Transactional
    public ZoomAccountSummary update(String instituteId, String id, ZoomAccountRequest req) {
        ZoomAccount account = loadOwned(instituteId, id);

        account.setLabel(req.getLabel());
        account.setZoomAccountId(req.getZoomAccountId());
        account.setS2sClientId(req.getS2sClientId());
        account.setSdkClientKey(req.getSdkClientKey());

        // Secret fields: blank → keep existing, non-blank → re-encrypt.
        if (!isBlank(req.getS2sClientSecret())) {
            account.setS2sClientSecretEnc(encryption.encrypt(req.getS2sClientSecret()));
            accessTokenService.evict(account.getId());
        }
        if (!isBlank(req.getSdkClientSecret())) {
            account.setSdkClientSecretEnc(encryption.encrypt(req.getSdkClientSecret()));
        }
        if (req.getWebhookVerificationToken() != null) {
            account.setWebhookVerificationTokenEnc(isBlank(req.getWebhookVerificationToken())
                    ? null : encryption.encrypt(req.getWebhookVerificationToken()));
        }

        ZoomAccount saved = store.update(account);

        if (Boolean.TRUE.equals(req.getSetAsDefault())) {
            saved = applyDefault(instituteId, saved.getId());
        }
        return toSummary(saved);
    }

    @Transactional
    public void delete(String instituteId, String id) {
        ZoomAccount account = loadOwned(instituteId, id);
        accessTokenService.evict(account.getId());
        store.delete(account.getId());
    }

    @Transactional
    public ZoomAccountSummary setDefault(String instituteId, String id) {
        loadOwned(instituteId, id); // tenant check
        return toSummary(applyDefault(instituteId, id));
    }

    // ── Test connection ─────────────────────────────────────────────────────

    @Transactional
    public ZoomTestConnectionResponse testConnection(String instituteId, String id) {
        ZoomAccount account = loadOwned(instituteId, id);
        try {
            String token = accessTokenService.getAccessToken(account);
            JsonNode me = webClientBuilder.build()
                    .get()
                    .uri(ZoomEndpoints.API_BASE_URL + "/users/me")
                    .header("Authorization", "Bearer " + token)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .doOnError(e -> VendorCallLog.failed(ZoomEndpoints.API_BASE_URL, "test connection users/me", null, e))
                    .block();

            String email = me != null && me.hasNonNull("email") ? me.get("email").asText() : null;
            String planType = me != null && me.hasNonNull("plan_type") ? me.get("plan_type").asText() : null;

            account.setLastVerifiedAt(new Date());
            account.setStatus(STATUS_ACTIVE);
            store.update(account);

            return ZoomTestConnectionResponse.builder()
                    .ok(true).accountEmail(email).planType(planType).build();

        } catch (WebClientResponseException e) {
            int status = e.getStatusCode().value();
            if (status == 401 || status == 403) {
                account.setStatus(STATUS_INVALID);
                store.update(account);
                accessTokenService.evict(account.getId());
            }
            return ZoomTestConnectionResponse.builder().ok(false)
                    .error("Zoom returned HTTP " + status).build();
        } catch (VacademyException e) {
            return ZoomTestConnectionResponse.builder().ok(false).error(e.getMessage()).build();
        } catch (Exception e) {
            log.error("zoom.test_connection accountId={} unexpected={}", account.getId(),
                    e.getClass().getSimpleName());
            return ZoomTestConnectionResponse.builder().ok(false)
                    .error("Connection failed: " + e.getClass().getSimpleName()).build();
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private ZoomAccount loadOwned(String instituteId, String id) {
        return store.findByIdAndInstitute(id, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Zoom account not found"));
    }

    /** Clears existing default and marks the target as default. Returns updated target. */
    private ZoomAccount applyDefault(String instituteId, String targetId) {
        store.clearDefault(instituteId);
        ZoomAccount target = store.findByIdAndInstitute(targetId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Zoom account vanished mid-update"));
        target.setIsDefault(true);
        return store.update(target);
    }

    private ZoomAccountSummary toSummary(ZoomAccount a) {
        return ZoomAccountSummary.builder()
                .id(a.getId())
                .label(a.getLabel())
                .zoomAccountIdMasked(mask(a.getZoomAccountId()))
                .s2sClientIdMasked(mask(a.getS2sClientId()))
                .sdkClientKeyMasked(mask(a.getSdkClientKey()))
                .webhookConfigured(a.getWebhookVerificationTokenEnc() != null)
                .status(a.getStatus())
                .isDefault(a.isDefault())
                .lastVerifiedAt(a.getLastVerifiedAt())
                .createdAt(a.getCreatedAt())
                .build();
    }

    private static String mask(String value) {
        if (value == null) return null;
        if (value.length() <= 10) return "…";
        return value.substring(0, 4) + "…" + value.substring(value.length() - 4);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static void requireSecret(String value, String fieldName) {
        if (isBlank(value)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, fieldName + " is required");
        }
    }
}
