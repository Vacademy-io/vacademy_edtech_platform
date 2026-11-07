package vacademy.io.admin_core_service.features.regional_pricing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.regional_pricing.entity.FxRate;
import vacademy.io.admin_core_service.features.regional_pricing.repository.FxRateRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Daily exchange rates for AUTO regional prices.
 *
 * <p>Rates are fetched once a day by {@code FxRateRefreshJob} into {@code fx_rate} and
 * read from there — no request path ever calls the rate provider. The default provider
 * is open.er-api.com (ExchangeRate-API's open endpoint: no key, ~160 currencies, daily
 * updates); any endpoint returning {@code {"rates": {"INR": 83.1, ...}}} against USD works.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FxRateService {

    private static final MathContext MC = MathContext.DECIMAL64;

    private final FxRateRepository fxRateRepository;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${regional.pricing.fx.url:https://open.er-api.com/v6/latest/USD}")
    private String fxUrl;

    /**
     * Pulls the latest USD-based rates and upserts them. Returns how many were stored.
     * Deliberately not @Transactional: it is called from inside option saves, and a failed
     * fetch inside a joined transaction would mark the caller's transaction rollback-only.
     */
    public int refreshRates() {
        String body = restTemplate.getForObject(fxUrl, String.class);
        JsonNode rates;
        try {
            rates = objectMapper.readTree(body).path("rates");
        } catch (Exception e) {
            throw new VacademyException("Could not parse exchange rates: " + e.getMessage());
        }
        if (!rates.isObject() || rates.isEmpty()) {
            throw new VacademyException("Exchange-rate provider returned no rates");
        }
        Date now = new Date();
        List<FxRate> rows = new ArrayList<>();
        for (Iterator<Map.Entry<String, JsonNode>> it = rates.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            if (e.getKey() == null || e.getKey().length() != 3 || !e.getValue().isNumber()
                    || e.getValue().asDouble() <= 0) {
                continue;
            }
            FxRate row = new FxRate();
            row.setCurrency(e.getKey().toUpperCase());
            row.setUnitsPerUsd(e.getValue().decimalValue());
            row.setSource(fxUrl);
            row.setFetchedAt(now);
            rows.add(row);
        }
        fxRateRepository.saveAll(rows);
        log.info("[FxRate] stored {} rates from {}", rows.size(), fxUrl);
        return rows.size();
    }

    /** Fetches rates when the table is still empty (first use before the daily job ran). */
    public void ensureLoaded() {
        if (fxRateRepository.count() == 0) {
            refreshRates();
        }
    }

    /**
     * Rate to multiply an amount in {@code from} by to get {@code to}. Empty when either
     * currency has no stored rate.
     */
    public Optional<BigDecimal> rate(String from, String to) {
        if (from == null || to == null) {
            return Optional.empty();
        }
        if (from.equalsIgnoreCase(to)) {
            return Optional.of(BigDecimal.ONE);
        }
        Optional<FxRate> f = fxRateRepository.findById(from.toUpperCase());
        Optional<FxRate> t = fxRateRepository.findById(to.toUpperCase());
        if (f.isEmpty() || t.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(t.get().getUnitsPerUsd().divide(f.get().getUnitsPerUsd(), MC));
    }
}
