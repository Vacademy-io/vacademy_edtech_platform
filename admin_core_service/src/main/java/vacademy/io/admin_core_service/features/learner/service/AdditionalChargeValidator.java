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
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.learner.dto.SecurityDepositStatusDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.packages.enums.ChargePackageType;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
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
 * <p><b>Rent picks</b> ({@code requested_book_package_session_ids}, {@link #validateRentPicks}):
 * at most {@link #MAX_RENT_PICKS} distinct books per order, each a live (ACTIVE or HIDDEN) package session of the
 * order's institute. Shared by the v2 order and the public v1 rent request
 * ({@link #validateLegacyRentRequest}), which also refuses a membership whose deposit is due: the
 * v1 request has no line to carry it.
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

    /** Most distinct books one order may pick for a rent (requested_book_package_session_ids). */
    public static final int MAX_RENT_PICKS = 20;
    static final String RENT_PICKS_TOO_MANY_MESSAGE =
            "At most " + MAX_RENT_PICKS + " books can be picked in one order.";
    static final String RENT_PICKS_UNAVAILABLE_MESSAGE =
            "A picked book is not available. Please reload the cart and try again.";

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
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private ObjectMapper objectMapper;

    /** As {@link #validate(String, String, List, Map)}, reading the lines' package types itself. */
    public void validate(String instituteId, String catalogueTag,
                         List<LearnerPackageSessionEnrollmentItemDTO> items) {
        if (items == null || items.isEmpty()) {
            return;
        }
        validate(instituteId, catalogueTag, items, packageTypes(items));
    }

    /**
     * Buy-mode charges (shipping by number of copies).
     *
     * @param items        the order's lines, quantities already normalised (null counts as 1)
     * @param packageTypes {@link #packageTypes} of those lines (read once per order by the caller)
     * @throws InvalidRequestException (400) on a wrong tier plan or a missing charge line
     */
    public void validate(String instituteId, String catalogueTag,
                         List<LearnerPackageSessionEnrollmentItemDTO> items, Map<String, String> packageTypes) {
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

    /** As {@link #validateRentMode(String, String, List, Map, UserDTO)}, reading the lines' package types itself. */
    public void validateRentMode(String instituteId, String catalogueTag,
                                 List<LearnerPackageSessionEnrollmentItemDTO> items, UserDTO buyer) {
        if (items == null || items.isEmpty()) {
            return;
        }
        validateRentMode(instituteId, catalogueTag, items, packageTypes(items), buyer);
    }

    /**
     * Rent-mode charges of a rent order (one with a MEMBERSHIP-package line); a no-op for any
     * other order. The rent charges are the tagged catalogue's when it links any; otherwise (no
     * tag, an unknown one, or a catalogue that links none) every catalogue's of the institute,
     * grouped by charge key — see {@link #requiredRentCharges}.
     *
     * <ul>
     *   <li>A rent charge line must carry the plan its config sets for a rent cart.</li>
     *   <li>A linked {@code oncePerUser} charge must be present when it is due for the buyer
     *       ({@link #DEPOSIT_MISSING_MESSAGE}) and absent when it is not
     *       ({@link #DEPOSIT_NOT_DUE_MESSAGE}).</li>
     *   <li>Any other linked rent charge must be present.</li>
     * </ul>
     *
     * @param packageTypes {@link #packageTypes} of the lines (read once per order by the caller)
     * @param buyer        the order's user as sent (id, or the identifier the enrolment resolves
     *                     by); nobody is created to answer this
     * @throws InvalidRequestException (400) on any of the above
     */
    public void validateRentMode(String instituteId, String catalogueTag,
                                 List<LearnerPackageSessionEnrollmentItemDTO> items,
                                 Map<String, String> packageTypes, UserDTO buyer) {
        if (items == null || items.isEmpty()) {
            return;
        }
        if (!hasMembershipLine(items, packageTypes)) {
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

        List<ChargeConfig> required = requiredRentCharges(instituteId, taggedRent, allRent);
        if (required.isEmpty()) {
            return;
        }
        Set<String> orderedSessions = orderedSessions(items);
        Boolean due = null;
        for (Map.Entry<String, List<ChargeConfig>> charge : byChargeKey(required).entrySet()) {
            List<ChargeConfig> variants = charge.getValue();
            // Any catalogue's variant of this charge satisfies it (two catalogues may each link
            // their own deposit package session).
            boolean present = variants.stream().anyMatch(c -> orderedSessions.contains(c.packageSessionId()));
            if (variants.stream().anyMatch(ChargeConfig::oncePerUser)) {
                if (due == null) {
                    due = securityDepositDueService.isDue(
                            securityDepositDueService.buyer(buyer, instituteId), instituteId);
                }
                if (due && !present) {
                    log.info("Rent order on institute {} (catalogue {}) is missing due charge {}",
                            instituteId, catalogueTag, charge.getKey());
                    throw new InvalidRequestException(DEPOSIT_MISSING_MESSAGE);
                }
                if (!due && present) {
                    log.info("Rent order on institute {} (catalogue {}) carries charge {} the buyer already paid",
                            instituteId, catalogueTag, charge.getKey());
                    throw new InvalidRequestException(DEPOSIT_NOT_DUE_MESSAGE);
                }
            } else if (!present) {
                log.warn("Rent order on institute {} (catalogue {}) is missing charge {}",
                        instituteId, catalogueTag, charge.getKey());
                throw new InvalidRequestException(RENT_CHARGE_MISSING_MESSAGE);
            }
        }
    }

    /**
     * The rent charges an order must settle: the tagged catalogue's when it links any; otherwise
     * every live catalogue's of the institute. So neither dropping the tag nor naming another
     * catalogue of the institute that links none can skip a deposit — a rent-mode charge applies
     * institute-wide once any storefront catalogue links it.
     */
    private List<ChargeConfig> requiredRentCharges(String instituteId, List<ChargeConfig> taggedRent,
                                                   List<ChargeConfig> allRentOrNull) {
        List<ChargeConfig> source = !taggedRent.isEmpty()
                ? taggedRent
                : (allRentOrNull != null ? allRentOrNull : rentOnly(allCatalogueCharges(instituteId)));
        return source.stream().filter(ChargeConfig::chargedInRentCart).toList();
    }

    /** Rent charges grouped by their key (the package session when a config has no key), in order. */
    private static Map<String, List<ChargeConfig>> byChargeKey(List<ChargeConfig> charges) {
        Map<String, List<ChargeConfig>> byKey = new java.util.LinkedHashMap<>();
        for (ChargeConfig config : charges) {
            String key = StringUtils.hasText(config.key()) ? config.key() : config.packageSessionId();
            byKey.computeIfAbsent(key, k -> new ArrayList<>()).add(config);
        }
        return byKey;
    }

    /**
     * What the rent checkout will ask of a signed-in learner: the first linked
     * {@code oncePerUser} rent charge of the catalogue (every catalogue of the institute when the
     * tag is absent or unknown, as {@link #validateRentMode} does) and whether it is due — the
     * same due rule the checkout enforces.
     */
    public SecurityDepositStatusDTO securityDepositStatus(String instituteId, String catalogueTag, String userId) {
        List<ChargeConfig> taggedRent = taggedCatalogue(instituteId, catalogueTag)
                .map(AdditionalChargeValidator::rentOnly)
                .orElse(List.of());
        List<ChargeConfig> rentCharges = requiredRentCharges(instituteId, taggedRent, null);
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

    /**
     * The books an order picked for a rent ({@code requested_book_package_session_ids}): at most
     * {@link #MAX_RENT_PICKS} distinct ids, each a live (ACTIVE or HIDDEN) package session of the order's
     * institute. Blank entries are ignored (they are never held). No query when nothing is picked.
     *
     * @throws InvalidRequestException (400) on too many picks or one that is not such a session
     */
    public void validateRentPicks(String instituteId, Collection<String> requestedBookPackageSessionIds) {
        Set<String> picks = new LinkedHashSet<>();
        if (requestedBookPackageSessionIds != null) {
            requestedBookPackageSessionIds.stream().filter(StringUtils::hasText).forEach(picks::add);
        }
        if (picks.isEmpty()) {
            return;
        }
        if (picks.size() > MAX_RENT_PICKS) {
            log.warn("Rent order on institute {} picks {} books (max {})", instituteId, picks.size(), MAX_RENT_PICKS);
            throw new InvalidRequestException(RENT_PICKS_TOO_MANY_MESSAGE);
        }
        Set<String> available = StringUtils.hasText(instituteId)
                ? new HashSet<>(packageSessionRepository.findActiveIdsOfInstitute(picks, instituteId))
                : Set.of();
        List<String> unavailable = picks.stream().filter(pick -> !available.contains(pick)).toList();
        if (!unavailable.isEmpty()) {
            log.warn("Rent order on institute {} picks books that are not its active sessions: {}",
                    instituteId, unavailable);
            throw new InvalidRequestException(RENT_PICKS_UNAVAILABLE_MESSAGE);
        }
    }

    /**
     * The public v1 enroll request (LearnerEnrollRequestController), checked before it enrolls anyone:
     * <ul>
     *   <li>its rent picks, as {@link #validateRentPicks} (no query when there are none);</li>
     *   <li>a MEMBERSHIP package in it, at an institute whose live catalogues link a
     *       {@code oncePerUser} rent charge (the security deposit) that is due for this person,
     *       is refused with {@link #DEPOSIT_MISSING_MESSAGE}: a v1 request has no line to carry
     *       the deposit, so a stale storefront or a direct call would rent without it. The person
     *       is resolved as on the v2 order (id, else phone / email), nobody is created.</li>
     * </ul>
     * Everything else passes untouched. One package-type read per request with package sessions;
     * the catalogues and the due rule are read only when a membership is in it.
     *
     * @throws InvalidRequestException (400) as above
     */
    public void validateLegacyRentRequest(LearnerEnrollRequestDTO request) {
        LearnerPackageSessionsEnrollDTO enroll = request != null ? request.getLearnerPackageSessionEnroll() : null;
        if (enroll == null) {
            return;
        }
        String instituteId = null;
        if (enroll.getRequestedBookPackageSessionIds() != null
                && enroll.getRequestedBookPackageSessionIds().stream().anyMatch(StringUtils::hasText)) {
            instituteId = legacyRequestInstituteId(request);
            validateRentPicks(instituteId, enroll.getRequestedBookPackageSessionIds());
        }

        Set<String> packageSessionIds = new HashSet<>();
        if (enroll.getPackageSessionIds() != null) {
            enroll.getPackageSessionIds().stream().filter(StringUtils::hasText).forEach(packageSessionIds::add);
        }
        if (packageSessionIds.isEmpty() || !packageTypesOf(packageSessionIds).values().stream()
                .anyMatch(CourseTypeEnum::isMembership)) {
            return;
        }
        if (instituteId == null) {
            instituteId = legacyRequestInstituteId(request);
        }
        boolean depositLinked = rentOnly(allCatalogueCharges(instituteId)).stream()
                .anyMatch(config -> config.oncePerUser() && config.chargedInRentCart());
        if (!depositLinked) {
            return;
        }
        if (securityDepositDueService.isDue(securityDepositDueService.buyer(request.getUser(), instituteId), instituteId)) {
            log.info("v1 enroll of membership {} on institute {} refused: the security deposit is due",
                    packageSessionIds, instituteId);
            throw new InvalidRequestException(DEPOSIT_MISSING_MESSAGE);
        }
    }

    /**
     * The institute a v1 request enrolls into: its invite's (LearnerEnrollRequestService
     * normalises to it whatever the request says), else the request's.
     */
    private String legacyRequestInstituteId(LearnerEnrollRequestDTO request) {
        String inviteId = request.getLearnerPackageSessionEnroll().getEnrollInviteId();
        if (StringUtils.hasText(inviteId)) {
            String inviteInstituteId = enrollInviteRepository.findById(inviteId)
                    .map(EnrollInvite::getInstituteId)
                    .orElse(null);
            if (StringUtils.hasText(inviteInstituteId)) {
                return inviteInstituteId;
            }
        }
        return request.getInstituteId();
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

    /**
     * Package type of each line's package session (MEMBERSHIP, DELIVERY_CHARGE, ...), by package
     * session id; unknown ids are absent. One query: an order reads this once and passes it on.
     */
    public Map<String, String> packageTypes(List<LearnerPackageSessionEnrollmentItemDTO> items) {
        if (items == null || items.isEmpty()) {
            return new HashMap<>();
        }
        return packageTypesOf(orderedSessions(items).stream()
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet()));
    }

    private Map<String, String> packageTypesOf(Set<String> ids) {
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
