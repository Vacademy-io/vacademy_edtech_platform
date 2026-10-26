package vacademy.io.auth_service.feature.user.audit;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Reports member access changes (PUT /user-roles/update-role-status: delete, disable,
 * enable, cancel invite) to admin_core's activity log. Until this existed, the only trace
 * of "who deleted this teacher" was a user_activity_log row naming the caller and the
 * endpoint, without the member or the status, so the answer had to be pieced together
 * from timestamps.
 *
 * One row per member whose roles actually changed, with entity_id = the member's user id,
 * the roles and their old status in before_payload and the new status in request_payload.
 *
 * Fire-and-forget like the assessment audit: posted off the request thread, every failure
 * logged and swallowed. The status change has already committed; an audit hiccup must not
 * fail or slow it.
 */
@Service
@Slf4j
public class RoleStatusAuditClient {

    public static final String ENTITY_MEMBER_ACCESS = "MEMBER_ACCESS";

    private final RoleStatusAuditSender sender;

    @PersistenceContext
    private EntityManager entityManager;

    // The @Async hop lives in a separate bean on purpose: calling an @Async method on
    // `this` bypasses the Spring proxy and runs it inline, on the admin's request thread.
    public RoleStatusAuditClient(RoleStatusAuditSender sender) {
        this.sender = sender;
    }

    /** One user_role row as it stood at a moment, detached from the persistence context. */
    public record RoleRowState(String rowId, String userId, String fullName, String email, String roleName,
                               String status) {
    }

    /**
     * The member's rows in {@code instituteId} as they are now. Called once before the
     * status update and once after; the difference is what the admin changed. Never throws:
     * an empty snapshot just means nothing gets recorded.
     */
    public Map<String, RoleRowState> snapshot(String instituteId, List<String> userIds) {
        if (entityManager == null || instituteId == null || userIds == null || userIds.isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            // Scalar columns, not UserRole entities: with open-in-view the request keeps one
            // persistence context, and the bulk UPDATE in between does not refresh managed
            // entities, so a second entity query would hand back the old status and the diff
            // would always be empty.
            List<Object[]> rows = entityManager.createQuery(
                            "SELECT ur.id, u.id, u.fullName, u.email, r.name, ur.status "
                                    + "FROM UserRole ur JOIN ur.user u LEFT JOIN ur.role r "
                                    + "WHERE ur.instituteId = :instituteId AND u.id IN (:userIds)",
                            Object[].class)
                    .setParameter("instituteId", instituteId)
                    .setParameter("userIds", userIds)
                    .getResultList();
            Map<String, RoleRowState> byRowId = new LinkedHashMap<>();
            for (Object[] row : rows) {
                byRowId.put((String) row[0], new RoleRowState((String) row[0], (String) row[1], (String) row[2],
                        (String) row[3], (String) row[4], (String) row[5]));
            }
            return byRowId;
        } catch (Exception e) {
            log.warn("role status audit snapshot failed for institute {}: {}", instituteId, e.getMessage());
            return Collections.emptyMap();
        }
    }

    /**
     * Record the change between two {@link #snapshot}s. Call AFTER the update committed.
     */
    public void record(CustomUserDetails actor, String instituteId, String newStatus,
                       Map<String, RoleRowState> before, Map<String, RoleRowState> after) {
        try {
            // member user id -> the rows of that member whose status moved
            Map<String, List<RoleRowState[]>> changedByMember = new LinkedHashMap<>();
            for (RoleRowState was : before.values()) {
                RoleRowState now = after.get(was.rowId());
                if (now != null && !Objects.equals(was.status(), now.status())) {
                    changedByMember.computeIfAbsent(was.userId(), k -> new ArrayList<>())
                            .add(new RoleRowState[]{was, now});
                }
            }
            if (changedByMember.isEmpty()) {
                return;
            }
            HttpServletRequest request = currentRequest();
            List<Map<String, Object>> bodies = new ArrayList<>();
            for (Map.Entry<String, List<RoleRowState[]>> entry : changedByMember.entrySet()) {
                bodies.add(body(actor, instituteId, newStatus, entry.getKey(), entry.getValue(), request));
            }
            sender.send(bodies);
        } catch (Exception e) {
            log.warn("role status audit not recorded ({} in {}): {}", newStatus, instituteId, e.getMessage());
        }
    }

