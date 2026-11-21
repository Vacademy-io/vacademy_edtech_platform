package vacademy.io.auth_service.feature.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.springframework.stereotype.Service;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Date;
import java.util.Map;

@Service
public class VimotionSignupTokenService {

    private static final long TTL_MILLIS = 15 * 60 * 1000L;
    private static final String PURPOSE = "vimotion-signup";

    public String issue(String phoneNumber, String email, String inviteCodeId) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .setClaims(Map.of(
                        "phone_number", phoneNumber == null ? "" : phoneNumber,
                        "email", email == null ? "" : email,
                        "invite_code_id", inviteCodeId == null ? "" : inviteCodeId,
                        "purpose", PURPOSE))
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + TTL_MILLIS))
                .signWith(JwtService.signingKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    public long ttlMillis() {
        return TTL_MILLIS;
    }

    public Claims verify(String token, String expectedPhoneNumber) {
        if (token == null || token.isBlank()) {
            throw new VacademyException("Missing signup token");
        }
        try {
            Claims claims = JwtService.parseSignedClaims(token);
            if (!PURPOSE.equals(claims.get("purpose", String.class))) {
                throw new VacademyException("Invalid signup token");
            }
            String tokenPhone = claims.get("phone_number", String.class);
            if (tokenPhone == null || !tokenPhone.equals(expectedPhoneNumber)) {
                throw new VacademyException("Signup token does not match phone number");
            }
            return claims;
        } catch (JwtException e) {
            throw new VacademyException("Invalid or expired signup token");
        }
    }
}
