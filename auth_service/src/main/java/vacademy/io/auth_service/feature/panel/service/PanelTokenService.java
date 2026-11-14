package vacademy.io.auth_service.feature.panel.service;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserPermission;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserPermissionRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.core.i18n.LocaleRegistry;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Short JWTs for a panel session. The claims match JwtService.generateToken, except that authorities
 * cover only the panel's institute, so the panel sees one institute and shows no picker, and an
 * informational {@code pnl} claim names the session. Renewal is a database lookup in
 * PanelSessionService, so this never creates or removes a row in refresh_token.
 */
@Service
public class PanelTokenService {

    public static final int ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

    private final UserRoleRepository userRoleRepository;
    private final UserPermissionRepository userPermissionRepository;

    public PanelTokenService(UserRoleRepository userRoleRepository, UserPermissionRepository userPermissionRepository) {
        this.userRoleRepository = userRoleRepository;
        this.userPermissionRepository = userPermissionRepository;
    }

    public String mint(User user, String instituteId, String sessionId) {
        List<UserRole> rolesHere = userRoleRepository.findByUser(user).stream()
                .filter(role -> instituteId.equals(role.getInstituteId()))
                .toList();
        List<String> permissions = userPermissionRepository.findByUserId(user.getId()).stream()
                .map(UserPermission::getPermissionId)
                .toList();
        return sign(user, rolesHere, permissions, sessionId, System.currentTimeMillis());
    }

    static String sign(User user, List<UserRole> rolesAtInstitute, List<String> permissions, String sessionId,
            long nowMs) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("user", user.getId());
        claims.put("fullname", user.getFullName());
        claims.put("username", user.getUsername());
        claims.put("email", user.getEmail());
        claims.put("is_root_user", user.isRootUser());
        claims.put("authorities", UserRoleService.createInstituteRoleMap(rolesAtInstitute));
        claims.put("permissions", permissions);
        claims.put("pnl", sessionId);
        if (user.getPreferredLocale() != null) {
            claims.put("locale", LocaleRegistry.normalize(user.getPreferredLocale()));
        }
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(user.getUsername())
                .setIssuedAt(new Date(nowMs))
                .setExpiration(new Date(nowMs + ACCESS_TOKEN_TTL_SECONDS * 1000L))
                .signWith(signingKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    private static Key signingKey() {
        return Keys.hmacShaKeyFor(Decoders.BASE64.decode(JwtService.secretKey));
    }
}
