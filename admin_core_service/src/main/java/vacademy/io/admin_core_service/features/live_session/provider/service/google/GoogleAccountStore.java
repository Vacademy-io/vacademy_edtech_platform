package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig;
import vacademy.io.admin_core_service.features.live_session.provider.repository.LiveSessionProviderConfigRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.enums.MeetingProvider;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Persistence for connected Google accounts on the shared
 * {@code institute_live_session_provider_mapping} table (provider = GOOGLE_MEET) — one row
 * per connected account, the OAuth refresh token stored AES-encrypted inside config_json.
 * Maps rows to/from {@link GoogleAccount} so the rest of the Google code is agnostic to
 * where credentials live. Mirrors {@code ZoomAccountStore}; no dedicated table/migration
 * (V164 already supports many rows per (institute, provider) via vendor_user_id).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleAccountStore {

    private static final String PROVIDER = MeetingProvider.GOOGLE_MEET.name();
    private static final List<String> ACTIVE = List.of("ACTIVE");

    private final LiveSessionProviderConfigRepository repository;
    private final ObjectMapper objectMapper;
    private final vacademy.io.admin_core_service.features.booking.repository.UserGoogleAccountRepository userGoogleAccountRepository;

    // ── Reads ────────────────────────────────────────────────────────────────

    public List<GoogleAccount> listByInstitute(String instituteId) {
        return repository.findByInstituteIdAndStatusIn(instituteId, ACTIVE).stream()
                .filter(c -> PROVIDER.equals(c.getProvider()))
                .map(this::toAccount)
                .sorted((a, b) -> a.getLabel() == null ? 1
                        : a.getLabel().compareToIgnoreCase(b.getLabel() == null ? "" : b.getLabel()))
                .collect(Collectors.toList());
    }

    public Optional<GoogleAccount> findByIdAndInstitute(String id, String instituteId) {
        return repository.findById(id)
                .filter(c -> PROVIDER.equals(c.getProvider()) && instituteId.equals(c.getInstituteId()))
                .map(this::toAccount);
    }

    public Optional<GoogleAccount> findById(String id) {
        return repository.findById(id)
                .filter(c -> PROVIDER.equals(c.getProvider()))
                .map(this::toAccount);
    }

    public Optional<GoogleAccount> findDefault(String instituteId) {
        List<GoogleAccount> all = listByInstitute(instituteId);
        return all.stream().filter(GoogleAccount::isDefault).findFirst()
                // Single-organizer is the common case — fall back to the only/first account, but
                // never to a user's personal connection (My Schedule): that must not become the
                // institute-wide default just because no account is flagged default.
                .or(() -> {
                    Set<String> personal = userGoogleAccountRepository.findByInstituteId(instituteId).stream()
                            .map(u -> u.getGoogleAccountId())
                            .collect(Collectors.toSet());
                    return all.stream().filter(a -> !personal.contains(a.getId())).findFirst();
                });
    }

    public Optional<GoogleAccount> findByInstituteAndEmail(String instituteId, String organizerEmail) {
        return listByInstitute(instituteId).stream()
                .filter(a -> organizerEmail.equalsIgnoreCase(a.getOrganizerEmail()))
                .findFirst();
    }

    // ── Writes ───────────────────────────────────────────────────────────────

    public GoogleAccount create(GoogleAccount account) {
        LiveSessionProviderConfig row = LiveSessionProviderConfig.builder()
                .instituteId(account.getInstituteId())
                .provider(PROVIDER)
                .vendorUserId(account.getOrganizerEmail()) // natural key + per-institute dedup
                .configJson(writeConfig(account))
                .status("ACTIVE")
                .updatedAt(new Date())
                .build();
        return toAccount(repository.save(row));
    }

    public GoogleAccount update(GoogleAccount account) {
        LiveSessionProviderConfig row = repository.findById(account.getId())
                .orElseThrow(() -> new VacademyException("Google account not found"));
        row.setVendorUserId(account.getOrganizerEmail());
        row.setConfigJson(writeConfig(account));
        if (account.getStatus() != null) {
            row.setStatus(account.getStatus());
        }
        row.setUpdatedAt(new Date());
        return toAccount(repository.save(row));
    }

    public void delete(String id) {
        repository.deleteById(id);
    }

    /** Clears the default flag on every Google account for an institute. */
    public void clearDefault(String instituteId) {
        for (LiveSessionProviderConfig c : repository.findByInstituteIdAndStatusIn(instituteId, ACTIVE)) {
            if (!PROVIDER.equals(c.getProvider())) continue;
            GoogleAccount a = toAccount(c);
            if (a.isDefault()) {
                a.setIsDefault(false);
                c.setConfigJson(writeConfig(a));
                c.setUpdatedAt(new Date());
                repository.save(c);
            }
        }
    }

    // ── Mapping ──────────────────────────────────────────────────────────────

    private GoogleAccount toAccount(LiveSessionProviderConfig row) {
        Map<String, Object> cfg;
        try {
            cfg = (row.getConfigJson() == null || row.getConfigJson().isBlank())
                    ? new LinkedHashMap<>()
                    : objectMapper.readValue(row.getConfigJson(), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.error("google.account parse failed for row {}: {}", row.getId(), e.getMessage());
            cfg = new LinkedHashMap<>();
        }

        Object lastVerified = cfg.get("lastVerifiedAt");
        return GoogleAccount.builder()
                .id(row.getId())
                .instituteId(row.getInstituteId())
                .status(row.getStatus())
                .createdAt(row.getCreatedAt())
                .label((String) cfg.get("label"))
                .organizerEmail((String) cfg.getOrDefault("organizerEmail", row.getVendorUserId()))
                .oauthRefreshTokenEnc((String) cfg.get("oauthRefreshTokenEnc"))
                .grantedScopes((String) cfg.get("grantedScopes"))
                .recordingEnabled(Boolean.TRUE.equals(cfg.get("recordingEnabled")))
                .defaultAccessType((String) cfg.getOrDefault("defaultAccessType", "OPEN"))
                .defaultTimezone((String) cfg.get("defaultTimezone"))
                .isDefault(Boolean.TRUE.equals(cfg.get("isDefault")))
                .lastVerifiedAt(lastVerified instanceof Number n ? new Date(n.longValue()) : null)
                .build();
    }

    private String writeConfig(GoogleAccount a) {
        Map<String, Object> cfg = new LinkedHashMap<>();
        cfg.put("label", a.getLabel());
        cfg.put("organizerEmail", a.getOrganizerEmail());
        cfg.put("oauthRefreshTokenEnc", a.getOauthRefreshTokenEnc());
        cfg.put("grantedScopes", a.getGrantedScopes());
        cfg.put("recordingEnabled", a.isRecordingEnabled());
        cfg.put("defaultAccessType", a.getDefaultAccessType());
        cfg.put("defaultTimezone", a.getDefaultTimezone());
        cfg.put("isDefault", a.isDefault());
        if (a.getLastVerifiedAt() != null) {
            cfg.put("lastVerifiedAt", a.getLastVerifiedAt().getTime());
        }
        try {
            return objectMapper.writeValueAsString(cfg);
        } catch (Exception e) {
            throw new VacademyException("Failed to serialize Google account config");
        }
    }
}
