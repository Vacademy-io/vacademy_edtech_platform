package vacademy.io.admin_core_service.features.booking.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.OAuthConnectState;
import vacademy.io.admin_core_service.features.audience.repository.OAuthConnectStateRepository;
import vacademy.io.admin_core_service.features.booking.entity.UserGoogleAccount;
import vacademy.io.admin_core_service.features.booking.repository.UserGoogleAccountRepository;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleAccountStore;
import vacademy.io.admin_core_service.features.live_session.provider.service.google.GoogleOAuthService;
import vacademy.io.admin_core_service.features.mentorship.entity.Mentor;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Each user (counsellor, mentor, any host) connects THEIR OWN Google account so My Schedule,
 * Meet links and calendar events belong to them rather than the institute default.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class UserGoogleAccountService {

    public static final String VENDOR = "GOOGLE_OAUTH";

    private final UserGoogleAccountRepository repository;
    private final OAuthConnectStateRepository stateRepository;
    private final GoogleOAuthService googleOAuthService;
    private final GoogleAccountStore googleAccountStore;
    private final MentorRepository mentorRepository;

    /** Consent URL for the caller; the callback links the account to them and returns to {@code returnPath}. */
    public Map<String, String> initiate(String instituteId, CustomUserDetails user, String returnPath) {
        OAuthConnectState state = stateRepository.save(OAuthConnectState.builder()
                .instituteId(instituteId)
                .vendor(VENDOR)
                .initiatedBy(user.getUserId())
                .linkToUser(true)
                .returnPath(returnPath)
                .expiresAt(LocalDateTime.now().plusMinutes(10))
                .build());
        Map<String, String> out = new LinkedHashMap<>();
        out.put("oauth_url", googleOAuthService.buildAuthorizeUrl(state.getId()));
        out.put("session_key", state.getId());
        return out;
    }

    @Transactional
    public void link(String instituteId, String userId, String googleAccountId) {
        UserGoogleAccount row = repository.findByInstituteIdAndUserId(instituteId, userId)
                .orElseGet(() -> UserGoogleAccount.builder().instituteId(instituteId).userId(userId).build());
        row.setGoogleAccountId(googleAccountId);
        repository.save(row);
    }

    /** Status for the My Schedule card: connected flag, email and whether a reconnect is needed. */
    public Map<String, Object> status(String instituteId, String userId) {
        Map<String, Object> out = new LinkedHashMap<>();
        Optional<GoogleAccount> account = accountFor(instituteId, userId)
                .flatMap(googleAccountStore::findById);
        out.put("connected", account.isPresent());
        out.put("email", account.map(GoogleAccount::getOrganizerEmail).orElse(null));
        out.put("status", account.map(GoogleAccount::getStatus).orElse(null));
        return out;
    }

    /** Unlink only — the underlying account may be shared with Live Session settings, so it is not deleted. */
    @Transactional
    public void disconnect(String instituteId, String userId) {
        repository.findByInstituteIdAndUserId(instituteId, userId).ifPresent(repository::delete);
    }

    /**
     * The Google account bookings hosted by this user should use: their own connection, then
     * their mentor connection; empty means "fall back to the institute default".
     */
    public Optional<String> resolveAccountId(String instituteId, String userId) {
        // A link to an account since removed in Live Session settings must fall back, not break the booking.
        return accountFor(instituteId, userId)
                .filter(id -> googleAccountStore.findByIdAndInstitute(id, instituteId).isPresent());
    }

    private Optional<String> accountFor(String instituteId, String userId) {
        if (instituteId == null || userId == null) return Optional.empty();
        try {
            Optional<String> own = repository.findByInstituteIdAndUserId(instituteId, userId)
                    .map(UserGoogleAccount::getGoogleAccountId)
                    .filter(id -> !id.isBlank());
            if (own.isPresent()) return own;
            return mentorRepository.findByInstituteIdAndUserIdAndStatusNot(instituteId, userId, "DELETED")
                    .map(Mentor::getGoogleAccountId)
                    .filter(id -> id != null && !id.isBlank());
        } catch (Exception e) {
            log.warn("Resolving Google account for user {} failed: {}", userId, e.getMessage());
            return Optional.empty();
        }
    }
}
