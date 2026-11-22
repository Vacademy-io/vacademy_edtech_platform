package vacademy.io.auth_service.feature.sso.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.auth.manager.LearnerAuthManager;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;
import vacademy.io.auth_service.feature.sso.entity.SsoHandoffCode;
import vacademy.io.auth_service.feature.sso.entity.SsoLoginAttempt;
import vacademy.io.auth_service.feature.sso.entity.UserSsoIdentity;
import vacademy.io.auth_service.feature.sso.repository.SsoHandoffCodeRepository;
import vacademy.io.auth_service.feature.sso.repository.SsoLoginAttemptRepository;
import vacademy.io.auth_service.feature.sso.repository.UserSsoIdentityRepository;
import vacademy.io.auth_service.feature.user.service.UserSessionService;
import vacademy.io.common.auth.dto.learner.UserWithJwtDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.OriginInstituteResolver;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Learner sign-in through an institute's OIDC provider.
 *
 * <pre>
 * portal  → GET  /open/v1/sso/start?institute_id|connection_id, portal_origin, return_path
 *         → 302 provider (code flow, PKCE S256, nonce, random state stored in sso_login_attempt)
 * provider→ GET  /open/v1/sso/oidc/callback?code&state
 *         → validate, resolve account, sync batches, mint a 60-second one-time code
 *         → 302 {portal_origin}{return_path}?sso_code=…
 * portal  → POST /open/v1/sso/exchange {code} → access + refresh token
 * </pre>
 *
 * Tokens never travel in a URL. A failure sends the learner to {portal}/login?sso_error=<code>.
 */
@Service
public class SsoLoginService {

    private static final Logger log = LoggerFactory.getLogger(SsoLoginService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    static final Duration ATTEMPT_TTL = Duration.ofMinutes(10);
    static final Duration HANDOFF_TTL = Duration.ofSeconds(60);

    private final SsoConnectionService connections;
    private final OidcProviderClient provider;
    private final SsoAccountService accounts;
    private final SsoEnrolmentSyncClient enrolments;
    private final SsoLoginAttemptRepository attempts;
    private final SsoHandoffCodeRepository handoffs;
    private final UserSsoIdentityRepository identities;
    private final LearnerAuthManager learnerAuthManager;
    private final UserSessionService userSessionService;
    private final OriginInstituteResolver originInstituteResolver;
    private final InstituteInternalService instituteInternalService;

    public SsoLoginService(SsoConnectionService connections, OidcProviderClient provider, SsoAccountService accounts,
                           SsoEnrolmentSyncClient enrolments, SsoLoginAttemptRepository attempts,
                           SsoHandoffCodeRepository handoffs, UserSsoIdentityRepository identities,
                           LearnerAuthManager learnerAuthManager, UserSessionService userSessionService,
                           OriginInstituteResolver originInstituteResolver,
                           InstituteInternalService instituteInternalService) {
        this.connections = connections;
        this.provider = provider;
        this.accounts = accounts;
        this.enrolments = enrolments;
        this.attempts = attempts;
        this.handoffs = handoffs;
        this.identities = identities;
        this.learnerAuthManager = learnerAuthManager;
        this.userSessionService = userSessionService;
        this.originInstituteResolver = originInstituteResolver;
        this.instituteInternalService = instituteInternalService;
    }

    // ── start ────────────────────────────────────────────────────────────────

    /** @return the provider URL to send the browser to */
    public String start(String connectionId, String instituteId, String portalOrigin, String returnPath,
                        String loginHint, boolean testMode) {
        InstituteSsoConnection connection = (StringUtils.hasText(connectionId)
                ? connections.findById(connectionId) : connections.findByInstitute(instituteId))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Single sign-on is not set up"));
        if (!connection.isEnabled() && !testMode) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Single sign-on is switched off for this institute");
        }
        String origin = resolvePortalOrigin(connection.getInstituteId(), portalOrigin);
        OidcProviderClient.Discovery discovery = provider.discover(connection.getIssuer());

        String state = randomToken(32);
        String nonce = randomToken(32);
        String verifier = randomToken(48);
        Date now = new Date();
        attempts.deleteExpiredBefore(new Date(now.getTime() - Duration.ofDays(1).toMillis()));
        attempts.save(SsoLoginAttempt.builder()
                .state(state)
                .connectionId(connection.getId())
                .nonce(nonce)
                .codeVerifier(verifier)
                .portalOrigin(origin)
                .returnPath(safeReturnPath(returnPath))
                .mode(testMode ? SsoLoginAttempt.MODE_TEST : SsoLoginAttempt.MODE_LOGIN)
                .expiresAt(new Date(now.getTime() + ATTEMPT_TTL.toMillis()))
                .build());
        return provider.authorizationUrl(discovery, connection.getClientId(), connections.redirectUri(),
                connection.getScopes(), state, nonce, s256(verifier), loginHint);
    }

