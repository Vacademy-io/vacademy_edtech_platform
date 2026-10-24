package vacademy.io.common.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
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
import java.util.function.Function;

@Component
public class JwtService {

    public static final String SECRET_KEY_ENV = "JWT_SECRET_KEY";

    // Legacy platform signing key. It is public (this repo is public), so anyone can mint a
    // token with it. Kept only as the fallback until JWT_SECRET_KEY is set on every service
    // and ai_service at once; setting a different value there is the rotation.
    private static final String LEGACY_SECRET_KEY = "357638792F423F4428472B4B6250655368566D597133743677397A2443264629";

    // Read once at class load. Also read directly by VimotionSignupTokenService and
    // LiveActivityStreamTokenService, so they follow the same key.
    public static final String secretKey = resolveSecretKey(System.getenv(SECRET_KEY_ENV));


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
        return Jwts
                .parserBuilder()
                .setSigningKey(getSignInKey())
                .build()
                .parseClaimsJws(token)
                .getBody();
    }

    private Key getSignInKey() {
        byte[] keyBytes = Decoders.BASE64.decode(secretKey);
        return Keys.hmacShaKeyFor(keyBytes);
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