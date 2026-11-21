package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductSummaryResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttribute;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttributeValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCollection;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductAttributeValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductCollection;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductOption;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductTranslation;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariant;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariantOptionValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.ProductStatus;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductOptionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductTranslationRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantOptionValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.common.CommercePackageTypes;
import vacademy.io.admin_core_service.features.commerce.common.CommerceUnits;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.level.repository.LevelRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.enumName;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.require;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.requireNotNegative;
import static vacademy.io.admin_core_service.features.commerce.catalogue.service.CatalogueRules.trimToNull;

/**
 * The only writer of products and variants.
 *
 * <p>A product is a {@code package} of type PRODUCT plus {@code commerce_product}. A variant is a
 * {@code package_session} on the shared DEFAULT level and DEFAULT session plus
 * {@code commerce_variant}, with one {@code enroll_invite}, one join row, one
 * {@code payment_option} and one {@code payment_plan} that carries the price. The legacy rows are
 * written here through their repositories. {@code PackageSessionService.createPackageSession} is
 * never used (it adds a learner form and a default invite), and no INVITED session is created.
 *
 * <p>Every public method takes the institute id that the access guard has already checked, and
 * reads and writes only rows of that institute.
 */
@Service
@RequiredArgsConstructor
public class CommerceProductService {

    static final String DEFAULT_LEVEL_ID = "DEFAULT";
    static final String DEFAULT_SESSION_ID = "DEFAULT";

    /** Legacy status of a product or variant that is on sale. */
    static final String LEGACY_LIVE = "ACTIVE";
    /**
     * Legacy status of a draft or archived product or variant. DELETED is the one value every
     * legacy reader of package and package_session leaves out; DRAFT and HIDDEN are shown by the
     * course screens. The row itself is never removed.
     */
    static final String LEGACY_HIDDEN = "DELETED";

    /** Tag of the invite behind a variant, so invite lists can leave it out. */
    static final String INVITE_TAG = "COMMERCE";
    /** Commerce takes payment through Razorpay only. */
    static final String INVITE_VENDOR = "RAZORPAY";
    static final String PAYMENT_OPTION_SOURCE = "PACKAGE_SESSION";
    static final String PAYMENT_OPTION_TYPE = "ONE_TIME";
    static final String DEFAULT_CURRENCY = "INR";
    static final String DEFAULT_UNIT = "PCS";
    /** A measured item (qty_scale above 1) whose unit is blank or a piece code (W2). */
    public static final String MEASURED_UNIT_REQUIRED = "VALIDATION: a measured item needs its unit (MTR, KG, …)";

    private static final String ENTITY_PRODUCT = "PRODUCT";
    private static final String ENTITY_VARIANT = "VARIANT";

    private final CommerceProductRepository productRepository;
    private final CommerceProductTranslationRepository translationRepository;
    private final CommerceVariantRepository variantRepository;
    private final CommerceAttributeRepository attributeRepository;
    private final CommerceAttributeValueRepository attributeValueRepository;
    private final CommerceProductAttributeValueRepository productAttributeValueRepository;
    private final CommerceProductOptionRepository productOptionRepository;
    private final CommerceVariantOptionValueRepository variantOptionValueRepository;
    private final CommerceCollectionRepository collectionRepository;
    private final CommerceProductCollectionRepository productCollectionRepository;
    private final CommerceVariantLegacyRepository variantLegacyRepository;
    private final PackageRepository packageRepository;
    private final PackageInstituteRepository packageInstituteRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final LevelRepository levelRepository;
    private final SessionRepository sessionRepository;
    private final InstituteRepository instituteRepository;
    private final EnrollInviteRepository enrollInviteRepository;
    private final PackageSessionLearnerInvitationToPaymentOptionRepository linkRepository;
    private final PaymentOptionRepository paymentOptionRepository;
    private final PaymentPlanRepository paymentPlanRepository;
    private final CommerceAuditService auditService;
    private final CommerceTaxClassService taxClassService;
    private final DocumentClock documentClock;
    private final StockLocationRepository locationRepository;

    /** The stock ledger, to lock the measure of an item with stock (WP-40); absent in tests built by hand. */
    private StockMovementRepository movementRepository;

    @Autowired(required = false)
    public void setMovementRepository(StockMovementRepository movementRepository) {
        this.movementRepository = movementRepository;
    }

    // ------------------------------------------------------------------ writes

    /**
     * Creates a product with its variants. When {@code external_ref} already names a product of
     * this institute, that product is updated instead, so a repeated import creates nothing.
     */
    @Transactional
    public ProductResponse save(String instituteId, String actorUserId, ProductRequest request) {
        require(request != null, "request body is required");
        String externalRef = trimToNull(request.getExternalRef());
        if (externalRef != null) {
            CommerceProduct existing = productRepository
                    .findByInstituteIdAndExternalRef(instituteId, externalRef).orElse(null);
            if (existing != null) {
                return apply(instituteId, actorUserId, load(instituteId, existing), request, false);
            }
        }
        return apply(instituteId, actorUserId, createBase(instituteId, actorUserId, request), request, true);
    }

    @Transactional
    public ProductResponse update(String instituteId, String actorUserId, String packageId,
                                  ProductRequest request) {
        require(request != null, "request body is required");
        return apply(instituteId, actorUserId, load(instituteId, requireProduct(instituteId, packageId)),
                request, false);
    }

    /** DRAFT, ACTIVE (publish) or ARCHIVED. Archiving hides the product; nothing is deleted. */
    @Transactional
    public ProductResponse changeStatus(String instituteId, String actorUserId, String packageId, String status) {
        require(trimToNull(status) != null, "status is required");
        ProductRequest request = new ProductRequest();
        request.setStatus(status);
        return update(instituteId, actorUserId, packageId, request);
    }

    /** Adds or updates variants of one product; the other variants are left as they are. */
    @Transactional
    public ProductResponse saveVariants(String instituteId, String actorUserId, String packageId,
                                        List<VariantRequest> variants) {
        require(variants != null && !variants.isEmpty(), "at least one variant is required");
        ProductRequest request = new ProductRequest();
        request.setVariants(variants);
        return update(instituteId, actorUserId, packageId, request);
    }

    /** Updates one variant. The id is looked up inside the institute, so a foreign id is not found. */
    @Transactional
    public ProductResponse updateVariant(String instituteId, String actorUserId, String packageSessionId,
                                         VariantRequest request) {
        require(request != null, "request body is required");
        CommerceVariant variant = variantRepository
                .findByInstituteIdAndPackageSessionId(instituteId, packageSessionId)
                .orElseThrow(() -> new ResourceNotFoundException("Variant not found"));
        request.setPackageSessionId(variant.getPackageSessionId());
        return saveVariants(instituteId, actorUserId, variant.getPackageId(), List.of(request));
    }

    // ------------------------------------------------------------------- reads

    @Transactional(readOnly = true)
    public ProductResponse get(String instituteId, String packageId) {
        return toResponse(load(instituteId, requireProduct(instituteId, packageId)));
    }

    @Transactional(readOnly = true)
    public Page<ProductSummaryResponse> list(String instituteId, String status, String q, String collectionId,
                                             int page, int size) {
        return list(instituteId, status, q, collectionId, false, page, size);
    }

