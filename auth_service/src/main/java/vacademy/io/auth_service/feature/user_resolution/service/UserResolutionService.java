package vacademy.io.auth_service.feature.user_resolution.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.hibernate.Session;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class UserResolutionService {

    private final UserRoleRepository userRoleRepository;
    private final UserRepository userRepository;

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Get users by institute and role - with caching for performance.
     *
     * Users are sanitized BEFORE caching — same reason as {@link #getUsersByIds}:
     * caching the raw entity (with the lazy roles collection and its circular
     * User → UserRole → User references) fails to serialize under the Redis
     * cache manager, the exception propagated, and the controller's catch-all
     * turned every call into an HTTP 400. That silently broke every consumer
     * of /users/by-role (the doubt-notification role fallback, and the CRM
     * counsellor-roster lookup that briefly depended on it).
     */
    @Cacheable(value = "usersByRole", key = "#instituteId + '_' + #roleName")
    @Transactional(readOnly = true)
    public List<User> getUsersByInstituteAndRole(String instituteId, String roleName) {
        log.debug("Resolving users for institute: {} and role: {}", instituteId, roleName);

        try {
            List<User> users = userRoleRepository.findUsersByInstituteIdAndRoleName(instituteId, roleName);
            log.debug("Found {} users with role: {} in institute: {}", users.size(), roleName, instituteId);
            // MUST be a non-final collection — see toCacheableList.
            return toCacheableList(users);

        } catch (Exception e) {
            log.error("Error getting users by institute and role", e);
            throw new RuntimeException("Failed to get users by role: " + e.getMessage(), e);
        }
    }

    /**
     * Get users by list of IDs - with caching for contact information
     * Users are sanitized before caching to avoid circular reference serialization
     * errors
     * (User -> UserRole -> User). Only essential fields are cached.
     */
    @Cacheable(value = "usersById", key = "#userIds.hashCode()")
    @Transactional(readOnly = true)
    public List<User> getUsersByIds(List<String> userIds) {
        log.debug("Resolving {} users by IDs", userIds.size());

        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }

        try {
            List<User> users = userRepository.findByIdIn(userIds);
            log.debug("Found {} users out of {} requested IDs", users.size(), userIds.size());

            if (users.size() < userIds.size()) {
                log.warn("Some user IDs were not found. Requested: {}, Found: {}", userIds.size(), users.size());
            }

            // Sanitize users before caching to avoid circular reference issues
            // This removes the roles collection which causes circular references
            // MUST be a non-final collection — see toCacheableList.
            return toCacheableList(users);

        } catch (Exception e) {
            log.error("Error getting users by IDs", e);
            throw new RuntimeException("Failed to get users by IDs: " + e.getMessage(), e);
        }
    }

    @Transactional(readOnly = true)
    public List<String> searchUserIdsByQuery(String query, String instituteId) {
        if (query == null || query.isBlank())
            return List.of();
        String inst = (instituteId != null && instituteId.isBlank()) ? null : instituteId;
        try {
            // The search is LIKE '%term%' over trigram indexes (V24). A cached generic plan
            // cannot see the term, so it picks one scan for every term: 2-letter terms (which
            // have no trigrams) went from ~270 ms to ~500 ms and 5-letter terms stayed at
            // ~130-270 ms instead of ~25 ms. Plan per call instead. SET LOCAL ends with this
            // transaction, so nothing leaks to other clients through pgbouncer.
            entityManager.unwrap(Session.class).doWork(connection -> {
                try (Statement statement = connection.createStatement()) {
                    statement.execute("SET LOCAL plan_cache_mode = force_custom_plan");
                }
            });
            List<String> ids = userRepository.searchUserIdsByQuery(query.trim(), inst);
            log.debug("searchUserIdsByQuery: query='{}', instituteId='{}', found={} ids",
                    query, inst, ids.size());
            return ids;
        } catch (Exception e) {
            log.error("Error in searchUserIdsByQuery", e);
            return List.of();
        }
    }

    /**
     * Sanitizes each user and collects into an {@link ArrayList} — deliberately NOT
     * {@code Stream.toList()}.
     *
     * <p>The Redis cache serializer uses {@code activateDefaultTyping(..., NON_FINAL, ...)}, which
     * writes a type id only for non-final runtime types. {@code Stream.toList()} returns
     * {@code java.util.ImmutableCollections$ListN}, which IS final, so the cached root array was
     * written with no type id — it serialized fine and then threw
     * {@code "expected VALUE_STRING ... type id"} on every read. That surfaced as an intermittent
     * HTTP 400 from {@code /users/by-role}: the first caller after each TTL expiry repopulated the
     * cache and got a correct answer, and everyone in the following 5 minutes got the error. For the
     * doubt cascade that meant zero recipients — no email, push, or bell.</p>
     *
     * <p>{@code ArrayList} is non-final, so its type id is written and the entry round-trips.</p>
     */
    private List<User> toCacheableList(List<User> users) {
        return users.stream().map(this::sanitizeUser)
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
    }

    /**
     * Sanitize User object by creating a shallow copy without circular references
     * This prevents serialization errors when caching to Redis
     */
    private User sanitizeUser(User user) {
        if (user == null) {
            return null;
        }

        User sanitized = new User();
        try {
            sanitized.setId(user.getId());
            sanitized.setEmail(user.getEmail());
            sanitized.setMobileNumber(user.getMobileNumber());
            sanitized.setFullName(user.getFullName());
            sanitized.setUsername(user.getUsername());
            // Explicitly do NOT set roles to avoid circular references
            // The roles field is not needed for contact information (email/phone)
        } catch (Exception e) {
            log.warn("Error sanitizing user {}: {}", user.getId(), e.getMessage());
            // Return minimal user with just ID if sanitization fails
            User minimal = new User();
            minimal.setId(user.getId());
            minimal.setEmail(user.getEmail());
            return minimal;
        }

        return sanitized;
    }
}