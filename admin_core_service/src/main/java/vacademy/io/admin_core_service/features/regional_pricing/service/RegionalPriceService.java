package vacademy.io.admin_core_service.features.regional_pricing.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPriceDTO;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPriceUpsertRequest;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPricingConfigDTO;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPricingSettingsRequest;
import vacademy.io.admin_core_service.features.regional_pricing.entity.FxRate;
import vacademy.io.admin_core_service.features.regional_pricing.entity.PaymentPlanRegionalPrice;
import vacademy.io.admin_core_service.features.regional_pricing.enums.RegionalPriceSource;
import vacademy.io.admin_core_service.features.regional_pricing.repository.FxRateRepository;
import vacademy.io.admin_core_service.features.regional_pricing.repository.PaymentPlanRegionalPriceRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Admin side of regional pricing: the per-option switch, the AUTO rows the system keeps
 * in step with the base price and exchange rate, and the MANUAL overrides an admin sets.
 *
 * <p>Rules:
 * <ul>
 *   <li>Turning the switch on (or adding a currency) creates one AUTO currency-wide row per
 *       paid plan for every listed currency, converted from the base price and rounded
 *       ({@link PriceRounding}).</li>
 *   <li>Editing a plan's base price recomputes its AUTO rows at once and flags its MANUAL
 *       rows {@code needs_review}; MANUAL prices are never overwritten.</li>
 *   <li>The daily rate refresh moves an AUTO price only when the rate has drifted past
 *       {@code regional.pricing.auto-drift-threshold} (default 5%), so displayed prices do
 *       not wobble day to day.</li>
 *   <li>Removing a currency from the list retires its currency-wide rows. Country rows are
 *       explicit admin choices and stay until deleted.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RegionalPriceService {

    private static final String ACTIVE = "ACTIVE";
    private static final String DELETED = "DELETED";
    private static final MathContext MC = MathContext.DECIMAL64;

    private final PaymentPlanRegionalPriceRepository regionalPriceRepository;
    private final PaymentOptionRepository paymentOptionRepository;
    private final PaymentPlanRepository paymentPlanRepository;
    private final FxRateRepository fxRateRepository;
    private final FxRateService fxRateService;

    @Value("${regional.pricing.auto-drift-threshold:0.05}")
    private BigDecimal driftThreshold;

    // -------------------------------------------------------------------------
    // Reads
    // -------------------------------------------------------------------------

    @Transactional(readOnly = true)
    public RegionalPricingConfigDTO getConfig(String paymentOptionId) {
        PaymentOption option = findOption(paymentOptionId);
        List<PaymentPlan> plans = Optional.ofNullable(option.getPaymentPlans()).orElse(List.of());
        Map<String, List<PaymentPlanRegionalPrice>> rowsByPlan = plans.isEmpty() ? Map.of()
                : regionalPriceRepository.findByPaymentPlanIdInAndStatus(
                                plans.stream().map(PaymentPlan::getId).toList(), ACTIVE)
                        .stream()
                        .collect(Collectors.groupingBy(PaymentPlanRegionalPrice::getPaymentPlanId));

        List<RegionalPricingConfigDTO.PlanPrices> planPrices = plans.stream()
                .map(plan -> RegionalPricingConfigDTO.PlanPrices.builder()
                        .paymentPlanId(plan.getId())
                        .name(plan.getName())
                        .baseActualPrice(plan.getActualPrice())
                        .baseElevatedPrice(plan.getElevatedPrice())
                        .baseCurrency(RegionalPriceResolver.baseCurrency(plan.getCurrency()))
                        .regionalPrices(rowsByPlan.getOrDefault(plan.getId(), List.of()).stream()
                                // currency-wide rows first, then country rows, each alphabetical
                                .sorted(Comparator
                                        .comparing((PaymentPlanRegionalPrice r) -> r.getCountryCode() != null)
                                        .thenComparing(r -> r.getCountryCode() == null ? "" : r.getCountryCode())
                                        .thenComparing(PaymentPlanRegionalPrice::getCurrency))
                                .map(RegionalPriceDTO::from)
                                .toList())
                        .build())
                .toList();

        return RegionalPricingConfigDTO.builder()
                .paymentOptionId(option.getId())
                .enabled(Boolean.TRUE.equals(option.getRegionalPricingEnabled()))
                .currencies(PaymentOption.splitCurrencies(option.getRegionalPricingCurrencies()))
                .ratesFetchedAt(fxRateRepository.findById("USD").map(FxRate::getFetchedAt).orElse(null))
                .plans(planPrices)
                .build();
    }

    // -------------------------------------------------------------------------
    // Option-level switch + currency list
    // -------------------------------------------------------------------------

    @Transactional
    public RegionalPricingConfigDTO updateSettings(String paymentOptionId, RegionalPricingSettingsRequest request) {
        PaymentOption option = findOption(paymentOptionId);
        if (request.getEnabled() != null) {
            option.setRegionalPricingEnabled(request.getEnabled());
        }
        if (request.getCurrencies() != null) {
            option.setRegionalPricingCurrencies(PaymentOption.joinCurrencies(request.getCurrencies()));
        }
        paymentOptionRepository.save(option);
        sync(option, false);
        return getConfig(paymentOptionId);
    }

    /** "Refresh rates now": fetch today's rates and reprice every AUTO row, ignoring the drift threshold. */
    @Transactional
    public RegionalPricingConfigDTO refreshOption(String paymentOptionId) {
        fxRateService.refreshRates();
        sync(findOption(paymentOptionId), true);
        return getConfig(paymentOptionId);
    }

    /**
     * Brings an option's rows in line with its plans and currency list. Idempotent; called
     * after any edit of the option or its plans. No-op while the switch is off (rows are
     * kept so switching back on restores the admin's prices).
     *
     * @param force reprice AUTO rows even when neither the base price nor the rate moved enough
     */
    @Transactional
    public void sync(PaymentOption option, boolean force) {
        if (option == null || !Boolean.TRUE.equals(option.getRegionalPricingEnabled())) {
            return;
        }
        List<String> targets = PaymentOption.splitCurrencies(option.getRegionalPricingCurrencies());
        List<PaymentPlan> plans = Optional.ofNullable(option.getPaymentPlans()).orElse(List.of());
        if (plans.isEmpty()) {
            return;
        }
        if (!targets.isEmpty()) {
            try {
                fxRateService.ensureLoaded();
            } catch (Exception e) {
                // No rates yet: AUTO rows are skipped below, the save that triggered this goes through.
                log.warn("[RegionalPricing] Could not load exchange rates: {}", e.getMessage());
            }
        }
        Map<String, List<PaymentPlanRegionalPrice>> rowsByPlan = regionalPriceRepository
                .findByPaymentPlanIdInAndStatus(plans.stream().map(PaymentPlan::getId).toList(), ACTIVE)
                .stream()
                .collect(Collectors.groupingBy(PaymentPlanRegionalPrice::getPaymentPlanId));
        Date now = new Date();
        List<PaymentPlanRegionalPrice> toSave = new ArrayList<>();

        for (PaymentPlan plan : plans) {
            String base = RegionalPriceResolver.baseCurrency(plan.getCurrency());
            List<PaymentPlanRegionalPrice> rows = rowsByPlan.getOrDefault(plan.getId(), List.of());

            for (PaymentPlanRegionalPrice row : rows) {
                boolean currencyWide = row.getCountryCode() == null;
                if (currencyWide && (!targets.contains(row.getCurrency()) || row.getCurrency().equals(base))) {
                    // Currency taken off the list (or now equal to the base currency).
                    row.setStatus(DELETED);
                    row.setUpdatedAt(now);
                    toSave.add(row);
                } else if (RegionalPriceSource.AUTO.name().equals(row.getPriceSource())) {
                    if (plan.getActualPrice() > 0 && reprice(row, plan, force)) {
                        toSave.add(row);
                    }
                } else if (baseChanged(row, plan) && !row.isNeedsReview()) {
                    row.setNeedsReview(true);
                    row.setUpdatedAt(now);
                    toSave.add(row);
                }
            }

            if (plan.getActualPrice() <= 0) {
                continue; // free plans are free everywhere
            }
            for (String currency : targets) {
                if (currency.equals(base)) {
                    continue;
                }
                boolean exists = rows.stream()
                        .anyMatch(r -> r.getCountryCode() == null && currency.equals(r.getCurrency()));
                if (exists) {
                    continue;
                }
                PaymentPlanRegionalPrice row = newRow(plan.getId(), currency, null, RegionalPriceSource.AUTO);
                if (reprice(row, plan, true)) {
                    toSave.add(row);
                } else {
                    log.warn("[RegionalPricing] No exchange rate {}→{}; AUTO price for plan {} not created",
                            base, currency, plan.getId());
                }
            }
        }
        regionalPriceRepository.saveAll(toSave);
    }

    // -------------------------------------------------------------------------
    // Row-level admin actions
    // -------------------------------------------------------------------------

    /** Sets a price by hand (MANUAL), or adds a system-priced row when {@code auto} is true. */
    @Transactional
    public RegionalPriceDTO upsert(RegionalPriceUpsertRequest request) {
        PaymentPlan plan = paymentPlanRepository.findById(request.getPaymentPlanId())
                .orElseThrow(() -> new VacademyException("Payment plan not found: " + request.getPaymentPlanId()));
        String country = StringUtils.hasText(request.getCountryCode())
                ? request.getCountryCode().trim().toUpperCase() : null;
        if (country != null && ViewerCountryResolver.normalize(country) == null) {
            throw new VacademyException("Invalid country code: " + request.getCountryCode());
        }
        String currency = StringUtils.hasText(request.getCurrency())
                ? request.getCurrency().trim().toUpperCase()
                : (country != null ? ViewerCountryResolver.currencyOf(country).orElse(null) : null);
        if (currency == null || currency.length() != 3) {
            throw new VacademyException("A 3-letter currency code is required");
        }
        if (country == null && currency.equals(RegionalPriceResolver.baseCurrency(plan.getCurrency()))) {
            throw new VacademyException("That is the plan's own currency — edit the plan price instead");
        }
        boolean auto = Boolean.TRUE.equals(request.getAuto());

        PaymentPlanRegionalPrice row = regionalPriceRepository.findByPaymentPlanIdAndStatus(plan.getId(), ACTIVE)
                .stream()
                .filter(r -> currency.equals(r.getCurrency()) && Objects.equals(country, r.getCountryCode()))
                .findFirst()
                .orElseGet(() -> newRow(plan.getId(), currency, country,
                        auto ? RegionalPriceSource.AUTO : RegionalPriceSource.MANUAL));

        if (auto) {
            row.setPriceSource(RegionalPriceSource.AUTO.name());
            if (!reprice(row, plan, true)) {
                throw new VacademyException("No exchange rate available for " + currency);
            }
        } else {
            if (request.getActualPrice() == null || request.getActualPrice().signum() <= 0) {
                throw new VacademyException("Price must be greater than zero");
            }
            row.setPriceSource(RegionalPriceSource.MANUAL.name());
            row.setActualPrice(money(request.getActualPrice(), currency));
            row.setElevatedPrice(request.getElevatedPrice() != null && request.getElevatedPrice().signum() > 0
                    ? money(request.getElevatedPrice(), currency) : null);
            // Remember the base this was set against, so a later base edit can flag it.
            row.setBasePriceAtCompute(BigDecimal.valueOf(plan.getActualPrice()).setScale(2, RoundingMode.HALF_UP));
            row.setBaseCurrency(RegionalPriceResolver.baseCurrency(plan.getCurrency()));
            row.setFxRateUsed(null);
            row.setComputedAt(new Date());
            row.setNeedsReview(false);
        }
        row.setUpdatedAt(new Date());
        return RegionalPriceDTO.from(regionalPriceRepository.save(row));
    }

    /** Hands a MANUAL row back to the system: it becomes AUTO and is repriced now. */
    @Transactional
    public RegionalPriceDTO resetToAuto(String regionalPriceId) {
        PaymentPlanRegionalPrice row = findRow(regionalPriceId);
        PaymentPlan plan = paymentPlanRepository.findById(row.getPaymentPlanId())
                .orElseThrow(() -> new VacademyException("Payment plan not found: " + row.getPaymentPlanId()));
        fxRateService.ensureLoaded();
        row.setPriceSource(RegionalPriceSource.AUTO.name());
        if (!reprice(row, plan, true)) {
            throw new VacademyException("No exchange rate available for " + row.getCurrency());
        }
        return RegionalPriceDTO.from(regionalPriceRepository.save(row));
    }

    /** Admin has looked at a MANUAL price after a base-price change and keeps it. */
    @Transactional
    public RegionalPriceDTO markReviewed(String regionalPriceId) {
        PaymentPlanRegionalPrice row = findRow(regionalPriceId);
        PaymentPlan plan = paymentPlanRepository.findById(row.getPaymentPlanId())
                .orElseThrow(() -> new VacademyException("Payment plan not found: " + row.getPaymentPlanId()));
        row.setNeedsReview(false);
        row.setBasePriceAtCompute(BigDecimal.valueOf(plan.getActualPrice()).setScale(2, RoundingMode.HALF_UP));
        row.setBaseCurrency(RegionalPriceResolver.baseCurrency(plan.getCurrency()));
        row.setUpdatedAt(new Date());
        return RegionalPriceDTO.from(regionalPriceRepository.save(row));
    }

    /**
     * Removes a row. A currency-wide row for a currency still on the option's list comes
     * straight back as AUTO on the next sync — remove the currency from the list to drop it.
     */
    @Transactional
    public void delete(String regionalPriceId) {
        PaymentPlanRegionalPrice row = findRow(regionalPriceId);
        row.setStatus(DELETED);
        row.setUpdatedAt(new Date());
        regionalPriceRepository.save(row);
    }

    // -------------------------------------------------------------------------
    // Daily refresh
    // -------------------------------------------------------------------------

    /** Reprices AUTO rows whose converted price drifted past the threshold. Returns rows changed. */
    @Transactional
    public int refreshAllAutoRows() {
        // Live plans of options that still have the switch on (getPaymentPlans holds ACTIVE plans only).
        Map<String, PaymentPlan> plans = paymentOptionRepository.findByRegionalPricingEnabledTrue().stream()
                .flatMap(option -> Optional.ofNullable(option.getPaymentPlans()).orElse(List.of()).stream())
                .collect(Collectors.toMap(PaymentPlan::getId, p -> p, (a, b) -> a));
        if (plans.isEmpty()) {
            return 0;
        }
        List<PaymentPlanRegionalPrice> rows = regionalPriceRepository.findByPaymentPlanIdInAndStatusAndPriceSource(
                plans.keySet(), ACTIVE, RegionalPriceSource.AUTO.name());
        List<PaymentPlanRegionalPrice> changed = new ArrayList<>();
        for (PaymentPlanRegionalPrice row : rows) {
            PaymentPlan plan = plans.get(row.getPaymentPlanId());
            if (plan != null && plan.getActualPrice() > 0 && reprice(row, plan, false)) {
                changed.add(row);
            }
        }
        regionalPriceRepository.saveAll(changed);
        return changed.size();
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /**
     * Converts the plan's base price into the row's currency and writes it when forced, when
     * the base price/currency changed since the last compute, or when the rate drifted past
     * the threshold. Returns whether the row changed.
     */
    private boolean reprice(PaymentPlanRegionalPrice row, PaymentPlan plan, boolean force) {
        String base = RegionalPriceResolver.baseCurrency(plan.getCurrency());
        Optional<BigDecimal> rate = fxRateService.rate(base, row.getCurrency());
        if (rate.isEmpty()) {
            return false;
        }
        BigDecimal basePrice = BigDecimal.valueOf(plan.getActualPrice());
        BigDecimal candidate = PriceRounding.round(basePrice.multiply(rate.get(), MC), row.getCurrency());
        if (!force && !baseChanged(row, plan) && row.getActualPrice() != null && row.getActualPrice().signum() > 0) {
            BigDecimal drift = candidate.subtract(row.getActualPrice()).abs()
                    .divide(row.getActualPrice(), MC);
            if (drift.compareTo(driftThreshold) < 0) {
                return false;
            }
        }
        row.setActualPrice(candidate);
        row.setElevatedPrice(plan.getElevatedPrice() > plan.getActualPrice()
                ? PriceRounding.round(BigDecimal.valueOf(plan.getElevatedPrice()).multiply(rate.get(), MC),
                row.getCurrency())
                : null);
        row.setBasePriceAtCompute(basePrice.setScale(2, RoundingMode.HALF_UP));
        row.setBaseCurrency(base);
        row.setFxRateUsed(rate.get());
        row.setComputedAt(new Date());
        row.setUpdatedAt(new Date());
        row.setNeedsReview(false);
        return true;
    }

    private static boolean baseChanged(PaymentPlanRegionalPrice row, PaymentPlan plan) {
        if (row.getBasePriceAtCompute() == null) {
            return true;
        }
        BigDecimal current = BigDecimal.valueOf(plan.getActualPrice()).setScale(2, RoundingMode.HALF_UP);
        return current.compareTo(row.getBasePriceAtCompute()) != 0
                || !RegionalPriceResolver.baseCurrency(plan.getCurrency()).equals(row.getBaseCurrency());
    }

    private static PaymentPlanRegionalPrice newRow(String planId, String currency, String country,
                                                   RegionalPriceSource source) {
        PaymentPlanRegionalPrice row = new PaymentPlanRegionalPrice();
        row.setPaymentPlanId(planId);
        row.setCurrency(currency);
        row.setCountryCode(country);
        row.setPriceSource(source.name());
        row.setStatus(ACTIVE);
        return row;
    }

    private static BigDecimal money(BigDecimal amount, String currency) {
        return amount.setScale(PriceRounding.minorUnits(currency), RoundingMode.HALF_UP);
    }

    private PaymentOption findOption(String paymentOptionId) {
        return paymentOptionRepository.findById(paymentOptionId)
                .orElseThrow(() -> new VacademyException("Payment option not found: " + paymentOptionId));
    }

    private PaymentPlanRegionalPrice findRow(String regionalPriceId) {
        return regionalPriceRepository.findById(regionalPriceId)
                .filter(r -> ACTIVE.equals(r.getStatus()))
                .orElseThrow(() -> new VacademyException("Regional price not found: " + regionalPriceId));
    }
}
