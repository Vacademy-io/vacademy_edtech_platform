package vacademy.io.admin_core_service.features.commerce.storefront.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Everything the public shop routes read for one institute: its ACTIVE products with their
 * ACTIVE variants, the attributes, and the ACTIVE collections. Loaded in one pass and cached for
 * a short time, like the course snapshot of the Catalogue API. It is an internal model and is
 * never serialised: the public views are built from it field by field
 * ({@code StorefrontDtos}), and cost columns are not even loaded.
 */
public record StorefrontSnapshot(String instituteId, StorefrontSettings settings, List<Product> products,
                                 Map<String, Product> bySlug, Map<String, Attribute> attributes,
                                 Map<String, AttributeValue> attributeValues, List<Collection> collections,
                                 Instant loadedAt) {

    /** Product text in one language. */
    public record Translation(String locale, String name, String shortDescription, String descriptionHtml,
                              List<Map<String, Object>> contentBlocks) {
    }

    /**
     * One sellable variant. {@code availableSlots} is what can still be sold online (holds
     * taken off); null for an UNTRACKED variant. {@code price} and {@code mrp} are for one base
     * unit; a price of null or zero means the variant has no price and cannot be bought.
     */
    public record Variant(String packageSessionId, String sku, String legacyName, boolean tracked,
                          Integer leadTimeDays, Integer weightGrams, Integer lengthMm, Integer widthMm,
                          Integer heightMm, String mediaId, int position, Integer availableSlots,
                          BigDecimal price, BigDecimal mrp, String currency,
                          Map<String, String> optionValueIds) {

        public boolean hasPrice() {
            return price != null && price.signum() > 0;
        }
    }

    public record Media(String packageSessionId, String mediaId, String kind, String tag,
                        Map<String, String> altI18n, Integer width, Integer height,
                        Map<String, Object> renditions, int position) {
    }

    public record Product(String packageId, String slug, boolean piece, String taxClassId, String brand,
                          String unit, int qtyScale, int qtyStep, String originName, Instant publishedAt,
                          Instant updatedAt, Map<String, Object> seoI18n, Map<String, Translation> translations,
                          List<Variant> variants, List<Media> media, Set<String> attributeValueIds,
                          List<String> optionAttributeIds, Map<String, Integer> collectionPositions,
                          String searchText) {
    }

    public record Attribute(String id, String code, Map<String, String> nameI18n, String kind, boolean filterable,
                            int position) {
    }

    public record AttributeValue(String id, String attributeId, String code, Map<String, String> labelI18n,
                                 String swatchHex, int position) {
    }

    public record Collection(String id, String parentId, String kind, String slug, Map<String, String> nameI18n,
                             Map<String, String> descriptionI18n, String mediaId, int position, Instant updatedAt) {
    }
}
