package vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.ProductStatus;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockMode;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.StockPolicy;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.AttributeInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.CollectionInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.LocationInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.TaxClassInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ValueInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.VariantInfo;

import java.math.BigDecimal;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn.*;

/**
 * Groups the rows of a file into products and checks every row against the template rules
 * and against what the institute already has. Pure: it reads nothing and writes nothing, so
 * the validate call and the commit job plan a file in exactly the same way.
 *
 * <p>Rows with the same handle are one product, wherever they stand in the file. The target
 * is the product with the row's external_ref; without one, the product whose slug is the
 * handle; otherwise a new product. Because the lookup is by external_ref or handle, running
 * the same file again finds every product it created and creates nothing.
 */
@Component
public class ImportPlanner {

    private static final Pattern SLUG = Pattern.compile("^[\\p{L}\\p{M}\\p{N}]+(-[\\p{L}\\p{M}\\p{N}]+)*$");
    private static final Pattern MEDIA_ID = Pattern.compile("^[A-Za-z0-9_-]{1,36}$");
    private static final Pattern MONEY = Pattern.compile("^\\d{1,10}(\\.\\d{1,2})?$");
    private static final Pattern WHOLE = Pattern.compile("^\\d{1,9}$");

    private static final ImportColumn[] OPTION_NAMES = {OPTION1_NAME, OPTION2_NAME, OPTION3_NAME};
    private static final ImportColumn[] OPTION_VALUES = {OPTION1_VALUE, OPTION2_VALUE, OPTION3_VALUE};

    /** SKUs, barcodes and external references already seen in the file, with their row. */
    private static final class FileState {
        final Map<String, Integer> skus = new HashMap<>();
        final Map<String, Integer> barcodes = new HashMap<>();
        final Map<String, Integer> externalRefs = new HashMap<>();
    }

    public ImportPlan plan(List<ImportRow> rows, ImportReferenceData ref) {
        Map<String, List<ImportRow>> groups = new LinkedHashMap<>();
        for (ImportRow row : rows) {
            String handle = row.get(HANDLE);
            // A row without a handle belongs to no product; it becomes a plan of its own with an error.
            String key = handle == null ? "\u0000" + row.rowNumber() : handle.toLowerCase(Locale.ROOT);
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(row);
        }
        FileState seen = new FileState();
        List<ProductPlan> plans = new ArrayList<>();
        groups.forEach((key, group) ->
                plans.add(planProduct(key.startsWith("\u0000") ? null : key, group, ref, seen)));
        return new ImportPlan(plans);
    }

    // ----------------------------------------------------------------- product

