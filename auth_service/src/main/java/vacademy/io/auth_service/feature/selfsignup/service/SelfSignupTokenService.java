package vacademy.io.auth_service.feature.selfsignup.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.exceptions.VacademyException;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * Proof that a visitor owns an email address, from an email OTP or from Google, good for one
 * sign-up form. Signed here so the form's later steps cannot name a different address.
 */
@Service
public class SelfSignupTokenService {

    public static final String METHOD_EMAIL_OTP = "EMAIL_OTP";
    public static final String METHOD_GOOGLE = "GOOGLE";

    private static final long TTL_MILLIS = 30 * 60 * 1000L;
    private static final String PURPOSE = "self-signup";

    public String issue(String email, String method, String name, String subjectId, String vendorId) {
        long now = System.currentTimeMillis();
        Map<String, Object> claims = new HashMap<>();
        claims.put("purpose", PURPOSE);
        claims.put("email", email.trim().toLowerCase());
        claims.put("method", method);
        claims.put("name", name == null ? "" : name);
        claims.put("subject_id", subjectId == null ? "" : subjectId);
        claims.put("vendor_id", vendorId == null ? "" : vendorId);
        return Jwts.builder()
                .setClaims(claims)
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + TTL_MILLIS))
                .signWith(getKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    public long ttlMillis() {
        return TTL_MILLIS;
    }

    public Claims verify(String token) {
        if (token == null || token.isBlank()) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Please verify your email again");
        }
        try {
            Claims claims = Jwts.parserBuilder().setSigningKey(getKey()).build().parseClaimsJws(token).getBody();
            if (!PURPOSE.equals(claims.get("purpose", String.class))) {
                throw new VacademyException(HttpStatus.UNAUTHORIZED, "Please verify your email again");
            }
            return claims;
        } catch (JwtException | IllegalArgumentException e) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Your verification has expired. Please verify your email again");
        }
    }

    private Key getKey() {
        return Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey));
    }
}
