package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.enums.CatalogueStatusEnum;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.stock_hold.service.RepeatPurchasePolicyService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Checks the shipping (and any other additional charge) lines of a storefront order against the
 * catalogue that priced the cart, so a client can neither pick a cheaper tier nor drop the line.
 *
 * <p>The tiers live in {@code course_catalogue.catalogue_json} →
 * {@code globalSettings.payment.additionalCharges[]}: {@code packageSessionId}, the
 * {@code applicableTo} modes ("COURSE" = buy, "MEMBERSHIP" = rent) and either
 * {@code tiers[{minQty, maxQty|null, planId, amount}]} or a flat {@code planId, amount}. The
 * storefront resolves them the same way (additional-charges-util.ts): the first tier whose range
 * holds the number of copies in the cart wins.
 *
 * <p>A charge with a non-empty {@code zones[{key, pinPrefixes, excludePinPrefixes, planId, amount}]}
 * is priced by the delivery PIN instead (its tiers and flat plan are ignored): once per order,
 * whatever the copies, at the plan of the first zone that serves the PIN (ShippingZoneMatcher).
 * Such an order needs a valid six-digit PIN; a PIN no zone serves, or whose zone has no plan and
 * amount, is not deliverable (the cart blocks checkout for both rather than ship for free).
 *
 * <ul>
 *   <li>A charge line must carry the plan of that tier (or zone). Its config is looked up in the tagged
 *       catalogue first, else in any catalogue of the institute (the browser picks the tag, so
 *       two catalogues with different tiers for one charge item are both accepted). A charge
 *       item no catalogue configures is allowed with a warning: an unknown setup, not an
 *       attack we can recognise.</li>
 *   <li>When the order names its catalogue, every buy-mode charge that catalogue would add to
 *       this cart must be in the order.</li>
 * </ul>
 *
 * Catalogues are read through the repository, which returns empty instead of throwing: this
 * runs inside the enrollment transaction, and an exception thrown out of a transactional
 * service would mark the whole enrollment rollback-only even when caught.
 */
@Slf4j
@Service
public class AdditionalChargeValidator {

    static final String CHARGE_MISMATCH_MESSAGE = "Shipping charge does not match the number of items";
    static final String CHARGE_MISSING_MESSAGE =
            "Shipping charge is missing from this order. Please reload the cart and try again.";
    static final String PIN_INVALID_MESSAGE = "Enter a valid 6-digit delivery PIN code";
    static final String PIN_NOT_SERVED_MESSAGE = "Delivery is not available to this PIN code";
    static final String ZONE_MISMATCH_MESSAGE = "Shipping charge does not match the delivery PIN code";

    /** {@code applicableTo} value of a buy-mode (storefront cart) charge. */
    private static final String BUY_MODE = "COURSE";

    /** The statuses the storefront's by-tag lookup serves (CourseCatalogueService). */
    private static final List<String> LIVE_STATUSES =
            List.of(CatalogueStatusEnum.ACTIVE.name(), CatalogueStatusEnum.DRAFT.name());

    @Autowired
    private CatalogueInstituteMappingRepository catalogueInstituteMappingRepository;