    private ProductPlan planProduct(String handle, List<ImportRow> rows, ImportReferenceData ref, FileState seen) {
        ProductPlan plan = new ProductPlan(handle, rows);
        ImportRow first = rows.get(0);
        if (handle == null) {
            plan.error(first, HANDLE, "REQUIRED", "handle is required on every row");
            return plan;
        }
        if (handle.length() > 200 || !SLUG.matcher(handle).matches()) {
            plan.error(first, HANDLE, "INVALID", "handle may hold letters, digits and single hyphens only");
        }
        if (rows.size() > ImportLimits.MAX_ROWS_PER_PRODUCT) {
            plan.error(first, HANDLE, "TOO_MANY_ROWS",
                    "one product has at most " + ImportLimits.MAX_ROWS_PER_PRODUCT + " rows");
        }

        Map<ImportColumn, String> p = new EnumMap<>(ImportColumn.class);
        Map<ImportColumn, ImportRow> at = new EnumMap<>(ImportColumn.class);
        for (ImportColumn column : ImportColumn.productColumns()) {
            for (ImportRow row : rows) {
                String value = row.get(column);
                if (value == null) {
                    continue;
                }
                if (!p.containsKey(column)) {
                    p.put(column, value);
                    at.put(column, row);
                } else if (!p.get(column).equals(value)) {
                    plan.error(row, column, "CONFLICT", "differs from row " + at.get(column).rowNumber()
                            + " of the same product; leave it blank or repeat the same text");
                }
            }
        }

        ProductRequest request = new ProductRequest();
        request.setSlug(handle);

        // ---- which product
        ProductInfo existing;
        String externalRef = p.get(EXTERNAL_REF);
        if (externalRef != null) {
            if (externalRef.length() > 255) {
                plan.error(at.get(EXTERNAL_REF), EXTERNAL_REF, "INVALID", "external_ref is at most 255 characters");
            }
            Integer otherRow = seen.externalRefs.putIfAbsent(externalRef, first.rowNumber());
            if (otherRow != null) {
                plan.error(at.get(EXTERNAL_REF), EXTERNAL_REF, "DUPLICATE_EXTERNAL_REF",
                        "the product on row " + otherRow + " has the same external_ref under another handle");
            }
            existing = ref.productByExternalRef(externalRef);
            ProductInfo slugOwner = ref.productBySlug(handle);
            if (slugOwner != null && (existing == null || !slugOwner.packageId().equals(existing.packageId()))) {
                plan.error(first, HANDLE, "HANDLE_TAKEN",
                        "another product already uses this handle; it has a different external_ref or none");
            }
            request.setExternalRef(externalRef);
        } else {
            existing = ref.productBySlug(handle);
        }
        plan.setExistingPackageId(existing == null ? null : existing.packageId());

        // ---- names and descriptions
        List<ProductTranslationDTO> translations = new ArrayList<>();
        addTranslation(plan, p, at, first, "hi", NAME_HI, SHORT_DESCRIPTION_HI, DESCRIPTION_HTML_HI,
                existing != null, translations);
        addTranslation(plan, p, at, first, "en", NAME_EN, SHORT_DESCRIPTION_EN, DESCRIPTION_HTML_EN,
                existing != null, translations);
        if (existing == null) {
            if (p.get(NAME_HI) == null && p.get(NAME_EN) == null) {
                plan.error(first, NAME_HI, "REQUIRED", "a new product needs name_hi or name_en");
            } else if (p.get(NAME_HI) == null) {
                plan.warn(first, NAME_HI, "MISSING_HINDI_NAME", "the product has no Hindi name");
            }
        }
        if (!translations.isEmpty()) {
            request.setTranslations(translations);
        }

        String brand = p.get(BRAND);
        if (brand != null) {
            if (brand.length() > 255) {
                plan.error(at.get(BRAND), BRAND, "INVALID", "brand is at most 255 characters");
            }
            request.setBrand(brand);
        }

        // ---- tax class and HSN
        String taxCode = p.get(TAX_CLASS_CODE);
        TaxClassInfo tax = null;
        boolean taxUnknown = false;
        if (taxCode != null) {
            tax = ref.taxClassByCode(taxCode);
            if (tax == null) {
                taxUnknown = true;
                plan.error(at.get(TAX_CLASS_CODE), TAX_CLASS_CODE, "UNKNOWN_TAX_CLASS",
                        "there is no tax class with the code " + clip(taxCode));
            } else {
                request.setTaxClassId(tax.id());
            }
        } else if (existing != null) {
            tax = ref.taxClassById(existing.taxClassId());
        }
        String hsn = p.get(HSN);
        if (hsn != null && !taxUnknown) {
            if (tax == null) {
                plan.error(at.get(HSN), HSN, "HSN_WITHOUT_TAX_CLASS",
                        "the HSN is stored on the tax class: fill tax_class_code");
            } else if (tax.hsnCode() == null || !tax.hsnCode().trim().equalsIgnoreCase(hsn)) {
                plan.error(at.get(HSN), HSN, "HSN_MISMATCH", "the tax class " + tax.code() + " has the HSN "
                        + (tax.hsnCode() == null ? "(none)" : tax.hsnCode())
                        + "; change the tax class or leave hsn blank");
            }
        }

        // ---- how it is counted (measured goods)
        String stockMode = enumValue(plan, at.get(STOCK_MODE), STOCK_MODE, p.get(STOCK_MODE), StockMode.class);
        String unit = p.get(UNIT) == null ? null : p.get(UNIT).toUpperCase(Locale.ROOT);
        if (unit != null && unit.length() > 32) {
            plan.error(at.get(UNIT), UNIT, "INVALID", "unit is at most 32 characters");
        }
        Integer qtyScale = whole(plan, at.get(QTY_SCALE), QTY_SCALE, p.get(QTY_SCALE), 1);
        Integer qtyStep = whole(plan, at.get(QTY_STEP), QTY_STEP, p.get(QTY_STEP), 1);
        if (existing != null && existing.published()) {
            requireUnchanged(plan, at, STOCK_MODE, stockMode, existing.stockMode());
            requireUnchanged(plan, at, UNIT, unit, existing.unit());
            requireUnchanged(plan, at, QTY_SCALE, qtyScale, existing.qtyScale());
        }
        request.setStockMode(stockMode);
        request.setUnit(unit);
        request.setQtyScale(qtyScale);
        request.setQtyStep(qtyStep);
        int effectiveQtyScale = qtyScale != null ? qtyScale
                : existing != null && existing.qtyScale() != null ? existing.qtyScale() : 1;
        String effectiveStockMode = stockMode != null ? stockMode
                : existing != null ? existing.stockMode() : StockMode.QUANTITY.name();

        String originCode = p.get(ORIGIN_LOCATION_CODE);
        if (originCode != null) {
            LocationInfo origin = ref.locationByCode(originCode);
            if (origin == null) {
                plan.error(at.get(ORIGIN_LOCATION_CODE), ORIGIN_LOCATION_CODE, "UNKNOWN_LOCATION",
                        "there is no location with the code " + clip(originCode));
            } else if (!origin.source()) {
                plan.error(at.get(ORIGIN_LOCATION_CODE), ORIGIN_LOCATION_CODE, "NOT_A_SOURCE",
                        "the location " + origin.code() + " is not marked as a source");
            } else {
                request.setOriginLocationId(origin.id());
            }
        }

        String status = enumValue(plan, at.get(STATUS), STATUS, p.get(STATUS), ProductStatus.class);
        request.setStatus(status);
        String effectiveStatus = status != null ? status
                : existing != null ? existing.status() : ProductStatus.DRAFT.name();
        boolean active = ProductStatus.ACTIVE.name().equals(effectiveStatus);

        if (p.get(COLLECTIONS) != null) {
            request.setCollectionIds(collectionIds(plan, at.get(COLLECTIONS), p.get(COLLECTIONS), ref));
        }
        if (p.get(ATTRIBUTES) != null) {
            request.setAttributeValueIds(attributeValueIds(plan, at.get(ATTRIBUTES), p.get(ATTRIBUTES), ref));
        }

        // ---- options
        AttributeInfo[] optionAttributes = new AttributeInfo[OPTION_NAMES.length];
        boolean[] named = new boolean[OPTION_NAMES.length];
        int optionCount = 0;
        boolean gap = false;
        List<String> optionIds = new ArrayList<>();
        for (int i = 0; i < OPTION_NAMES.length; i++) {
            String code = p.get(OPTION_NAMES[i]);
            if (code == null) {
                gap = true;
                continue;
            }
            ImportRow row = at.get(OPTION_NAMES[i]);
            if (gap) {
                plan.error(row, OPTION_NAMES[i], "INVALID", "fill the option columns in order, option1 first");
                continue;
            }
            named[i] = true;
            optionCount++;
            AttributeInfo attribute = ref.attributeByCode(code);
            if (attribute == null) {
                plan.error(row, OPTION_NAMES[i], "UNKNOWN_ATTRIBUTE", "there is no attribute with the code " + clip(code));
            } else if (optionIds.contains(attribute.id())) {
                plan.error(row, OPTION_NAMES[i], "INVALID", "the attribute " + attribute.code() + " is named twice");
            } else {
                optionAttributes[i] = attribute;
                optionIds.add(attribute.id());
            }
        }
        if (optionCount > 0) {
            request.setOptionAttributeIds(optionIds);
        }

        // ---- variants
        List<VariantInfo> existingVariants = existing == null ? List.of() : ref.variantsOf(existing.packageId());
        List<VariantRequest> variants = new ArrayList<>();
        Set<String> matchedIds = new HashSet<>();
        Set<String> variantRefs = new HashSet<>();
        Map<String, Integer> signatures = new HashMap<>();
        int openWithoutOptions = 0;
        ImportRow secondOpenRow = null;
        int created = 0;
        int updated = 0;
        boolean anyActiveVariant = false;
        for (ImportRow row : rows) {
            if (!row.hasVariantCells()) {
                continue;
            }
            VariantRequest variant = new VariantRequest();
            String sku = row.get(SKU);
            if (sku == null) {
                plan.error(row, SKU, "REQUIRED", "sku is required on a variant row");
            } else {
                if (sku.length() > 100) {
                    plan.error(row, SKU, "INVALID", "sku is at most 100 characters");
                }
                Integer otherRow = seen.skus.putIfAbsent(sku, row.rowNumber());
                if (otherRow != null) {
                    plan.error(row, SKU, "DUPLICATE_SKU", "row " + otherRow + " has the same sku");
                }
            }
            String variantRef = row.get(VARIANT_EXTERNAL_REF);
            if (variantRef != null) {
                if (variantRef.length() > 255) {
                    plan.error(row, VARIANT_EXTERNAL_REF, "INVALID", "variant_external_ref is at most 255 characters");
                }
                if (!variantRefs.add(variantRef)) {
                    plan.error(row, VARIANT_EXTERNAL_REF, "DUPLICATE_EXTERNAL_REF",
                            "two rows of the product have the same variant_external_ref");
                }
            }

            VariantInfo matched = null;
            if (variantRef != null) {
                matched = existingVariants.stream()
                        .filter(v -> variantRef.equals(v.externalRef())).findFirst().orElse(null);
            }
            if (matched == null && sku != null) {
                matched = existingVariants.stream().filter(v -> sku.equals(v.sku())).findFirst().orElse(null);
            }
            if (matched != null && !matchedIds.add(matched.packageSessionId())) {
                plan.error(row, SKU, "DUPLICATE_VARIANT", "two rows name the same variant of the product");
            }
            if (sku != null) {
                VariantInfo owner = ref.variantBySku(sku);
                if (owner != null
                        && (matched == null || !owner.packageSessionId().equals(matched.packageSessionId()))) {
                    plan.error(row, SKU, "DUPLICATE_SKU", "another variant in the shop already uses this sku");
                }
            }
            String barcode = row.get(BARCODE);
            if (barcode != null) {
                if (barcode.length() > 100) {
                    plan.error(row, BARCODE, "INVALID", "barcode is at most 100 characters");
                }
                Integer otherRow = seen.barcodes.putIfAbsent(barcode, row.rowNumber());
                if (otherRow != null) {
                    plan.error(row, BARCODE, "DUPLICATE_BARCODE", "row " + otherRow + " has the same barcode");
                }
                VariantInfo owner = ref.variantByBarcode(barcode);
                if (owner != null
                        && (matched == null || !owner.packageSessionId().equals(matched.packageSessionId()))) {
                    plan.error(row, BARCODE, "DUPLICATE_BARCODE",
                            "another variant in the shop already uses this barcode");
                }
            }
            String name = row.get(VARIANT_NAME);
            if (name != null && name.length() > 255) {
                plan.error(row, VARIANT_NAME, "INVALID", "variant_name is at most 255 characters");
            }

            BigDecimal price = perBaseUnit(plan, row, PRICE, money(plan, row, PRICE), effectiveQtyScale);
            BigDecimal mrp = perBaseUnit(plan, row, MRP, money(plan, row, MRP), effectiveQtyScale);
            if (price != null && mrp != null && mrp.compareTo(price) < 0) {
                plan.error(row, MRP, "MRP_BELOW_PRICE", "mrp cannot be below the price");
            }

            String policy = enumValue(plan, row, STOCK_POLICY, row.get(STOCK_POLICY), StockPolicy.class);
            if (matched != null && policy != null && !policy.equals(matched.stockPolicy())) {
                plan.error(row, STOCK_POLICY, "POLICY_LOCKED",
                        "stock_policy of an existing variant cannot be changed by an import");
            }
            String effectivePolicy = policy != null ? policy
                    : matched != null ? matched.stockPolicy() : StockPolicy.TRACKED.name();
            if (StockMode.PIECE.name().equals(effectiveStockMode)
                    && !StockPolicy.TRACKED.name().equals(effectivePolicy)) {
                plan.error(row, STOCK_POLICY, "INVALID", "a product sold by piece needs TRACKED variants");
            }

            String variantStatus = enumValue(plan, row, VARIANT_STATUS, row.get(VARIANT_STATUS), ProductStatus.class);
            String effectiveVariantStatus = variantStatus != null ? variantStatus
                    : matched != null ? matched.status() : ProductStatus.ACTIVE.name();
            boolean archived = ProductStatus.ARCHIVED.name().equals(effectiveVariantStatus);
            boolean variantActive = ProductStatus.ACTIVE.name().equals(effectiveVariantStatus);
            anyActiveVariant |= variantActive;

            boolean unpriced = matched == null
                    ? (price == null || price.signum() == 0)
                    : (price != null && price.signum() == 0);
            // An unreadable price cell already has its own error.
            boolean priceCellReadable = row.get(PRICE) == null || price != null;
            if (unpriced && priceCellReadable) {
                if (active && variantActive) {
                    plan.error(row, PRICE, "PRICE_REQUIRED", "an ACTIVE product needs a price above zero on every active variant");
                } else if (matched == null) {
                    plan.warn(row, PRICE, "NO_PRICE", "the variant has no price; the product cannot be published until it has one");
                }
            }

            String mediaId = row.get(VARIANT_IMAGE_MEDIA_ID);
            if (mediaId != null && !MEDIA_ID.matcher(mediaId).matches()) {
                plan.error(row, VARIANT_IMAGE_MEDIA_ID, "INVALID", "variant_image_media_id is not a media-library file id");
            }

            Map<String, String> optionValues = new LinkedHashMap<>();
            for (int i = 0; i < OPTION_VALUES.length; i++) {
                String value = row.get(OPTION_VALUES[i]);
                if (!named[i]) {
                    if (value != null) {
                        plan.error(row, OPTION_VALUES[i], "OPTION_WITHOUT_NAME",
                                "fill " + OPTION_NAMES[i].header() + " on the first row of the product");
                    }
                    continue;
                }
                if (value == null) {
                    if (!archived) {
                        plan.error(row, OPTION_VALUES[i], "REQUIRED",
                                "every variant needs a value for each option of the product");
                    }
                    continue;
                }
                AttributeInfo attribute = optionAttributes[i];
                if (attribute == null) {
                    continue;
                }
                ValueInfo info = ref.value(attribute.id(), value);
                if (info == null) {
                    plan.error(row, OPTION_VALUES[i], "UNKNOWN_ATTRIBUTE_VALUE",
                            "the attribute " + attribute.code() + " has no value with the code " + clip(value));
                } else {
                    optionValues.put(attribute.id(), info.id());
                }
            }
            if (optionCount > 0) {
                variant.setOptionValues(optionValues);
                if (!archived && optionValues.size() == optionCount) {
                    Integer otherRow = signatures.putIfAbsent(optionValues.toString(), row.rowNumber());
                    if (otherRow != null) {
                        plan.error(row, OPTION1_VALUE, "DUPLICATE_OPTION_VALUES",
                                "row " + otherRow + " has the same option values");
                    }
                }
            } else if (!archived) {
                openWithoutOptions++;
                if (openWithoutOptions == 2) {
                    secondOpenRow = row;
                }
            }

            variant.setPackageSessionId(matched == null ? null : matched.packageSessionId());
            variant.setExternalRef(variantRef);
            variant.setSku(sku);
            variant.setBarcode(barcode);
            variant.setName(name);
            variant.setPrice(price);
            variant.setMrp(mrp);
            variant.setStockPolicy(policy);
            variant.setStatus(variantStatus);
            variant.setWeightGrams(whole(plan, row, WEIGHT_GRAMS, row.get(WEIGHT_GRAMS), 0));
            variant.setLengthMm(whole(plan, row, LENGTH_MM, row.get(LENGTH_MM), 0));
            variant.setWidthMm(whole(plan, row, WIDTH_MM, row.get(WIDTH_MM), 0));
            variant.setHeightMm(whole(plan, row, HEIGHT_MM, row.get(HEIGHT_MM), 0));
            variant.setLeadTimeDays(whole(plan, row, LEAD_TIME_DAYS, row.get(LEAD_TIME_DAYS), 0));
            variant.setMediaId(mediaId);
            variants.add(variant);
            if (matched == null) {
                created++;
            } else {
                updated++;
            }
        }
        if (existing == null && secondOpenRow != null) {
            plan.error(secondOpenRow, OPTION1_VALUE, "OPTIONS_REQUIRED",
                    "a product with several variants needs option1_name and a value on every row");
        }
        plan.setVariantsToCreate(created);
        plan.setVariantsToUpdate(updated);

        // ---- publish rules the service would refuse at commit
        if (active) {
            if (ref.isTaxClassRequiredToPublish() && tax == null && !taxUnknown) {
                plan.error(at.getOrDefault(STATUS, first), TAX_CLASS_CODE, "MISSING_TAX_CLASS",
                        "an ACTIVE product needs a tax class");
            }
            if (existing == null && !anyActiveVariant) {
                plan.error(at.getOrDefault(STATUS, first), STATUS, "NO_ACTIVE_VARIANT",
                        "an ACTIVE product needs at least one active variant row");
            }
        }

        // ---- images
        String mediaIds = p.get(IMAGE_MEDIA_IDS);
        if (mediaIds != null) {
            for (String id : mediaIds.split("\\|")) {
                String mediaId = id.trim();
                if (mediaId.isEmpty() || plan.getGalleryMediaIds().contains(mediaId)) {
                    continue;
                }
                if (!MEDIA_ID.matcher(mediaId).matches()) {
                    plan.error(at.get(IMAGE_MEDIA_IDS), IMAGE_MEDIA_IDS, "INVALID",
                            clip(mediaId) + " is not a media-library file id");
                } else {
                    plan.getGalleryMediaIds().add(mediaId);
                }
            }
        }
        String urls = p.get(IMAGE_URLS);
        if (urls != null) {
            for (String url : urls.split("[|\\s]+")) {
                if (url.isEmpty() || plan.getImageUrls().contains(url)) {
                    continue;
                }
                if (!isAcceptableImageUrl(url)) {
                    plan.error(at.get(IMAGE_URLS), IMAGE_URLS, "INVALID",
                            clip(url) + " is not an http or https address");
                } else {
                    plan.getImageUrls().add(url);
                }
            }
            if (!plan.getImageUrls().isEmpty()) {
                plan.warn(at.get(IMAGE_URLS), IMAGE_URLS, "IMAGE_URLS_QUEUED", plan.getImageUrls().size()
                        + " image URL(s) are queued for the migration tool; the import does not download them");
            }
        }
        if (plan.getGalleryMediaIds().size() + plan.getImageUrls().size() > ImportLimits.MAX_IMAGES_PER_PRODUCT) {
            plan.error(first, IMAGE_MEDIA_IDS, "TOO_MANY_IMAGES",
                    "one product has at most " + ImportLimits.MAX_IMAGES_PER_PRODUCT + " images in the file");
        }
        if (existing == null && plan.getGalleryMediaIds().isEmpty() && plan.getImageUrls().isEmpty()) {
            plan.warn(first, IMAGE_MEDIA_IDS, "NO_LEAD_PHOTO", "the product has no photo");
        }

        if (!plan.hasErrors()) {
            request.setVariants(variants.isEmpty() ? null : variants);
            plan.setRequest(request);
        }
        return plan;
    }

