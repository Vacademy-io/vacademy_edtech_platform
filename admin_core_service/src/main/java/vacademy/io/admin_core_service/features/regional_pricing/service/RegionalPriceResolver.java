package vacademy.io.admin_core_service.features.regional_pricing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.PackageSessionToPaymentOptionDTO;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageInviteMappingResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageResponse;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.regional_pricing.entity.PaymentPlanRegionalPrice;
import vacademy.io.admin_core_service.features.regional_pricing.repository.PaymentPlanRegionalPriceRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Learner side of regional pricing: which price a viewer from a given country pays.
 *
 * <p>Lookup order for a plan whose option has regional pricing on:
 * <ol>
 *   <li>a row for the viewer's exact country;</li>
 *   <li>the currency-wide row for the country's local currency;</li>
 *   <li>otherwise the plan's own (base) price.</li>
 * </ol>
 * A row in a currency the invite's gateway cannot charge is skipped. Prices are read from
 * stored rows only — AUTO and MANUAL rows are both just prices here, nothing is converted
 * on the fly — so the learner pays exactly what they were shown.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RegionalPriceResolver {

    static final String ACTIVE = "ACTIVE";
    private static final String SUPPRESS_ATTR = RegionalPriceResolver.class.getName() + ".SUPPRESSED";

    private final PaymentPlanRegionalPriceRepository regionalPriceRepository;
    private final PaymentOptionRepository paymentOptionRepository;
    private final ViewerCountryResolver viewerCountryResolver;
    private final ObjectMapper objectMapper;

    public Optional<String> viewerCountry() {
        return viewerCountryResolver.currentCountry();
    }

    /** Regional price for the current request's viewer, if one applies. */
    public Optional<RegionalQuote> quote(PaymentPlan plan, String vendor) {
        // Switch first: the viewer's country (an IP lookup) is only worked out for an option
        // that actually has regional pricing on.
        if (!regionalPricingOn(plan)) {
            return Optional.empty();
        }
        return quote(plan, viewerCountry().orElse(null), vendor);
    }

    private static boolean regionalPricingOn(PaymentPlan plan) {
        return plan != null && plan.getPaymentOption() != null
                && Boolean.TRUE.equals(plan.getPaymentOption().getRegionalPricingEnabled());
    }

    /**
     * Turns regional pricing off for the rest of the current HTTP request. A multi-course
     * checkout calls this when its items would not all price in one regional currency, so the
     * per-item enrolments it fans out to stay on base prices and the order total adds up.
     */
    public void suppressForCurrentRequest() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (attrs != null) {
            attrs.setAttribute(SUPPRESS_ATTR, Boolean.TRUE, RequestAttributes.SCOPE_REQUEST);
        }
    }

    private static boolean suppressed() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        return attrs != null
                && Boolean.TRUE.equals(attrs.getAttribute(SUPPRESS_ATTR, RequestAttributes.SCOPE_REQUEST));
    }

    public Optional<RegionalQuote> quote(PaymentPlan plan, String countryCode, String vendor) {
        if (plan == null || countryCode == null || plan.getActualPrice() <= 0 || suppressed()) {
            return Optional.empty();
        }
        PaymentOption option = plan.getPaymentOption();
        if (option == null || !Boolean.TRUE.equals(option.getRegionalPricingEnabled())) {
            return Optional.empty();
        }
        List<PaymentPlanRegionalPrice> rows = regionalPriceRepository.findByPaymentPlanIdAndStatus(plan.getId(), ACTIVE);
        return pick(rows, plan.getId(), baseCurrency(plan.getCurrency()), countryCode, vendor);
    }

    static Optional<RegionalQuote> pick(List<PaymentPlanRegionalPrice> rows, String planId, String baseCurrency,
                                        String countryCode, String vendor) {
        if (rows == null || rows.isEmpty() || countryCode == null) {
            return Optional.empty();
        }
        Optional<PaymentPlanRegionalPrice> countryRow = rows.stream()
                .filter(r -> countryCode.equalsIgnoreCase(r.getCountryCode()))
                .filter(r -> GatewayCurrencySupport.supports(vendor, r.getCurrency()))
                .findFirst();
        if (countryRow.isPresent()) {
            return countryRow.map(r -> toQuote(r, planId, countryCode));
        }
        Optional<String> local = ViewerCountryResolver.currencyOf(countryCode);
        if (local.isEmpty() || local.get().equalsIgnoreCase(baseCurrency)) {
            return Optional.empty();
        }
        return rows.stream()
                .filter(r -> r.getCountryCode() == null && local.get().equalsIgnoreCase(r.getCurrency()))
                .filter(r -> GatewayCurrencySupport.supports(vendor, r.getCurrency()))
                .findFirst()
                .map(r -> toQuote(r, planId, countryCode));
    }

    private static RegionalQuote toQuote(PaymentPlanRegionalPrice r, String planId, String countryCode) {
        return new RegionalQuote(planId, r.getActualPrice(), r.getElevatedPrice(), r.getCurrency(),
                countryCode, r.getPriceSource(), r.getId());
    }

    // -------------------------------------------------------------------------
    // Learner-facing reads: swap the base price on plan DTOs for the viewer's price.
    // -------------------------------------------------------------------------

    /**
     * Rewrites the plans of a public enroll-invite payload to the viewer's regional price.
     * The invite's own {@code currency} is changed only when every paid plan on it moved to
     * the same currency, so a mixed invite never advertises one currency for another's price.
     */
    public void localize(EnrollInviteDTO invite) {
        try {
            localizeInvite(invite);
        } catch (Exception e) {
            // Never break a public page over regional pricing. Every database read happens
            // before any DTO is changed, so on failure the payload is the untouched base one.
            log.warn("Regional pricing skipped for invite {}: {}", invite != null ? invite.getId() : null,
                    e.getMessage());
        }
    }

    private void localizeInvite(EnrollInviteDTO invite) {
        if (invite == null || invite.getPackageSessionToPaymentOptions() == null) {
            return;
        }
        List<PackageSessionToPaymentOptionDTO> mappings = invite.getPackageSessionToPaymentOptions().stream()
                .filter(m -> m != null && m.getPaymentOption() != null)
                .toList();
        // Switch first, from the payload itself when it carries it: an invite whose options are
        // all off returns here with no query and no country lookup.
        Map<String, Boolean> flags = new HashMap<>();
        mappings.forEach(m -> flags.put(m.getPaymentOption().getId(), m.getPaymentOption().getRegionalPricingEnabled()));
        Set<String> enabled = enabledOptions(flags);
        if (enabled.isEmpty()) {
            return;
        }
        Optional<String> country = viewerCountry();
        if (country.isEmpty()) {
            return;
        }
        List<PaymentPlanDTO> candidates = new ArrayList<>();
        List<PaymentPlanDTO> paidPlans = new ArrayList<>();
        for (PackageSessionToPaymentOptionDTO m : mappings) {
            List<PaymentPlanDTO> plans = Optional.ofNullable(m.getPaymentOption().getPaymentPlans()).orElse(List.of());
            plans.stream().filter(p -> p != null && p.getActualPrice() != null && p.getActualPrice() > 0)
                    .forEach(paidPlans::add);
            if (enabled.contains(m.getPaymentOption().getId())) {
                candidates.addAll(plans);
            }
        }
        localizePlans(candidates, invite.getVendor(), country.get());

        Set<String> currencies = paidPlans.stream().map(PaymentPlanDTO::getCurrency)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        boolean allLocalized = !paidPlans.isEmpty()
                && paidPlans.stream().allMatch(p -> p.getPricingCountry() != null);
        if (allLocalized && currencies.size() == 1) {
            invite.setCurrency(currencies.iterator().next());
        }
    }

    /**
     * Product pages: per-mapping plans are localized only when the page has no basket
     * pricing or offers — those are written as amounts in the page's base currency, so a
     * page using them stays on base pricing end to end (display and checkout alike).
     */
    public void localize(ProductPageResponse page) {
        try {
            localizeProductPage(page);
        } catch (Exception e) {
            // Same guarantee as for invites: on any failure the page goes out on base prices.
            log.warn("Regional pricing skipped for product page {}: {}", page != null ? page.getCode() : null,
                    e.getMessage());
        }
    }

    private void localizeProductPage(ProductPageResponse page) {
        if (page == null || page.getMappings() == null || hasCurrencyBoundSettings(page.getSettingsJson())) {
            return;
        }
        Map<String, Boolean> flags = new HashMap<>();
        page.getMappings().stream().filter(m -> m.getPaymentOptionId() != null)
                .forEach(m -> flags.put(m.getPaymentOptionId(), m.getRegionalPricingEnabled()));
        Set<String> enabled = enabledOptions(flags);
        if (enabled.isEmpty()) {
            return;
        }
        Optional<String> country = viewerCountry();
        if (country.isEmpty()) {
            return;
        }
        List<PaymentPlanDTO> candidates = page.getMappings().stream()
                .filter(m -> m.getPaymentPlan() != null && enabled.contains(m.getPaymentOptionId()))
                .map(ProductPageInviteMappingResponse::getPaymentPlan)
                .toList();
        localizePlans(candidates, page.getVendor(), country.get());

        List<PaymentPlanDTO> paid = page.getMappings().stream()
                .map(ProductPageInviteMappingResponse::getPaymentPlan)
                .filter(p -> p != null && p.getActualPrice() != null && p.getActualPrice() > 0)
                .toList();
        Set<String> currencies = paid.stream().map(PaymentPlanDTO::getCurrency)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        if (!paid.isEmpty() && paid.stream().allMatch(p -> p.getPricingCountry() != null) && currencies.size() == 1) {
            page.setCurrency(currencies.iterator().next());
        } else {
            // Checkout prices a product-page basket all-or-nothing (one currency for the whole
            // order), so the page must not show a mix of regional and base prices either.
            paid.forEach(RegionalPriceResolver::revertDto);
        }
    }

    private static void revertDto(PaymentPlanDTO dto) {
        if (dto.getPricingCountry() == null) {
            return;
        }
        dto.setActualPrice(dto.getBaseActualPrice());
        dto.setElevatedPrice(dto.getBaseElevatedPrice());
        dto.setCurrency(dto.getBaseCurrency());
        dto.setBaseActualPrice(null);
        dto.setBaseElevatedPrice(null);
        dto.setBaseCurrency(null);
        dto.setPricingCountry(null);
    }

    /** Swaps price/currency on plan DTOs whose option is already known to be enabled. */
    void localizePlans(List<PaymentPlanDTO> plans, String vendor, String countryCode) {
        List<PaymentPlanDTO> paid = plans.stream()
                .filter(p -> p != null && p.getId() != null && p.getActualPrice() != null && p.getActualPrice() > 0)
                .toList();
        if (paid.isEmpty()) {
            return;
        }
        Map<String, List<PaymentPlanRegionalPrice>> rowsByPlan = regionalPriceRepository
                .findByPaymentPlanIdInAndStatus(paid.stream().map(PaymentPlanDTO::getId).collect(Collectors.toSet()), ACTIVE)
                .stream()
                .collect(Collectors.groupingBy(PaymentPlanRegionalPrice::getPaymentPlanId));
        for (PaymentPlanDTO dto : paid) {
            pick(rowsByPlan.get(dto.getId()), dto.getId(), baseCurrency(dto.getCurrency()), countryCode, vendor)
                    .ifPresent(q -> applyToDto(dto, q));
        }
    }

    private static void applyToDto(PaymentPlanDTO dto, RegionalQuote q) {
        dto.setBaseActualPrice(dto.getActualPrice());
        dto.setBaseElevatedPrice(dto.getElevatedPrice());
        dto.setBaseCurrency(dto.getCurrency());
        dto.setPricingCountry(q.countryCode());
        dto.setActualPrice(q.actualPrice().doubleValue());
        // A base-currency strike-through next to a regional price would be meaningless.
        dto.setElevatedPrice(q.elevatedPrice() != null ? q.elevatedPrice().doubleValue() : 0d);
        dto.setCurrency(q.currency());
    }

    /**
     * Option ids with regional pricing on. Uses the switch carried on the payload when every
     * option has it; only an option whose payload lacks it is read from the database.
     */
    private Set<String> enabledOptions(Map<String, Boolean> flagsByOptionId) {
        Set<String> enabled = new HashSet<>();
        Set<String> unknown = new HashSet<>();
        flagsByOptionId.forEach((id, flag) -> {
            if (id == null) {
                return;
            }
            if (flag == null) {
                unknown.add(id);
            } else if (flag) {
                enabled.add(id);
            }
        });
        if (!unknown.isEmpty()) {
            enabled.addAll(enabledOptionIds(unknown));
        }
        return enabled;
    }

    private Set<String> enabledOptionIds(Collection<String> optionIds) {
        if (optionIds.isEmpty()) {
            return Set.of();
        }
        Set<String> enabled = new HashSet<>();
        for (PaymentOption o : paymentOptionRepository.findAllById(optionIds)) {
            if (Boolean.TRUE.equals(o.getRegionalPricingEnabled())) {
                enabled.add(o.getId());
            }
        }
        return enabled;
    }

    /** True when the product page's settings carry money amounts (basket pricing / offers). */
    public boolean hasCurrencyBoundSettings(String settingsJson) {
        if (!StringUtils.hasText(settingsJson)) {
            return false;
        }
        try {
            JsonNode root = objectMapper.readTree(settingsJson);
            return root.path("basketPricing").path("enabled").asBoolean(false)
                    || root.path("offers").path("enabled").asBoolean(false);
        } catch (Exception e) {
            // Unreadable settings: stay on base pricing rather than guess.
            return true;
        }
    }

    static String baseCurrency(String planCurrency) {
        return StringUtils.hasText(planCurrency) ? planCurrency.trim().toUpperCase() : "INR";
    }
}
