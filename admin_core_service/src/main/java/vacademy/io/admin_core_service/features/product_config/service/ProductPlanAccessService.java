package vacademy.io.admin_core_service.features.product_config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanAccessDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.PublicProductOfferDTO;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * What a product workspace may do, from what it bought: a free trial (one user), a product plan
 * (its users, from the health dashboard's plan list), or a workspace we set up by hand (not
 * limited here). The live plan is the institute's TRIAL/ACTIVE/GRACE AI subscription whose plan
 * key is the storefront key of one of the product's plans ({@code <product>_<key>}).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductPlanAccessService {

    /** A free trial is for one teacher (the website says so). */
    static final int TRIAL_SEATS = 1;
    private static final String LEAD_TAG_TRIAL = "FREE_TRIAL";

    private final JdbcTemplate jdbcTemplate;
    private final PlatformProductService productService;

    record InstituteRow(String product, String leadTag, Timestamp demoExpiresAt) {
    }

    record LivePlan(String planKey, Timestamp endAt) {
    }

    public ProductPlanAccessDTO access(String instituteId) {
        Optional<InstituteRow> institute = jdbcTemplate.query(
                "SELECT product, lead_tag, demo_expires_at FROM institutes WHERE id = ?",
                (rs, n) -> new InstituteRow(rs.getString("product"), rs.getString("lead_tag"),
                        rs.getTimestamp("demo_expires_at")), instituteId).stream().findFirst();
        if (institute.isEmpty() || !StringUtils.hasText(institute.get().product())
                || "vacademy".equalsIgnoreCase(institute.get().product())) {
            return ProductPlanAccessDTO.builder().status(ProductPlanAccessDTO.STATUS_NONE).build();
        }
        String product = institute.get().product().toLowerCase(java.util.Locale.ROOT);
        Optional<ProductSettingsDTO> settings = productService.find(product);
        if (settings.isEmpty()) {
            return ProductPlanAccessDTO.builder().product(product).status(ProductPlanAccessDTO.STATUS_NONE).build();
        }
        List<ProductPlanDTO> plans = settings.get().getPlans();
        Integer months = settings.get().getPlanValidityMonths();
        try {
            // Same numbers the website shows: the storefront price wins over the dashboard's.
            PublicProductOfferDTO offer = productService.publicOffer(product);
            plans = offer.getPlans();
            months = offer.getPlanValidityMonths();
        } catch (Exception e) {
            log.debug("[product-plan] offer unavailable for {}: {}", product, e.getMessage());
        }
        return decide(product, institute.get(), livePlan(instituteId).orElse(null), plans, months,
                settings.get().getExtraCreditPriceInr(), Instant.now());
    }

    /** The seat limit alone; null when this workspace is not limited here. */
    public Integer seatLimit(String instituteId) {
        return access(instituteId).getSeatLimit();
    }

    static ProductPlanAccessDTO decide(String product, InstituteRow institute, LivePlan live,
            List<ProductPlanDTO> plans, Integer months, java.math.BigDecimal extraCreditPrice, Instant now) {
        ProductPlanAccessDTO.ProductPlanAccessDTOBuilder out = ProductPlanAccessDTO.builder()
                .product(product)
                .plans(plans)
                .planValidityMonths(months)
                .extraCreditPriceInr(extraCreditPrice);
        ProductPlanDTO bought = null;
        if (live != null && plans != null) {
            bought = plans.stream()
                    .filter(p -> PlatformProductService.storefrontKey(product, p.getKey()).equals(live.planKey()))
                    .findFirst().orElse(null);
        }
        if (bought != null) {
            return out.status(ProductPlanAccessDTO.STATUS_PLAN)
                    .planKey(bought.getKey())
                    .planName(bought.getName())
                    .planCredits(bought.getCredits())
                    .planPriceInr(bought.getPriceInr())
                    .planEndsAt(live.endAt() == null ? null : live.endAt().toInstant().toString())
                    .seatLimit(bought.getUsers() == null ? TRIAL_SEATS : Math.max(TRIAL_SEATS, bought.getUsers()))
                    .build();
        }
        if (LEAD_TAG_TRIAL.equalsIgnoreCase(institute.leadTag())) {
            Timestamp ends = institute.demoExpiresAt();
            return out.status(ProductPlanAccessDTO.STATUS_TRIAL)
                    .seatLimit(TRIAL_SEATS)
                    .trialEndsAt(ends == null ? null : ends.toInstant().toString())
                    .trialExpired(ends != null && ends.toInstant().isBefore(now))
                    .build();
        }
        // Paid by hand, or a plan we granted outside the product's list: we manage it, no limit here.
        return out.status(ProductPlanAccessDTO.STATUS_MANAGED).build();
    }

    private Optional<LivePlan> livePlan(String instituteId) {
        try {
            return jdbcTemplate.query("SELECT p.plan_key, s.end_at FROM institute_ai_subscription s "
                            + "JOIN ai_plan_version v ON v.id = s.plan_version_id "
                            + "JOIN ai_plan p ON p.id = v.plan_id "
                            + "WHERE s.institute_id = ? AND s.status IN ('TRIAL', 'ACTIVE', 'GRACE') "
                            + "ORDER BY s.created_at DESC LIMIT 1",
                    (rs, n) -> new LivePlan(rs.getString("plan_key"), rs.getTimestamp("end_at")), instituteId)
                    .stream().findFirst();
        } catch (Exception e) {
            log.warn("[product-plan] live plan lookup failed for {}: {}", instituteId, e.getMessage());
            return Optional.empty();
        }
    }
}
