package vacademy.io.auth_service.feature.sso.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.VacademyException;

import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Talks to an institute's OIDC provider: discovery, the authorization-code exchange, ID token
 * validation and userinfo.
 *
 * <p>Every URL comes from an institute admin, so each one must be https and must not resolve to
 * a loopback, private or link-local address (no reaching our own cluster through a "provider").
 * Redirects are never followed.
 */
@Component
public class OidcProviderClient {

    private static final Logger log = LoggerFactory.getLogger(OidcProviderClient.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Duration DISCOVERY_TTL = Duration.ofHours(1);
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final int MAX_BODY_CHARS = 1_000_000;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private final Map<String, CachedDiscovery> discoveryCache = new ConcurrentHashMap<>();
    private final Map<String, NimbusJwtDecoder> decoderCache = new ConcurrentHashMap<>();

    /** The parts of a discovery document we use. */
    public record Discovery(String issuer, String authorizationEndpoint, String tokenEndpoint,
                            String userinfoEndpoint, String jwksUri, String endSessionEndpoint,
                            List<String> idTokenSigningAlgs) {
    }

    /** What the token endpoint returned. */
    public record TokenResponse(String idToken, String accessToken) {
    }

    private record CachedDiscovery(Discovery discovery, long fetchedAtMillis) {
    }

    /** Discovery for an issuer, cached for an hour. */
    public Discovery discover(String issuer) {
        String normalised = normaliseIssuer(issuer);
        CachedDiscovery cached = discoveryCache.get(normalised);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAtMillis() < DISCOVERY_TTL.toMillis()) {
            return cached.discovery();
        }
        Discovery fresh = fetchDiscovery(normalised);
        discoveryCache.put(normalised, new CachedDiscovery(fresh, System.currentTimeMillis()));
        return fresh;
    }

    /** Discovery without the cache, for the admin "check" button. */
    public Discovery discoverFresh(String issuer) {
        String normalised = normaliseIssuer(issuer);
        Discovery fresh = fetchDiscovery(normalised);
        discoveryCache.put(normalised, new CachedDiscovery(fresh, System.currentTimeMillis()));
        return fresh;
    }

