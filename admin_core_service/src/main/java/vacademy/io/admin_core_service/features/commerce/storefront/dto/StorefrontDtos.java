package vacademy.io.admin_core_service.features.commerce.storefront.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Value;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Every view the public shop routes return, and nothing else. These are the only classes that
 * are serialised to a shopper, so the list of their fields is the list of what is public.
 * Cost, supplier, tax class ids, raw stock counts, barcodes,
 * label codes, external references and institute ids have no field here; a test
 * ({@code StorefrontDtosTest}) fails when a field is added without being put on its allow list.
 * JSON is snake_case like the rest of the Catalogue API.
 */
public final class StorefrontDtos {

    private StorefrontDtos() {
    }

    /** Tax-inclusive price of one base unit. {@code from} is true when the variants differ in price. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Price {
        BigDecimal amount;
        BigDecimal compareAtAmount;
        String currency;
        boolean from;
    }

    /** A state, with {@code left} only when the state is LOW. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Stock {
        String state;
        Integer left;
        boolean purchasable;
        /** A product sold piece by piece with exactly one piece left. */
        boolean singlePiece;
        Integer leadTimeDays;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Rendition {
        Integer width;
        String url;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Media {
        String kind;
        String url;
        String alt;
        String tag;
        Integer width;
        Integer height;
        List<Rendition> renditions;
        /** The variant the image shows, or null for a picture of the product. */
        String variantId;
        int position;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Swatch {
        String code;
        String label;
        String swatchHex;
    }

    /** One product on a listing, a rail or a suggestion list. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ProductCard {
        String id;
        String slug;
        String path;
        String locale;
        String name;
        String shortDescription;
        String brand;
        String unit;
        int qtyScale;
        int qtyStep;
        String origin;
        Media image;
        Price price;
        Stock stock;
        List<String> badges;
        List<Swatch> swatches;
        int variantCount;
        /** Set when the product has exactly one variant, so a card can add it to the cart directly. */
        String defaultVariantId;
        String publishedAt;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OptionValue {
        String code;
        String label;
        String swatchHex;
        int position;
    }

    /** An attribute the variants differ in (colour, size). */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Option {
        String code;
        String name;
        String kind;
        List<OptionValue> values;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Variant {
        /** The id a cart line carries. */
        String id;
        String sku;
        String label;
        /** Option code to value code. */
        Map<String, String> optionValues;
        Price price;
        Stock stock;
        Integer weightGrams;
        Integer lengthMm;
        Integer widthMm;
        Integer heightMm;
        Media image;
        int position;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ContentBlock {
        String code;
        String html;
    }

    /** A product attribute that is not an option, for the specs panel. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Spec {
        String code;
        String name;
        List<String> values;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Alternate {
        String locale;
        String path;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Seo {
        String title;
        String description;
        /** The address of this language version: the bare path for the base locale, {@code ?lang=} otherwise. */
        String canonicalPath;
        List<Alternate> alternates;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CollectionRef {
        String slug;
        String kind;
        String name;
        String path;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ProductDetail {
        String id;
        String slug;
        String path;
        String locale;
        List<String> availableLocales;
        String name;
        String shortDescription;
        String descriptionHtml;
        List<ContentBlock> contentBlocks;
        String brand;
        String unit;
        int qtyScale;
        int qtyStep;
        /**
         * The shop's per-order maximum ({@code maxOrderQuantity}, default 25) in display units:
         * pieces for counted goods, metres (or kg) for measured goods. The cart refuses more than
         * this × {@code qty_scale} base units of one variant across its lines
         * ({@code QUANTITY_ABOVE_MAX}); a length picker floors it to the step.
         */
        int maxOrderQuantity;
        String stockMode;
        String origin;
        Price price;
        Stock stock;
        List<String> badges;
        List<Media> media;
        List<Option> options;
        List<Variant> variants;
        List<Spec> specs;
        List<CollectionRef> collections;
        Seo seo;
        String publishedAt;
        String updatedAt;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FacetValue {
        String code;
        String label;
        String swatchHex;
        int count;
        boolean selected;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Facet {
        String code;
        String name;
        String kind;
        List<FacetValue> values;
    }

    /** {@code from} exclusive, {@code to} inclusive; a null end is open. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PriceBand {
        BigDecimal from;
        BigDecimal to;
        int count;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PriceFacet {
        BigDecimal min;
        BigDecimal max;
        List<PriceBand> bands;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AvailabilityFacet {
        int inStock;
        int outOfStock;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Facets {
        List<Facet> attributes;
        PriceFacet price;
        AvailabilityFacet availability;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ProductList {
        List<ProductCard> data;
        int total;
        int page;
        int pageSize;
        boolean hasMore;
        String locale;
        /** Null unless {@code facets=true} was asked for. */
        Facets facets;
    }

    /** The answer to {@code suggest=1}: a few products and collections for the search overlay. */
    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Suggestions {
        List<ProductCard> products;
        List<CollectionRef> collections;
        int total;
        String locale;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Category {
        String slug;
        String kind;
        String name;
        String description;
        String imageUrl;
        String path;
        int position;
        /** ACTIVE products in this entry and in the entries under it. */
        int productCount;
        /** Of those, the ones that can be bought now. */
        int inStockCount;
        List<Category> children;
    }

    @Value
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CategoryTree {
        List<Category> data;
        String locale;
    }
}
