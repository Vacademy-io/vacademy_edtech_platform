package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.MediaKind;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.ProductStatus;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportSheetWriter;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.AttributeInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.LocationInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.TaxClassInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ValueInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The current catalogue of one institute as a CSV in the import template, so that export,
 * edit, re-import is the bulk edit path.
 *
 * <p>Product columns are written on the first row of a product only; the handle is on every
 * row. Products are read one at a time and written as they are read, so memory does not grow
 * with the catalogue. The file carries no stock and no cost, and every cell is made safe
 * against spreadsheet formulas by {@link ImportSheetWriter}.
 */
@Slf4j
@Service
public class CommerceCatalogueExportService {

    private static final ImportColumn[] OPTION_NAMES =
            {ImportColumn.OPTION1_NAME, ImportColumn.OPTION2_NAME, ImportColumn.OPTION3_NAME};
    private static final ImportColumn[] OPTION_VALUES =
            {ImportColumn.OPTION1_VALUE, ImportColumn.OPTION2_VALUE, ImportColumn.OPTION3_VALUE};
    private static final int CLEAR_EVERY = 50;

    /** What one export call will write, decided before the first byte goes out. */
    public record Selection(String instituteId, ImportReferenceData reference, List<ProductInfo> products,
                            int expectedRows) { }

    private final ImportReferenceLoader referenceLoader;
    private final CommerceProductService productService;
    private final CommerceProductMediaRepository mediaRepository;
    private final CommerceAuditService auditService;

    @PersistenceContext
    private EntityManager entityManager;

    public CommerceCatalogueExportService(ImportReferenceLoader referenceLoader,
                                          CommerceProductService productService,
                                          CommerceProductMediaRepository mediaRepository,
                                          CommerceAuditService auditService) {
        this.referenceLoader = referenceLoader;
        this.productService = productService;
        this.mediaRepository = mediaRepository;
        this.auditService = auditService;
    }

    /**
     * Picks the products: all of the institute, or those with the status, or those named.
     * Ids are matched against the institute's own products, so a foreign id selects nothing.
     * An export over the cap is refused here, while the caller can still be told why.
     */
    public Selection select(String instituteId, String status, List<String> packageIds) {
        String wantedStatus = null;
        if (status != null && !status.isBlank()) {
            try {
                wantedStatus = ProductStatus.valueOf(status.trim().toUpperCase(Locale.ROOT)).name();
            } catch (IllegalArgumentException e) {
                throw new InvalidRequestException("status has an unknown value: " + status.trim());
            }
        }
        Set<String> wantedIds = null;
        if (packageIds != null && !packageIds.isEmpty()) {
            if (packageIds.size() > ImportLimits.MAX_EXPORT_IDS) {
                throw new InvalidRequestException("at most " + ImportLimits.MAX_EXPORT_IDS
                        + " products can be named in one export");
            }
            wantedIds = new HashSet<>(packageIds);
        }
        ImportReferenceData reference = referenceLoader.load(instituteId);
        clearPersistenceContext();
        List<ProductInfo> products = new ArrayList<>();
        int rows = 0;
        for (ProductInfo product : reference.products()) {
            if (wantedStatus != null && !wantedStatus.equals(product.status())) {
                continue;
            }
            if (wantedIds != null && !wantedIds.contains(product.packageId())) {
                continue;
            }
            products.add(product);
            rows += Math.max(1, reference.variantsOf(product.packageId()).size());
        }
        if (rows > ImportLimits.MAX_EXPORT_ROWS) {
            throw new InvalidRequestException("the export would have " + rows + " rows; the limit is "
                    + ImportLimits.MAX_EXPORT_ROWS + ". Export one status at a time");
        }
        products.sort(Comparator.comparing(ProductInfo::slug));
        return new Selection(instituteId, reference, products, rows);
    }

