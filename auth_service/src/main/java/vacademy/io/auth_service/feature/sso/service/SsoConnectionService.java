package vacademy.io.auth_service.feature.sso.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.institute_oauth.service.OAuthClientSecretCipher;
import vacademy.io.auth_service.feature.sso.dto.SsoConnectionRequest;
import vacademy.io.auth_service.feature.sso.dto.SsoConnectionResponse;
import vacademy.io.auth_service.feature.sso.dto.SsoGroupRule;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;
import vacademy.io.auth_service.feature.sso.repository.InstituteSsoConnectionRepository;
import vacademy.io.auth_service.feature.sso.repository.UserSsoIdentityRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/** Reads and writes an institute's SSO connection. */
@Service
public class SsoConnectionService {

    static final String CALLBACK_PATH = "/auth-service/open/v1/sso/oidc/callback";
    static final String START_PATH = "/auth-service/open/v1/sso/start";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern CLAIM = Pattern.compile("^[A-Za-z0-9_.:/-]{1,100}$");
    private static final Set<String> AUTH_METHODS = Set.of("client_secret_basic", "client_secret_post", "none");

    private final InstituteSsoConnectionRepository repository;
    private final UserSsoIdentityRepository identityRepository;
    private final OAuthClientSecretCipher cipher;
    private final OidcProviderClient providerClient;
    private final String publicBaseUrl;

    public SsoConnectionService(InstituteSsoConnectionRepository repository,
                                UserSsoIdentityRepository identityRepository,
                                OAuthClientSecretCipher cipher, OidcProviderClient providerClient,
                                @Value("${sso.public-base-url:https://backend-stage.vacademy.io}") String publicBaseUrl) {
        this.repository = repository;
        this.identityRepository = identityRepository;
        this.cipher = cipher;
        this.providerClient = providerClient;
        this.publicBaseUrl = OidcProviderClient.normaliseIssuer(publicBaseUrl);
    }

    public String redirectUri() {
        return publicBaseUrl + CALLBACK_PATH;
    }

    public String initiateLoginUri(String connectionId) {
        return publicBaseUrl + START_PATH + "?connection_id=" + connectionId;
    }

    public Optional<InstituteSsoConnection> findByInstitute(String instituteId) {
        return repository.findByInstituteId(instituteId);
    }

    public Optional<InstituteSsoConnection> findById(String id) {
        return id == null ? Optional.empty() : repository.findById(id);
    }

    public String clientSecret(InstituteSsoConnection connection) {
        if (!StringUtils.hasText(connection.getClientSecretEncrypted())) {
            return null;
        }
        String secret = cipher.decryptOrNull(connection.getClientSecretEncrypted());
        if (secret == null) {
            throw new SsoFailure("misconfigured", "The stored client secret could not be decrypted");
        }
        return secret;
    }

