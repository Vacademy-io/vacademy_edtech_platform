package vacademy.io.admin_core_service.features.product_page.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.domain_routing.service.LearnerPortalUrlResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.product_page.dto.*;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageReadRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.shortlink.service.ShortUrlManagementService;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.CouponCode;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.CouponCodeRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponValidationService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import org.springframework.util.StringUtils;

import java.security.SecureRandom;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class ProductPageService {

    private static final String SOURCE_TYPE = "PRODUCT_PAGE";
    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String STATUS_DRAFT = "DRAFT";
    private static final String STATUS_DELETED = "DELETED";

    @Autowired
    private ProductPageRepository coursePageRepository;

    @Autowired
    private ProductPageInviteMappingRepository mappingRepository;

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository psInvitePoRepository;

    @Autowired
    private InstituteCustomFiledService customFieldService;

    @Autowired
    private ShortUrlManagementService shortUrlManagementService;

    @Autowired
    private CouponCodeRepository couponCodeRepository;

    @Autowired
    private AppliedCouponDiscountRepository appliedCouponDiscountRepository;

    @Autowired
    private InstituteSettingService instituteSettingService;

    // Lost its @Autowired in a 2026-05-29 merge, which left it null: every coupon
    // check (/open/v1/product-page/validate-coupon and any enroll carrying a
    // coupon) threw a NullPointerException.
    @Autowired
    private CouponValidationService couponValidationService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private LearnerPortalUrlResolver learnerPortalUrlResolver;

    @Autowired
    private ProductPageReadRepository readRepository;

    @Autowired
    private ProductPageCustomFieldLoader customFieldLoader;

    // -------------------------------------------------------------------------
    // Admin CRUD
    // -------------------------------------------------------------------------

    @Transactional
    public ProductPageResponse createProductPage(String instituteId, ProductPageRequest request) {
        ProductPage page = new ProductPage();
        page.setName(request.getName());
        page.setCode(generateUniqueCode());
        page.setInstituteId(instituteId);
        page.setStatus(STATUS_DRAFT);
        page.setPageJson(request.getPageJson());
        page.setSettingsJson(request.getSettingsJson());
        page = coursePageRepository.save(page);

        saveMappings(page, request.getMappings());

        String shortUrl = shortUrlManagementService.createShortUrl(
                buildLearnerUrl(page.getCode(), instituteId), SOURCE_TYPE, page.getId(), instituteId);
        page.setShortUrl(shortUrl);
        page = coursePageRepository.save(page);

        log.info("Created course page id={} code={} for institute={}", page.getId(), page.getCode(), instituteId);
        return buildAdminResponse(page);
    }

    @Transactional
    public ProductPageResponse updateProductPage(String coursePageId, ProductPageRequest request) {
        // Locked: a catalogue sync running at the same time would otherwise add
        // courses next to the ones this save re-inserts (see lockById).
        ProductPage page = coursePageRepository.lockById(coursePageId)
                .orElseThrow(() -> new VacademyException("Course page not found: " + coursePageId));

        page.setName(request.getName());
        if (request.getPageJson() != null)
            page.setPageJson(request.getPageJson());
        if (request.getSettingsJson() != null)
            page.setSettingsJson(request.getSettingsJson());
        if (request.getStatus() != null)
            page.setStatus(request.getStatus());

        if (request.getMappings() != null) {
            mappingRepository.updateStatusByProductPageId(coursePageId, STATUS_DELETED);
            saveMappings(page, request.getMappings());
        }

        page = coursePageRepository.save(page);
        return buildAdminResponse(page);
    }

    @Transactional
    public String deleteProductPage(String coursePageId) {
        ProductPage page = coursePageRepository.findById(coursePageId)
                .orElseThrow(() -> new VacademyException("Course page not found: " + coursePageId));
        page.setStatus(STATUS_DELETED);
        coursePageRepository.save(page);
        return "Deleted";
    }

    public List<ProductPageResponse> getAllProductPages(String instituteId) {
        List<ProductPage> pages = coursePageRepository.findByInstituteIdAndStatusIn(
                instituteId, List.of(STATUS_ACTIVE, STATUS_DRAFT));
        return pages.stream().map(this::buildAdminResponse).collect(Collectors.toList());
    }

    /**
     * One page of the admin list, lightweight: no page JSON and no mappings,
     * only their count. search matches name or code (case-insensitive);
     * status is ACTIVE, DRAFT or blank for both; sort is LATEST (default),
     * OLDEST, NAME_ASC or NAME_DESC.
     */
    public ProductPageListResponse listProductPages(String instituteId, String search, String status,
                                                    String sort, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), 100);
        List<String> allStatuses = List.of(STATUS_ACTIVE, STATUS_DRAFT);
        List<String> statuses = StringUtils.hasText(status) && allStatuses.contains(status.trim().toUpperCase())
                ? List.of(status.trim().toUpperCase())
                : allStatuses;
        String pattern = likePattern(search);

        Page<ProductPage> result = coursePageRepository.searchForAdmin(
                instituteId, statuses, pattern, PageRequest.of(safePage, safeSize, listSort(sort)));

        List<String> ids = result.getContent().stream().map(ProductPage::getId).collect(Collectors.toList());
        Map<String, Long> mappingCounts = new HashMap<>();
        if (!ids.isEmpty()) {
            for (Object[] row : mappingRepository.countByProductPageIds(ids, List.of(STATUS_ACTIVE))) {
                mappingCounts.put((String) row[0], ((Number) row[1]).longValue());
            }
        }

        Map<String, Long> statusCounts = new HashMap<>();
        for (Object[] row : coursePageRepository.countByStatusForAdmin(instituteId, allStatuses, pattern)) {
            statusCounts.put((String) row[0], ((Number) row[1]).longValue());
        }

        ProductPageListResponse resp = new ProductPageListResponse();
        resp.setContent(result.getContent().stream()
                .map(p -> new ProductPageSummaryResponse(p.getId(), p.getName(), p.getCode(), p.getStatus(),
                        p.getShortUrl(), mappingCounts.getOrDefault(p.getId(), 0L),
                        p.getCreatedAt(), p.getUpdatedAt()))
                .collect(Collectors.toList()));
        resp.setPage(safePage);
        resp.setSize(safeSize);
        resp.setTotalElements(result.getTotalElements());
        resp.setTotalPages(result.getTotalPages());
        resp.setActiveCount(statusCounts.getOrDefault(STATUS_ACTIVE, 0L));
        resp.setDraftCount(statusCounts.getOrDefault(STATUS_DRAFT, 0L));
        return resp;
    }

    /** Lower-cased contains-pattern for the list search, with % _ and ! escaped by !. */
    static String likePattern(String search) {
        if (!StringUtils.hasText(search)) {
            return "%";
        }
        String escaped = search.trim().toLowerCase(Locale.ROOT)
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }

    /** id breaks ties, so a page never shows up on two list pages. */
    static Sort listSort(String sort) {
        String key = sort == null ? "" : sort.trim().toUpperCase(Locale.ROOT);
        switch (key) {
            case "OLDEST":
                return Sort.by(Sort.Order.asc("createdAt"), Sort.Order.asc("id"));
            case "NAME_ASC":
                return Sort.by(Sort.Order.asc("name").ignoreCase(), Sort.Order.asc("id"));
            case "NAME_DESC":
                return Sort.by(Sort.Order.desc("name").ignoreCase(), Sort.Order.asc("id"));
            default:
                return Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"));
        }
    }

    public ProductPageResponse getProductPageById(String coursePageId) {
        ProductPage page = coursePageRepository.findById(coursePageId)
                .orElseThrow(() -> new VacademyException("Course page not found: " + coursePageId));
        return buildAdminResponseWithCustomFields(page);
    }

    // -------------------------------------------------------------------------
    // Custom field management (product-page scoped)
    // -------------------------------------------------------------------------

    @Transactional
    public ProductPageResponse addCustomFieldToPage(String productPageId, String customFieldId, String instituteId) {
        ProductPage page = loadPageForInstitute(productPageId, instituteId);

        List<ProductPageInviteMapping> activeMappings = activeMappings(productPageId);
        if (activeMappings.isEmpty()) {
            throw new VacademyException("No active course mappings on this page — add courses and save first");
        }

        for (ProductPageInviteMapping mapping : activeMappings) {
            String enrollInviteId = mapping.getPsInvitePaymentOption().getEnrollInvite().getId();

            CustomFieldDTO cfDto = new CustomFieldDTO();
            cfDto.setId(customFieldId);

            InstituteCustomFieldDTO dto = new InstituteCustomFieldDTO();
            dto.setInstituteId(instituteId);
            dto.setType(CustomFieldTypeEnum.ENROLL_INVITE.name());
            dto.setTypeId(enrollInviteId);
            dto.setCustomField(cfDto);

            customFieldService.addOrUpdateCustomField(List.of(dto));
        }

        return buildAdminResponseWithCustomFields(page, activeMappings);
    }

    /**
     * Edits a field already on this page's form — its label, input type,
     * whether it is required, and its config (which now carries the
     * verification block that gates submission behind a WhatsApp OTP).
     *
     * All four live on the shared `custom_fields` row, NOT on the mapping, so
     * the edit reaches every form in the institute using this field. That is
     * the existing model — required-ness and input type have always been read
     * from the master row — and the admin dialog says so rather than pretending
     * the change is page-local.
     *
     * The page is still the authorisation scope: a field that is not on it is
     * rejected, so this endpoint cannot be used to edit arbitrary fields of
     * another institute.
     */
    @Transactional
    public ProductPageResponse updateCustomFieldOnPage(
            String productPageId, String customFieldId,
            ProductPageCustomFieldUpdateRequest request, String instituteId) {
        ProductPage page = loadPageForInstitute(productPageId, instituteId);

        List<ProductPageInviteMapping> activeMappings = activeMappings(productPageId);

        boolean onThisPage = activeMappings.stream().anyMatch(mapping -> customFieldService
                .getByInstituteIdAndFieldIdAndTypeAndTypeId(
                        instituteId, customFieldId,
                        CustomFieldTypeEnum.ENROLL_INVITE.name(),
                        mapping.getPsInvitePaymentOption().getEnrollInvite().getId())
                .isPresent());

        if (!onThisPage) {
            throw new VacademyException("That field is not on this product page");
        }

        CustomFieldDTO update = new CustomFieldDTO();
        update.setFieldName(request.getFieldName());
        update.setFieldType(request.getFieldType());
        update.setIsMandatory(request.getIsMandatory());
        update.setConfig(request.getConfig());
        customFieldService.updateCustomField(update, customFieldId);

        return buildAdminResponseWithCustomFields(page, activeMappings);
    }

    /**
     * Sets the order the page's form asks for its fields in.
     *
     * The order lives on the mapping (`individual_order`), and there is one
     * mapping per enroll invite — so a page selling 28 courses stores the same
     * position 28 times. Nothing set it before, which left every field on 999
     * and the form's order down to whatever order the rows came back in: a
     * checkout collecting both "Full Name" and "School Name" could ask for them
     * either way round on consecutive loads.
     *
     * Ids not on the page are ignored rather than rejected: an admin reordering
     * a stale tab should not lose the whole save over one field somebody else
     * removed in the meantime.
     */
    @Transactional
    public ProductPageResponse reorderCustomFieldsOnPage(
            String productPageId, List<String> orderedCustomFieldIds, String instituteId) {
        ProductPage page = loadPageForInstitute(productPageId, instituteId);

        List<ProductPageInviteMapping> activeMappings = activeMappings(productPageId);

        if (orderedCustomFieldIds != null) {
            for (ProductPageInviteMapping mapping : activeMappings) {
                String enrollInviteId = mapping.getPsInvitePaymentOption().getEnrollInvite().getId();

                for (int position = 0; position < orderedCustomFieldIds.size(); position++) {
                    String customFieldId = orderedCustomFieldIds.get(position);
                    if (customFieldId == null || customFieldId.isBlank()) {
                        continue;
                    }
                    // Only touch fields this invite already carries — addOrUpdate
                    // would otherwise ATTACH a field that was never on the page.
                    if (customFieldService.getByInstituteIdAndFieldIdAndTypeAndTypeId(
                            instituteId, customFieldId,
                            CustomFieldTypeEnum.ENROLL_INVITE.name(), enrollInviteId).isEmpty()) {
                        continue;
                    }

                    CustomFieldDTO cfDto = new CustomFieldDTO();
                    cfDto.setId(customFieldId);

                    InstituteCustomFieldDTO dto = new InstituteCustomFieldDTO();
                    dto.setInstituteId(instituteId);
                    dto.setType(CustomFieldTypeEnum.ENROLL_INVITE.name());
                    dto.setTypeId(enrollInviteId);
                    dto.setCustomField(cfDto);
                    dto.setIndividualOrder(position);

                    customFieldService.addOrUpdateCustomField(List.of(dto));
                }
            }
        }

        return buildAdminResponseWithCustomFields(page, activeMappings);
    }

    @Transactional
    public ProductPageResponse createAndLinkCustomFieldToPage(
            String productPageId, ProductPageCustomFieldCreateRequest request, String instituteId) {

        if (request.getFieldName() == null || request.getFieldName().isBlank()) {
            throw new VacademyException("fieldName is required");
        }
        if (request.getFieldType() == null || request.getFieldType().isBlank()) {
            throw new VacademyException("fieldType is required");
        }

        ProductPage page = loadPageForInstitute(productPageId, instituteId);

        List<ProductPageInviteMapping> activeMappings = activeMappings(productPageId);
        if (activeMappings.isEmpty()) {
            throw new VacademyException("No active course mappings on this page — add courses and save first");
        }

        for (ProductPageInviteMapping mapping : activeMappings) {
            String enrollInviteId = mapping.getPsInvitePaymentOption().getEnrollInvite().getId();

            CustomFieldDTO cfDto = new CustomFieldDTO();
            cfDto.setFieldName(request.getFieldName());
            cfDto.setFieldType(request.getFieldType());
            cfDto.setIsMandatory(request.getIsMandatory());
            cfDto.setConfig(request.getConfig());

            InstituteCustomFieldDTO dto = new InstituteCustomFieldDTO();
            dto.setInstituteId(instituteId);
            dto.setType(CustomFieldTypeEnum.ENROLL_INVITE.name());
            dto.setTypeId(enrollInviteId);
            dto.setIsMandatory(request.getIsMandatory());
            dto.setCustomField(cfDto);

            customFieldService.addOrUpdateCustomField(List.of(dto));
        }

        return buildAdminResponseWithCustomFields(page, activeMappings);
    }

    @Transactional
    public ProductPageResponse removeCustomFieldFromPage(String productPageId, String customFieldId,
            String instituteId) {
        ProductPage page = loadPageForInstitute(productPageId, instituteId);

        List<ProductPageInviteMapping> activeMappings = activeMappings(productPageId);

        List<String> mappingIdsToDelete = new ArrayList<>();
        for (ProductPageInviteMapping mapping : activeMappings) {
            String enrollInviteId = mapping.getPsInvitePaymentOption().getEnrollInvite().getId();
            customFieldService.getByInstituteIdAndFieldIdAndTypeAndTypeId(
                    instituteId, customFieldId, CustomFieldTypeEnum.ENROLL_INVITE.name(), enrollInviteId)
                    .ifPresent(icf -> mappingIdsToDelete.add(icf.getId()));
        }

        if (!mappingIdsToDelete.isEmpty()) {
            customFieldService.softDeleteMappingsByIds(mappingIdsToDelete);
        }

        return buildAdminResponseWithCustomFields(page, activeMappings);
    }

    /**
     * Loads a product page and validates it belongs to the given institute
     * (cross-tenant guard).
     */
    private ProductPage loadPageForInstitute(String productPageId, String instituteId) {
        ProductPage page = coursePageRepository.findById(productPageId)
                .orElseThrow(() -> new VacademyException("Product page not found: " + productPageId));
        if (!page.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Product page does not belong to this institute");
        }
        return page;
    }

    // -------------------------------------------------------------------------
    // Public (learner-facing)
    // -------------------------------------------------------------------------

    public ProductPageResponse getProductPageByCode(String code, String instituteId) {
        ProductPage page = coursePageRepository.findByCode(code)
                .orElseThrow(() -> new VacademyException("Course page not found for code: " + code));

        if (!page.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Course page does not belong to this institute");
        }
        if (STATUS_DELETED.equals(page.getStatus())) {
            throw new VacademyException("Course page is not available");
        }

        return buildAdminResponseWithCustomFields(page);
    }

    // -------------------------------------------------------------------------
    // Coupon management
    // -------------------------------------------------------------------------

    @Transactional
    public String createCoupon(String coursePageId, ProductPageCouponRequest request) {
        ProductPage page = coursePageRepository.findById(coursePageId)
                .orElseThrow(() -> new VacademyException("Course page not found: " + coursePageId));

        CouponCode couponCode = new CouponCode();
        couponCode.setCode(request.getCode().toUpperCase().trim());
        couponCode.setStatus(STATUS_ACTIVE);
        couponCode.setSourceType(SOURCE_TYPE);
        couponCode.setSourceId(coursePageId);
        // V309: product-page coupons are now institute-scoped too so they appear
        // in the admin coupon list and the per-institute uniqueness constraint applies.
        couponCode.setInstituteId(page.getInstituteId());
        couponCode.setTag(page.getName());
        couponCode.setRedeemStartDate(request.getRedeemStartDate() != null
                ? java.sql.Date.valueOf(request.getRedeemStartDate().toLocalDate())
                : null);
        couponCode.setRedeemEndDate(request.getRedeemEndDate() != null
                ? java.sql.Date.valueOf(request.getRedeemEndDate().toLocalDate())
                : null);
        if (request.getMaxUses() != null)
            couponCode.setUsageLimit(request.getMaxUses().longValue());
        // Quantity condition — "₹99 off when you take 2 or more". Only stored when
        // it is a real condition; 1 or less is no condition at all.
        if (request.getMinItems() != null && request.getMinItems() > 1)
            couponCode.setMinItems(request.getMinItems());
        couponCode = couponCodeRepository.save(couponCode);

        AppliedCouponDiscount discount = new AppliedCouponDiscount();
        discount.setName(request.getCode());
        discount.setDiscountType(request.getDiscountType());
        discount.setDiscountPoint(request.getDiscountValue());
        discount.setMaxDiscountPoint(request.getMaxDiscountValue());
        discount.setDiscountSource(SOURCE_TYPE);
        discount.setStatus(STATUS_ACTIVE);
        discount.setCouponCode(couponCode);
        if (request.getRedeemStartDate() != null)
            discount.setRedeemStartDate(java.sql.Date.valueOf(request.getRedeemStartDate().toLocalDate()));
        if (request.getRedeemEndDate() != null)
            discount.setRedeemEndDate(java.sql.Date.valueOf(request.getRedeemEndDate().toLocalDate()));
        appliedCouponDiscountRepository.save(discount);

        log.info("Created coupon {} for course page {}", request.getCode(), coursePageId);
        return "Coupon created";
    }

    @Transactional
    public String deleteCoupon(String couponCodeId) {
        CouponCode coupon = couponCodeRepository.findById(couponCodeId)
                .orElseThrow(() -> new VacademyException("Coupon not found: " + couponCodeId));
        coupon.setStatus(STATUS_DELETED);
        couponCodeRepository.save(coupon);
        return "Coupon deleted";
    }

    public ProductPageCouponValidateResponse validateCoupon(String coursePageCode, String couponCode,
            double totalAmount) {
        return validateCoupon(coursePageCode, couponCode, totalAmount, null);
    }

    /**
     * @param itemCount how many courses are in the basket, for coupons carrying a
     *                  minimum. Null reads as one item.
     */
    public ProductPageCouponValidateResponse validateCoupon(String coursePageCode, String couponCode,
            double totalAmount, Integer itemCount) {
        ProductPage page = coursePageRepository.findByCode(coursePageCode)
                .orElseThrow(() -> new VacademyException("Course page not found"));

        // Delegate to the generic validator. PRODUCT_PAGE-scoped legacy coupons
        // are matched via product_page_code; the validator does the discount
        // computation using the shared CouponDiscountUtil for identical math.
        CouponValidateRequestDTO req = CouponValidateRequestDTO.builder()
                .couponCode(couponCode)
                .instituteId(page.getInstituteId())
                .productPageCode(coursePageCode)
                .totalAmount(totalAmount)
                .itemCount(itemCount)
                .build();
        CouponValidateResponseDTO resp = couponValidationService.validate(req);

        return ProductPageCouponValidateResponse.builder()
                .couponCodeId(resp.getCouponCodeId())
                .appliedCouponDiscountId(resp.getAppliedCouponDiscountId())
                .discountType(resp.getDiscountType())
                .discountValue(resp.getDiscountValue())
                .maxDiscountValue(resp.getMaxDiscountValue())
                .valid(resp.isValid())
                .message(resp.getMessage())
                .build();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    private void saveMappings(ProductPage page, List<ProductPageInviteMappingRequest> requests) {
        if (requests == null || requests.isEmpty())
            return;

        for (ProductPageInviteMappingRequest req : requests) {
            PackageSessionLearnerInvitationToPaymentOption bridge = psInvitePoRepository
                    .findById(req.getPsInvitePaymentOptionId())
                    .orElseThrow(() -> new VacademyException(
                            "PackageSession-Invite-PaymentOption mapping not found: "
                                    + req.getPsInvitePaymentOptionId()));

            ProductPageInviteMapping mapping = new ProductPageInviteMapping();
            mapping.setProductPage(page);
            mapping.setPsInvitePaymentOption(bridge);
            mapping.setPaymentPlanId(req.getPaymentPlanId());
            mapping.setPreselected(req.isPreselected());
            mapping.setDisplayOrder(req.getDisplayOrder());
            mapping.setStatus(STATUS_ACTIVE);
            mappingRepository.save(mapping);
        }
    }

    /**
     * The page's ACTIVE mappings in display order (display_order, created_at,
     * id), each with its bridge row, invite, package session and payment
     * option already loaded. Every read of a page's courses goes through here,
     * so the learner page, the editor and checkout all see one order.
     */
    public List<ProductPageInviteMapping> activeMappings(String productPageId) {
        return mappingRepository.findOrderedWithBridge(productPageId, List.of(STATUS_ACTIVE));
    }

    /** The mappings' locked plans by id, in one query. Missing plans are simply absent. */
    public Map<String, PaymentPlan> loadPlans(Collection<ProductPageInviteMapping> mappings) {
        Set<String> ids = new LinkedHashSet<>();
        for (ProductPageInviteMapping m : mappings) {
            if (m.getPaymentPlanId() != null) ids.add(m.getPaymentPlanId());
        }
        return loadPlansById(ids);
    }

    public Map<String, PaymentPlan> loadPlansById(Collection<String> planIds) {
        Map<String, PaymentPlan> out = new HashMap<>();
        List<String> ids = new ArrayList<>(new LinkedHashSet<>(planIds));
        ids.removeIf(Objects::isNull);
        for (int from = 0; from < ids.size(); from += ProductPageCustomFieldLoader.CHUNK) {
            List<String> chunk = ids.subList(from, Math.min(ids.size(), from + ProductPageCustomFieldLoader.CHUNK));
            for (PaymentPlan plan : readRepository.findPlansWithOptionByIdIn(chunk)) {
                out.put(plan.getId(), plan);
            }
        }
        return out;
    }

    ProductPageResponse buildAdminResponse(ProductPage page) {
        return buildAdminResponse(page, activeMappings(page.getId()));
    }

    ProductPageResponse buildAdminResponse(ProductPage page, List<ProductPageInviteMapping> activeMappings) {
        ProductPageResponse resp = new ProductPageResponse();
        fillAdminResponse(resp, page, activeMappings);
        return resp;
    }

    /**
     * Page fields and its mappings, into a response object the caller
     * supplies. Returns the mappings' locked plans by id, read for the
     * mappings' prices.
     */
    Map<String, PaymentPlan> fillAdminResponse(ProductPageResponse resp, ProductPage page,
                                               List<ProductPageInviteMapping> activeMappings) {
        resp.setId(page.getId());
        resp.setName(page.getName());
        resp.setCode(page.getCode());
        resp.setInstituteId(page.getInstituteId());
        resp.setStatus(page.getStatus());
        resp.setPageJson(page.getPageJson());
        resp.setSettingsJson(page.getSettingsJson());
        resp.setShortUrl(page.getShortUrl());

        Map<String, PaymentPlan> plans = loadPlans(activeMappings);
        resp.setMappings(activeMappings.stream()
                .map(m -> toMappingResponse(m, plans))
                .collect(Collectors.toList()));
        return plans;
    }

    private ProductPageResponse buildAdminResponseWithCustomFields(ProductPage page) {
        return buildAdminResponseWithCustomFields(page, activeMappings(page.getId()));
    }

    /**
     * Overload accepting pre-fetched mappings. The mappings are read once and
     * used for both the course list and the form, where they used to be
     * fetched a second time for the course list.
     */
    private ProductPageResponse buildAdminResponseWithCustomFields(
            ProductPage page, List<ProductPageInviteMapping> activeMappings) {
        ProductPageResponse resp = new ProductPageResponse();
        fillAdminResponseWithCustomFields(resp, page, activeMappings);
        return resp;
    }

    /**
     * {@link #fillAdminResponse} plus the checkout form, vendor, currency
     * (both from {@link #gatewayMapping}) and GTM container.
     */
    public void fillAdminResponseWithCustomFields(ProductPageResponse resp, ProductPage page,
                                                  List<ProductPageInviteMapping> activeMappings) {
        Map<String, PaymentPlan> plans = fillAdminResponse(resp, page, activeMappings);

        resp.setAggregatedCustomFields(aggregateCustomFields(page.getInstituteId(), activeMappings));

        ProductPageInviteMapping gatewayMapping = gatewayMapping(activeMappings, plans);
        if (gatewayMapping != null) {
            EnrollInvite gatewayInvite = gatewayMapping.getPsInvitePaymentOption().getEnrollInvite();
            resp.setVendor(gatewayInvite.getVendor());
            resp.setCurrency(gatewayInvite.getCurrency());
        }

        // Populate GTM container ID from institute settings
        try {
            Object gtmSetting = instituteSettingService.getSettingByInstituteIdAndKey(page.getInstituteId(),
                    "GTM_SETTING");
            if (gtmSetting instanceof Map) {
                Map<?, ?> gtmMap = (Map<?, ?>) gtmSetting;
                if (Boolean.TRUE.equals(gtmMap.get("enabled"))
                        && gtmMap.get("containerId") != null
                        && StringUtils.hasText(gtmMap.get("containerId").toString())) {
                    resp.setGtmContainerId(gtmMap.get("containerId").toString());
                }
            }
        } catch (Exception e) {
            log.debug("GTM setting not found for institute {}: {}", page.getInstituteId(), e.getMessage());
        }
    }

    /**
     * The mapping whose invite gives the page its gateway and currency: the
     * first one, in display order, whose locked plan costs something, else
     * the first one. A free course is charged nothing; its currency is often
     * only a default label (free plans are created in INR) and its gateway a
     * fallback set before the institute configured one, so it heads the
     * page's prices and payment widget only when nothing on the page is
     * priced. Checkout charges a cart the same way: through its first priced
     * course's gateway (ProductPageEnrollmentService.gatewayInvite), in its
     * priced courses' currency (checkoutCurrency). A mapping whose plan is
     * gone counts as free. Null for a page with no mappings.
     *
     * Visible for testing.
     */
    static ProductPageInviteMapping gatewayMapping(List<ProductPageInviteMapping> activeMappings,
                                                   Map<String, PaymentPlan> plans) {
        if (activeMappings.isEmpty()) {
            return null;
        }
        for (ProductPageInviteMapping mapping : activeMappings) {
            PaymentPlan plan = mapping.getPaymentPlanId() != null ? plans.get(mapping.getPaymentPlanId()) : null;
            if (plan != null && plan.getActualPrice() > 0) {
                return mapping;
            }
        }
        return activeMappings.get(0);
    }

    /**
     * Aggregates custom fields from all active invite mappings, deduplicated by
     * fieldId.
     * Tracks which enrollInviteIds own each field so the frontend can filter
     * dynamically.
     *
     * Every invite's fields are read in ONE query (they used to cost one query
     * per course); the per-invite lists and the aggregation are unchanged.
     */
    List<ProductPageAggregatedFieldDTO> aggregateCustomFields(
            String instituteId, List<ProductPageInviteMapping> activeMappings) {

        List<String> inviteIds = activeMappings.stream()
                .map(mapping -> mapping.getPsInvitePaymentOption().getEnrollInvite().getId())
                .collect(Collectors.toList());
        Map<String, List<InstituteCustomFieldDTO>> fieldsByInvite = inviteIds.isEmpty()
                ? Map.of()
                : customFieldLoader.fieldsByInvite(instituteId, inviteIds);

        // fieldId → aggregated DTO (preserving insertion order = first invite's config
        // wins)
        Map<String, ProductPageAggregatedFieldDTO> deduped = new LinkedHashMap<>();

        for (String enrollInviteId : inviteIds) {
            List<InstituteCustomFieldDTO> fields = fieldsByInvite.getOrDefault(enrollInviteId, List.of());

            for (InstituteCustomFieldDTO field : fields) {
                // fieldId = CustomFields PK; fall back to InstituteCustomField PK if missing
                String fieldId = field.getFieldId() != null
                        ? field.getFieldId()
                        : field.getId();
                if (deduped.containsKey(fieldId)) {
                    deduped.get(fieldId).addInviteId(enrollInviteId);
                } else {
                    deduped.put(fieldId, new ProductPageAggregatedFieldDTO(field, enrollInviteId));
                }
            }
        }

        return new ArrayList<>(deduped.values());
    }

    private ProductPageInviteMappingResponse toMappingResponse(ProductPageInviteMapping m,
                                                               Map<String, PaymentPlan> plans) {
        ProductPageInviteMappingResponse r = new ProductPageInviteMappingResponse();
        r.setId(m.getId());
        r.setPsInvitePaymentOptionId(m.getPsInvitePaymentOption().getId());
        r.setEnrollInviteId(m.getPsInvitePaymentOption().getEnrollInvite().getId());
        r.setPackageSessionId(m.getPsInvitePaymentOption().getPackageSession().getId());
        r.setPaymentOptionId(m.getPsInvitePaymentOption().getPaymentOption().getId());
        r.setPaymentPlanId(m.getPaymentPlanId());
        r.setPreselected(m.isPreselected());
        r.setDisplayOrder(m.getDisplayOrder());
        r.setStatus(m.getStatus());

        PaymentPlan plan = plans.get(m.getPaymentPlanId());
        if (plan != null) {
            r.setPaymentPlan(plan.mapToPaymentPlanDTO());
        }

        if (m.getPsInvitePaymentOption().getPaymentOption() != null) {
            r.setPaymentOptionType(m.getPsInvitePaymentOption().getPaymentOption().getType());
            r.setRegionalPricingEnabled(Boolean.TRUE.equals(
                    m.getPsInvitePaymentOption().getPaymentOption().getRegionalPricingEnabled()));
        }

        vacademy.io.common.institute.entity.session.PackageSession ps = m.getPsInvitePaymentOption()
                .getPackageSession();
        if (ps != null) {
            if (ps.getPackageEntity() != null) {
                vacademy.io.common.institute.entity.PackageEntity pkg = ps.getPackageEntity();
                r.setPackageId(pkg.getId());
                r.setPackageName(pkg.getPackageName());
                // Card presentation data. Without these every product-page /
                // catalogue-offer card fell back to a monogram placeholder with
                // no blurb and no tags, because nothing else populates them.
                r.setCoursePreviewImageMediaId(firstNonBlank(
                        pkg.getCoursePreviewImageMediaId(),
                        pkg.getCourseBannerMediaId(),
                        pkg.getThumbnailFileId()));
                r.setAboutTheCourseHtml(firstNonBlankHtml(
                        pkg.getAboutTheCourse(),
                        pkg.getCourseHtmlDescription()));
                r.setTags(pkg.getTags());
            }
            if (ps.getLevel() != null)
                r.setLevelName(ps.getLevel().getLevelName());
            if (ps.getSession() != null)
                r.setSessionName(ps.getSession().getSessionName());
        }

        return r;
    }

    /**
     * First value carrying VISIBLE text, or null when there is none.
     *
     * Editors persist an empty rich-text field as "&lt;p&gt;&lt;/p&gt;", which is
     * non-blank as a string but renders as nothing — every package on a real
     * institute stores exactly that. Returning it would push consumers past
     * their `about_the_course_html || plan.description` fallback and leave the
     * card with no description at all, so markup with no text counts as blank.
     */
    private String firstNonBlankHtml(String... values) {
        if (values == null)
            return null;
        for (String v : values) {
            if (v == null)
                continue;
            String text = v.replaceAll("<[^>]*>", " ")
                    .replace("&nbsp;", " ")
                    .replace("&#160;", " ");
            if (StringUtils.hasText(text))
                return v;
        }
        return null;
    }

    /** First value that is neither null nor blank, or null when there is none. */
    private String firstNonBlank(String... values) {
        if (values == null)
            return null;
        for (String v : values) {
            if (StringUtils.hasText(v))
                return v;
        }
        return null;
    }

    private String generateUniqueCode() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        String code;
        do {
            StringBuilder sb = new StringBuilder(6);
            for (int i = 0; i < 6; i++)
                sb.append(chars.charAt(random.nextInt(chars.length())));
            code = sb.toString();
        } while (coursePageRepository.existsByCode(code));
        return code;
    }

    /**
     * Where the page's short link sends people. Must be absolute: a bare "/product-pages/x" is
     * resolved against the short-link host (u.vacademy.io) and 404s. instituteId is always
     * appended — the shared learner.vacademy.io portal can't tell institutes apart by host.
     */
    private String buildLearnerUrl(String code, String instituteId) {
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        return learnerPortalUrlResolver.resolveBaseUrl(instituteId, institute)
                + "/product-pages/" + code + "?instituteId=" + instituteId;
    }

    double computeDiscount(AppliedCouponDiscount discount, double totalAmount) {
        if ("percentage".equalsIgnoreCase(discount.getDiscountType())) {
            double computed = totalAmount * discount.getDiscountPoint() / 100.0;
            if (discount.getMaxDiscountPoint() != null && computed > discount.getMaxDiscountPoint()) {
                return discount.getMaxDiscountPoint();
            }
            return computed;
        } else {
            // FIXED / amount
            return discount.getDiscountPoint() != null ? discount.getDiscountPoint() : 0.0;
        }
    }
}