    private Discovery fetchDiscovery(String issuer) {
        String url = issuer + "/.well-known/openid-configuration";
        JsonNode doc = getJson(url, null);
        String declaredIssuer = text(doc, "issuer");
        // OIDC Discovery 4.3: the document's issuer must be the one we asked for.
        if (declaredIssuer == null || !normaliseIssuer(declaredIssuer).equals(issuer)) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY,
                    "The provider's discovery document names a different issuer (" + declaredIssuer + ")");
        }
        String authorization = requireHttps(text(doc, "authorization_endpoint"), "authorization_endpoint");
        String token = requireHttps(text(doc, "token_endpoint"), "token_endpoint");
        String jwks = requireHttps(text(doc, "jwks_uri"), "jwks_uri");
        String userinfo = text(doc, "userinfo_endpoint");
        String endSession = text(doc, "end_session_endpoint");
        List<String> algs = new java.util.ArrayList<>();
        JsonNode algNode = doc.path("id_token_signing_alg_values_supported");
        if (algNode.isArray()) {
            algNode.forEach(n -> algs.add(n.asText()));
        }
        return new Discovery(declaredIssuer, authorization, token,
                userinfo == null ? null : requireHttps(userinfo, "userinfo_endpoint"),
                jwks, endSession, algs);
    }

    /** The provider's sign-in URL for this attempt (code flow, PKCE S256, nonce). */
    public String authorizationUrl(Discovery discovery, String clientId, String redirectUri, String scopes,
                                   String state, String nonce, String codeChallenge, String loginHint) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("response_type", "code");
        params.put("client_id", clientId);
        params.put("redirect_uri", redirectUri);
        params.put("scope", scopes);
        params.put("state", state);
        params.put("nonce", nonce);
        params.put("code_challenge", codeChallenge);
        params.put("code_challenge_method", "S256");
        if (loginHint != null && !loginHint.isBlank()) {
            params.put("login_hint", loginHint);
        }
        String query = params.entrySet().stream()
                .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
        String endpoint = discovery.authorizationEndpoint();
        return endpoint + (endpoint.contains("?") ? "&" : "?") + query;
    }

    /** Swaps the authorization code for tokens. */
    public TokenResponse exchangeCode(Discovery discovery, String clientId, String clientSecret, String authMethod,
                                      String code, String redirectUri, String codeVerifier) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("code", code);
        form.put("redirect_uri", redirectUri);
        form.put("code_verifier", codeVerifier);
        HttpRequest.Builder request = HttpRequest.newBuilder(guardedUri(discovery.tokenEndpoint()))
                .timeout(TIMEOUT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/x-www-form-urlencoded");
        if ("client_secret_post".equalsIgnoreCase(authMethod)) {
            form.put("client_id", clientId);
            if (clientSecret != null) {
                form.put("client_secret", clientSecret);
            }
        } else if ("none".equalsIgnoreCase(authMethod) || clientSecret == null) {
            form.put("client_id", clientId);
        } else {
            // RFC 6749 2.3.1: both parts are form-encoded before base64.
            String basic = enc(clientId) + ":" + enc(clientSecret);
            request.header("Authorization", "Basic "
                    + Base64.getEncoder().encodeToString(basic.getBytes(StandardCharsets.UTF_8)));
        }
        String body = form.entrySet().stream()
                .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
        HttpResponse<String> response = send(request.POST(HttpRequest.BodyPublishers.ofString(body)).build());
        JsonNode json = parse(response.body());
        if (response.statusCode() / 100 != 2) {
            String error = text(json, "error");
            String description = text(json, "error_description");
            log.warn("SSO token exchange refused by provider: status={} error={} description={}",
                    response.statusCode(), error, description);
            throw new SsoFailure("token_exchange_failed",
                    "The provider refused the sign-in code" + (error != null ? " (" + error + ")" : ""));
        }
        String idToken = text(json, "id_token");
        if (idToken == null) {
            throw new SsoFailure("no_id_token", "The provider did not return an ID token. Is the openid scope enabled?");
        }
        return new TokenResponse(idToken, text(json, "access_token"));
    }

    /** Validates signature, issuer, audience, authorized party, expiry and nonce. */
    public Jwt validateIdToken(Discovery discovery, String clientId, String idToken, String expectedNonce) {
        NimbusJwtDecoder decoder = decoderFor(discovery, clientId);
        Jwt jwt;
        try {
            jwt = decoder.decode(idToken);
        } catch (JwtException e) {
            log.warn("SSO ID token rejected: {}", e.getMessage());
            throw new SsoFailure("invalid_id_token", "The provider's ID token did not pass validation");
        }
        String nonce = jwt.getClaimAsString("nonce");
        if (expectedNonce == null || !expectedNonce.equals(nonce)) {
            throw new SsoFailure("invalid_id_token", "The provider's ID token does not belong to this sign-in");
        }
        return jwt;
    }

    private NimbusJwtDecoder decoderFor(Discovery discovery, String clientId) {
        String key = discovery.issuer() + "|" + discovery.jwksUri() + "|" + clientId;
        return decoderCache.computeIfAbsent(key, k -> {
            guardedUri(discovery.jwksUri());
            NimbusJwtDecoder.JwkSetUriJwtDecoderBuilder builder = NimbusJwtDecoder.withJwkSetUri(discovery.jwksUri())
                    .restOperations(guardedRestTemplate());
            List<SignatureAlgorithm> algs = signatureAlgorithms(discovery.idTokenSigningAlgs());
            builder.jwsAlgorithms(set -> set.addAll(algs));
            NimbusJwtDecoder decoder = builder.build();
            OAuth2TokenValidator<Jwt> issuer = jwt -> issuerMatches(discovery.issuer(), jwt);
            OAuth2TokenValidator<Jwt> audience = jwt -> audienceMatches(clientId, jwt);
            OAuth2TokenValidator<Jwt> expiry = jwt -> jwt.getExpiresAt() != null
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "exp missing", null));
            decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                    expiry, new JwtTimestampValidator(Duration.ofSeconds(120)), issuer, audience));
            return decoder;
        });
    }

    /**
     * The client Nimbus uses for the provider's signing keys (fetched again on key rotation):
     * every request re-checks the address, and redirects are not followed.
     */
    private static org.springframework.web.client.RestTemplate guardedRestTemplate() {
        org.springframework.http.client.SimpleClientHttpRequestFactory factory =
                new org.springframework.http.client.SimpleClientHttpRequestFactory() {
                    @Override
                    protected void prepareConnection(java.net.HttpURLConnection connection, String method)
                            throws java.io.IOException {
                        super.prepareConnection(connection, method);
                        connection.setInstanceFollowRedirects(false);
                    }
                };
        factory.setConnectTimeout((int) TIMEOUT.toMillis());
        factory.setReadTimeout((int) TIMEOUT.toMillis());
        org.springframework.web.client.RestTemplate rest = new org.springframework.web.client.RestTemplate(factory);
        rest.getInterceptors().add((request, body, execution) -> {
            guardedUri(request.getURI().toString());
            return execution.execute(request, body);
        });
        return rest;
    }

    /** Asymmetric algorithms only: HS* would mean signing with the client secret, "none" means unsigned. */
    static List<SignatureAlgorithm> signatureAlgorithms(List<String> advertised) {
        List<SignatureAlgorithm> out = new java.util.ArrayList<>();
        if (advertised != null) {
            for (String name : advertised) {
                SignatureAlgorithm alg = SignatureAlgorithm.from(name);
                if (alg != null) {
                    out.add(alg);
                }
            }
        }
        if (out.isEmpty()) {
            out.add(SignatureAlgorithm.RS256);
        }
        return out;
    }

    static OAuth2TokenValidatorResult issuerMatches(String issuer, Jwt jwt) {
        String iss = jwt.getClaimAsString("iss");
        if (iss != null && normaliseIssuer(iss).equals(normaliseIssuer(issuer))) {
            return OAuth2TokenValidatorResult.success();
        }
        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "issuer mismatch", null));
    }

    static OAuth2TokenValidatorResult audienceMatches(String clientId, Jwt jwt) {
        List<String> aud = jwt.getAudience();
        if (aud == null || !aud.contains(clientId)) {
            return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "audience mismatch", null));
        }
        // OIDC Core 3.1.3.7: with several audiences, azp must be us.
        String azp = jwt.getClaimAsString("azp");
        if (aud.size() > 1 && !clientId.equals(azp)) {
            return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "azp mismatch", null));
        }
        if (azp != null && !clientId.equals(azp)) {
            return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "azp mismatch", null));
        }
        return OAuth2TokenValidatorResult.success();
    }

    /** Userinfo claims, or an empty map when the provider has no userinfo endpoint or refuses. */
    public Map<String, Object> userinfo(Discovery discovery, String accessToken) {
        if (discovery.userinfoEndpoint() == null || accessToken == null) {
            return Map.of();
        }
        try {
            JsonNode json = getJson(discovery.userinfoEndpoint(), accessToken);
            @SuppressWarnings("unchecked")
            Map<String, Object> map = MAPPER.convertValue(json, Map.class);
            return map == null ? Map.of() : map;
        } catch (RuntimeException e) {
            log.warn("SSO userinfo call failed: {}", e.getMessage());
            return Map.of();
        }
    }

    private JsonNode getJson(String url, String bearer) {
        HttpRequest.Builder request = HttpRequest.newBuilder(guardedUri(url))
                .timeout(TIMEOUT)
                .header("Accept", "application/json")
                .GET();
        if (bearer != null) {
            request.header("Authorization", "Bearer " + bearer);
        }
        HttpResponse<String> response = send(request.build());
        if (response.statusCode() / 100 != 2) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY,
                    "The provider answered " + response.statusCode() + " for " + url);
        }
        return parse(response.body());
    }

    private HttpResponse<String> send(HttpRequest request) {
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.body() != null && response.body().length() > MAX_BODY_CHARS) {
                throw new VacademyException(HttpStatus.BAD_GATEWAY, "The provider's response is too large");
            }
            return response;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Interrupted while calling the provider");
        } catch (java.io.IOException e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Could not reach the provider: " + e.getMessage());
        }
    }

    private static JsonNode parse(String body) {
        try {
            JsonNode node = MAPPER.readTree(body == null ? "" : body);
            if (node == null || !node.isObject()) {
                throw new VacademyException(HttpStatus.BAD_GATEWAY, "The provider did not answer with JSON");
            }
            return node;
        } catch (java.io.IOException e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "The provider did not answer with JSON");
        }
    }

    /** "https://x/" and "https://x" are the same issuer. */
    public static String normaliseIssuer(String issuer) {
        if (issuer == null) {
            return null;
        }
        String trimmed = issuer.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    /** The URL, if it is https and every address its host resolves to is public. */
    static URI guardedUri(String url) {
        URI uri;
        try {
            uri = URI.create(Objects.requireNonNull(url).trim());
        } catch (RuntimeException e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Not a valid URL: " + url);
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Provider URLs must be https: " + url);
        }
        try {
            for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                if (isNonPublic(address)) {
                    throw new VacademyException(HttpStatus.BAD_REQUEST,
                            "Provider URL points to a private network address: " + uri.getHost());
                }
            }
        } catch (UnknownHostException e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Unknown host: " + uri.getHost());
        }
        return uri;
    }

    static boolean isNonPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            return true;
        }
        byte[] b = address.getAddress();
        if (b.length == 4) {
            int first = b[0] & 0xff;
            int second = b[1] & 0xff;
            return first == 0 || (first == 100 && second >= 64 && second <= 127) // carrier-grade NAT
                    || (first == 198 && (second == 18 || second == 19));       // benchmarking
        }
        // IPv6 unique local fc00::/7
        return (b[0] & 0xfe) == 0xfc;
    }

    private static String requireHttps(String url, String field) {
        if (url == null || !url.trim().toLowerCase().startsWith("https://")) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "The provider's " + field + " is missing or not https");
        }
        return url.trim();
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
