package vacademy.io.auth_service.feature.sso.service;

import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The person the provider vouched for, read through the connection's claim names.
 *
 * @param emailVerified TRUE / FALSE when the provider said so, null when it did not say
 *                      (Entra ID never sends email_verified)
 */
public record SsoClaims(String subject, String email, Boolean emailVerified, String fullName, String phone,
                        List<String> groups) {

    /**
     * ID token claims win over userinfo for the subject (userinfo must name the same subject or
     * it is ignored); userinfo fills anything the ID token left out.
     */
    public static Map<String, Object> merge(Map<String, Object> idTokenClaims, Map<String, Object> userinfo) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (userinfo != null && !userinfo.isEmpty()) {
            Object infoSub = userinfo.get("sub");
            Object tokenSub = idTokenClaims.get("sub");
            if (infoSub != null && infoSub.toString().equals(String.valueOf(tokenSub))) {
                merged.putAll(userinfo);
            }
        }
        merged.putAll(idTokenClaims);
        return merged;
    }

    public static SsoClaims from(Map<String, Object> claims, InstituteSsoConnection connection) {
        String subject = string(claims.get(nonBlank(connection.getClaimUserId(), "sub")));
        String email = string(claims.get(nonBlank(connection.getClaimEmail(), "email")));
        if (email == null) {
            // Entra ID puts the sign-in address here when the mail attribute is empty.
            email = string(claims.get("preferred_username"));
            if (email != null && !email.contains("@")) {
                email = null;
            }
        }
        if (email != null) {
            email = email.trim().toLowerCase(Locale.ROOT);
        }
        String name = string(claims.get(nonBlank(connection.getClaimName(), "name")));
        if (name == null) {
            String given = string(claims.get(nonBlank(connection.getClaimGivenName(), "given_name")));
            String family = string(claims.get(nonBlank(connection.getClaimFamilyName(), "family_name")));
            String joined = ((given == null ? "" : given) + " " + (family == null ? "" : family)).trim();
            name = joined.isEmpty() ? null : joined;
        }
        if (name == null && email != null) {
            name = email.substring(0, email.indexOf('@'));
        }
        String phone = connection.getClaimPhone() == null || connection.getClaimPhone().isBlank()
                ? null : string(claims.get(connection.getClaimPhone()));
        List<String> groups = connection.getClaimGroups() == null || connection.getClaimGroups().isBlank()
                ? List.of() : list(claims.get(connection.getClaimGroups()));
        return new SsoClaims(subject, email, bool(claims.get("email_verified")), name, phone, groups);
    }

    private static String nonBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static String string(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isEmpty() ? null : text;
    }

    private static Boolean bool(Object value) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof String s) {
            if ("true".equalsIgnoreCase(s.trim())) return Boolean.TRUE;
            if ("false".equalsIgnoreCase(s.trim())) return Boolean.FALSE;
        }
        return null;
    }

    /** An array, a single string, or a comma-separated string. */
    static List<String> list(Object value) {
        Set<String> out = new LinkedHashSet<>();
        if (value instanceof Collection<?> collection) {
            for (Object item : collection) {
                String text = string(item);
                if (text != null) out.add(text);
            }
        } else if (value != null) {
            for (String part : value.toString().split(",")) {
                if (!part.isBlank()) out.add(part.trim());
            }
        }
        return new ArrayList<>(out);
    }
}