    /** The audit row of an export; written before the file, so an export is never unrecorded. */
    public void audit(Selection selection, String actorUserId, String status) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("products", selection.products().size());
        detail.put("rows", selection.expectedRows());
        if (status != null && !status.isBlank()) {
            detail.put("status", status.trim().toUpperCase(Locale.ROOT));
        }
        auditService.record(selection.instituteId(), actorUserId, "CATALOGUE_EXPORTED", "CATALOGUE", null,
                CommerceImportJobProcessor.json(detail));
    }

    /** Writes the header and the rows; returns the number of data rows. The stream stays open. */
    public int write(Selection selection, OutputStream out) throws IOException {
        try (ImportSheetWriter writer = ImportSheetWriter.csv(out)) {
            int done = 0;
            for (ProductInfo info : selection.products()) {
                if (writer.rowsWritten() >= ImportLimits.MAX_EXPORT_ROWS) {
                    log.warn("commerce export of institute {} stopped at the row cap", selection.instituteId());
                    break;
                }
                ProductResponse product;
                try {
                    product = productService.get(selection.instituteId(), info.packageId());
                } catch (ResourceNotFoundException e) {
                    continue;
                }
                List<String> gallery = new ArrayList<>();
                for (CommerceProductMedia media : mediaRepository
                        .findByInstituteIdAndPackageIdOrderByPositionAsc(selection.instituteId(), info.packageId())) {
                    if (media.getPackageSessionId() == null && MediaKind.IMAGE.name().equals(media.getKind())
                            && !gallery.contains(media.getMediaId())) {
                        gallery.add(media.getMediaId());
                    }
                }
                for (Map<ImportColumn, String> row : rows(product, gallery, selection.reference())) {
                    writer.writeRow(row);
                }
                if (++done % CLEAR_EVERY == 0) {
                    writer.flush();
                    clearPersistenceContext();
                }
            }
            return writer.rowsWritten();
        }
    }

    /** The request keeps one persistence context open; drop what was read so far. Nothing here is pending. */
    private void clearPersistenceContext() {
        if (entityManager != null) {
            entityManager.clear();
        }
    }

    /** The rows of one product: product columns on the first, one row per variant. */
    static List<Map<ImportColumn, String>> rows(ProductResponse product, List<String> galleryMediaIds,
                                                ImportReferenceData reference) {
        Map<ImportColumn, String> head = new EnumMap<>(ImportColumn.class);
        head.put(ImportColumn.HANDLE, product.getSlug());
        put(head, ImportColumn.EXTERNAL_REF, product.getExternalRef());
        if (product.getTranslations() != null) {
            for (ProductTranslationDTO translation : product.getTranslations()) {
                if ("hi".equals(translation.getLocale())) {
                    put(head, ImportColumn.NAME_HI, translation.getName());
                    put(head, ImportColumn.SHORT_DESCRIPTION_HI, translation.getShortDescription());
                    put(head, ImportColumn.DESCRIPTION_HTML_HI, translation.getDescriptionHtml());
                    putBlocks(head, translation);
                } else if ("en".equals(translation.getLocale())) {
                    put(head, ImportColumn.NAME_EN, translation.getName());
                    put(head, ImportColumn.SHORT_DESCRIPTION_EN, translation.getShortDescription());
                    put(head, ImportColumn.DESCRIPTION_HTML_EN, translation.getDescriptionHtml());
                    putBlocks(head, translation);
                }
            }
        }
        put(head, ImportColumn.BRAND, product.getBrand());
        if (product.getCollectionIds() != null) {
            List<String> paths = new ArrayList<>();
            for (String id : product.getCollectionIds()) {
                String path = reference.collectionPath(id);
                if (path != null) {
                    paths.add(path);
                }
            }
            put(head, ImportColumn.COLLECTIONS, String.join("|", paths));
        }
        if (product.getAttributeValueIds() != null) {
            List<String> pairs = new ArrayList<>();
            for (String id : product.getAttributeValueIds()) {
                ValueInfo value = reference.valueById(id);
                AttributeInfo attribute = value == null ? null : reference.attributeById(value.attributeId());
                if (attribute != null) {
                    pairs.add(attribute.code() + "=" + value.code());
                }
            }
            put(head, ImportColumn.ATTRIBUTES, String.join("|", pairs));
        }
        TaxClassInfo tax = reference.taxClassById(product.getTaxClassId());
        if (tax != null) {
            put(head, ImportColumn.TAX_CLASS_CODE, tax.code());
            put(head, ImportColumn.HSN, tax.hsnCode());
        }
        put(head, ImportColumn.STOCK_MODE, product.getStockMode());
        put(head, ImportColumn.UNIT, product.getUnit());
        put(head, ImportColumn.QTY_SCALE, text(product.getQtyScale()));
        put(head, ImportColumn.QTY_STEP, text(product.getQtyStep()));
        LocationInfo origin = reference.locationById(product.getOriginLocationId());
        if (origin != null) {
            put(head, ImportColumn.ORIGIN_LOCATION_CODE, origin.code());
        }
        put(head, ImportColumn.STATUS, product.getStatus());
        put(head, ImportColumn.IMAGE_MEDIA_IDS, String.join("|", galleryMediaIds));

        // The template has three option columns; a product with more keeps its first three here.
        List<String> optionIds = product.getOptionAttributeIds() == null ? List.of() : product.getOptionAttributeIds();
        int options = Math.min(optionIds.size(), OPTION_NAMES.length);
        for (int i = 0; i < options; i++) {
            AttributeInfo attribute = reference.attributeById(optionIds.get(i));
            if (attribute != null) {
                put(head, OPTION_NAMES[i], attribute.code());
            }
        }

        List<Map<ImportColumn, String>> rows = new ArrayList<>();
        List<VariantResponse> variants = product.getVariants() == null ? List.of() : product.getVariants();
        if (variants.isEmpty()) {
            rows.add(head);
            return rows;
        }
        boolean first = true;
        for (VariantResponse variant : variants) {
            Map<ImportColumn, String> row = new EnumMap<>(ImportColumn.class);
            if (first) {
                row.putAll(head);
                first = false;
            } else {
                row.put(ImportColumn.HANDLE, product.getSlug());
            }
            put(row, ImportColumn.VARIANT_EXTERNAL_REF, variant.getExternalRef());
            put(row, ImportColumn.SKU, variant.getSku());
            put(row, ImportColumn.BARCODE, variant.getBarcode());
            put(row, ImportColumn.VARIANT_NAME, variant.getName());
            for (int i = 0; i < options; i++) {
                String valueId = variant.getOptionValues() == null ? null : variant.getOptionValues().get(optionIds.get(i));
                ValueInfo value = reference.valueById(valueId);
                if (value != null) {
                    put(row, OPTION_VALUES[i], value.code());
                }
            }
            // The file carries the price of one unit (a metre), the catalogue that of one base unit.
            put(row, ImportColumn.PRICE, money(perUnit(variant.getPrice(), product.getQtyScale())));
            put(row, ImportColumn.MRP, money(perUnit(variant.getMrp(), product.getQtyScale())));
            put(row, ImportColumn.WEIGHT_GRAMS, text(variant.getWeightGrams()));
            put(row, ImportColumn.LENGTH_MM, text(variant.getLengthMm()));
            put(row, ImportColumn.WIDTH_MM, text(variant.getWidthMm()));
            put(row, ImportColumn.HEIGHT_MM, text(variant.getHeightMm()));
            put(row, ImportColumn.STOCK_POLICY, variant.getStockPolicy());
            put(row, ImportColumn.LEAD_TIME_DAYS, text(variant.getLeadTimeDays()));
            put(row, ImportColumn.VARIANT_STATUS, variant.getStatus());
            put(row, ImportColumn.VARIANT_IMAGE_MEDIA_ID, variant.getMediaId());
            rows.add(row);
        }
        return rows;
    }

    private static void put(Map<ImportColumn, String> row, ImportColumn column, String value) {
        if (value != null && !value.isBlank()) {
            row.put(column, value);
        }
    }

    private static String text(Integer value) {
        return value == null ? null : value.toString();
    }

    /** 1350.0 is written as 1350, 1349.5 as 1349.5: plain digits the import reads back. */
    private static BigDecimal perUnit(BigDecimal perBaseUnit, Integer qtyScale) {
        return perBaseUnit == null || qtyScale == null || qtyScale <= 1 ? perBaseUnit
                : perBaseUnit.multiply(BigDecimal.valueOf(qtyScale));
    }

    /** The content blocks the template has a column for (care, story). */
    private static void putBlocks(Map<ImportColumn, String> head, ProductTranslationDTO translation) {
        if (translation.getContentBlocks() == null) {
            return;
        }
        Map<String, ImportColumn> columns = ImportColumn.blockColumns(translation.getLocale());
        for (Map<String, Object> block : translation.getContentBlocks()) {
            ImportColumn column = block == null ? null : columns.get(String.valueOf(block.get("code")));
            if (column != null && block.get("html") instanceof String html) {
                put(head, column, html);
            }
        }
    }

    private static String money(BigDecimal value) {
        if (value == null) {
            return null;
        }
        BigDecimal plain = value.setScale(2, java.math.RoundingMode.HALF_UP).stripTrailingZeros();
        return (plain.scale() < 0 ? plain.setScale(0) : plain).toPlainString();
    }
}
