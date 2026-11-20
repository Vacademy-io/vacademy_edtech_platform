package vacademy.io.admin_core_service.features.product_config.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;

/**
 * A product "Buy <plan>" account (lead tag LEAD) gets no login mail at sign-up. When its plan is
 * paid, the institute becomes PROD and auth-service sends the login mail. The LEAD -> PROD update is
 * the claim: only the call that flips it sends, so the webhook and the reconcile job together still
 * send one mail. Never throws: a failure is logged and never reaches the payment.
 */
@Slf4j
@Service
public class ProductPaidWelcomeService {

    static final String LEAD_TAG_BUYING = "LEAD";
    static final String LEAD_TAG_PAID = "PROD";

    private final JdbcTemplate jdbcTemplate;

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;

    public ProductPaidWelcomeService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** After a plan payment is captured; off the payment thread. */
    public void onPlanPaidAsync(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return;
        }
        CompletableFuture.runAsync(() -> onPlanPaid(instituteId));
    }

    /** @return true when this call sent (asked auth-service to send) the login mail */
    boolean onPlanPaid(String instituteId) {
        try {
            List<String> product = jdbcTemplate.queryForList(
                    "SELECT product FROM institutes WHERE id = ? AND lead_tag = ?", String.class, instituteId,
                    LEAD_TAG_BUYING);
            if (product.isEmpty() || !StringUtils.hasText(product.get(0))
                    || "vacademy".equalsIgnoreCase(product.get(0).trim())) {
                return false;
            }
            int claimed = jdbcTemplate.update(
                    "UPDATE institutes SET lead_tag = ?, updated_at = now() WHERE id = ? AND lead_tag = ?",
                    LEAD_TAG_PAID, instituteId, LEAD_TAG_BUYING);
            if (claimed != 1) {
                return false;
            }
            String key = product.get(0).trim().toLowerCase(Locale.ROOT);
            internalClientUtils.makeHmacRequest(clientName, HttpMethod.POST.name(), authServerBaseUrl,
                    "/auth-service/internal/v1/self-signup/" + key + "/paid-welcome?instituteId=" + instituteId, null);
            log.info("[product-welcome] institute {} ({}) paid: login mail requested", instituteId, key);
            return true;
        } catch (Exception e) {
            log.error("[product-welcome] login mail after payment failed for institute {}: {}", instituteId,
                    e.getMessage(), e);
            return false;
        }
    }
}
