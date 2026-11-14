package vacademy.io.auth_service.feature.panel.filter;

import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.common.auth.service.JwtService;

import java.security.Key;

/**
 * The Bearer endpoints under /auth-service/v1/panel/** (scan, approve, pairing, rooms and panels)
 * are for a staff member's own phone or browser. A panel never calls them, so an access token minted
 * for a panel session, which carries a {@code pnl} claim, is refused there. A panel session can then
 * never be used to approve, pair or administer, or to start the session that follows it.
 *
 * <p>An interceptor, so the path is matched as the dispatcher decoded it and the refusal is written
 * by PanelExceptionAdvice like any other. The security chain has already checked the token by the
 * time this runs; this only reads the claim.
 */
@Component
public class PanelBearerGuard implements HandlerInterceptor, WebMvcConfigurer {

    public static final String BEARER_PATHS = "/auth-service/v1/panel/**";

    private static final String PANEL_CLAIM = "pnl";
    private static final String BEARER = "Bearer ";

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns(BEARER_PATHS);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (isPanelToken(request.getHeader(HttpHeaders.AUTHORIZATION))) {
            throw new PanelApiException(HttpStatus.FORBIDDEN, "FORBIDDEN",
                    "Use your own phone or computer for this");
        }
        return true;
    }

    static boolean isPanelToken(String authorization) {
        if (authorization == null || !authorization.startsWith(BEARER)) {
            return false;
        }
        try {
            Object claim = Jwts.parserBuilder().setSigningKey(signingKey()).build()
                    .parseClaimsJws(authorization.substring(BEARER.length())).getBody().get(PANEL_CLAIM);
            return claim != null;
        } catch (ExpiredJwtException e) {
            return e.getClaims().get(PANEL_CLAIM) != null;
        } catch (JwtException | IllegalArgumentException e) {
            // Not a token this service signed: the security chain decides what it may reach.
            return false;
        }
    }

    private static Key signingKey() {
        return Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey));
    }
}
