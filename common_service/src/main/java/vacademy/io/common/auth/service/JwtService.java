package vacademy.io.common.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import io.jsonwebtoken.security.SignatureException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.constants.AuthConstant;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.core.i18n.LocaleRegistry;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

@Component
public class JwtService {

    public static final String SECRET_KEY_ENV = "JWT_SECRET_KEY";

    // Legacy platform signing key. It is public (this repo is public), so anyone can mint a
    // token with it. Kept only as the fallback until JWT_SECRET_KEY is set on every service
    // and ai_service at once; setting a different value there is the rotation.
    private static final String LEGACY_SECRET_KEY = "357638792F423F4428472B4B6250655368566D597133743677397A2443264629";

    // Optional second key that is accepted for verification only, never for signing. Unset
    // (the default) means one key, exactly as before. Used to change JWT_SECRET_KEY without
    // signing anyone out: tokens signed with the other key keep verifying while it is set.
    public static final String PREVIOUS_SECRET_KEY_ENV = "JWT_SECRET_KEY_PREVIOUS";

    // Read once at class load. Also read directly by LiveActivityStreamTokenService, so it
    // follows the same key. Other token code signs with signingKey() and verifies with
    // parseSignedClaims().
    public static final String secretKey = resolveSecretKey(System.getenv(SECRET_KEY_ENV));

    // null when JWT_SECRET_KEY_PREVIOUS is unset, blank, or the same as the signing key.
    static final String previousSecretKey =
            resolvePreviousSecretKey(System.getenv(PREVIOUS_SECRET_KEY_ENV), secretKey);

    // One INFO line per user per hour when a token verifies only with the previous key, so
    // the remaining sessions on it can be counted before that key is removed.
    private static final long PREVIOUS_KEY_LOG_INTERVAL_MS = 60 * 60 * 1000L;
    private static final int PREVIOUS_KEY_LOG_MAX_ENTRIES = 50_000;
    private static final Map<String, Long> previousKeyLoggedAt = new ConcurrentHashMap<>();


    public String extractUsername(String token) {
        return extractClaim(token, Claims::getSubject);
    }

    public <T> T extractClaim(String token, Function<Claims, T> claimsResolver) {
        final Claims claims = extractAllClaims(token);
        return claimsResolver.apply(claims);
    }