    @Autowired
    private RepeatPurchasePolicyService repeatPurchasePolicyService;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * @param items the order's lines, quantities already normalised (null counts as 1)
     * @param deliveryPinCode the order's delivery PIN as sent (trimmed here); only zone charges read it
     * @throws InvalidRequestException (400) on a wrong tier/zone plan, a missing charge line, or —
     *         for a zone charge — a missing/invalid PIN or one no zone delivers to
     */
    public void validate(String instituteId, String catalogueTag,
                         List<LearnerPackageSessionEnrollmentItemDTO> items, String deliveryPinCode) {
        if (items == null || items.isEmpty()) {
            return;
        }
        String pin = ShippingZoneMatcher.normalisePin(deliveryPinCode);
        List<ChargeConfig> taggedCharges = StringUtils.hasText(catalogueTag)
                ? taggedCatalogueCharges(instituteId, catalogueTag.trim())
                : List.of();
        Set<String> taggedChargeSessions = taggedCharges.stream()
                .map(ChargeConfig::packageSessionId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        // Copies in the cart = every line that is not itself a charge.
        List<LearnerPackageSessionEnrollmentItemDTO> chargeItems = new ArrayList<>();
        int bookQuantity = 0;
        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            String packageSessionId = item.getPackageSessionId();
            if (taggedChargeSessions.contains(packageSessionId)
                    || repeatPurchasePolicyService.isChargePackageSession(packageSessionId)) {
                chargeItems.add(item);
            } else {
                bookQuantity += quantityOf(item);
            }
        }

        List<ChargeConfig> instituteCharges = null;
        for (LearnerPackageSessionEnrollmentItemDTO chargeItem : chargeItems) {
            List<ChargeConfig> configs = forPackageSession(taggedCharges, chargeItem.getPackageSessionId());
            if (configs.isEmpty()) {
                if (instituteCharges == null) {
                    instituteCharges = allCatalogueCharges(instituteId);
                }
                configs = forPackageSession(instituteCharges, chargeItem.getPackageSessionId());
            }
            if (configs.isEmpty()) {
                log.warn("Charge item {} (plan {}) is configured in no catalogue of institute {}; allowing it",
                        chargeItem.getPackageSessionId(), chargeItem.getPlanId(), instituteId);
                continue;
            }
            int copies = bookQuantity;
            boolean matches = configs.stream()
                    .map(config -> config.expectedPlanId(copies, pin))
                    .anyMatch(planId -> planId != null && planId.equals(chargeItem.getPlanId()));
            if (!matches) {
                log.warn("Charge plan mismatch on institute {}: item {} sent plan {}, {} copies (PIN {}) expect {}",
                        instituteId, chargeItem.getPackageSessionId(), chargeItem.getPlanId(), copies, pin,
                        configs.stream().map(config -> config.expectedPlanId(copies, pin)).toList());
                throw new InvalidRequestException(rejectedChargeMessage(configs, copies, pin));
            }
        }

        if (bookQuantity > 0 && !taggedCharges.isEmpty()) {
            Set<String> orderedSessions = items.stream()
                    .map(LearnerPackageSessionEnrollmentItemDTO::getPackageSessionId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            for (ChargeConfig config : taggedCharges) {
                if (config.chargedInBuyCart(bookQuantity, pin)
                        && !orderedSessions.contains(config.packageSessionId())) {
                    log.warn("Order on catalogue {} of institute {} with {} copies is missing charge {} ({})",
                            catalogueTag, instituteId, bookQuantity, config.key(), config.packageSessionId());
                    throw new InvalidRequestException(missingChargeMessage(config, pin));
                }
            }
        } else if (bookQuantity > 0 && chargeItems.isEmpty()) {
            // No (or an unknown) catalogue tag: leaving it out must not be a way to skip shipping.
            // The storefront always sends its tag, so this only judges tag-less callers — against
            // every catalogue of the institute.
            if (instituteCharges == null) {
                instituteCharges = allCatalogueCharges(instituteId);
            }
            int copies = bookQuantity;
            Optional<ChargeConfig> owed = instituteCharges.stream()
                    .filter(config -> config.chargedInBuyCart(copies, pin))
                    .findFirst();
            if (owed.isPresent()) {
                log.warn("Tag-less order on institute {} with {} copies is missing charge {} ({})",
                        instituteId, bookQuantity, owed.get().key(), owed.get().packageSessionId());
                throw new InvalidRequestException(missingChargeMessage(owed.get(), pin));
            }
        }
    }

    /**
     * Why no config accepts a charge line. A zone charge on an order with copies fails on its PIN
     * first (the buyer can fix that); anything else is a plan that does not match.
     */
    private static String rejectedChargeMessage(List<ChargeConfig> configs, int copies, String pin) {
        List<ChargeConfig> zoned = configs.stream().filter(ChargeConfig::zoned).toList();
        if (copies > 0 && !zoned.isEmpty()) {
            if (pin == null) {
                return PIN_INVALID_MESSAGE;
            }
            if (zoned.stream().allMatch(config -> config.pinProblem(pin) != null)) {
                return PIN_NOT_SERVED_MESSAGE;
            }
            return ZONE_MISMATCH_MESSAGE;
        }
        return CHARGE_MISMATCH_MESSAGE;
    }

    /** A missing zone charge reports its PIN problem, if any: dropping the line must not dodge it. */
    private static String missingChargeMessage(ChargeConfig config, String pin) {
        String pinProblem = config.pinProblem(pin);
        return pinProblem != null ? pinProblem : CHARGE_MISSING_MESSAGE;
    }

    private static int quantityOf(LearnerPackageSessionEnrollmentItemDTO item) {
        Integer quantity = item.getRequestedQuantity();
        return quantity != null && quantity > 0 ? quantity : 1;
    }

    private static List<ChargeConfig> forPackageSession(List<ChargeConfig> configs, String packageSessionId) {
        if (!StringUtils.hasText(packageSessionId)) {
            return List.of();
        }
        return configs.stream().filter(config -> packageSessionId.equals(config.packageSessionId())).toList();
    }

    private List<ChargeConfig> taggedCatalogueCharges(String instituteId, String catalogueTag) {
        if (!StringUtils.hasText(instituteId)) {
            return List.of();
        }
        return catalogueInstituteMappingRepository
                .findByInstituteIdAndTagName(instituteId, catalogueTag, LIVE_STATUSES)
                .map(mapping -> parseCharges(catalogueJson(mapping)))
                .orElseGet(() -> {
                    log.warn("Order names catalogue tag {} that institute {} does not have", catalogueTag, instituteId);
                    return List.of();
                });
    }

    private List<ChargeConfig> allCatalogueCharges(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return List.of();
        }
        List<ChargeConfig> charges = new ArrayList<>();
        for (CatalogueInstituteMapping mapping
                : catalogueInstituteMappingRepository.findByInstituteIdAndStatusIn(instituteId, LIVE_STATUSES)) {
            charges.addAll(parseCharges(catalogueJson(mapping)));
        }
        return charges;
    }

