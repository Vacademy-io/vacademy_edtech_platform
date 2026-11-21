package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.ProductStatus;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * "Quick add item" on the Receive screen (WP-41): stock staff create a DRAFT product with one
 * TRACKED variant and no price, through {@link CommerceProductService#save}, so the goods in hand
 * can be received. A manager sets the price before it is labelled or sold. The product carries
 * {@code external_ref = "QA:" + client_request_id}. The request runs once under
 * {@link CommerceRequestGuard}: a repeat with the same body answers the stored product and changes
 * nothing (a manager may have priced, described or published it since); the same key with another
 * body is refused with 409 {@code IDEMPOTENCY_MISMATCH}.
 */
@Service
public class CommerceQuickAddService {

    public static final String EXTERNAL_REF_PREFIX = "QA:";
    public static final String ACTION_QUICK_ADD = "PRODUCT_QUICK_ADD";
    static final int MAX_NAME = 120;
    private static final Pattern SKU = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private static final Pattern UNIT = Pattern.compile("^[A-Z]{1,32}$");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record QuickAddRequest(String clientRequestId, Map<String, String> name, String taxClassId, String unit,
                                  String stockMode, Integer qtyScale, String sku, String barcode) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record QuickAddAnswer(String productId, String packageSessionId, String sku, Map<String, String> name,
                                 String stockMode, String unit, Integer qtyScale, String status, Boolean replayed) {
    }

    private final CommerceProductService productService;
    private final CommerceProductRepository productRepository;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceCounterService counters;
    private final CommerceAuditService auditService;
    private final CommerceRequestGuard requestGuard;

    public CommerceQuickAddService(CommerceProductService productService, CommerceProductRepository productRepository,
                                   CommerceTaxSettingService taxSettingService, CommerceCounterService counters,
                                   CommerceAuditService auditService, CommerceRequestGuard requestGuard) {
        this.productService = productService;
        this.productRepository = productRepository;
        this.taxSettingService = taxSettingService;
        this.counters = counters;
        this.auditService = auditService;
        this.requestGuard = requestGuard;
    }

    public QuickAddAnswer quickAdd(String instituteId, String actorUserId, QuickAddRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        String key = CommerceRequestGuard.requireClientKey(request.clientRequestId());
        Map<String, String> names = new LinkedHashMap<>();
        Map<String, String> given = request.name() == null ? Map.of() : request.name();
        for (String locale : List.of("en", "hi")) {
            String value = trim(given.get(locale));
            if (value != null) {
                if (value.length() > MAX_NAME) {
                    throw new InvalidRequestException("VALIDATION: a name is at most " + MAX_NAME + " characters");
                }
                names.put(locale, value);
            }
        }
        if (names.isEmpty()) {
            throw new InvalidRequestException("VALIDATION: give the item a name in Hindi or English");
        }
        String taxClassId = trim(request.taxClassId());
        if (taxClassId == null && taxSettingService.context(instituteId).getMode() == TaxMode.REGULAR) {
            throw new InvalidRequestException("VALIDATION: choose a tax class");
        }
        String unit = trim(request.unit()) == null ? "PCS" : request.unit().trim().toUpperCase(Locale.ROOT);
        if (!UNIT.matcher(unit).matches()) {
            throw new InvalidRequestException("VALIDATION: unit is a unit code such as PCS or MTR");
        }
        String stockMode = trim(request.stockMode()) == null ? StockMode.QUANTITY.name()
                : request.stockMode().trim().toUpperCase(Locale.ROOT);
        if (!StockMode.QUANTITY.name().equals(stockMode) && !StockMode.PIECE.name().equals(stockMode)) {
            throw new InvalidRequestException("VALIDATION: stock_mode is QUANTITY or PIECE");
        }
        int qtyScale = request.qtyScale() == null ? 1 : request.qtyScale();
        if (qtyScale != 1 && !(qtyScale == 10 && "MTR".equals(unit) && StockMode.QUANTITY.name().equals(stockMode))) {
            throw new InvalidRequestException("VALIDATION: qty_scale is 1, or 10 for an item sold by the metre");
        }
        String sku = trim(request.sku());
        if (sku != null && !SKU.matcher(sku).matches()) {
            throw new InvalidRequestException("VALIDATION: sku is up to 64 letters, digits, - or _");
        }
        String barcode = trim(request.barcode());
        if (barcode != null && barcode.length() > 100) {
            throw new InvalidRequestException("VALIDATION: barcode is at most 100 characters");
        }
        String externalRef = EXTERNAL_REF_PREFIX + key;
        CommerceRequestGuard.Key guardKey = new CommerceRequestGuard.Key(instituteId, key, ACTION_QUICK_ADD, "PRODUCT",
                null, CommerceRequestGuard.hash(ACTION_QUICK_ADD, request), actorUserId);
        String givenSku = sku;
        CommerceRequestGuard.Outcome<QuickAddAnswer> outcome = requestGuard.run(guardKey, () -> {
            // A product made under this key before the guard row existed is answered, never rewritten.
            CommerceProduct earlier = productRepository.findByInstituteIdAndExternalRef(instituteId, externalRef)
                    .orElse(null);
            if (earlier != null) {
                return stored(instituteId, earlier.getPackageId(), externalRef, names);
            }
            String finalSku = givenSku != null ? givenSku
                    : counters.nextNumber(instituteId, CommerceCounterService.SCOPE_QUICK_ADD);
            ProductRequest product = new ProductRequest();
            product.setExternalRef(externalRef);
            product.setStockMode(stockMode);
            product.setTaxClassId(taxClassId);
            product.setUnit(unit);
            product.setQtyScale(qtyScale);
            product.setQtyStep(1);
            product.setStatus(ProductStatus.DRAFT.name());
            List<ProductTranslationDTO> translations = new ArrayList<>();
            names.forEach((locale, value) -> translations.add(ProductTranslationDTO.builder().locale(locale)
                    .name(value).build()));
            product.setTranslations(translations);
            product.setVariants(List.of(VariantRequest.builder()
                    .externalRef(externalRef)
                    .sku(finalSku)
                    .barcode(barcode)
                    .stockPolicy(StockPolicy.TRACKED.name())
                    .build()));
            ProductResponse saved = productService.save(instituteId, actorUserId, product);
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("sku", finalSku);
            audit.put("stock_mode", stockMode);
            audit.put("unit", unit);
            auditService.record(instituteId, actorUserId, null, "PRODUCT_QUICK_ADDED", "PRODUCT",
                    saved.getPackageId(), null, json(audit), null);
            return answer(saved, externalRef, names, finalSku, null);
        }, () -> productRepository.findByInstituteIdAndExternalRef(instituteId, externalRef)
                .map(found -> stored(instituteId, found.getPackageId(), externalRef, names))
                .orElseThrow(() -> new IllegalStateException("quick add " + key + " finished without a product")));
        return outcome.replayed() ? withReplayed(outcome.value()) : outcome.value();
    }

    /** The product a quick add made, as it is now; nothing is written. */
    private QuickAddAnswer stored(String instituteId, String packageId, String externalRef, Map<String, String> names) {
        return withReplayed(answer(productService.get(instituteId, packageId), externalRef, names, null, null));
    }

    private static QuickAddAnswer answer(ProductResponse product, String externalRef, Map<String, String> names,
                                         String sku, Boolean replayed) {
        VariantResponse variant = product.getVariants() == null || product.getVariants().isEmpty() ? null
                : product.getVariants().stream().filter(v -> externalRef.equals(v.getExternalRef())).findFirst()
                .orElse(product.getVariants().get(0));
        return new QuickAddAnswer(product.getPackageId(), variant == null ? null : variant.getPackageSessionId(),
                variant == null ? sku : variant.getSku(), names, product.getStockMode(), product.getUnit(),
                product.getQtyScale(), product.getStatus(), replayed);
    }

    private static QuickAddAnswer withReplayed(QuickAddAnswer a) {
        return new QuickAddAnswer(a.productId(), a.packageSessionId(), a.sku(), a.name(), a.stockMode(), a.unit(),
                a.qtyScale(), a.status(), Boolean.TRUE);
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not write a quick add as JSON", e);
        }
    }
}