    public String generateRefreshToken(Map<String, Object> extraClaims, User userDetails) {
        return Jwts
                .builder()
                .setClaims(extraClaims)
                .setSubject(userDetails.getUsername())
                .setIssuedAt(new Date(System.currentTimeMillis()))
                .setExpiration(new Date(System.currentTimeMillis() + (AuthConstant.refreshTokenExpiryInSecs * 1000)))
                .signWith(getSignInKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    public long getExpirationTime() {
        return AuthConstant.jwtTokenExpiryInMillis;
    }

    private String buildToken(
            Map<String, Object> extraClaims,
            User userDetails,
            long expiration
    ) {
        return Jwts
                .builder()
                .setClaims(extraClaims)
                .setSubject(userDetails.getUsername())
                .setIssuedAt(new Date(System.currentTimeMillis()))
                .setExpiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(getSignInKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    public boolean isTokenValid(String token, UserDetails userDetails) {
        final String username = extractUsername(token);
        return (username.equals(userDetails.getUsername()));
    }

    public boolean isTokenExpired(String token) {
        return extractExpiration(token).before(new Date());
    }

    private Date extractExpiration(String token) {
        return extractClaim(token, Claims::getExpiration);
    }

    private Claims extractAllClaims(String token) {
        return parseSignedClaims(token);
    }

    private Key getSignInKey() {
        return signingKey();
    }

    /** The key every platform token is signed with (JWT_SECRET_KEY). */
    public static Key signingKey() {
        return keyFor(secretKey);
    }

    /**
     * Verifies a platform-signed token and returns its claims. Accepts the signing key and,
     * when JWT_SECRET_KEY_PREVIOUS is set, that key too. Throws what the jjwt parser throws
     * (ExpiredJwtException, SignatureException, MalformedJwtException, ...).
     */
    public static Claims parseSignedClaims(String token) {
        return parseSignedClaims(token, secretKey, previousSecretKey);
    }

    static Claims parseSignedClaims(String token, String currentKey, String previousKey) {
        try {
            return parseWith(token, currentKey);
        } catch (SignatureException signedWithAnotherKey) {
            if (previousKey == null) {
                throw signedWithAnotherKey;
            }
            Claims claims;
            try {
                claims = parseWith(token, previousKey);
            } catch (SignatureException alsoNotPrevious) {
                throw signedWithAnotherKey;
            }
            notePreviousKeyUse(claims);
            return claims;
        }
    }

    private static Claims parseWith(String token, String key) {
        return Jwts.parserBuilder().setSigningKey(keyFor(key)).build().parseClaimsJws(token).getBody();
    }

    private static Key keyFor(String key) {
        return Keys.hmacShaKeyFor(Decoders.BASE64.decode(key));
    }

    private static void notePreviousKeyUse(Claims claims) {
        Object user = claims.get("user");
        String userId = user == null ? "-" : user.toString();
        long now = System.currentTimeMillis();
        Long last = previousKeyLoggedAt.get(userId);
        if (last != null && now - last < PREVIOUS_KEY_LOG_INTERVAL_MS) {
            return;
        }
        if (previousKeyLoggedAt.size() >= PREVIOUS_KEY_LOG_MAX_ENTRIES) {
            previousKeyLoggedAt.clear();
        }
        previousKeyLoggedAt.put(userId, now);
        LoggerFactory.getLogger(JwtService.class)
                .info("Token verified with {} (user={})", PREVIOUS_SECRET_KEY_ENV, userId);
    }

    /**
     * JWT_SECRET_KEY_PREVIOUS when it is set and differs from the signing key; null otherwise.
     * Validated like JWT_SECRET_KEY: a set but unusable value fails startup. Never logs the value.
     */
    static String resolvePreviousSecretKey(String fromEnv, String currentKey) {
        Logger log = LoggerFactory.getLogger(JwtService.class);
        String candidate = fromEnv == null ? "" : fromEnv.trim();
        if (candidate.isEmpty()) {
            return null;
        }
        try {
            Keys.hmacShaKeyFor(Decoders.BASE64.decode(candidate));
        } catch (RuntimeException e) {
            log.error("{} is set but is not a usable HS256 key ({}); refusing to start.",
                    PREVIOUS_SECRET_KEY_ENV, e.getClass().getSimpleName());
            throw new IllegalStateException(PREVIOUS_SECRET_KEY_ENV + " is set but is not a usable HS256 key ("
                    + e.getClass().getSimpleName() + ")");
        }
        if (candidate.equals(currentKey)) {
            log.info("{} equals {}; verifying with one key.", PREVIOUS_SECRET_KEY_ENV, SECRET_KEY_ENV);
            return null;
        }
        log.info("Also accepting tokens signed with the key from {} (verification only).", PREVIOUS_SECRET_KEY_ENV);
        return candidate;
    }

    /**
     * JWT_SECRET_KEY when it is set; the legacy key only when it is unset or blank. A value
     * that is set but not usable as an HS256 key (same BASE64 decoding as getSignInKey, at
     * least 256 bits) FAILS STARTUP rather than falling back: ai_service uses the env value
     * as given, so a silent fallback would leave Java on the public key and split the two
     * on every token. Never logs the value.
     */
    static String resolveSecretKey(String fromEnv) {
        Logger log = LoggerFactory.getLogger(JwtService.class);
        String candidate = fromEnv == null ? "" : fromEnv.trim();
        if (candidate.isEmpty()) {
            log.warn("{} is not set; signing JWTs with the legacy built-in key, which is public. "
                    + "Set {} on every service and ai_service together to rotate.", SECRET_KEY_ENV, SECRET_KEY_ENV);
            return LEGACY_SECRET_KEY;
        }
        try {
            Keys.hmacShaKeyFor(Decoders.BASE64.decode(candidate));
        } catch (RuntimeException e) {
            log.error("{} is set but is not a usable HS256 key ({}); refusing to start. It must be BASE64 "
                    + "(hex works) of at least 32 bytes, e.g. `openssl rand -hex 32`.",
                    SECRET_KEY_ENV, e.getClass().getSimpleName());
            throw new IllegalStateException(SECRET_KEY_ENV + " is set but is not a usable HS256 key ("
                    + e.getClass().getSimpleName() + ")");
        }
        if (LEGACY_SECRET_KEY.equals(candidate)) {
            log.warn("{} equals the legacy built-in key, which is public; rotate it.", SECRET_KEY_ENV);
        } else {
            log.info("Signing JWTs with the key from {}.", SECRET_KEY_ENV);
        }
        return candidate;
    }


    public String generateToken(User userDetails, List<UserRole> userRoles,List<String>userPermissions) {
        // Create a map to hold extra claims (payload for the JWT)
        Map<String, Object> extraClaims = new HashMap<>();

        // Add user details to the claims
        extraClaims.put("user", userDetails.getId());
        extraClaims.put("fullname", userDetails.getFullName());
        extraClaims.put("username", userDetails.getUsername());
        extraClaims.put("email", userDetails.getEmail());
        extraClaims.put("is_root_user", userDetails.isRootUser());  // Indicate if it's a root user
        extraClaims.put("authorities", UserRoleService.createInstituteRoleMap(userRoles));
        extraClaims.put("permissions", userPermissions);
        addLocaleClaim(extraClaims, userDetails);
        return buildToken(extraClaims, userDetails, AuthConstant.jwtTokenExpiryInMillis);
    }

    public String generateToken(User userDetails,
                                List<UserRole> userRoles,
                                List<String> userPermissions,
                                int days) {

        // Create a map to hold extra claims (payload for the JWT)
        Map<String, Object> extraClaims = new HashMap<>();

        // Add user details to the claims
        extraClaims.put("user", userDetails.getId());
        extraClaims.put("fullname", userDetails.getFullName());
        extraClaims.put("username", userDetails.getUsername());
        extraClaims.put("email", userDetails.getEmail());
        extraClaims.put("is_root_user", userDetails.isRootUser());  // Indicate if it's a root user
        extraClaims.put("authorities", UserRoleService.createInstituteRoleMap(userRoles));
        extraClaims.put("permissions", userPermissions);
        addLocaleClaim(extraClaims, userDetails);

        // convert days → milliseconds
        long expirationMillis = days * 24L * 60L * 60L * 1000L;

        return buildToken(extraClaims, userDetails, expirationMillis);
    }

    // Add the user's preferred locale as a "locale" claim (i18n Phase 0).
    // Omitted when the user has no explicit preference — resolution then falls
    // back to Accept-Language / default in LocaleResolutionFilter. Institute-
    // default resolution at token time is a documented follow-up.
    private void addLocaleClaim(Map<String, Object> extraClaims, User userDetails) {
        if (userDetails.getPreferredLocale() != null) {
            extraClaims.put("locale", LocaleRegistry.normalize(userDetails.getPreferredLocale()));
        }
    }
}