    private static String catalogueJson(CatalogueInstituteMapping mapping) {
        return mapping != null && mapping.getCourseCatalogue() != null
                ? mapping.getCourseCatalogue().getCatalogueJson()
                : null;
    }

    /** {@code globalSettings.payment.additionalCharges[]}; empty for a missing or unreadable catalogue. */
    private List<ChargeConfig> parseCharges(String catalogueJson) {
        if (!StringUtils.hasText(catalogueJson)) {
            return List.of();
        }
        JsonNode charges;
        try {
            charges = objectMapper.readTree(catalogueJson)
                    .path("globalSettings").path("payment").path("additionalCharges");
        } catch (Exception e) {
            log.warn("Could not read additionalCharges from catalogue JSON: {}", e.getMessage());
            return List.of();
        }
        if (!charges.isArray()) {
            return List.of();
        }
        List<ChargeConfig> configs = new ArrayList<>();
        for (JsonNode charge : charges) {
            if (!charge.isObject()) {
                continue;
            }
            Set<String> applicableTo = new HashSet<>();
            for (JsonNode mode : charge.path("applicableTo")) {
                if (mode.isTextual()) {
                    applicableTo.add(mode.asText());
                }
            }
            List<Tier> tiers = new ArrayList<>();
            for (JsonNode tier : charge.path("tiers")) {
                if (tier.isObject()) {
                    tiers.add(new Tier(intOrNull(tier.get("minQty")), intOrNull(tier.get("maxQty")),
                            textOrNull(tier.get("planId"))));
                }
            }
            // Any non-empty zones array makes this a zone charge, even if no entry is readable
            // (then no PIN is deliverable) — the cart decides the same way from the array alone.
            JsonNode zonesNode = charge.path("zones");
            boolean zoned = zonesNode.isArray() && zonesNode.size() > 0;
            List<ShippingZoneMatcher.Zone> zones = new ArrayList<>();
            for (JsonNode zone : zonesNode) {
                if (zone.isObject()) {
                    JsonNode amount = zone.get("amount");
                    zones.add(new ShippingZoneMatcher.Zone(textOrNull(zone.get("key")),
                            prefixes(zone.get("pinPrefixes")), prefixes(zone.get("excludePinPrefixes")),
                            textOrNull(zone.get("planId")),
                            amount != null && amount.isNumber() ? amount.doubleValue() : null));
                }
            }
            configs.add(new ChargeConfig(
                    textOrNull(charge.get("key")),
                    textOrNull(charge.get("packageSessionId")),
                    applicableTo,
                    StringUtils.hasText(textOrNull(charge.get("packageSessionId")))
                            && StringUtils.hasText(textOrNull(charge.get("enrollInviteId")))
                            && StringUtils.hasText(textOrNull(charge.get("paymentOptionId"))),
                    tiers,
                    textOrNull(charge.get("planId")),
                    charge.hasNonNull("amount") && charge.get("amount").isNumber(),
                    zoned,
                    zones));
        }
        return configs;
    }

