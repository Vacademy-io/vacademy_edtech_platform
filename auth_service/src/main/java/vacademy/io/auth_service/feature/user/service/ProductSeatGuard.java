package vacademy.io.auth_service.feature.user.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * A product workspace (Evalezy) may only have as many staff users as its plan allows: one on the
 * free trial and on a one-user plan, the plan's users on a team plan. admin-core decides the limit
 * (plan-access); null means the workspace is not limited (every Vacademy institute, and product
 * workspaces we set up by hand). If admin-core cannot be reached the invite goes ahead, so a
 * Vacademy invite is never blocked by this check.
 */
@Slf4j
@Component
public class ProductSeatGuard {

    private static final String STUDENT = "STUDENT";

    private static final String STAFF_COUNT = "SELECT COUNT(DISTINCT ur.user_id) FROM user_role ur "
            + "JOIN roles r ON r.id = ur.role_id "
            + "WHERE ur.institute_id = ? AND ur.status IN ('ACTIVE', 'INVITED') AND r.role_name <> 'STUDENT'";

    private static final String IS_STAFF_HERE = "SELECT COUNT(*) FROM user_role ur "
            + "JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id "
            + "WHERE ur.institute_id = ? AND ur.status IN ('ACTIVE', 'INVITED') AND r.role_name <> 'STUDENT' "
            + "AND lower(u.email) = lower(?)";

    @Autowired
    private InternalClientUtils internalClientUtils;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${admin.core.service.base_url}")
    private String adminCoreBaseUrl;

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * Institutes admin-core called "not a product workspace" (every Vacademy institute): they never
     * become one, so they skip the call for a while and an ordinary invite costs nothing extra.
     */
    private static final long NOT_A_PRODUCT_TTL_MS = 30 * 60 * 1000L;
    private static final int MAX_REMEMBERED = 20_000;
    private final java.util.Map<String, Long> notAProductUntil = new java.util.concurrent.ConcurrentHashMap<>();

    /** Refuses (409) when adding this staff member would go past the workspace's plan. */
    public void requireSeatFor(String instituteId, String email, List<String> roles) {
        if (!StringUtils.hasText(instituteId) || !needsSeat(roles)) {
            return;
        }
        Long skipUntil = notAProductUntil.get(instituteId);
        if (skipUntil != null && skipUntil > System.currentTimeMillis()) {
            return;
        }
        Limit limit = limitOf(instituteId);
        if (limit == null || limit.seats() == null) {
            return;
        }
        if (StringUtils.hasText(email)) {
            Long already = jdbcTemplate.queryForObject(IS_STAFF_HERE, Long.class, instituteId, email.trim());
            if (already != null && already > 0) {
                return;
            }
        }
        Long staff = jdbcTemplate.queryForObject(STAFF_COUNT, Long.class, instituteId);
        if (staff != null && staff >= limit.seats()) {
            throw new VacademyException(HttpStatus.CONFLICT, message(limit));
        }
    }

    static boolean needsSeat(List<String> roles) {
        return roles == null || roles.isEmpty() || roles.stream().anyMatch(r -> r != null && !STUDENT.equalsIgnoreCase(r));
    }

    static String message(Limit limit) {
        String plan = StringUtils.hasText(limit.planName()) ? "The " + limit.planName() + " plan" : "The free trial";
        if (limit.seats() <= 1) {
            return plan + " is for one teacher. Buy a team plan to add teachers.";
        }
        return plan + " allows " + limit.seats() + " users. Remove a user to add another.";
    }

    record Limit(Integer seats, String planName) {
    }

    private Limit limitOf(String instituteId) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(),
                    adminCoreBaseUrl, "/admin-core-service/internal/product-config/v1/institutes/" + instituteId
                            + "/plan-access", null);
            String body = response.getBody();
            if (!StringUtils.hasText(body)) {
                return null;
            }
            JsonNode node = mapper.readTree(body);
            if ("NONE".equals(node.path("status").asText(null))) {
                if (notAProductUntil.size() > MAX_REMEMBERED) {
                    notAProductUntil.clear();
                }
                notAProductUntil.put(instituteId, System.currentTimeMillis() + NOT_A_PRODUCT_TTL_MS);
            }
            JsonNode seats = node.get("seat_limit");
            String planName = node.hasNonNull("plan_name") ? node.get("plan_name").asText() : null;
            return new Limit(seats == null || seats.isNull() ? null : seats.asInt(), planName);
        } catch (Exception e) {
            log.warn("[seat-guard] plan access unavailable for {}, invite allowed: {}", instituteId, e.getMessage());
            return null;
        }
    }
}