    private static void addTranslation(ProductPlan plan, Map<ImportColumn, String> p, Map<ImportColumn, ImportRow> at,
                                       ImportRow first, String locale, ImportColumn nameColumn,
                                       ImportColumn shortColumn, ImportColumn descriptionColumn, boolean update,
                                       List<ProductTranslationDTO> out) {
        String name = p.get(nameColumn);
        String shortDescription = p.get(shortColumn);
        String description = p.get(descriptionColumn);
        // The content blocks the template carries (care, story). Only filled cells are sent;
        // the writer merges them into the stored blocks by code.
        List<Map<String, Object>> blocks = new ArrayList<>();
        for (Map.Entry<String, ImportColumn> block : ImportColumn.blockColumns(locale).entrySet()) {
            String html = p.get(block.getValue());
            if (html != null) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("code", block.getKey());
                entry.put("html", html);
                blocks.add(entry);
            }
        }
        if (name == null && shortDescription == null && description == null && blocks.isEmpty()) {
            return;
        }
        if (name == null && !update) {
            // On an update the stored name is kept; a new product has none to keep.
            plan.error(first, nameColumn, "REQUIRED",
                    nameColumn.header() + " is required when a description in that language is filled");
        }
        if (name != null && name.length() > 255) {
            plan.error(at.get(nameColumn), nameColumn, "INVALID", "a product name is at most 255 characters");
        }
        out.add(ProductTranslationDTO.builder()
                .locale(locale)
                .name(name)
                .shortDescription(shortDescription)
                .descriptionHtml(description)
                .contentBlocks(blocks.isEmpty() ? null : blocks)
                .build());
    }

    /**
     * The file gives a price per unit (a metre of cloth); the catalogue stores the price of
     * one base unit (a tenth of a metre at scale 10). The price must divide to the paisa.
     */
    private static BigDecimal perBaseUnit(ProductPlan plan, ImportRow row, ImportColumn column, BigDecimal perUnit,
                                          int scale) {
        if (perUnit == null || scale <= 1) {
            return perUnit;
        }
        try {
            return perUnit.divide(BigDecimal.valueOf(scale)).setScale(2, java.math.RoundingMode.UNNECESSARY);
        } catch (ArithmeticException e) {
            plan.error(row, column, "PRICE_NOT_DIVISIBLE", column.header() + " is for one unit and qty_scale is "
                    + scale + ": it must divide into " + scale + " equal parts to the paisa (for example "
                    + BigDecimal.valueOf(scale).multiply(new BigDecimal("0.50")).stripTrailingZeros().toPlainString()
                    + " steps)");
            return null;
        }
    }

    // ------------------------------------------------------------------ fields

    private static void requireUnchanged(ProductPlan plan, Map<ImportColumn, ImportRow> at, ImportColumn column,
                                         Object wanted, Object stored) {
        if (wanted != null && !wanted.equals(stored)) {
            plan.error(at.get(column), column, "MEASURE_LOCKED",
                    column.header() + " cannot change after the product has been published");
        }
    }

    private static <E extends Enum<E>> String enumValue(ProductPlan plan, ImportRow row, ImportColumn column,
                                                        String raw, Class<E> type) {
        if (raw == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, raw.toUpperCase(Locale.ROOT)).name();
        } catch (IllegalArgumentException e) {
            plan.error(row, column, "INVALID", column.header() + " must be one of "
                    + Arrays.toString(type.getEnumConstants()).replaceAll("[\\[\\]]", ""));
            return null;
        }
    }

    private static Integer whole(ProductPlan plan, ImportRow row, ImportColumn column, String raw, int min) {
        if (raw == null) {
            return null;
        }
        if (!WHOLE.matcher(raw).matches() || Integer.parseInt(raw) < min) {
            plan.error(row, column, "INVALID", column.header() + " must be a whole number"
                    + (min > 0 ? " of " + min + " or more" : ", zero or more"));
            return null;
        }
        return Integer.parseInt(raw);
    }

    private static BigDecimal money(ProductPlan plan, ImportRow row, ImportColumn column) {
        String raw = row.get(column);
        if (raw == null) {
            return null;
        }
        if (!MONEY.matcher(raw).matches()) {
            plan.error(row, column, "INVALID", column.header()
                    + " must be a plain amount with at most two decimals, for example 1350 or 1349.50");
            return null;
        }
        return new BigDecimal(raw);
    }

    private static List<String> collectionIds(ProductPlan plan, ImportRow row, String raw, ImportReferenceData ref) {
        List<String> ids = new ArrayList<>();
        for (String path : raw.split("\\|")) {
            List<String> parts = Arrays.stream(path.split("[/>]")).map(String::trim)
                    .filter(s -> !s.isEmpty()).toList();
            if (parts.isEmpty()) {
                continue;
            }
            CollectionInfo leaf = ref.collectionBySlug(parts.get(parts.size() - 1));
            boolean found = leaf != null;
            CollectionInfo current = leaf;
            for (int i = parts.size() - 2; found && i >= 0; i--) {
                CollectionInfo parent = ref.collectionById(current.parentId());
                found = parent != null && parent.slug().equalsIgnoreCase(parts.get(i));
                current = parent;
            }
            if (!found) {
                plan.error(row, COLLECTIONS, "UNKNOWN_COLLECTION", "there is no collection " + clip(path.trim())
                        + "; create it first or correct the path (slugs, parent/child)");
            } else if (!ids.contains(leaf.id())) {
                ids.add(leaf.id());
            }
        }
        return ids;
    }

    private static List<String> attributeValueIds(ProductPlan plan, ImportRow row, String raw,
                                                  ImportReferenceData ref) {
        List<String> ids = new ArrayList<>();
        for (String pair : raw.split("\\|")) {
            String text = pair.trim();
            if (text.isEmpty()) {
                continue;
            }
            int cut = text.indexOf('=');
            if (cut < 0) {
                cut = text.indexOf(':');
            }
            if (cut <= 0 || cut == text.length() - 1) {
                plan.error(row, ATTRIBUTES, "INVALID", clip(text) + " is not attribute_code=value_code");
                continue;
            }
            String code = text.substring(0, cut).trim();
            String valueCode = text.substring(cut + 1).trim();
            AttributeInfo attribute = ref.attributeByCode(code);
            if (attribute == null) {
                plan.error(row, ATTRIBUTES, "UNKNOWN_ATTRIBUTE", "there is no attribute with the code " + clip(code));
                continue;
            }
            ValueInfo value = ref.value(attribute.id(), valueCode);
            if (value == null) {
                plan.error(row, ATTRIBUTES, "UNKNOWN_ATTRIBUTE_VALUE",
                        "the attribute " + attribute.code() + " has no value with the code " + clip(valueCode));
            } else if (!ids.contains(value.id())) {
                ids.add(value.id());
            }
        }
        return ids;
    }

    /**
     * Shape only. The address is stored for the migration tool and is never opened by this
     * service, so no host check is needed here; the tool has its own allow-list.
     */
    static boolean isAcceptableImageUrl(String url) {
        if (url.length() > 2000) {
            return false;
        }
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            return scheme != null
                    && (scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))
                    && uri.getHost() != null
                    && uri.getUserInfo() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /** Text from the file inside a message, cut so one bad cell cannot bloat the response. */
    private static String clip(String value) {
        return value.length() > 60 ? value.substring(0, 60) + "..." : value;
    }
}