    private static String textOrNull(JsonNode node) {
        return node != null && node.isTextual() && StringUtils.hasText(node.asText()) ? node.asText() : null;
    }

    /**
     * A PIN prefix list as the cart reads it: anything but an array is absent (null), and an entry
     * that is not a string stays as null — it never matches, but the list is still not empty.
     */
    private static List<String> prefixes(JsonNode node) {
        if (node == null || !node.isArray()) {
            return null;
        }
        List<String> prefixes = new ArrayList<>();
        for (JsonNode prefix : node) {
            prefixes.add(prefix.isTextual() ? prefix.asText() : null);
        }
        return prefixes;
    }

    private static Integer intOrNull(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isNumber()) {
            return node.intValue();
        }
        if (node.isTextual()) {
            try {
                return Integer.parseInt(node.asText().trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    /** One tier; {@code maxQty} null is unbounded, a tier without {@code minQty} never matches (as in the cart). */
    private record Tier(Integer minQty, Integer maxQty, String planId) {
        boolean holds(int quantity) {
            return minQty != null && quantity >= minQty && (maxQty == null || quantity <= maxQty);
        }
    }

    /** One {@code additionalCharges[]} entry; {@code zoned} = priced by {@code zones}, not tiers/flat. */
    private record ChargeConfig(String key, String packageSessionId, Set<String> applicableTo, boolean linked,
                                List<Tier> tiers, String flatPlanId, boolean flatHasAmount,
                                boolean zoned, List<ShippingZoneMatcher.Zone> zones) {

        /**
         * The plan this charge must carry for {@code quantity} copies delivered to {@code pin}
         * (normalised, null when invalid), or null when it applies to none. A zone charge is one
         * line per order whatever the copies, so only "any copies at all" matters for it.
         */
        String expectedPlanId(int quantity, String pin) {
            if (zoned) {
                return quantity > 0
                        ? zoneFor(pin).filter(ShippingZoneMatcher.Zone::priced)
                                .map(ShippingZoneMatcher.Zone::planId).orElse(null)
                        : null;
            }
            if (!tiers.isEmpty()) {
                for (Tier tier : tiers) {
                    if (tier.holds(quantity)) {
                        return tier.planId();
                    }
                }
                return null;
            }
            return flatPlanId;
        }

        /**
         * Whether the storefront's buy cart adds this charge for {@code quantity} copies. A zone
         * charge is owed for any copies, whatever the PIN: when the PIN cannot be priced the cart
         * blocks checkout, and the order fails on the PIN instead (see pinProblem).
         */
        boolean chargedInBuyCart(int quantity, String pin) {
            if (!linked || !applicableTo.contains(BUY_MODE)) {
                return false;
            }
            if (zoned) {
                return quantity > 0;
            }
            return tiers.isEmpty()
                    ? flatPlanId != null && flatHasAmount
                    : expectedPlanId(quantity, pin) != null;
        }

        Optional<ShippingZoneMatcher.Zone> zoneFor(String pin) {
            return ShippingZoneMatcher.match(zones, pin);
        }

        /**
         * For a zone charge: the 400 message when {@code pin} is missing/invalid, or when the first
         * zone serving it is none or has no plan and amount (the cart calls both "not deliverable"
         * rather than ship for free); else null.
         */
        String pinProblem(String pin) {
            if (!zoned) {
                return null;
            }
            if (pin == null) {
                return PIN_INVALID_MESSAGE;
            }
            return zoneFor(pin).filter(ShippingZoneMatcher.Zone::priced).isPresent() ? null : PIN_NOT_SERVED_MESSAGE;
        }
    }
}
