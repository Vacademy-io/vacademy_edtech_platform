package vacademy.io.assessment_service.features.submission_review.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Display names for "marked by" and history actors: one auth-service call per response for
 * the ids not cached, cached per pod for 10 minutes ({@code userNames}). Unknown -> no entry
 * (the dashboard shows "A teacher"). Never throws.
 */
@Slf4j
@Component
public class UserNames {

    static final String CACHE = "userNames";
    private static final String UNKNOWN = "";

    @Autowired(required = false)
    private AuthService authService;
    @Autowired(required = false)
    private CacheManager cacheManager;

    public UserNames() {
    }

    public UserNames(AuthService authService, CacheManager cacheManager) {
        this.authService = authService;
        this.cacheManager = cacheManager;
    }

    public Map<String, String> names(Collection<String> userIds) {
        Map<String, String> out = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        Cache cache = cacheManager == null ? null : cacheManager.getCache(CACHE);
        Set<String> missing = new LinkedHashSet<>();
        for (String id : userIds) {
            if (id == null || id.isBlank()) continue;
            String cached = cache == null ? null : cache.get(id, String.class);
            if (cached != null) {
                if (!cached.isEmpty()) out.put(id, cached);
            } else {
                missing.add(id);
            }
        }
        if (!missing.isEmpty() && authService != null) {
            try {
                List<UserDTO> users = authService.getUsersByIds(new ArrayList<>(missing));
                for (UserDTO u : users) {
                    if (u == null || u.getId() == null) continue;
                    String name = u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName()
                            : u.getUsername();
                    if (name != null) out.put(u.getId(), name);
                }
            } catch (Exception e) {
                log.warn("[submission-review] could not resolve user names: {}", e.getMessage());
            }
            if (cache != null) {
                for (String id : missing) cache.put(id, out.getOrDefault(id, UNKNOWN));
            }
        }
        return out;
    }
}
