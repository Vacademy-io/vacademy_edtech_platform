package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
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
 * {@code external_ref = "QA:" + client_request_id}: a repeat of the request updates the same
 * product, never creates a second.
 */
@Service
public class CommerceQuickAddService {

    public static final String EXTERNAL_REF_PREFIX = "QA:";
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
    private final TransactionTemplate transaction;

    public CommerceQuickAddService(CommerceProductService productService, CommerceProductRepository productRepository,
                                   CommerceTaxSettingService taxSettingService, CommerceCounterService counters,
                                   CommerceAuditService auditService, PlatformTransactionManager transactionManager) {
        this.productService = productService;
        this.productRepository = productRepository;
        this.taxSettingService = taxSettingService;
        this.counters = counters;
        this.auditService = auditService;
        this.transaction = new TransactionTemplate(transactionManager);
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
        CommerceProduct earlier = transaction.execute(status -> productRepository
                .findByInstituteIdAndExternalRef(instituteId, externalRef).orElse(null));
        if (sku == null) {
            sku = earlier == null
                    ? counters.nextNumber(instituteId, CommerceCounterService.SCOPE_QUICK_ADD)
                    : skuOf(instituteId, earlier.getPackageId());
        }
        ProductRequest product = new ProductRequest();
        product.setExternalRef(externalRef);
        product.setStockMode(stockMode);
        product.setTaxClassId(taxClassId == null ? null : taxClassId);
        product.setUnit(unit);
        product.setQtyScale(qtyScale);
        product.setQtyStep(1);
        if (earlier == null) {
            product.setStatus(ProductStatus.DRAFT.name());
        }
        List<ProductTranslationDTO> translations = new ArrayList<>();
        names.forEach((locale, value) -> translations.add(ProductTranslationDTO.builder().locale(locale).name(value)
                .build()));
        product.setTranslations(translations);
        product.setVariants(List.of(VariantRequest.builder()
                .externalRef(externalRef)
                .sku(sku)
                .barcode(barcode)
                .stockPolicy(StockPolicy.TRACKED.name())
                .build()));
        String finalSku = sku;
        ProductResponse saved = transaction.execute(status -> {
            ProductResponse response = productService.save(instituteId, actorUserId, product);
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("sku", finalSku);
            audit.put("stock_mode", stockMode);
            audit.put("unit", unit);
            audit.put("repeat", earlier != null);
            auditService.record(instituteId, actorUserId, null, "PRODUCT_QUICK_ADDED", "PRODUCT",
                    response.getPackageId(), null, json(audit), null);
            return response;
        });
        VariantResponse variant = saved.getVariants() == null || saved.getVariants().isEmpty() ? null
                : saved.getVariants().stream().filter(v -> externalRef.equals(v.getExternalRef())).findFirst()
                .orElse(saved.getVariants().get(0));
        return new QuickAddAnswer(saved.getPackageId(), variant == null ? null : variant.getPackageSessionId(),
                variant == null ? finalSku : variant.getSku(), names, saved.getStockMode(), saved.getUnit(),
                saved.getQtyScale(), saved.getStatus(), earlier != null ? Boolean.TRUE : null);
    }

    private String skuOf(String instituteId, String packageId) {
        ProductResponse existing = productService.get(instituteId, packageId);
        return existing.getVariants() == null || existing.getVariants().isEmpty() ? null
                : existing.getVariants().get(0).getSku();
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