    /**
     * The portal origin to come back to: the one the portal sent when its host belongs to the
     * institute, else the institute's configured learner portal (provider-started sign-ins send none).
     */
    String resolvePortalOrigin(String instituteId, String requested) {
        String configured = configuredPortalOrigin(instituteId);
        String origin = originOf(requested);
        if (origin == null) {
            if (configured == null) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "No learner portal is set for this institute");
            }
            return configured;
        }
        if (origin.equals(configured)) {
            return origin;
        }
        String host = URI.create(origin).getHost();
        if (instituteId.equals(originInstituteResolver.resolveInstituteIdFromHost(host))) {
            return origin;
        }
        throw new VacademyException(HttpStatus.BAD_REQUEST, "This portal address does not belong to the institute");
    }

    private String configuredPortalOrigin(String instituteId) {
        try {
            var info = instituteInternalService.getInstituteByInstituteId(instituteId);
            return info == null ? null : originOf(info.getLearnerPortalUrl());
        } catch (Exception e) {
            log.warn("SSO: could not read the learner portal of institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /** "https://host[:port]" for an https URL (http only for localhost), else null. */
    static String originOf(String url) {
        if (!StringUtils.hasText(url)) {
            return null;
        }
        String candidate = url.trim();
        if (!candidate.contains("://")) {
            candidate = "https://" + candidate;
        }
        try {
            URI uri = URI.create(candidate);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if (host == null || uri.getUserInfo() != null) {
                return null;
            }
            host = host.toLowerCase(Locale.ROOT);
            boolean local = host.equals("localhost") || host.equals("127.0.0.1");
            if (!scheme.equals("https") && !(scheme.equals("http") && local)) {
                return null;
            }
            return scheme + "://" + host + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** A same-site path ("/x"), never "//host" or a URL. */
    static String safeReturnPath(String path) {
        if (!StringUtils.hasText(path)) {
            return null;
        }
        String trimmed = path.trim();
        if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")
                || trimmed.length() > 1000 || trimmed.chars().anyMatch(c -> c < 0x20)) {
            return null;
        }
        return trimmed;
    }

    // ── callback ─────────────────────────────────────────────────────────────

    /** Where the browser goes after the callback, or an HTML page to show (test mode, broken state). */
    public record CallbackResult(String redirectUrl, String html) {
    }

    public CallbackResult callback(String code, String state, String error, String errorDescription) {
        SsoLoginAttempt attempt = state == null ? null : attempts.findById(state).orElse(null);
        if (attempt == null) {
            return new CallbackResult(null, page("Sign-in link expired",
                    "This sign-in was not started here or has already been used. Go back to the learner portal and try again.", null));
        }
        if (attempts.consume(state, new Date()) != 1) {
            return new CallbackResult(failRedirect(attempt, "expired"), null);
        }
        boolean test = SsoLoginAttempt.MODE_TEST.equals(attempt.getMode());
        try {
            if (StringUtils.hasText(error)) {
                log.info("SSO provider returned error={} description={}", error, errorDescription);
                throw new SsoFailure("access_denied".equals(error) ? "access_denied" : "provider_error",
                        "The provider stopped the sign-in: " + error
                                + (errorDescription != null ? " (" + errorDescription + ")" : ""));
            }
            if (!StringUtils.hasText(code)) {
                throw new SsoFailure("provider_error", "The provider sent no sign-in code");
            }
            InstituteSsoConnection connection = connections.findById(attempt.getConnectionId())
                    .orElseThrow(() -> new SsoFailure("not_configured", "Single sign-on was removed"));
            if (!connection.isEnabled() && !test) {
                throw new SsoFailure("not_configured", "Single sign-on is switched off");
            }
            OidcProviderClient.Discovery discovery = provider.discover(connection.getIssuer());
            OidcProviderClient.TokenResponse tokens = provider.exchangeCode(discovery, connection.getClientId(),
                    connections.clientSecret(connection), connection.getTokenAuthMethod(), code,
                    connections.redirectUri(), attempt.getCodeVerifier());
            Jwt idToken = provider.validateIdToken(discovery, connection.getClientId(), tokens.idToken(),
                    attempt.getNonce());
            Map<String, Object> claimMap = new LinkedHashMap<>(idToken.getClaims());
            SsoClaims claims = SsoClaims.from(claimMap, connection);
            if (needsUserinfo(claims, connection)) {
                claimMap = SsoClaims.merge(idToken.getClaims(), provider.userinfo(discovery, tokens.accessToken()));
                claims = SsoClaims.from(claimMap, connection);
            }
            if (test) {
                return new CallbackResult(null, testReport(connection, claimMap, claims));
            }
            return new CallbackResult(finishLogin(connection, attempt, claims), null);
        } catch (SsoFailure failure) {
            log.info("SSO sign-in failed: code={} reason={}", failure.getCode(), failure.getMessage());
            if (test) {
                return new CallbackResult(null, page("Test failed", failure.getMessage(), null));
            }
            return new CallbackResult(failRedirect(attempt, failure.getCode()), null);
        } catch (VacademyException e) {
            log.warn("SSO sign-in failed: {}", e.getMessage());
            if (test) {
                return new CallbackResult(null, page("Test failed", e.getMessage(), null));
            }
            return new CallbackResult(failRedirect(attempt, "provider_error"), null);
        }
    }

    private static boolean needsUserinfo(SsoClaims claims, InstituteSsoConnection connection) {
        return claims.email() == null
                || (StringUtils.hasText(connection.getClaimGroups()) && claims.groups().isEmpty());
    }

    /** Checks access, resolves the account, syncs batches, mints the handoff code. */
    private String finishLogin(InstituteSsoConnection connection, SsoLoginAttempt attempt, SsoClaims claims) {
        if (!StringUtils.hasText(claims.subject())) {
            throw new SsoFailure("missing_user_id", "The provider sent no " + connection.getClaimUserId() + " claim");
        }
        if (!StringUtils.hasText(claims.email())) {
            throw new SsoFailure("missing_email", "The provider sent no email address");
        }
        if (Boolean.FALSE.equals(claims.emailVerified())) {
            throw new SsoFailure("email_not_verified", "The provider says this email address is not verified");
        }
        if (!SsoEmailDomains.covers(SsoEmailDomains.parse(connection.getEmailDomains()), claims.email())) {
            throw new SsoFailure("email_domain_not_allowed",
                    "Email domain " + SsoEmailDomains.domainOf(claims.email()) + " is not set up for this institute");
        }
        if (!SsoAccessPolicy.isAllowed(connection.getAccessMode(),
                SsoConnectionService.list(connection.getAllowedGroups()), claims.groups())) {
            throw new SsoFailure("not_assigned", "The user is not in a group allowed to sign in");
        }

        SsoAccountService.Resolved resolved = accounts.resolve(connection, claims);
        String userId = resolved.user().getId();
        String instituteId = connection.getInstituteId();

        if (userSessionService.checkSessionLimit(userId, instituteId).isPresent()) {
            throw new SsoFailure("session_limit", "The learner is signed in on too many devices");
        }

        syncBatches(connection, resolved, claims);

        String code = randomToken(32);
        Date now = new Date();
        handoffs.deleteExpiredBefore(new Date(now.getTime() - Duration.ofDays(1).toMillis()));
        handoffs.save(SsoHandoffCode.builder()
                .codeHash(sha256Hex(code))
                .userId(userId)
                .instituteId(instituteId)
                .connectionId(connection.getId())
                .expiresAt(new Date(now.getTime() + HANDOFF_TTL.toMillis()))
                .build());
        String path = attempt.getReturnPath() == null ? "/" : attempt.getReturnPath();
        return attempt.getPortalOrigin() + path + (path.contains("?") ? "&" : "?") + "sso_code=" + enc(code);
    }

    private void syncBatches(InstituteSsoConnection connection, SsoAccountService.Resolved resolved, SsoClaims claims) {
        UserSsoIdentity identity = resolved.identity();
        Set<String> desired = SsoAccessPolicy.desiredPackageSessions(
                SsoConnectionService.list(connection.getDefaultPackageSessionIds()),
                SsoConnectionService.rules(connection), claims.groups());
        List<String> previous = SsoConnectionService.list(identity.getGrantedPackageSessionIds());
        Set<String> remove = SsoAccessPolicy.toRemove(previous, desired, connection.isRemoveAccessOnGroupLoss());
        boolean synced = enrolments.sync(connection.getInstituteId(), resolved.user().getId(),
                resolved.user().getUsername(), resolved.user().getFullName(), resolved.user().getEmail(),
                resolved.user().getMobileNumber(), desired, remove);
        if (synced) {
            identity.setGrantedPackageSessionIds(SsoConnectionService.json(
                    SsoAccessPolicy.grantedAfterSync(previous, desired, connection.isRemoveAccessOnGroupLoss())));
        }
        identity.setEmail(claims.email());
        identity.setLastLoginAt(new Date());
        identity.setUpdatedAt(new Date());
        identities.save(identity);
    }

    // ── exchange ─────────────────────────────────────────────────────────────

    /** Swaps a one-time code for tokens. */
    public UserWithJwtDTO exchange(String code) {
        if (!StringUtils.hasText(code) || code.length() > 200) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Sign-in code is missing");
        }
        String hash = sha256Hex(code.trim());
        Optional<SsoHandoffCode> row = handoffs.findById(hash);
        if (row.isEmpty() || handoffs.consume(hash, new Date()) != 1) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Sign-in code is invalid or expired");
        }
        SsoHandoffCode handoff = row.get();
        UserWithJwtDTO tokens = learnerAuthManager.generateTokenForUserByUserId(handoff.getUserId(),
                handoff.getInstituteId());
        userSessionService.createSession(handoff.getUserId(), handoff.getInstituteId(), tokens.getAccessToken(), "WEB");
        log.info("SSO sign-in completed: user={} institute={} connection={}", handoff.getUserId(),
                handoff.getInstituteId(), handoff.getConnectionId());
        return tokens;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static String failRedirect(SsoLoginAttempt attempt, String code) {
        return attempt.getPortalOrigin() + "/login?sso_error=" + enc(code);
    }

    private String testReport(InstituteSsoConnection connection, Map<String, Object> claimMap, SsoClaims claims) {
        StringBuilder rows = new StringBuilder();
        rows.append(row("User id (" + connection.getClaimUserId() + ")", claims.subject()));
        rows.append(row("Email", claims.email()));
        rows.append(row("Email verified", claims.emailVerified() == null ? "not sent" : claims.emailVerified().toString()));
        rows.append(row("Name", claims.fullName()));
        rows.append(row("Phone", claims.phone()));
        rows.append(row("Groups", claims.groups().isEmpty() ? "none" : String.join(", ", claims.groups())));
        boolean domainOk = SsoEmailDomains.covers(SsoEmailDomains.parse(connection.getEmailDomains()), claims.email());
        boolean allowed = SsoAccessPolicy.isAllowed(connection.getAccessMode(),
                SsoConnectionService.list(connection.getAllowedGroups()), claims.groups());
        Set<String> batches = SsoAccessPolicy.desiredPackageSessions(
                SsoConnectionService.list(connection.getDefaultPackageSessionIds()),
                SsoConnectionService.rules(connection), claims.groups());
        rows.append(row("Email domain allowed", domainOk ? "yes" : "NO"));
        rows.append(row("Allowed to sign in", allowed ? "yes" : "NO (not in an allowed group)"));
        rows.append(row("Batches they would get", batches.isEmpty() ? "none" : String.join(", ", batches)));
        StringBuilder raw = new StringBuilder();
        claimMap.forEach((key, value) -> raw.append(row(key, String.valueOf(value))));
        String verdict = claims.subject() != null && claims.email() != null && domainOk && allowed
                && !Boolean.FALSE.equals(claims.emailVerified())
                ? "The connection works. This person would be signed in."
                : "The provider answered, but this person would NOT be signed in. See the rows marked NO or empty.";
        return page("Test sign-in result", verdict,
                "<h2>What we read</h2><table>" + rows + "</table>"
                        + "<h2>Everything the provider sent</h2><table>" + raw + "</table>"
                        + "<p>Nobody was signed in and no account was created. You can close this tab.</p>");
    }

    private static String row(String key, String value) {
        return "<tr><th>" + esc(key) + "</th><td>" + esc(value == null ? "" : value) + "</td></tr>";
    }

    static String page(String title, String message, String bodyHtml) {
        return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>" + esc(title) + "</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1f2937}"
                + "table{border-collapse:collapse;width:100%;margin:8px 0 24px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top;font-size:14px;word-break:break-word}"
                + "th{width:34%;background:#f9fafb;font-weight:600}h1{font-size:22px}h2{font-size:16px;margin-top:24px}</style></head><body>"
                + "<h1>" + esc(title) + "</h1><p>" + esc(message) + "</p>" + (bodyHtml == null ? "" : bodyHtml) + "</body></html>";
    }

    /** A plain page with a title and one message. */
    public static String plainPage(String title, String message) {
        return page(title, message == null ? "" : message, null);
    }

    static String esc(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }

    static String randomToken(int bytes) {
        byte[] buffer = new byte[bytes];
        RANDOM.nextBytes(buffer);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buffer);
    }

    static String s256(String verifier) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(verifier));
    }

    static String sha256Hex(String value) {
        return HexFormat.of().formatHex(sha256(value));
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