    @Transactional
    public InstituteSsoConnection save(String instituteId, SsoConnectionRequest body, String userId) {
        if (body == null) {
            throw bad("Request body is required");
        }
        InstituteSsoConnection row = repository.findByInstituteId(instituteId).orElseGet(() ->
                InstituteSsoConnection.builder().instituteId(instituteId).createdBy(userId).build());

        row.setDisplayName(required(body.getDisplayName(), row.getDisplayName(), "display_name", 255));
        String issuer = OidcProviderClient.normaliseIssuer(required(body.getIssuer(), row.getIssuer(), "issuer", 1024));
        if (!issuer.toLowerCase(Locale.ROOT).startsWith("https://")) {
            throw bad("The issuer must be an https URL");
        }
        row.setIssuer(issuer);
        row.setClientId(required(body.getClientId(), row.getClientId(), "client_id", 512));
        if (body.getTokenAuthMethod() != null) {
            String method = body.getTokenAuthMethod().trim().toLowerCase(Locale.ROOT);
            if (!AUTH_METHODS.contains(method)) {
                throw bad("token_auth_method must be client_secret_basic, client_secret_post or none");
            }
            row.setTokenAuthMethod(method);
        }
        if (StringUtils.hasText(body.getClientSecret())) {
            if (!cipher.isConfigured()) {
                throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                        "Secret storage is not configured on this server");
            }
            row.setClientSecretEncrypted(cipher.encrypt(body.getClientSecret().trim()));
        }
        if (body.getScopes() != null) {
            String scopes = body.getScopes().trim().replaceAll("\\s+", " ");
            if (!(" " + scopes + " ").contains(" openid ")) {
                scopes = "openid " + scopes;
            }
            row.setScopes(scopes.trim());
        }
        if (body.getEmailDomains() != null) {
            List<String> domains = SsoEmailDomains.parse(String.join(",", body.getEmailDomains()));
            String error = SsoEmailDomains.validate(domains);
            if (error != null) {
                throw bad(error);
            }
            row.setEmailDomains(String.join(",", domains));
        }
        if (!StringUtils.hasText(row.getEmailDomains())) {
            throw bad("Add at least one email domain");
        }
        row.setClaimUserId(claim(body.getClaimUserId(), row.getClaimUserId(), "sub"));
        row.setClaimEmail(claim(body.getClaimEmail(), row.getClaimEmail(), "email"));
        row.setClaimName(claim(body.getClaimName(), row.getClaimName(), "name"));
        row.setClaimGivenName(claim(body.getClaimGivenName(), row.getClaimGivenName(), "given_name"));
        row.setClaimFamilyName(claim(body.getClaimFamilyName(), row.getClaimFamilyName(), "family_name"));
        if (body.getClaimPhone() != null) {
            row.setClaimPhone(optionalClaim(body.getClaimPhone()));
        }
        if (body.getClaimGroups() != null) {
            row.setClaimGroups(optionalClaim(body.getClaimGroups()));
        }
        if (body.getAccessMode() != null) {
            String mode = body.getAccessMode().trim().toUpperCase(Locale.ROOT);
            if (!SsoAccessPolicy.MODE_ALL.equals(mode) && !SsoAccessPolicy.MODE_GROUPS.equals(mode)) {
                throw bad("access_mode must be ALL or GROUPS");
            }
            row.setAccessMode(mode);
        }
        if (body.getAllowedGroups() != null) {
            row.setAllowedGroups(json(trimmed(body.getAllowedGroups())));
        }
        if (body.getDefaultPackageSessionIds() != null) {
            row.setDefaultPackageSessionIds(json(trimmed(body.getDefaultPackageSessionIds())));
        }
        if (body.getGroupRules() != null) {
            List<SsoGroupRule> rules = new ArrayList<>();
            for (SsoGroupRule rule : body.getGroupRules()) {
                if (rule == null || !StringUtils.hasText(rule.getGroup())) {
                    continue;
                }
                rules.add(new SsoGroupRule(rule.getGroup().trim(), trimmed(rule.getPackageSessionIds())));
            }
            row.setGroupRules(json(rules));
        }
        if (body.getRemoveAccessOnGroupLoss() != null) {
            row.setRemoveAccessOnGroupLoss(body.getRemoveAccessOnGroupLoss());
        }
        if (body.getTrustProviderEmail() != null) {
            row.setTrustProviderEmail(body.getTrustProviderEmail());
        }
        if (body.getAutoRedirect() != null) {
            row.setAutoRedirect(body.getAutoRedirect());
        }
        if (body.getEnabled() != null) {
            row.setEnabled(body.getEnabled());
        }
        boolean needsGroups = SsoAccessPolicy.MODE_GROUPS.equals(row.getAccessMode())
                || !rules(row).isEmpty();
        if (needsGroups && !StringUtils.hasText(row.getClaimGroups())) {
            throw bad("Set the groups claim name to use group-based access");
        }
        if (SsoAccessPolicy.MODE_GROUPS.equals(row.getAccessMode()) && list(row.getAllowedGroups()).isEmpty()) {
            throw bad("List at least one allowed group, or let everyone sign in");
        }
        if (row.isEnabled()) {
            if (!"none".equals(row.getTokenAuthMethod()) && !StringUtils.hasText(row.getClientSecretEncrypted())) {
                throw bad("Add the client secret before switching single sign-on on");
            }
            try {
                providerClient.discoverFresh(row.getIssuer());
            } catch (VacademyException e) {
                throw bad("Cannot switch on: the provider's discovery document failed: " + e.getMessage());
            }
        }
        row.setUpdatedBy(userId);
        row.setUpdatedAt(new Date());
        return repository.save(row);
    }

    @Transactional
    public boolean delete(String instituteId) {
        Optional<InstituteSsoConnection> row = repository.findByInstituteId(instituteId);
        row.ifPresent(repository::delete);
        return row.isPresent();
    }

    public SsoConnectionResponse toResponse(String instituteId, InstituteSsoConnection row) {
        SsoConnectionResponse.SsoConnectionResponseBuilder out = SsoConnectionResponse.builder()
                .instituteId(instituteId)
                .redirectUri(redirectUri());
        if (row == null) {
            return out.configured(false).build();
        }
        return out.configured(true)
                .id(row.getId())
                .protocol(row.getProtocol())
                .displayName(row.getDisplayName())
                .issuer(row.getIssuer())
                .clientId(row.getClientId())
                .clientSecretSet(StringUtils.hasText(row.getClientSecretEncrypted()))
                .tokenAuthMethod(row.getTokenAuthMethod())
                .scopes(row.getScopes())
                .emailDomains(SsoEmailDomains.parse(row.getEmailDomains()))
                .claimUserId(row.getClaimUserId())
                .claimEmail(row.getClaimEmail())
                .claimName(row.getClaimName())
                .claimGivenName(row.getClaimGivenName())
                .claimFamilyName(row.getClaimFamilyName())
                .claimPhone(row.getClaimPhone())
                .claimGroups(row.getClaimGroups())
                .accessMode(row.getAccessMode())
                .allowedGroups(list(row.getAllowedGroups()))
                .defaultPackageSessionIds(list(row.getDefaultPackageSessionIds()))
                .groupRules(rules(row))
                .removeAccessOnGroupLoss(row.isRemoveAccessOnGroupLoss())
                .trustProviderEmail(row.isTrustProviderEmail())
                .autoRedirect(row.isAutoRedirect())
                .enabled(row.isEnabled())
                .linkedUsers(identityRepository.countByConnectionId(row.getId()))
                .updatedAt(row.getUpdatedAt())
                .initiateLoginUri(initiateLoginUri(row.getId()))
                .build();
    }

    public static List<String> list(String json) {
        if (!StringUtils.hasText(json)) {
            return List.of();
        }
        try {
            List<String> values = MAPPER.readValue(json, new TypeReference<List<String>>() {
            });
            return values == null ? List.of() : values;
        } catch (Exception e) {
            return List.of();
        }
    }

    public static List<SsoGroupRule> rules(InstituteSsoConnection row) {
        if (!StringUtils.hasText(row.getGroupRules())) {
            return List.of();
        }
        try {
            List<SsoGroupRule> values = MAPPER.readValue(row.getGroupRules(), new TypeReference<List<SsoGroupRule>>() {
            });
            return values == null ? List.of() : values;
        } catch (Exception e) {
            return List.of();
        }
    }

    public static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<String> trimmed(List<String> values) {
        List<String> out = new ArrayList<>();
        if (values != null) {
            for (String value : values) {
                if (StringUtils.hasText(value) && !out.contains(value.trim())) {
                    out.add(value.trim());
                }
            }
        }
        return out;
    }

    private static String required(String incoming, String current, String field, int max) {
        String value = incoming != null ? incoming.trim() : current;
        if (!StringUtils.hasText(value)) {
            throw bad(field + " is required");
        }
        if (value.length() > max) {
            throw bad(field + " is too long");
        }
        return value;
    }

    private static String claim(String incoming, String current, String fallback) {
        if (incoming == null) {
            return StringUtils.hasText(current) ? current : fallback;
        }
        String value = incoming.trim();
        if (value.isEmpty()) {
            return fallback;
        }
        if (!CLAIM.matcher(value).matches()) {
            throw bad("Not a valid claim name: " + value);
        }
        return value;
    }

    private static String optionalClaim(String incoming) {
        String value = incoming.trim();
        if (value.isEmpty()) {
            return null;
        }
        if (!CLAIM.matcher(value).matches()) {
            throw bad("Not a valid claim name: " + value);
        }
        return value;
    }

    private static VacademyException bad(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }
}