    private Map<String, Object> body(CustomUserDetails actor, String instituteId, String newStatus,
                                     String memberId, List<RoleRowState[]> changes, HttpServletRequest request) {
        RoleRowState member = changes.get(0)[0];
        List<String> roleNames = new ArrayList<>();
        List<Map<String, Object>> beforeRoles = new ArrayList<>();
        for (RoleRowState[] change : changes) {
            String role = change[0].roleName() != null ? change[0].roleName() : "?";
            roleNames.add(role);
            Map<String, Object> was = new HashMap<>();
            was.put("role", role);
            was.put("status", change[0].status());
            beforeRoles.add(was);
        }
        boolean self = actor != null && memberId.equals(actor.getUserId());

        Map<String, Object> requestPayload = new LinkedHashMap<>();
        requestPayload.put("user_id", memberId);
        requestPayload.put("full_name", member.fullName());
        requestPayload.put("email", member.email());
        requestPayload.put("status", newStatus);
        requestPayload.put("roles", roleNames);

        Map<String, Object> body = new HashMap<>();
        body.put("institute_id", instituteId);
        body.put("actor_id", actor != null ? actor.getUserId() : null);
        body.put("actor_name", actor != null ? actor.getFullName() : null);
        body.put("actor_email", actor != null ? actor.getUsername() : null);
        body.put("entity_type", ENTITY_MEMBER_ACCESS);
        body.put("entity_id", memberId);
        body.put("action", action(newStatus));
        body.put("description", description(newStatus, self, displayName(member)) + " (" + String.join(", ", roleNames) + ")");
        body.put("request_payload", requestPayload);
        body.put("before_payload", Map.of("roles", beforeRoles));
        if (request != null) {
            body.put("http_method", request.getMethod());
            body.put("endpoint", request.getRequestURI());
            body.put("ip_address", clientIp(request));
            body.put("user_agent", request.getHeader("User-Agent"));
        }
        body.put("response_status", 200);
        return body;
    }

    static String action(String newStatus) {
        if (newStatus == null) {
            return "STATUS_CHANGE";
        }
        return switch (newStatus.toUpperCase()) {
            case "DELETED", "DELETE" -> "DELETE";
            case "DISABLED" -> "DISABLE_ACCESS";
            case "ACTIVE" -> "ENABLE_ACCESS";
            case "CANCEL" -> "CANCEL";
            default -> "STATUS_CHANGE";
        };
    }

    static String description(String newStatus, boolean self, String member) {
        return switch (action(newStatus)) {
            case "DELETE" -> self ? "deleted their own account" : "deleted " + member;
            case "DISABLE_ACCESS" -> "disabled access for " + member;
            case "ENABLE_ACCESS" -> "enabled access for " + member;
            case "CANCEL" -> "cancelled the invite for " + member;
            default -> "set " + member + " to " + newStatus;
        };
    }

    private static String displayName(RoleRowState member) {
        String name = member.fullName() != null && !member.fullName().isBlank() ? member.fullName() : null;
        String email = member.email() != null && !member.email().isBlank() ? member.email() : null;
        if (name != null && email != null && !name.equalsIgnoreCase(email)) {
            return name + " <" + email + ">";
        }
        return name != null ? name : (email != null ? email : member.userId());
    }

    private static HttpServletRequest currentRequest() {
        try {
            var attrs = RequestContextHolder.getRequestAttributes();
            return attrs instanceof ServletRequestAttributes sra ? sra.getRequest() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