    /** {@code taxClassMissing} true keeps only the products that have no tax class yet. */
    @Transactional(readOnly = true)
    public Page<ProductSummaryResponse> list(String instituteId, String status, String q, String collectionId,
                                             boolean taxClassMissing, int page, int size) {
        Page<CommerceProduct> products = productRepository.search(instituteId,
                enumName(ProductStatus.class, status, "status"), likePattern(q), trimToNull(collectionId),
                taxClassMissing,
                CatalogueRules.page(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))));
        List<String> packageIds = products.getContent().stream().map(CommerceProduct::getPackageId).toList();
        if (packageIds.isEmpty()) {
            return products.map(p -> toSummary(p, null, List.of()));
        }
        Map<String, Map<String, String>> names = new HashMap<>();
        for (CommerceProductTranslation t : translationRepository
                .findByInstituteIdAndPackageIdIn(instituteId, packageIds)) {
            names.computeIfAbsent(t.getPackageId(), k -> new LinkedHashMap<>()).put(t.getLocale(), t.getName());
        }
        Map<String, List<VariantState>> variantsByPackage = loadVariantStates(instituteId,
                variantRepository.findByInstituteIdAndPackageIdIn(instituteId, packageIds)).stream()
                .collect(Collectors.groupingBy(v -> v.variant.getPackageId()));
        return products.map(p -> toSummary(p, names.get(p.getPackageId()),
                variantsByPackage.getOrDefault(p.getPackageId(), List.of())));
    }

    @Transactional(readOnly = true)
    public VariantResponse getVariant(String instituteId, String packageSessionId) {
        CommerceVariant variant = variantRepository
                .findByInstituteIdAndPackageSessionId(instituteId, packageSessionId)
                .orElseThrow(() -> new ResourceNotFoundException("Variant not found"));
        return toVariantResponse(loadVariantStates(instituteId, List.of(variant)).get(0));
    }

    @Transactional(readOnly = true)
    public Page<VariantResponse> listVariants(String instituteId, String packageId, int page, int size) {
        requireProduct(instituteId, packageId);
        Page<CommerceVariant> variants = variantRepository.findByInstituteIdAndPackageId(instituteId, packageId,
                CatalogueRules.page(page, size, Sort.by(Sort.Order.asc("position"), Sort.Order.asc("id"))));
        Map<String, VariantState> states = loadVariantStates(instituteId, variants.getContent()).stream()
                .collect(Collectors.toMap(v -> v.variant.getPackageSessionId(), v -> v));
        return variants.map(v -> toVariantResponse(states.get(v.getPackageSessionId())));
    }

    // ------------------------------------------------------------ working state

    private static final class VariantState {
        CommerceVariant variant;
        PackageSession session;
        PackageSessionLearnerInvitationToPaymentOption link;
        PaymentPlan plan;
        /** attribute id to row. */
        final Map<String, CommerceVariantOptionValue> optionRows = new LinkedHashMap<>();
        boolean sessionDirty;
        boolean inviteDirty;

        Map<String, String> optionValues() {
            Map<String, String> out = new LinkedHashMap<>();
            optionRows.forEach((attributeId, row) -> out.put(attributeId, row.getAttributeValueId()));
            return out;
        }
    }

    private static final class ProductState {
        CommerceProduct product;
        PackageEntity pkg;
        List<CommerceProductTranslation> translations = new ArrayList<>();
        List<CommerceProductOption> options = new ArrayList<>();
        List<CommerceProductAttributeValue> facets = new ArrayList<>();
        List<CommerceProductCollection> collections = new ArrayList<>();
        List<VariantState> variants = new ArrayList<>();
    }

    private CommerceProduct requireProduct(String instituteId, String packageId) {
        // Looked up by institute and id together, so an id of another institute is simply not found.
        return productRepository.findByInstituteIdAndPackageId(instituteId, packageId)
                .orElseThrow(() -> new ResourceNotFoundException("Product not found"));
    }

    private ProductState load(String instituteId, CommerceProduct product) {
        String packageId = product.getPackageId();
        ProductState state = new ProductState();
        state.product = product;
        state.pkg = packageRepository.findById(packageId)
                .orElseThrow(() -> new IllegalStateException("package row missing for product " + packageId));
        state.translations = new ArrayList<>(
                translationRepository.findByInstituteIdAndPackageId(instituteId, packageId));
        state.options = new ArrayList<>(
                productOptionRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(instituteId, packageId));
        state.facets = new ArrayList<>(
                productAttributeValueRepository.findByInstituteIdAndPackageId(instituteId, packageId));
        state.collections = new ArrayList<>(
                productCollectionRepository.findByInstituteIdAndPackageId(instituteId, packageId));
        state.variants = loadVariantStates(instituteId,
                variantRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(instituteId, packageId));
        return state;
    }

    private List<VariantState> loadVariantStates(String instituteId, List<CommerceVariant> variants) {
        List<VariantState> states = new ArrayList<>();
        if (variants.isEmpty()) {
            return states;
        }
        List<String> sessionIds = variants.stream().map(CommerceVariant::getPackageSessionId).toList();
        Map<String, PackageSession> sessions = new HashMap<>();
        packageSessionRepository.findAllById(sessionIds).forEach(s -> sessions.put(s.getId(), s));
        Map<String, PackageSessionLearnerInvitationToPaymentOption> links = new HashMap<>();
        for (PackageSessionLearnerInvitationToPaymentOption link
                : variantLegacyRepository.findLinksByPackageSessionIds(sessionIds, instituteId, INVITE_TAG)) {
            links.putIfAbsent(link.getPackageSession().getId(), link);
        }
        Map<String, PaymentPlan> plansByOption = new HashMap<>();
        List<String> optionIds = links.values().stream().map(l -> l.getPaymentOption().getId()).toList();
        if (!optionIds.isEmpty()) {
            for (PaymentPlan plan : variantLegacyRepository.findPlansByPaymentOptionIds(optionIds, LEGACY_LIVE)) {
                plansByOption.putIfAbsent(plan.getPaymentOption().getId(), plan);
            }
        }
        Map<String, List<CommerceVariantOptionValue>> optionRows = variantOptionValueRepository
                .findByInstituteIdAndPackageSessionIdIn(instituteId, sessionIds).stream()
                .collect(Collectors.groupingBy(CommerceVariantOptionValue::getPackageSessionId));
        for (CommerceVariant variant : variants) {
            VariantState state = new VariantState();
            state.variant = variant;
            state.session = sessions.get(variant.getPackageSessionId());
            state.link = links.get(variant.getPackageSessionId());
            if (state.session == null || state.link == null) {
                throw new IllegalStateException("legacy rows missing for variant " + variant.getPackageSessionId());
            }
            state.plan = plansByOption.get(state.link.getPaymentOption().getId());
            for (CommerceVariantOptionValue row
                    : optionRows.getOrDefault(variant.getPackageSessionId(), List.of())) {
                state.optionRows.put(row.getAttributeId(), row);
            }
            states.add(state);
        }
        return states;
    }

    /** Attributes and values named by the request or already on the product, all of this institute. */
    private static final class Refs {
        final Map<String, CommerceAttribute> attributes = new HashMap<>();
        final Map<String, CommerceAttributeValue> values = new HashMap<>();
    }

    // ------------------------------------------------------------------ create

    /** package, package_institute and commerce_product for a new product. Nothing else yet. */
    private ProductState createBase(String instituteId, String actorUserId, ProductRequest request) {
        List<ProductTranslationDTO> translations = request.getTranslations();
        require(translations != null && !translations.isEmpty() && translations.get(0) != null
                        && trimToNull(translations.get(0).getName()) != null,
                "a new product needs at least one translation with a name");
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new ResourceNotFoundException("Institute not found"));

        PackageEntity pkg = new PackageEntity();
        pkg.setPackageName(translations.get(0).getName().trim());
        pkg.setPackageType(CommercePackageTypes.PRODUCT);
        // Hidden until syncLegacyStatuses decides; a product is never visible half-written.
        pkg.setStatus(LEGACY_HIDDEN);
        pkg.setIsCoursePublishedToCatalaouge(false);
        pkg.setCreatedByUserId(actorUserId);
        pkg.setVersionNumber(1);
        pkg = packageRepository.save(pkg);

        PackageInstitute packageInstitute = new PackageInstitute();
        packageInstitute.setPackageEntity(pkg);
        packageInstitute.setInstituteEntity(institute);
        packageInstituteRepository.save(packageInstitute);

        CommerceProduct product = new CommerceProduct();
        product.setInstituteId(instituteId);
        product.setPackageId(pkg.getId());
        product.setSlug(newSlug(instituteId, request.getSlug(), translations.get(0).getName()));
        product.setStockMode(StockMode.QUANTITY.name());
        product.setUnit(DEFAULT_UNIT);
        product.setQtyScale(1);
        product.setQtyStep(1);
        product.setStatus(ProductStatus.DRAFT.name());
        product = productRepository.save(product);

        ProductState state = new ProductState();
        state.product = product;
        state.pkg = pkg;
        return state;
    }

    private String newSlug(String instituteId, String requested, String name) {
        String explicit = trimToNull(requested);
        if (explicit != null) {
            String slug = CatalogueRules.requireSlug(explicit);
            requireSlugFree(instituteId, slug);
            return slug;
        }
        String slug = CatalogueRules.slugFrom(name);
        if (slug.isEmpty()) {
            return "product-" + CatalogueRules.randomSuffix();
        }
        return productRepository.findByInstituteIdAndSlug(instituteId, slug).isPresent()
                ? slug + "-" + CatalogueRules.randomSuffix()
                : slug;
    }

    private void requireSlugFree(String instituteId, String slug) {
        if (productRepository.findByInstituteIdAndSlug(instituteId, slug).isPresent()) {
            throw new ConflictException("Another product already uses the slug " + slug);
        }
    }

    // ------------------------------------------------------------------- apply

    private ProductResponse apply(String instituteId, String actorUserId, ProductState state,
                                  ProductRequest request, boolean created) {
        CommerceProduct product = state.product;
        String statusBefore = product.getStatus();
        Refs refs = loadRefs(instituteId, state, request);

        applyProductFields(instituteId, state, request, created);
        applyTranslations(instituteId, state, request.getTranslations());
        applyOptions(instituteId, state, request.getOptionAttributeIds());
        applyFacets(instituteId, state, request.getAttributeValueIds());
        applyCollections(instituteId, state, request.getCollectionIds());
        applyVariants(instituteId, actorUserId, state, request.getVariants());
        requireValidVariantSet(state, refs);

        String status = enumName(ProductStatus.class, request.getStatus(), "status");
        if (status != null) {
            product.setStatus(status);
        }
        if (ProductStatus.ACTIVE.name().equals(product.getStatus())) {
            requirePublishable(state);
            if (product.getPublishedAt() == null) {
                product.setPublishedAt(LocalDateTime.now());
            }
        }
        syncLegacyStatuses(state);
        refreshSearchText(state, refs);
        state.product = productRepository.save(product);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("slug", product.getSlug());
        detail.put("status", product.getStatus());
        detail.put("variant_count", state.variants.size());
        auditService.record(instituteId, actorUserId, created ? "PRODUCT_CREATED" : "PRODUCT_UPDATED",
                ENTITY_PRODUCT, product.getPackageId(), CatalogueRules.json(detail));
        if (!created && !Objects.equals(statusBefore, product.getStatus())) {
            Map<String, Object> change = new LinkedHashMap<>();
            change.put("from", statusBefore);
            change.put("to", product.getStatus());
            auditService.record(instituteId, actorUserId, "PRODUCT_STATUS_CHANGED", ENTITY_PRODUCT,
                    product.getPackageId(), CatalogueRules.json(change));
        }
        return toResponse(state);
    }

    /**
     * Loads every attribute and value the request names, scoped to the institute, before any row
     * is written. An id of another institute is not found and the request is refused.
     */
    private Refs loadRefs(String instituteId, ProductState state, ProductRequest request) {
        Set<String> attributeIds = new LinkedHashSet<>();
        Set<String> requestedValueIds = new LinkedHashSet<>();
        if (request.getOptionAttributeIds() != null) {
            for (String id : request.getOptionAttributeIds()) {
                require(trimToNull(id) != null, "option_attribute_ids holds an empty id");
                attributeIds.add(id.trim());
            }
        }
        if (request.getAttributeValueIds() != null) {
            for (String id : request.getAttributeValueIds()) {
                require(trimToNull(id) != null, "attribute_value_ids holds an empty id");
                requestedValueIds.add(id.trim());
            }
        }
        if (request.getVariants() != null) {
            for (VariantRequest variant : request.getVariants()) {
                require(variant != null, "variants holds an empty entry");
                if (variant.getOptionValues() != null) {
                    variant.getOptionValues().forEach((attributeId, valueId) -> {
                        require(trimToNull(attributeId) != null && trimToNull(valueId) != null,
                                "option_values holds an empty id");
                        attributeIds.add(attributeId.trim());
                        requestedValueIds.add(valueId.trim());
                    });
                }
            }
        }
        Set<String> valueIds = new LinkedHashSet<>(requestedValueIds);
        state.facets.forEach(f -> valueIds.add(f.getAttributeValueId()));
        state.variants.forEach(v -> v.optionRows.values().forEach(r -> valueIds.add(r.getAttributeValueId())));

        Refs refs = new Refs();
        if (!attributeIds.isEmpty()) {
            attributeRepository.findByInstituteIdAndIdIn(instituteId, attributeIds)
                    .forEach(a -> refs.attributes.put(a.getId(), a));
            for (String id : attributeIds) {
                require(refs.attributes.containsKey(id), "unknown attribute: " + id);
            }
        }
        if (!valueIds.isEmpty()) {
            attributeValueRepository.findByInstituteIdAndIdIn(instituteId, valueIds)
                    .forEach(v -> refs.values.put(v.getId(), v));
            for (String id : requestedValueIds) {
                require(refs.values.containsKey(id), "unknown attribute value: " + id);
            }
        }
        return refs;
    }

    private void applyProductFields(String instituteId, ProductState state, ProductRequest request,
                                    boolean created) {
        CommerceProduct product = state.product;

        String slug = trimToNull(request.getSlug());
        if (!created && slug != null) {
            slug = CatalogueRules.requireSlug(slug);
            if (!slug.equals(product.getSlug())) {
                requireSlugFree(instituteId, slug);
                product.setSlug(slug);
            }
        }

        String externalRef = trimToNull(request.getExternalRef());
        if (externalRef != null && !externalRef.equals(product.getExternalRef())) {
            require(externalRef.length() <= 255, "external_ref is too long");
            CommerceProduct other = productRepository
                    .findByInstituteIdAndExternalRef(instituteId, externalRef).orElse(null);
            if (other != null && !other.getPackageId().equals(product.getPackageId())) {
                throw new ConflictException("Another product already uses the external reference " + externalRef);
            }
            product.setExternalRef(externalRef);
        }

        String stockMode = enumName(StockMode.class, request.getStockMode(), "stock_mode");
        String unit = trimToNull(request.getUnit());
        if (unit != null) {
            unit = unit.toUpperCase(Locale.ROOT);
            require(unit.length() <= 32, "unit is too long");
        }
        Integer qtyScale = request.getQtyScale();
        require(qtyScale == null || qtyScale >= 1, "qty_scale must be 1 or more");
        Integer qtyStep = request.getQtyStep();
        require(qtyStep == null || qtyStep >= 1, "qty_step must be 1 or more");

        // Stock, holds, order lines and prices all count base units of 1/qty_scale of the unit, and
        // PIECE stock is tracked per piece. Once a product has been on sale these cannot change here.
        boolean measureChanges = (stockMode != null && !stockMode.equals(product.getStockMode()))
                || (unit != null && !unit.equals(product.getUnit()))
                || (qtyScale != null && !qtyScale.equals(product.getQtyScale()));
        require(!measureChanges || product.getPublishedAt() == null,
                "stock_mode, unit and qty_scale cannot change after the product has been published");
        // Stock already counted in the old measure would mean something else (40 PCS read as 4 m), and a
        // quantity item turned PIECE could never receive a transfer in transit. DRAFT or not.
        if (measureChanges && !created && movementRepository != null
                && movementRepository.existsForPackage(instituteId, product.getPackageId())) {
            throw new ConflictException("STOCK_EXISTS: unit, qty_scale and stock mode cannot change once stock has "
                    + "moved for this item");
        }
        // Lengths, weights and volumes print with log10(qty_scale) decimals, so the scale is a power
        // of ten; a one-of-a-kind item is one piece. Checked only when the request touches either.
        if (stockMode != null || qtyScale != null) {
            String effectiveMode = stockMode != null ? stockMode : product.getStockMode();
            int effectiveScale = qtyScale != null ? qtyScale
                    : product.getQtyScale() == null ? 1 : product.getQtyScale();
            require(CommerceUnits.allowedScale(effectiveScale), "VALIDATION: qty_scale is 1, 10, 100 or 1000");
            require(!StockMode.PIECE.name().equals(effectiveMode) || effectiveScale == 1,
                    "VALIDATION: a one-of-a-kind item is counted in pieces (qty_scale 1)");
        }
        // A measured item prints "2.5 m": its unit must be one with a sign, never blank or a piece
        // code (the default PCS would print "2.5" on paper and "2.5 pc" in the shop).
        if (stockMode != null || qtyScale != null || unit != null) {
            int effectiveScale = qtyScale != null ? qtyScale
                    : product.getQtyScale() == null ? 1 : product.getQtyScale();
            String effectiveUnit = unit != null ? unit : product.getUnit();
            require(!CommerceUnits.measured(effectiveScale) || CommerceUnits.measuredUnit(effectiveUnit),
                    MEASURED_UNIT_REQUIRED);
        }
        if (stockMode != null) {
            product.setStockMode(stockMode);
        }
        if (unit != null) {
            product.setUnit(unit);
        }
        if (qtyScale != null) {
            product.setQtyScale(qtyScale);
        }
        if (qtyStep != null) {
            product.setQtyStep(qtyStep);
        }

        if (request.getBrand() != null) {
            String brand = trimToNull(request.getBrand());
            require(brand == null || brand.length() <= 255, "brand is too long");
            product.setBrand(brand);
        }
        if (request.getSeoI18n() != null) {
            product.setSeoI18n(request.getSeoI18n().isEmpty() ? null : request.getSeoI18n());
        }

        // Null means "leave unchanged"; an empty string clears the value. Both ids are looked up
        // inside the institute, so a foreign id is refused.
        if (request.getTaxClassId() != null) {
            String taxClassId = trimToNull(request.getTaxClassId());
            taxClassService.requireUsableTaxClass(instituteId, taxClassId);
            product.setTaxClassId(taxClassId);
        }
        if (request.getOriginLocationId() != null) {
            String originLocationId = trimToNull(request.getOriginLocationId());
            if (originLocationId != null) {
                StockLocation origin = locationRepository.findByInstituteIdAndId(instituteId, originLocationId)
                        .orElseThrow(() -> new InvalidRequestException(
                                "origin_location_id is not a location of this institute"));
                require(origin.isSource(), "origin_location_id must be a source location");
            }
            product.setOriginLocationId(originLocationId);
        }
    }

    private void applyTranslations(String instituteId, ProductState state, List<ProductTranslationDTO> requested) {
        if (requested == null || requested.isEmpty()) {
            return;
        }
        Map<String, CommerceProductTranslation> byLocale = new HashMap<>();
        state.translations.forEach(t -> byLocale.put(t.getLocale(), t));
        Set<String> seen = new HashSet<>();
        for (ProductTranslationDTO dto : requested) {
            require(dto != null, "translations holds an empty entry");
            String locale = CatalogueRules.requireLocale(dto.getLocale());
            require(seen.add(locale), "translations holds the locale " + locale + " twice");
            String name = trimToNull(dto.getName());
            require(name != null, "a translation needs a name");
            require(name.length() <= 255, "a product name is at most 255 characters");

            CommerceProductTranslation translation = byLocale.get(locale);
            if (translation == null) {
                translation = new CommerceProductTranslation();
                translation.setInstituteId(instituteId);
                translation.setPackageId(state.product.getPackageId());
                translation.setLocale(locale);
                state.translations.add(translation);
                byLocale.put(locale, translation);
            }
            CatalogueRules.requireTextSizes(trimToNull(dto.getShortDescription()),
                    trimToNull(dto.getDescriptionHtml()), dto.getContentBlocks());
            translation.setName(name);
            translation.setShortDescription(trimToNull(dto.getShortDescription()));
            translation.setDescriptionHtml(trimToNull(dto.getDescriptionHtml()));
            translation.setContentBlocks(dto.getContentBlocks());
        }
        // The legacy name follows the first translation of the request.
        String legacyName = requested.get(0).getName().trim();
        if (!legacyName.equals(state.pkg.getPackageName())) {
            state.pkg.setPackageName(legacyName);
            state.pkg = packageRepository.save(state.pkg);
        }
    }

    private void applyOptions(String instituteId, ProductState state, List<String> attributeIds) {
        if (attributeIds == null) {
            return;
        }
        List<String> wanted = attributeIds.stream().map(String::trim).toList();
        require(new HashSet<>(wanted).size() == wanted.size(), "option_attribute_ids holds an attribute twice");
        Map<String, CommerceProductOption> existing = new HashMap<>();
        state.options.forEach(o -> existing.put(o.getAttributeId(), o));

        List<CommerceProductOption> result = new ArrayList<>();
        for (int i = 0; i < wanted.size(); i++) {
            CommerceProductOption option = existing.remove(wanted.get(i));
            if (option == null) {
                option = new CommerceProductOption();
                option.setInstituteId(instituteId);
                option.setPackageId(state.product.getPackageId());
                option.setAttributeId(wanted.get(i));
                option.setPosition(i);
                option = productOptionRepository.save(option);
            } else if (!Integer.valueOf(i).equals(option.getPosition())) {
                option.setPosition(i);
                option = productOptionRepository.save(option);
            }
            result.add(option);
        }
        if (!existing.isEmpty()) {
            productOptionRepository.deleteAll(existing.values());
        }
        state.options = result;
    }

    private void applyFacets(String instituteId, ProductState state, List<String> attributeValueIds) {
        if (attributeValueIds == null) {
            return;
        }
        Set<String> wanted = attributeValueIds.stream().map(String::trim)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        List<CommerceProductAttributeValue> result = new ArrayList<>();
        List<CommerceProductAttributeValue> removed = new ArrayList<>();
        for (CommerceProductAttributeValue facet : state.facets) {
            if (wanted.remove(facet.getAttributeValueId())) {
                result.add(facet);
            } else {
                removed.add(facet);
            }
        }
        for (String valueId : wanted) {
            CommerceProductAttributeValue facet = new CommerceProductAttributeValue();
            facet.setInstituteId(instituteId);
            facet.setPackageId(state.product.getPackageId());
            facet.setAttributeValueId(valueId);
            result.add(productAttributeValueRepository.save(facet));
        }
        if (!removed.isEmpty()) {
            productAttributeValueRepository.deleteAll(removed);
        }
        state.facets = result;
    }

    private void applyCollections(String instituteId, ProductState state, List<String> collectionIds) {
        if (collectionIds == null) {
            return;
        }
        Set<String> wanted = new LinkedHashSet<>();
        for (String id : collectionIds) {
            require(trimToNull(id) != null, "collection_ids holds an empty id");
            wanted.add(id.trim());
        }
        if (!wanted.isEmpty()) {
            Set<String> found = collectionRepository.findByInstituteIdAndIdIn(instituteId, wanted).stream()
                    .map(CommerceCollection::getId).collect(Collectors.toSet());
            for (String id : wanted) {
                require(found.contains(id), "unknown collection: " + id);
            }
        }
        List<CommerceProductCollection> result = new ArrayList<>();
        List<CommerceProductCollection> removed = new ArrayList<>();
        for (CommerceProductCollection row : state.collections) {
            if (wanted.remove(row.getCollectionId())) {
                result.add(row);
            } else {
                removed.add(row);
            }
        }
        for (String collectionId : wanted) {
            CommerceProductCollection row = new CommerceProductCollection();
            row.setInstituteId(instituteId);
            row.setCollectionId(collectionId);
            row.setPackageId(state.product.getPackageId());
            // New memberships go to the end; the collection screen sets the order.
            row.setPosition(Integer.MAX_VALUE);
            result.add(productCollectionRepository.save(row));
        }
        if (!removed.isEmpty()) {
            productCollectionRepository.deleteAll(removed);
        }
        state.collections = result;
    }

    // ---------------------------------------------------------------- variants

    private void applyVariants(String instituteId, String actorUserId, ProductState state,
                               List<VariantRequest> requests) {
        if (requests == null) {
            return;
        }
        Set<VariantState> touched = new HashSet<>();
        for (VariantRequest request : requests) {
            VariantState existing = match(state, request);
            if (existing == null) {
                VariantState created = createVariant(instituteId, actorUserId, state, request);
                state.variants.add(created);
                touched.add(created);
            } else {
                require(touched.add(existing), "the request names the variant "
                        + existing.variant.getSku() + " more than once");
                changeVariant(instituteId, actorUserId, state, existing, request);
            }
        }
    }

    private VariantState match(ProductState state, VariantRequest request) {
        String packageSessionId = trimToNull(request.getPackageSessionId());
        if (packageSessionId != null) {
            // Only variants of this product are candidates, so an id from elsewhere is not found.
            return state.variants.stream()
                    .filter(v -> packageSessionId.equals(v.variant.getPackageSessionId()))
                    .findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("Variant not found in this product"));
        }
        String externalRef = trimToNull(request.getExternalRef());
        if (externalRef != null) {
            for (VariantState v : state.variants) {
                if (externalRef.equals(v.variant.getExternalRef())) {
                    return v;
                }
            }
        }
        String sku = trimToNull(request.getSku());
        if (sku != null) {
            for (VariantState v : state.variants) {
                if (sku.equals(v.variant.getSku())) {
                    return v;
                }
            }
        }
        return null;
    }

    private VariantState createVariant(String instituteId, String actorUserId, ProductState state,
                                       VariantRequest request) {
        String sku = requireSku(request.getSku());
        requireSkuFree(instituteId, state, sku, null);
        String barcode = trimToNull(request.getBarcode());
        if (barcode != null) {
            requireBarcodeFree(instituteId, state, barcode, null);
        }
        String stockPolicy = enumName(StockPolicy.class, request.getStockPolicy(), "stock_policy");
        if (stockPolicy == null) {
            stockPolicy = StockPolicy.TRACKED.name();
        }
        String status = enumName(ProductStatus.class, request.getStatus(), "variant status");
        if (status == null) {
            status = ProductStatus.ACTIVE.name();
        }
        String name = trimToNull(request.getName());
        if (name == null) {
            name = sku;
        }
        require(name.length() <= 255, "a variant name is at most 255 characters");
        BigDecimal price = checkedMoney(request.getPrice(), "price");
        BigDecimal mrp = checkedMoney(request.getMrp(), "mrp");
        if (price == null) {
            // No price yet: the product cannot be published until one is set.
            price = BigDecimal.ZERO;
        }
        if (mrp == null) {
            mrp = price;
        }
        require(mrp.compareTo(price) >= 0, "mrp cannot be below the price");
        String currency = checkedCurrency(request.getCurrency());
        if (currency == null) {
            currency = DEFAULT_CURRENCY;
        }
        requireVariantNumbers(request);

        Level level = levelRepository.findById(DEFAULT_LEVEL_ID)
                .orElseThrow(() -> new IllegalStateException("the DEFAULT level row is missing"));
        Session session = sessionRepository.findById(DEFAULT_SESSION_ID)
                .orElseThrow(() -> new IllegalStateException("the DEFAULT session row is missing"));

        PackageSession packageSession = new PackageSession();
        packageSession.setLevel(level);
        packageSession.setSession(session);
        packageSession.setPackageEntity(state.pkg);
        packageSession.setStatus(LEGACY_HIDDEN);
        packageSession.setStartTime(new Date());
        packageSession.setName(name);
        packageSession.setIsParent(false);
        packageSession.setIsOrgAssociated(false);
        if (StockPolicy.TRACKED.name().equals(stockPolicy)) {
            // Tracked means max_seats is not null. It starts with nothing to sell; receipts
            // (StockLedgerService) raise it. UNTRACKED keeps both null, which is unlimited.
            packageSession.setMaxSeats(0);
            packageSession.setAvailableSlots(0);
        }
        packageSession = packageSessionRepository.save(packageSession);

        String legacyName = state.pkg.getPackageName() + " - " + name;
        EnrollInvite invite = new EnrollInvite();
        invite.setName(legacyName);
        invite.setStartDate(new java.sql.Date(System.currentTimeMillis()));
        invite.setInviteCode("c" + UUID.randomUUID().toString().replace("-", "").substring(0, 15));
        invite.setStatus(LEGACY_HIDDEN);
        invite.setInstituteId(instituteId);
        invite.setVendor(INVITE_VENDOR);
        invite.setVendorId(INVITE_VENDOR);
        invite.setCurrency(currency);
        invite.setTag(INVITE_TAG);
        // Null on purpose, like validity_in_days below: either one gives the buyer's plan an end date.
        invite.setLearnerAccessDays(null);
        invite.setIsBundled(false);
        invite.setCreatedByUserId(actorUserId);
        invite.setUpdatedByUserId(actorUserId);
        invite = enrollInviteRepository.save(invite);

        PaymentOption option = new PaymentOption();
        option.setName(legacyName);
        option.setStatus(LEGACY_LIVE);
        option.setSource(PAYMENT_OPTION_SOURCE);
        option.setSourceId(packageSession.getId());
        option.setType(PAYMENT_OPTION_TYPE);
        option.setRequireApproval(false);
        option.setRegionalPricingEnabled(false);
        option.setPlanChangeAllowed(false);
        option.setCreatedByUserId(actorUserId);
        option = paymentOptionRepository.save(option);

        PaymentPlan plan = new PaymentPlan();
        plan.setName(legacyName);
        plan.setStatus(LEGACY_LIVE);
        plan.setValidityInDays(null);
        plan.setActualPrice(price.doubleValue());
        plan.setElevatedPrice(mrp.doubleValue());
        plan.setCurrency(currency);
        plan.setPlanChangeAllowed(false);
        plan.setPaymentOption(option);
        plan = paymentPlanRepository.save(plan);

        PackageSessionLearnerInvitationToPaymentOption link = linkRepository.save(
                new PackageSessionLearnerInvitationToPaymentOption(invite, packageSession, option, LEGACY_HIDDEN));

        CommerceVariant variant = new CommerceVariant();
        variant.setInstituteId(instituteId);
        variant.setPackageSessionId(packageSession.getId());
        variant.setPackageId(state.product.getPackageId());
        variant.setSku(sku);
        variant.setBarcode(barcode);
        variant.setStockPolicy(stockPolicy);
        variant.setLeadTimeDays(request.getLeadTimeDays());
        variant.setWeightGrams(request.getWeightGrams());
        variant.setLengthMm(request.getLengthMm());
        variant.setWidthMm(request.getWidthMm());
        variant.setHeightMm(request.getHeightMm());
        // A cost typed at creation is the standard cost and the starting average.
        // After that the average belongs to the stock
        // ledger alone; both columns are not updatable through this entity.
        BigDecimal startingCost = checkedMoney(request.getCostPrice(), "cost_price");
        variant.setCostPrice(startingCost);
        variant.setStandardCost(startingCost);
        variant.setMediaId(CatalogueRules.mediaId(request.getMediaId()));
        variant.setPosition(request.getPosition() != null ? request.getPosition() : state.variants.size());
        variant.setStatus(status);
        variant.setExternalRef(trimToNull(request.getExternalRef()));
        variant = variantRepository.save(variant);

        VariantState created = new VariantState();
        created.variant = variant;
        created.session = packageSession;
        created.link = link;
        created.plan = plan;
        if (request.getOptionValues() != null) {
            writeOptionValues(instituteId, created, request.getOptionValues());
        }
        return created;
    }

    private void changeVariant(String instituteId, String actorUserId, ProductState state, VariantState current,
                               VariantRequest request) {
        CommerceVariant variant = current.variant;
        requireVariantNumbers(request);

        String sku = trimToNull(request.getSku());
        if (sku != null && !sku.equals(variant.getSku())) {
            sku = requireSku(sku);
            requireSkuFree(instituteId, state, sku, current);
            variant.setSku(sku);
        }
        if (request.getBarcode() != null) {
            String barcode = trimToNull(request.getBarcode());
            if (barcode != null && !barcode.equals(variant.getBarcode())) {
                requireBarcodeFree(instituteId, state, barcode, current);
            }
            variant.setBarcode(barcode);
        }
        String stockPolicy = enumName(StockPolicy.class, request.getStockPolicy(), "stock_policy");
        // HOOK (stock policy): switching sets or clears max_seats and available_slots, which
        // only the stock ledger may write. Until that exists the policy of a variant is fixed.
        require(stockPolicy == null || stockPolicy.equals(variant.getStockPolicy()),
                "stock_policy of an existing variant cannot be changed yet");
        String status = enumName(ProductStatus.class, request.getStatus(), "variant status");
        if (status != null) {
            variant.setStatus(status);
        }
        if (request.getLeadTimeDays() != null) {
            variant.setLeadTimeDays(request.getLeadTimeDays());
        }
        if (request.getWeightGrams() != null) {
            variant.setWeightGrams(request.getWeightGrams());
        }
        if (request.getLengthMm() != null) {
            variant.setLengthMm(request.getLengthMm());
        }
        if (request.getWidthMm() != null) {
            variant.setWidthMm(request.getWidthMm());
        }
        if (request.getHeightMm() != null) {
            variant.setHeightMm(request.getHeightMm());
        }
        // cost_price on an existing variant is ignored on purpose: the weighted average is
        // written only by StockLedgerService, and a standard cost is set through
        // PUT /commerce/v1/stock/standard-costs. A repeated import therefore cannot write an
        // old average back over a new one.
        if (request.getCostPrice() != null) {
            checkedMoney(request.getCostPrice(), "cost_price");
        }
        if (request.getMediaId() != null) {
            variant.setMediaId(CatalogueRules.mediaId(request.getMediaId()));
        }
        if (request.getPosition() != null) {
            variant.setPosition(request.getPosition());
        }
        String externalRef = trimToNull(request.getExternalRef());
        if (externalRef != null) {
            variant.setExternalRef(externalRef);
        }
        current.variant = variantRepository.save(variant);

        String name = trimToNull(request.getName());
        if (name != null && !name.equals(current.session.getName())) {
            require(name.length() <= 255, "a variant name is at most 255 characters");
            current.session.setName(name);
            current.sessionDirty = true;
        }

        updatePrice(instituteId, actorUserId, current, request);

        if (request.getOptionValues() != null) {
            writeOptionValues(instituteId, current, request.getOptionValues());
        }
    }

    /** A price change is an update of the variant's payment_plan, with an audit row. */
    private void updatePrice(String instituteId, String actorUserId, VariantState current, VariantRequest request) {
        BigDecimal price = checkedMoney(request.getPrice(), "price");
        BigDecimal mrp = checkedMoney(request.getMrp(), "mrp");
        String currency = checkedCurrency(request.getCurrency());
        if (price == null && mrp == null && currency == null) {
            return;
        }
        PaymentPlan plan = current.plan;
        if (plan == null) {
            throw new IllegalStateException(
                    "payment plan missing for variant " + current.variant.getPackageSessionId());
        }
        BigDecimal oldPrice = BigDecimal.valueOf(plan.getActualPrice());
        BigDecimal oldMrp = BigDecimal.valueOf(plan.getElevatedPrice());
        BigDecimal newPrice = price != null ? price : oldPrice;
        BigDecimal newMrp = mrp != null ? mrp : oldMrp.max(newPrice);
        require(newMrp.compareTo(newPrice) >= 0, "mrp cannot be below the price");
        String newCurrency = currency != null ? currency : plan.getCurrency();

        boolean priceChanged = oldPrice.compareTo(newPrice) != 0 || oldMrp.compareTo(newMrp) != 0;
        boolean currencyChanged = !Objects.equals(newCurrency, plan.getCurrency());
        if (!priceChanged && !currencyChanged) {
            return;
        }
        plan.setActualPrice(newPrice.doubleValue());
        plan.setElevatedPrice(newMrp.doubleValue());
        plan.setCurrency(newCurrency);
        current.plan = paymentPlanRepository.save(plan);
        if (currencyChanged) {
            current.link.getEnrollInvite().setCurrency(newCurrency);
            current.inviteDirty = true;
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("sku", current.variant.getSku());
        detail.put("old_price", oldPrice);
        detail.put("new_price", newPrice);
        detail.put("old_mrp", oldMrp);
        detail.put("new_mrp", newMrp);
        detail.put("currency", newCurrency);
        auditService.record(instituteId, actorUserId, "VARIANT_PRICE_CHANGED", ENTITY_VARIANT,
                current.variant.getPackageSessionId(), CatalogueRules.json(detail));
    }

    /**
     * Rows are changed in place. Deleting and re-inserting would break the unique key on
     * (package_session_id, attribute_id), because Hibernate flushes inserts before deletes.
     */
    private void writeOptionValues(String instituteId, VariantState current, Map<String, String> wanted) {
        Set<String> keep = new HashSet<>();
        for (Map.Entry<String, String> entry : wanted.entrySet()) {
            String attributeId = entry.getKey().trim();
            String valueId = entry.getValue().trim();
            keep.add(attributeId);
            CommerceVariantOptionValue row = current.optionRows.get(attributeId);
            if (row == null) {
                row = new CommerceVariantOptionValue();
                row.setInstituteId(instituteId);
                row.setPackageSessionId(current.variant.getPackageSessionId());
                row.setAttributeId(attributeId);
                row.setAttributeValueId(valueId);
                current.optionRows.put(attributeId, variantOptionValueRepository.save(row));
            } else if (!valueId.equals(row.getAttributeValueId())) {
                row.setAttributeValueId(valueId);
                current.optionRows.put(attributeId, variantOptionValueRepository.save(row));
            }
        }
        List<CommerceVariantOptionValue> removed = new ArrayList<>();
        current.optionRows.entrySet().removeIf(entry -> {
            if (keep.contains(entry.getKey())) {
                return false;
            }
            removed.add(entry.getValue());
            return true;
        });
        if (!removed.isEmpty()) {
            variantOptionValueRepository.deleteAll(removed);
        }
    }

    private static String requireSku(String value) {
        String sku = trimToNull(value);
        require(sku != null, "sku is required for a new variant");
        require(sku.length() <= 100, "sku is at most 100 characters");
        return sku;
    }

    private void requireSkuFree(String instituteId, ProductState state, String sku, VariantState self) {
        for (VariantState other : state.variants) {
            require(other == self || !sku.equals(other.variant.getSku()),
                    "two variants of the product have the sku " + sku);
        }
        CommerceVariant taken = variantRepository.findByInstituteIdAndSku(instituteId, sku).orElse(null);
        if (taken != null && (self == null || !taken.getPackageSessionId().equals(self.variant.getPackageSessionId()))) {
            throw new ConflictException("Another variant already uses the sku " + sku);
        }
    }

    private void requireBarcodeFree(String instituteId, ProductState state, String barcode, VariantState self) {
        require(barcode.length() <= 100, "barcode is at most 100 characters");
        for (VariantState other : state.variants) {
            require(other == self || !barcode.equals(other.variant.getBarcode()),
                    "two variants of the product have the barcode " + barcode);
        }
        CommerceVariant taken = variantRepository.findByInstituteIdAndBarcode(instituteId, barcode).orElse(null);
        if (taken != null && (self == null || !taken.getPackageSessionId().equals(self.variant.getPackageSessionId()))) {
            throw new ConflictException("Another variant already uses the barcode " + barcode);
        }
    }

    private static void requireVariantNumbers(VariantRequest request) {
        requireNotNegative(request.getLeadTimeDays(), "lead_time_days");
        requireNotNegative(request.getWeightGrams(), "weight_grams");
        requireNotNegative(request.getLengthMm(), "length_mm");
        requireNotNegative(request.getWidthMm(), "width_mm");
        requireNotNegative(request.getHeightMm(), "height_mm");
        requireNotNegative(request.getPosition(), "position");
    }

    private static BigDecimal checkedMoney(BigDecimal value, String field) {
        if (value == null) {
            return null;
        }
        require(value.signum() >= 0, field + " cannot be negative");
        require(value.stripTrailingZeros().scale() <= 2, field + " has more than two decimal places");
        require(value.precision() - value.scale() <= 10, field + " is too large");
        return value;
    }

    private static String checkedCurrency(String value) {
        String currency = trimToNull(value);
        if (currency == null) {
            return null;
        }
        currency = currency.toUpperCase(Locale.ROOT);
        require(currency.matches("[A-Z]{3}"), "currency must be a three-letter code");
        return currency;
    }

    // ------------------------------------------------------------------- rules

    /**
     * Every variant that is not archived has exactly one value for each option of the product,
     * each value belongs to its attribute, and no two such variants have the same value set.
     * A product with no options can therefore have one such variant only.
     */
    private void requireValidVariantSet(ProductState state, Refs refs) {
        Set<String> optionIds = new TreeSet<>();
        state.options.forEach(o -> optionIds.add(o.getAttributeId()));
        boolean pieceStock = StockMode.PIECE.name().equals(state.product.getStockMode());
        Map<String, String> skuBySignature = new HashMap<>();
        for (VariantState variant : state.variants) {
            String sku = variant.variant.getSku();
            require(!pieceStock || StockPolicy.TRACKED.name().equals(variant.variant.getStockPolicy()),
                    "variant " + sku + " must be TRACKED: the product is sold by piece");
            if (ProductStatus.ARCHIVED.name().equals(variant.variant.getStatus())) {
                continue;
            }
            Map<String, String> values = variant.optionValues();
            require(values.keySet().equals(optionIds),
                    "variant " + sku + " must have exactly one value for each option of the product");
            StringBuilder signature = new StringBuilder();
            for (String attributeId : optionIds) {
                String valueId = values.get(attributeId);
                CommerceAttributeValue value = refs.values.get(valueId);
                require(value != null && attributeId.equals(value.getAttributeId()),
                        "variant " + sku + " has a value that does not belong to its option");
                signature.append(attributeId).append('=').append(valueId).append('|');
            }
            String clash = skuBySignature.put(signature.toString(), sku);
            require(clash == null, "variants " + clash + " and " + sku + " have the same option values");
        }
    }

    /** Publishing needs at least one active variant, and every active variant needs a price. */
    private void requirePublishable(ProductState state) {
        List<VariantState> onSale = state.variants.stream()
                .filter(v -> ProductStatus.ACTIVE.name().equals(v.variant.getStatus()))
                .toList();
        require(!onSale.isEmpty(), "a product needs at least one active variant before it is published");
        for (VariantState variant : onSale) {
            require(variant.plan != null && variant.plan.getActualPrice() > 0,
                    "variant " + variant.variant.getSku() + " needs a price before the product is published");
        }
        requireTaxClassForPublish(state.product);
    }

    /**
     * Publish rule: in tax mode REGULAR an ACTIVE product needs a
     * tax class with a rate in force today. It runs on every save that leaves the product
     * ACTIVE, so an active product cannot drop its tax class either.
     */
    private void requireTaxClassForPublish(CommerceProduct product) {
        taxClassService.requireTaxClassForPublish(product.getInstituteId(), product.getTaxClassId(),
                documentClock.today(product.getInstituteId()));
    }

    /**
     * The legacy rows are ACTIVE only while the product and the variant are both ACTIVE, so a
     * draft or archived product is absent from every legacy list. Rows are saved only when they
     * change: a needless save of package_session would bump its version under a running checkout.
     */
    private void syncLegacyStatuses(ProductState state) {
        boolean productLive = ProductStatus.ACTIVE.name().equals(state.product.getStatus());
        String packageStatus = productLive ? LEGACY_LIVE : LEGACY_HIDDEN;
        if (!packageStatus.equals(state.pkg.getStatus())) {
            state.pkg.setStatus(packageStatus);
            state.pkg = packageRepository.save(state.pkg);
        }
        for (VariantState variant : state.variants) {
            boolean live = productLive && ProductStatus.ACTIVE.name().equals(variant.variant.getStatus());
            String legacyStatus = live ? LEGACY_LIVE : LEGACY_HIDDEN;
            if (!legacyStatus.equals(variant.session.getStatus())) {
                variant.session.setStatus(legacyStatus);
                variant.sessionDirty = true;
            }
            if (variant.sessionDirty) {
                variant.session = packageSessionRepository.save(variant.session);
                variant.sessionDirty = false;
            }
            EnrollInvite invite = variant.link.getEnrollInvite();
            if (!legacyStatus.equals(invite.getStatus())) {
                invite.setStatus(legacyStatus);
                variant.inviteDirty = true;
            }
            if (variant.inviteDirty) {
                enrollInviteRepository.save(invite);
                variant.inviteDirty = false;
            }
            if (!legacyStatus.equals(variant.link.getStatus())) {
                variant.link.setStatus(legacyStatus);
                variant.link = linkRepository.save(variant.link);
            }
        }
    }

    /** Lower-cased name in the locale, the SKUs and the attribute value labels. */
    private void refreshSearchText(ProductState state, Refs refs) {
        Set<String> valueIds = new LinkedHashSet<>();
        state.facets.forEach(f -> valueIds.add(f.getAttributeValueId()));
        state.variants.forEach(v -> valueIds.addAll(v.optionValues().values()));
        for (CommerceProductTranslation translation : state.translations) {
            Set<String> parts = new LinkedHashSet<>();
            parts.add(translation.getName());
            state.variants.forEach(v -> parts.add(v.variant.getSku()));
            for (String valueId : valueIds) {
                CommerceAttributeValue value = refs.values.get(valueId);
                String label = value == null ? null : labelFor(value.getLabelI18n(), translation.getLocale());
                if (label != null) {
                    parts.add(label);
                }
            }
            translation.setSearchText(String.join(" ", parts).toLowerCase(Locale.ROOT));
        }
        state.translations = new ArrayList<>(translationRepository.saveAll(state.translations));
    }

    private static String labelFor(Map<String, String> labels, String locale) {
        if (labels == null || labels.isEmpty()) {
            return null;
        }
        String label = labels.get(locale);
        return label != null ? label : labels.values().iterator().next();
    }

    private static String likePattern(String q) {
        String cleaned = trimToNull(q);
        if (cleaned == null) {
            return null;
        }
        // Wildcards typed by the user are matched as spaces, not as wildcards.
        cleaned = cleaned.toLowerCase(Locale.ROOT).replaceAll("[%_\\\\]", " ").trim();
        return cleaned.isEmpty() ? null : "%" + cleaned + "%";
    }

    // --------------------------------------------------------------- responses

    private ProductResponse toResponse(ProductState state) {
        CommerceProduct product = state.product;
        return ProductResponse.builder()
                .packageId(product.getPackageId())
                .externalRef(product.getExternalRef())
                .slug(product.getSlug())
                .stockMode(product.getStockMode())
                .taxClassId(product.getTaxClassId())
                .brand(product.getBrand())
                .unit(product.getUnit())
                .qtyScale(product.getQtyScale())
                .qtyStep(product.getQtyStep())
                .originLocationId(product.getOriginLocationId())
                .status(product.getStatus())
                .publishedAt(product.getPublishedAt())
                .seoI18n(product.getSeoI18n())
                .translations(state.translations.stream().map(t -> ProductTranslationDTO.builder()
                        .locale(t.getLocale())
                        .name(t.getName())
                        .shortDescription(t.getShortDescription())
                        .descriptionHtml(t.getDescriptionHtml())
                        .contentBlocks(t.getContentBlocks())
                        .build()).toList())
                .optionAttributeIds(state.options.stream().map(CommerceProductOption::getAttributeId).toList())
                .attributeValueIds(state.facets.stream()
                        .map(CommerceProductAttributeValue::getAttributeValueId).toList())
                .collectionIds(state.collections.stream().map(CommerceProductCollection::getCollectionId).toList())
                .variants(state.variants.stream().map(this::toVariantResponse).toList())
                .createdAt(product.getCreatedAt())
                .updatedAt(product.getUpdatedAt())
                .build();
    }

    private VariantResponse toVariantResponse(VariantState state) {
        CommerceVariant variant = state.variant;
        PaymentPlan plan = state.plan;
        return VariantResponse.builder()
                .packageSessionId(variant.getPackageSessionId())
                .packageId(variant.getPackageId())
                .name(state.session.getName())
                .sku(variant.getSku())
                .barcode(variant.getBarcode())
                .labelCode(variant.getLabelCode())
                .stockPolicy(variant.getStockPolicy())
                .leadTimeDays(variant.getLeadTimeDays())
                .weightGrams(variant.getWeightGrams())
                .lengthMm(variant.getLengthMm())
                .widthMm(variant.getWidthMm())
                .heightMm(variant.getHeightMm())
                .costPrice(variant.getCostPrice())
                .mediaId(variant.getMediaId())
                .position(variant.getPosition())
                .status(variant.getStatus())
                .externalRef(variant.getExternalRef())
                .price(plan == null ? null : BigDecimal.valueOf(plan.getActualPrice()))
                .mrp(plan == null ? null : BigDecimal.valueOf(plan.getElevatedPrice()))
                .currency(plan == null ? null : plan.getCurrency())
                .enrollInviteId(state.link.getEnrollInvite().getId())
                .paymentOptionId(state.link.getPaymentOption().getId())
                .paymentPlanId(plan == null ? null : plan.getId())
                .optionValues(state.optionValues())
                .build();
    }

    private ProductSummaryResponse toSummary(CommerceProduct product, Map<String, String> names,
                                             Collection<VariantState> variants) {
        BigDecimal min = null;
        BigDecimal max = null;
        String currency = null;
        for (VariantState variant : variants) {
            if (variant.plan == null || ProductStatus.ARCHIVED.name().equals(variant.variant.getStatus())) {
                continue;
            }
            BigDecimal price = BigDecimal.valueOf(variant.plan.getActualPrice());
            min = min == null ? price : min.min(price);
            max = max == null ? price : max.max(price);
            currency = variant.plan.getCurrency();
        }
        return ProductSummaryResponse.builder()
                .packageId(product.getPackageId())
                .externalRef(product.getExternalRef())
                .slug(product.getSlug())
                .status(product.getStatus())
                .brand(product.getBrand())
                .stockMode(product.getStockMode())
                .taxClassId(product.getTaxClassId())
                .names(names == null ? Map.of() : names)
                .variantCount(variants.size())
                .minPrice(min)
                .maxPrice(max)
                .unit(product.getUnit())
                .qtyScale(product.getQtyScale())
                .qtyStep(product.getQtyStep())
                .currency(currency)
                .updatedAt(product.getUpdatedAt())
                .build();
    }
}
