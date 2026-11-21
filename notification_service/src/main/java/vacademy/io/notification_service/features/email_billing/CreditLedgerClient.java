package vacademy.io.notification_service.features.email_billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The institute credit wallet, through admin-core's internal email-credits endpoints (admin-core
 * owns the ledger client). Balances are cached for 30 seconds: the gate asks on every send, and a
 * bulk send must not turn into one balance call per recipient.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CreditLedgerClient {

    static final String BALANCE_ROUTE = "/admin-core-service/internal/credits/v1/email/balance";
    static final String CHARGE_ROUTE = "/admin-core-service/internal/credits/v1/email/charge";
    private static final long BALANCE_TTL_MILLIS = 30_000;

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${admin.core.service.baseurl}")
    private String adminCoreBaseUrl;

    private record Cached(Optional<BigDecimal> balance, long at) {
    }

    private final Map<String, Cached> balances = new ConcurrentHashMap<>();

    /** Current wallet balance, or empty when admin-core cannot say. */
    public Optional<BigDecimal> balance(String instituteId) {
        Cached c = balances.get(instituteId);
        if (c != null && System.currentTimeMillis() - c.at() < BALANCE_TTL_MILLIS) {
            return c.balance();
        }
        Optional<BigDecimal> value = fetchBalance(instituteId);
        balances.put(instituteId, new Cached(value, System.currentTimeMillis()));
        return value;
    }

    /** Drops the cached balance, e.g. right after a charge or when an admin asks for usage. */
    public void forget(String instituteId) {
        balances.remove(instituteId);
    }

    private Optional<BigDecimal> fetchBalance(String instituteId) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName,
                    HttpMethod.GET.name(), adminCoreBaseUrl,
                    BALANCE_ROUTE + "?instituteId=" + URLEncoder.encode(instituteId, StandardCharsets.UTF_8), null);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return Optional.empty();
            }
            JsonNode node = objectMapper.readTree(response.getBody());
            JsonNode balance = node.get("balance");
            return balance == null || balance.isNull() ? Optional.empty() : Optional.of(balance.decimalValue());
        } catch (Exception e) {
            log.warn("Could not read credit balance for institute {}: {}", instituteId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Charges {@code credits} to the institute wallet under {@code idempotencyKey}; a repeated key
     * charges nothing more. @return true when the ledger confirmed the charge (or an earlier one).
     */
    public boolean charge(String instituteId, BigDecimal credits, long units, String periodMonth,
            String idempotencyKey) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("instituteId", instituteId);
            body.put("credits", credits);
            body.put("units", units);
            body.put("periodMonth", periodMonth);
            body.put("idempotencyKey", idempotencyKey);
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName,
                    HttpMethod.POST.name(), adminCoreBaseUrl, CHARGE_ROUTE, body);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return false;
            }
            boolean charged = objectMapper.readTree(response.getBody()).path("charged").asBoolean(false);
            if (charged) {
                forget(instituteId);
            }
            return charged;
        } catch (Exception e) {
            log.warn("Email credit charge {} for institute {} failed: {}", idempotencyKey, instituteId, e.getMessage());
            return false;
        }
    }
}
