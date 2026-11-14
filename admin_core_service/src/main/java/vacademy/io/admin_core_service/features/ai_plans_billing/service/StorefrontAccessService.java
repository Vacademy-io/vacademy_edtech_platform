package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiPlansBillingSettings.StorefrontMode;

import java.util.List;

/**
 * Whether the AI-plan storefront is open for one institute (server side; the admin UI only
 * mirrors the answer). Closed unless every rule passes:
 * <ol>
 *   <li>{@code billing.storefront.mode} is not OFF;</li>
 *   <li>the institute is not a sub-org child (sub-org admins sign in on the parent's domain, so
 *       only the server can tell; AI spend rolls up to the parent, which buys);</li>
 *   <li>{@code ai_storefront_institute.storefront_enabled} is not FALSE (an explicit off always wins);</li>
 *   <li>ALL: open. ALLOWLIST: the institute has {@code storefront_enabled = TRUE} or an active
 *       INCLUDE row in {@code ai_storefront_audience} with {@code plan_id} NULL. SEGMENTS: the
 *       same, or one of its {@code ai_institute_segment} keys has such a row;</li>
 *   <li>no active EXCLUDE row (institute or one of its segments) with {@code plan_id} NULL.</li>
 * </ol>
 * Any lookup error closes the storefront.
 */
@Slf4j
@Service
public class StorefrontAccessService {

    static final String SELECT_SUBORG_CHILD = "SELECT COUNT(*) FROM institute_suborg WHERE suborg_id = ? "
            + "AND COALESCE(UPPER(status), 'ACTIVE') NOT IN ('DELETED', 'INACTIVE')";
    static final String SELECT_SWITCH =
            "SELECT storefront_enabled FROM ai_storefront_institute WHERE institute_id = ?";
    static final String SELECT_AUDIENCE = "SELECT a.rule FROM ai_storefront_audience a "
            + "WHERE a.is_active AND a.plan_id IS NULL AND (a.institute_id = ? "
            + "OR (? AND a.segment_key IN (SELECT s.segment_key FROM ai_institute_segment s WHERE s.institute_id = ?)))";
    static final String SELECT_EXCLUDES = "SELECT COUNT(*) FROM ai_storefront_audience a "
            + "WHERE a.is_active AND a.plan_id IS NULL AND UPPER(a.rule) = 'EXCLUDE' AND (a.institute_id = ? "
            + "OR a.segment_key IN (SELECT s.segment_key FROM ai_institute_segment s WHERE s.institute_id = ?))";

    private final AiPlansBillingSettings settings;
    private final JdbcTemplate jdbc;

    public StorefrontAccessService(AiPlansBillingSettings settings, JdbcTemplate jdbc) {
        this.settings = settings;
        this.jdbc = jdbc;
    }

    public boolean isOpen(String instituteId) {
        StorefrontMode mode = settings.storefrontMode();
        if (mode == StorefrontMode.OFF || instituteId == null || instituteId.isBlank()) {
            return false;
        }
        try {
            Long child = jdbc.queryForObject(SELECT_SUBORG_CHILD, Long.class, instituteId);
            if (child != null && child > 0) {
                return false;
            }
            List<Boolean> sw = jdbc.queryForList(SELECT_SWITCH, Boolean.class, instituteId);
            Boolean enabled = sw.isEmpty() ? null : sw.get(0);
            if (Boolean.FALSE.equals(enabled)) {
                return false;
            }
            Long excluded = jdbc.queryForObject(SELECT_EXCLUDES, Long.class, instituteId, instituteId);
            if (excluded != null && excluded > 0) {
                return false;
            }
            if (mode == StorefrontMode.ALL || Boolean.TRUE.equals(enabled)) {
                return true;
            }
            boolean segments = mode == StorefrontMode.SEGMENTS;
            List<String> rules = jdbc.queryForList(SELECT_AUDIENCE, String.class, instituteId, segments, instituteId);
            return rules.stream().anyMatch(r -> r == null || "INCLUDE".equalsIgnoreCase(r.trim()));
        } catch (Exception e) {
            log.warn("[ai-plans-billing] storefront check failed for {} ({}); closed", instituteId, e.getMessage());
            return false;
        }
    }

    /** Throws 404 STOREFRONT_OFF when closed. */
    public void requireOpen(String instituteId) {
        if (!isOpen(instituteId)) {
            throw AiPlansBillingException.storefrontOff();
        }
    }
}
