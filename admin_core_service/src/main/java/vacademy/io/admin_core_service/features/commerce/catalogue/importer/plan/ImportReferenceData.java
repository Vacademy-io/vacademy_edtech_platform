package vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What one institute already has, read once before a file is planned or the catalogue is
 * exported: tax classes, locations, attributes and values, collections, products and
 * variants. Every row in here belongs to that institute, so a code or id of another
 * institute is simply not found.
 */
public final class ImportReferenceData {

    public record TaxClassInfo(String id, String code, String hsnCode, String status) { }

    public record LocationInfo(String id, String code, boolean source) { }

    public record AttributeInfo(String id, String code) { }

    public record ValueInfo(String id, String attributeId, String code) { }

    public record CollectionInfo(String id, String parentId, String slug) { }

    public record ProductInfo(String packageId, String slug, String externalRef, String taxClassId,
                              String stockMode, String unit, Integer qtyScale, String status,
                              boolean published) { }

    public record VariantInfo(String packageSessionId, String packageId, String sku, String barcode,
                              String externalRef, String stockPolicy, String status) { }

    private final Map<String, TaxClassInfo> taxByCode = new HashMap<>();
    private final Map<String, TaxClassInfo> taxById = new HashMap<>();
    private final Map<String, LocationInfo> locationByCode = new HashMap<>();
    private final Map<String, LocationInfo> locationById = new HashMap<>();
    private final Map<String, AttributeInfo> attributeByCode = new HashMap<>();
    private final Map<String, AttributeInfo> attributeById = new HashMap<>();
    private final Map<String, ValueInfo> valueByAttributeAndCode = new HashMap<>();
    private final Map<String, ValueInfo> valueById = new HashMap<>();
    private final Map<String, CollectionInfo> collectionBySlug = new HashMap<>();
    private final Map<String, CollectionInfo> collectionById = new HashMap<>();
    private final Map<String, ProductInfo> productByExternalRef = new HashMap<>();
    private final Map<String, ProductInfo> productBySlug = new HashMap<>();
    private final List<ProductInfo> products = new ArrayList<>();
    private final Map<String, VariantInfo> variantBySku = new HashMap<>();
    private final Map<String, VariantInfo> variantByBarcode = new HashMap<>();
    private final Map<String, List<VariantInfo>> variantsByPackage = new HashMap<>();
    private boolean taxClassRequiredToPublish;

    // ------------------------------------------------------------------ adders

    public ImportReferenceData addTaxClass(String id, String code, String hsnCode, String status) {
        TaxClassInfo info = new TaxClassInfo(id, code, hsnCode, status);
        taxByCode.put(lower(code), info);
        taxById.put(id, info);
        return this;
    }

    public ImportReferenceData addLocation(String id, String code, boolean source) {
        LocationInfo info = new LocationInfo(id, code, source);
        locationByCode.put(lower(code), info);
        locationById.put(id, info);
        return this;
    }

    public ImportReferenceData addAttribute(String id, String code) {
        AttributeInfo info = new AttributeInfo(id, code);
        attributeByCode.put(lower(code), info);
        attributeById.put(id, info);
        return this;
    }

    public ImportReferenceData addValue(String id, String attributeId, String code) {
        ValueInfo info = new ValueInfo(id, attributeId, code);
        valueByAttributeAndCode.put(attributeId + "\u0000" + lower(code), info);
        valueById.put(id, info);
        return this;
    }

    public ImportReferenceData addCollection(String id, String parentId, String slug) {
        CollectionInfo info = new CollectionInfo(id, parentId, slug);
        collectionBySlug.put(lower(slug), info);
        collectionById.put(id, info);
        return this;
    }

    public ImportReferenceData addProduct(ProductInfo info) {
        products.add(info);
        productBySlug.put(info.slug(), info);
        if (info.externalRef() != null) {
            productByExternalRef.put(info.externalRef(), info);
        }
        return this;
    }

    public ImportReferenceData addVariant(VariantInfo info) {
        if (info.sku() != null) {
            variantBySku.put(info.sku(), info);
        }
        if (info.barcode() != null) {
            variantByBarcode.put(info.barcode(), info);
        }
        variantsByPackage.computeIfAbsent(info.packageId(), k -> new ArrayList<>()).add(info);
        return this;
    }

    /** True in tax mode REGULAR: an ACTIVE product needs a tax class. */
    public ImportReferenceData taxClassRequiredToPublish(boolean required) {
        this.taxClassRequiredToPublish = required;
        return this;
    }

    // ----------------------------------------------------------------- lookups

    public boolean isTaxClassRequiredToPublish() {
        return taxClassRequiredToPublish;
    }

    public TaxClassInfo taxClassByCode(String code) {
        return taxByCode.get(lower(code));
    }

    public TaxClassInfo taxClassById(String id) {
        return id == null ? null : taxById.get(id);
    }

    public LocationInfo locationByCode(String code) {
        return locationByCode.get(lower(code));
    }

    public LocationInfo locationById(String id) {
        return id == null ? null : locationById.get(id);
    }

    public AttributeInfo attributeByCode(String code) {
        return attributeByCode.get(lower(code));
    }

    public AttributeInfo attributeById(String id) {
        return id == null ? null : attributeById.get(id);
    }

    public ValueInfo value(String attributeId, String valueCode) {
        return valueByAttributeAndCode.get(attributeId + "\u0000" + lower(valueCode));
    }

    public ValueInfo valueById(String id) {
        return id == null ? null : valueById.get(id);
    }

    public CollectionInfo collectionBySlug(String slug) {
        return collectionBySlug.get(lower(slug));
    }

    public CollectionInfo collectionById(String id) {
        return id == null ? null : collectionById.get(id);
    }

    /** parent/child by slug, root first; null when the id is unknown. A loop in the tree ends the walk. */
    public String collectionPath(String id) {
        CollectionInfo current = collectionById(id);
        if (current == null) {
            return null;
        }
        List<String> parts = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        while (current != null && seen.add(current.id())) {
            parts.add(0, current.slug());
            current = collectionById(current.parentId());
        }
        return String.join("/", parts);
    }

    public ProductInfo productByExternalRef(String externalRef) {
        return productByExternalRef.get(externalRef);
    }

    public ProductInfo productBySlug(String slug) {
        return productBySlug.get(slug);
    }

    public Collection<ProductInfo> products() {
        return products;
    }

    public VariantInfo variantBySku(String sku) {
        return variantBySku.get(sku);
    }

    public VariantInfo variantByBarcode(String barcode) {
        return variantByBarcode.get(barcode);
    }

    public List<VariantInfo> variantsOf(String packageId) {
        return variantsByPackage.getOrDefault(packageId, List.of());
    }

    private static String lower(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
    }
}
