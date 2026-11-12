package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.course.enums.CourseTypeEnum;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.enums.CatalogueStatusEnum;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.learner.dto.SecurityDepositStatusDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.packages.enums.ChargePackageType;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
 * {@code applicableTo} modes ("COURSE" = buy, "MEMBERSHIP" = rent), an optional
 * {@code oncePerUser} flag and either {@code tiers[{minQty, maxQty|null, planId, amount}]} or a
 * flat {@code planId, amount}. The storefront resolves them the same way
 * (additional-charges-util.ts): the first tier whose range holds the number of copies in the cart
 * wins; a rent cart resolves its charges as a cart of one.
 *
 * <p><b>Buy orders</b> ({@link #validate}):
 * <ul>
 *   <li>A charge line must carry the plan of that tier. Its config is looked up in the tagged
 *       catalogue first, else in any catalogue of the institute (the browser picks the tag, so
 *       two catalogues with different tiers for one charge item are both accepted). A charge
 *       item no catalogue configures is allowed with a warning: an unknown setup, not an
 *       attack we can recognise.</li>
 *   <li>When the order names its catalogue, every buy-mode charge that catalogue would add to
 *       this cart must be in the order.</li>
 * </ul>
 *
 * <p><b>Rent orders</b> — any order with a MEMBERSHIP-package line ({@link #validateRentMode}):
 * a membership is a plan, not a copy, so it never makes shipping due; the catalogue's rent-mode
 * charges must be there instead. A {@code oncePerUser} charge (the refundable security deposit)
 * must be present exactly when it is due ({@link SecurityDepositDueService}); any other linked
 * rent charge always. Orders without a membership line, and institutes whose catalogues link no
 * rent-mode charge, are judged exactly as before.
 *
 * <p>Catalogues are read through the repository, which returns empty instead of throwing: this
 * runs inside the enrollment transaction, and an exception thrown out of a transactional
 * service would mark the whole enrollment rollback-only even when caught. Every check here runs
 * before the order writes anything, so a 400 leaves nothing behind.
 */
@Slf4j
@Service
public class AdditionalChargeValidator {

    static final String CHARGE_MISMATCH_MESSAGE = "Shipping charge does not match the number of items";
    static final String CHARGE_MISSING_MESSAGE =
            "Shipping charge is missing from this order. Please reload the cart and try again.";

    /** The client matches on the leading token; the text after it is for people. */
    static final String DEPOSIT_MISSING_MESSAGE = "SECURITY_DEPOSIT_MISSING: This order needs the "
            + "refundable security deposit. Please reload the cart and try again.";
    static final String DEPOSIT_NOT_DUE_MESSAGE = "SECURITY_DEPOSIT_NOT_DUE: The security deposit "
            + "is already paid on this account. Please reload the cart and try again.";
    static final String RENT_CHARGE_MISSING_MESSAGE =
            "A charge is missing from this order. Please reload the cart and try again.";
    static final String RENT_CHARGE_MISMATCH_MESSAGE =
            "A charge in this order does not match the catalogue. Please reload the cart and try again.";

    /** {@code applicableTo} value of a buy-mode (storefront cart) charge. */
    private static final String BUY_MODE = "COURSE";

    /** {@code applicableTo} value of a rent-mode (membership) charge. */
    private static final String RENT_MODE = "MEMBERSHIP";

    /** A rent cart prices its charges as one order: the storefront resolves them for a cart of one. */
    private static final int RENT_CART_QUANTITY = 1;

    /** The statuses the storefront's by-tag lookup serves (CourseCatalogueService). */
    private static final List<String> LIVE_STATUSES =
            List.of(CatalogueStatusEnum.ACTIVE.name(), CatalogueStatusEnum.DRAFT.name());

    @Autowired
    private CatalogueInstituteMappingRepository catalogueInstituteMappingRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private SecurityDepositDueService securityDepositDueService;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * Buy-mode charges (shipping by number of copies).
     *
     * @param items the order's lines, quantities already normalised (null counts as 1)
     * @throws InvalidRequestException (400) on a wrong tier plan or a missing charge line
     */
    public void validate(String instituteId, String catalogueTag,
                         List<LearnerPackageSessionEnrollmentItemDTO> items) {
        if (items == null || items.isEmpty()) {
            return;
        }
        List<ChargeConfig> taggedCharges = StringUtils.hasText(catalogueTag)
                ? taggedCatalogueCharges(instituteId, catalogueTag.trim())
                : List.of();
        Set<String> taggedChargeSessions = taggedCharges.stream()
                .map(ChargeConfig::packageSessionId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());
        Map<String, String> packageTypes = packageTypes(items);
        boolean rentOrder = hasMembershipLine(items, packageTypes);

        // Copies in the cart = every line that is neither a charge nor a membership (a plan,
        // not a copy: it must never make shipping due).
        List<LearnerPackageSessionEnrollmentItemDTO> chargeItems = new ArrayList<>();
        int bookQuantity = 0;
        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            String packageSessionId = item.getPackageSessionId();
            String packageType = packageTypes.get(packageSessionId);
            if (taggedChargeSessions.contains(packageSessionId) || ChargePackageType.isCharge(packageType)) {
                chargeItems.add(item);
            } else if (!CourseTypeEnum.isMembership(packageType)) {
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
            if (rentOrder && configs.stream().anyMatch(ChargeConfig::appliesToRent)) {
                continue; // a rent-mode charge of a rent order: validateRentMode checks it
            }
            int copies = bookQuantity;
            boolean matches = configs.stream()
                    .map(config -> config.expectedPlanId(copies))
                    .anyMatch(planId -> planId != null && planId.equals(chargeItem.getPlanId()));
            if (!matches) {
                log.warn("Charge plan mismatch on institute {}: item {} sent plan {}, {} copies expect {}",
                        instituteId, chargeItem.getPackageSessionId(), chargeItem.getPlanId(), copies,
                        configs.stream().map(config -> config.expectedPlanId(copies)).toList());
                throw new InvalidRequestException(CHARGE_MISMATCH_MESSAGE);
            }
        }

        if (bookQuantity > 0 && !taggedCharges.isEmpty()) {
            Set<String> orderedSessions = orderedSessions(items);
            for (ChargeConfig config : taggedCharges) {
                if (config.chargedInBuyCart(bookQuantity) && !orderedSessions.contains(config.packageSessionId())) {
                    log.warn("Order on catalogue {} of institute {} with {} copies is missing charge {} ({})",
                            catalogueTag, instituteId, bookQuantity, config.key(), config.packageSessionId());
                    throw new InvalidRequestException(CHARGE_MISSING_MESSAGE);
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
                    .filter(config -> config.chargedInBuyCart(copies))
                    .findFirst();
            if (owed.isPresent()) {
                log.warn("Tag-less order on institute {} with {} copies is missing charge {} ({})",
                        instituteId, bookQuantity, owed.get().key(), owed.get().packageSessionId());
                throw new InvalidRequestException(CHARGE_MISSING_MESSAGE);
            }
        }
    }

    /**
     * Rent-mode charges of a rent order (one with a MEMBERSHIP-package line); a no-op for any
     * other order. The rent charges are the tagged catalogue's; with no tag (or an unknown one),
     * every catalogue's of the institute, so dropping the tag cannot skip the deposit.
     *
     * <ul>
     *   <li>A rent charge line must carry the plan its config sets for a rent cart.</li>
     *   <li>A linked {@code oncePerUser} charge must be present when it is due for the buyer
     *       ({@link #DEPOSIT_MISSING_MESSAGE}) and absent when it is not
     *       ({@link #DEPOSIT_NOT_DUE_MESSAGE}).</li>
     *   <li>Any other linked rent charge must be present.</li>
     * </ul>
     *
     * @param buyer the order's user as sent (id, or the identifier the enrolment resolves by);
     *              nobody is created to answer this
     * @throws InvalidRequestException (400) on any of the above
     */
    public void validateRentMode(String instituteId, String catalogueTag,
                                 List<LearnerPackageSessionEnrollmentItemDTO> items, UserDTO buyer) {
        if (items == null || items.isEmpty()) {
            return;
        }
        if (!hasMembershipLine(items, packageTypes(items))) {
            return;
        }
        Optional<List<ChargeConfig>> tagged = taggedCatalogue(instituteId, catalogueTag);
        List<ChargeConfig> allRent = null;
        List<ChargeConfig> taggedRent = tagged.map(AdditionalChargeValidator::rentOnly).orElse(List.of());

        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            List<ChargeConfig> configs = forPackageSession(taggedRent, item.getPackageSessionId());
            if (configs.isEmpty()) {
                if (allRent == null) {
                    allRent = rentOnly(allCatalogueCharges(instituteId));
                }
                configs = forPackageSession(allRent, item.getPackageSessionId());
            }
            if (configs.isEmpty()) {
                continue; // not a rent charge: the membership itself, or a buy-mode line
            }
            boolean matches = configs.stream()
                    .map(config -> config.expectedPlanId(RENT_CART_QUANTITY))
                    .anyMatch(planId -> planId != null && planId.equals(item.getPlanId()));
            if (!matches) {
                log.warn("Rent charge plan mismatch on institute {}: item {} sent plan {}, expected {}",
                        instituteId, item.getPackageSessionId(), item.getPlanId(),
                        configs.stream().map(config -> config.expectedPlanId(RENT_CART_QUANTITY)).toList());
                throw new InvalidRequestException(RENT_CHARGE_MISMATCH_MESSAGE);
            }
        }

        List<ChargeConfig> required = tagged.isPresent()
                ? taggedRent
                : (allRent != null ? allRent : rentOnly(allCatalogueCharges(instituteId)));
        if (required.isEmpty()) {
            return;
        }
        Set<String> orderedSessions = orderedSessions(items);
        Boolean due = null;
        for (ChargeConfig config : required) {
            if (!config.chargedInRentCart()) {
                continue;
            }
            boolean present = orderedSessions.contains(config.packageSessionId());
            if (config.oncePerUser()) {
                if (due == null) {
                    due = securityDepositDueService.isDue(
                            securityDepositDueService.buyer(buyer, instituteId), instituteId);
                }
                if (due && !present) {
                    log.info("Rent order on institute {} (catalogue {}) is missing due charge {} ({})",
                            instituteId, catalogueTag, config.key(), config.packageSessionId());
                    throw new InvalidRequestException(DEPOSIT_MISSING_MESSAGE);
                }
                if (!due && present) {
                    log.info("Rent order on institute {} (catalogue {}) carries charge {} the buyer already paid",
                            instituteId, catalogueTag, config.key());
                    throw new InvalidRequestException(DEPOSIT_NOT_DUE_MESSAGE);
                }
            } else if (!present) {
                log.warn("Rent order on institute {} (catalogue {}) is missing charge {} ({})",
                        instituteId, catalogueTag, config.key(), config.packageSessionId());
                throw new InvalidRequestException(RENT_CHARGE_MISSING_MESSAGE);
            }
        }
    }

    /**
     * What the rent checkout will ask of a signed-in learner: the first linked
     * {@code oncePerUser} rent charge of the catalogue (every catalogue of the institute when the
     * tag is absent or unknown, as {@link #validateRentMode} does) and whether it is due — the
     * same due rule the checkout enforces.
     */
    public SecurityDepositStatusDTO securityDepositStatus(String instituteId, String catalogueTag, String userId) {
        List<ChargeConfig> rentCharges = taggedCatalogue(instituteId, catalogueTag)
                .map(AdditionalChargeValidator::rentOnly)
                .orElseGet(() -> rentOnly(allCatalogueCharges(instituteId)));
        Optional<ChargeConfig> onceCharge = rentCharges.stream()
                .filter(ChargeConfig::oncePerUser)
                .filter(ChargeConfig::chargedInRentCart)
                .findFirst();
        if (onceCharge.isEmpty()) {
            return SecurityDepositStatusDTO.notConfigured();
        }
        boolean due = securityDepositDueService.isDue(
                securityDepositDueService.signedInUser(userId, instituteId), instituteId);
        Double amount = onceCharge.get().expectedAmount(RENT_CART_QUANTITY);
        return new SecurityDepositStatusDTO(due, onceCharge.get().key(), amount != null ? amount : 0.0);
    }

    private static int quantityOf(LearnerPackageSessionEnrollmentItemDTO item) {
        Integer quantity = item.getRequestedQuantity();
        return quantity != null && quantity > 0 ? quantity : 1;
    }

    private static Set<String> orderedSessions(List<LearnerPackageSessionEnrollmentItemDTO> items) {
        return items.stream()
                .map(LearnerPackageSessionEnrollmentItemDTO::getPackageSessionId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
    }

    private static boolean hasMembershipLine(List<LearnerPackageSessionEnrollmentItemDTO> items,
                                             Map<String, String> packageTypes) {
        return items.stream().anyMatch(item -> CourseTypeEnum.isMembership(packageTypes.get(item.getPackageSessionId())));
    }

    /** Package type of each line's package session, by package session id; unknown ids are absent. */
    private Map<String, String> packageTypes(List<LearnerPackageSessionEnrollmentItemDTO> items) {
        Set<String> ids = orderedSessions(items).stream()
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());
        Map<String, String> types = new HashMap<>();
        if (ids.isEmpty()) {
            return types;
        }
        for (PackageSessionRepository.StockInfoProjection info : packageSessionRepository.findStockInfoByIds(ids)) {
            if (info.getPackageSessionId() != null && info.getPackageType() != null) {
                types.put(info.getPackageSessionId(), info.getPackageType());
            }
        }
        return types;
    }

    private static List<ChargeConfig> rentOnly(List<ChargeConfig> configs) {
        return configs.stream().filter(ChargeConfig::appliesToRent).toList();
    }

    private static List<ChargeConfig> forPackageSession(List<ChargeConfig> configs, String packageSessionId) {
        if (!StringUtils.hasText(packageSessionId)) {
            return List.of();
        }
        return configs.stream().filter(config -> packageSessionId.equals(config.packageSessionId())).toList();
    }

    private List<ChargeConfig> taggedCatalogueCharges(String instituteId, String catalogueTag) {
        return taggedCatalogue(instituteId, catalogueTag).orElse(List.of());
    }

    /** The tagged catalogue's charges; empty when there is no tag or the institute has no such catalogue. */
    private Optional<List<ChargeConfig>> taggedCatalogue(String instituteId, String catalogueTag) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(catalogueTag)) {
            return Optional.empty();
        }
        Optional<List<ChargeConfig>> charges = catalogueInstituteMappingRepository
                .findByInstituteIdAndTagName(instituteId, catalogueTag.trim(), LIVE_STATUSES)
                .map(mapping -> parseCharges(catalogueJson(mapping)));
        if (charges.isEmpty()) {
            log.warn("Order names catalogue tag {} that institute {} does not have", catalogueTag, instituteId);
        }
        return charges;
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
                            textOrNull(tier.get("planId")), numberOrNull(tier.get("amount"))));
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
                    numberOrNull(charge.get("amount")),
                    charge.path("oncePerUser").asBoolean(false)));
        }
        return configs;
    }

    private static String textOrNull(JsonNode node) {
        return node != null && node.isTextual() && StringUtils.hasText(node.asText()) ? node.asText() : null;
    }

    /** A JSON number, as the storefront requires ({@code typeof amount === "number"}); else null. */
    private static Double numberOrNull(JsonNode node) {
        return node != null && node.isNumber() ? node.doubleValue() : null;
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
    private record Tier(Integer minQty, Integer maxQty, String planId, Double amount) {
        boolean holds(int quantity) {
            return minQty != null && quantity >= minQty && (maxQty == null || quantity <= maxQty);
        }
    }

    /** One {@code additionalCharges[]} entry. */
    private record ChargeConfig(String key, String packageSessionId, Set<String> applicableTo, boolean linked,
                                List<Tier> tiers, String flatPlanId, Double flatAmount, boolean oncePerUser) {

        /** The tier for {@code quantity}, or null when the charge is flat or no tier holds it. */
        private Tier tierFor(int quantity) {
            for (Tier tier : tiers) {
                if (tier.holds(quantity)) {
                    return tier;
                }
            }
            return null;
        }

        /** The plan this charge must carry for {@code quantity} copies, or null when it applies to none. */
        String expectedPlanId(int quantity) {
            if (!tiers.isEmpty()) {
                Tier tier = tierFor(quantity);
                return tier != null ? tier.planId() : null;
            }
            return flatPlanId;
        }

        /** The price the cart shows for {@code quantity} copies, or null when it applies to none. */
        Double expectedAmount(int quantity) {
            if (!tiers.isEmpty()) {
                Tier tier = tierFor(quantity);
                return tier != null ? tier.amount() : null;
            }
            return flatAmount;
        }

        boolean appliesToRent() {
            return applicableTo.contains(RENT_MODE);
        }

        /** Whether the storefront's buy cart adds this charge for {@code quantity} copies. */
        boolean chargedInBuyCart(int quantity) {
            if (!linked || !applicableTo.contains(BUY_MODE)) {
                return false;
            }
            return tiers.isEmpty()
                    ? flatPlanId != null && flatAmount != null
                    : expectedPlanId(quantity) != null;
        }

        /** Whether the storefront's rent cart adds this charge (resolved as a cart of one). */
        boolean chargedInRentCart() {
            if (!linked || !appliesToRent()) {
                return false;
            }
            return tiers.isEmpty()
                    ? flatPlanId != null && flatAmount != null
                    : expectedPlanId(RENT_CART_QUANTITY) != null;
        }
    }
}
