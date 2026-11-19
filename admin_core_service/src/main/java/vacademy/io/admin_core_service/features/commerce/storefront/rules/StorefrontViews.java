package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogHtml;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Attribute;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.AttributeValue;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Collection;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Media;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Product;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Translation;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Variant;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;

/**
 * Builds the public views from the snapshot. Pure: the media URLs come in as a function, so
 * nothing here talks to a database or to another service. Every field of a view is copied
 * here by name, which is why an internal column can only become public by a change in this
 * class and in {@code StorefrontDtos}.
 */
public final class StorefrontViews {

    public static final String BADGE_ONE_OF_ONE = "ONE_OF_ONE";
    public static final String BADGE_ONLY_N_LEFT = "ONLY_N_LEFT";
    public static final String BADGE_NEW = "NEW";
    public static final String BADGE_MADE_TO_ORDER = "MADE_TO_ORDER";
    static final Duration NEW_FOR = Duration.ofDays(30);
    private static final int SEO_DESCRIPTION_MAX = 160;
    private static final int MAX_SWATCHES = 8;

    private StorefrontViews() {
    }

    // ------------------------------------------------------------------ paths

    /** {@code /p/<slug>}, with {@code ?lang=} for a locale that is not the site's base locale. */
    public static String productPath(String slug, String locale, String baseLocale) {
        return withLang("/p/" + segment(slug), locale, baseLocale);
    }

    public static String collectionPath(String slug, String locale, String baseLocale) {
        return withLang("/c/" + segment(slug), locale, baseLocale);
    }

    private static String withLang(String path, String locale, String baseLocale) {
        String l = StorefrontLocale.normalize(locale);
        String base = StorefrontLocale.normalize(baseLocale);
        return l == null || l.equals(base) ? path : path + "?lang=" + l;
    }

    public static String segment(String slug) {
        return slug == null ? "" : URLEncoder.encode(slug, StandardCharsets.UTF_8).replace("+", "%20");
    }

    // ------------------------------------------------------------------ stock and price

    public static StockStates.Level level(Variant variant) {
        return new StockStates.Level(variant.tracked(), variant.availableSlots(), variant.leadTimeDays());
    }

    public static StockStates.Stock stockOf(Product product, Variant variant, StorefrontSettings settings) {
        if (!variant.hasPrice()) {
            // A variant with no price cannot be bought, whatever its stock.
            return new StockStates.Stock(StockStates.State.OUT, null, false, false, null);
        }
        return StockStates.ofVariant(level(variant), settings.lowStockThreshold(), product.qtyScale(), product.piece());
    }

    /** The product on a card: only variants that have a price count. */
    public static StockStates.Stock stockOf(Product product, StorefrontSettings settings) {
        List<StockStates.Level> levels = new ArrayList<>();
        for (Variant variant : product.variants()) {
            if (variant.hasPrice()) {
                levels.add(level(variant));
            }
        }
        return StockStates.ofProduct(levels, settings.lowStockThreshold(), product.qtyScale(), product.piece());
    }

    /**
     * The price a card shows: the lowest among the variants that can be bought now, else the
     * lowest of all; null when no variant has a price.
     */
    public static Variant priceVariant(Product product, StorefrontSettings settings) {
        Variant best = null;
        boolean bestBuyable = false;
        for (Variant variant : product.variants()) {
            if (!variant.hasPrice()) {
                continue;
            }
            boolean buyable = stockOf(product, variant, settings).purchasable();
            if (best == null || (buyable && !bestBuyable)
                    || (buyable == bestBuyable && variant.price().compareTo(best.price()) < 0)) {
                best = variant;
                bestBuyable = buyable;
            }
        }
        return best;
    }

    public static BigDecimal cardPrice(Product product, StorefrontSettings settings) {
        Variant variant = priceVariant(product, settings);
        return variant == null ? null : variant.price();
    }

    static StorefrontDtos.Price price(Variant variant, boolean from) {
        if (variant == null || !variant.hasPrice()) {
            return null;
        }
        return StorefrontDtos.Price.builder()
                .amount(variant.price())
                .compareAtAmount(variant.mrp() != null && variant.mrp().compareTo(variant.price()) > 0
                        ? variant.mrp() : null)
                .currency(variant.currency() == null ? "INR" : variant.currency())
                .from(from)
                .build();
    }

    static StorefrontDtos.Price productPrice(Product product, StorefrontSettings settings) {
        Set<BigDecimal> distinct = new TreeSet<>();
        for (Variant variant : product.variants()) {
            if (variant.hasPrice()) {
                distinct.add(variant.price());
            }
        }
        return price(priceVariant(product, settings), distinct.size() > 1);
    }

    public static StorefrontDtos.Stock stock(StockStates.Stock stock) {
        return StorefrontDtos.Stock.builder()
                .state(stock.state().name())
                .left(stock.state() == StockStates.State.LOW ? stock.left() : null)
                .purchasable(stock.purchasable())
                .singlePiece(stock.oneOfAKind())
                .leadTimeDays(stock.leadTimeDays())
                .build();
    }

    static List<String> badges(Product product, StockStates.Stock stock, Instant now) {
        List<String> out = new ArrayList<>();
        if (stock.oneOfAKind()) {
            out.add(BADGE_ONE_OF_ONE);
        } else if (stock.state() == StockStates.State.LOW) {
            out.add(BADGE_ONLY_N_LEFT);
        }
        if (stock.state() == StockStates.State.MADE_TO_ORDER) {
            out.add(BADGE_MADE_TO_ORDER);
        }
        if (product.publishedAt() != null && now != null
                && Duration.between(product.publishedAt(), now).compareTo(NEW_FOR) <= 0) {
            out.add(BADGE_NEW);
        }
        return out;
    }

    // ------------------------------------------------------------------ media

    /** Every media id or URL a product's pictures need, for one batch lookup. */
    public static void collectMediaRefs(Product product, boolean leadOnly, StorefrontSettings settings,
                                        java.util.Collection<String> into) {
        if (leadOnly) {
            Media lead = leadMedia(product, settings);
            if (lead != null) {
                collect(lead, into);
            } else {
                for (Variant variant : product.variants()) {
                    if (variant.mediaId() != null) {
                        into.add(variant.mediaId());
                        break;
                    }
                }
            }
            return;
        }
        for (Media media : product.media()) {
            collect(media, into);
        }
        for (Variant variant : product.variants()) {
            if (variant.mediaId() != null) {
                into.add(variant.mediaId());
            }
        }
    }

    private static void collect(Media media, java.util.Collection<String> into) {
        if (media.mediaId() != null) {
            into.add(media.mediaId());
        }
        for (RenditionRef ref : renditionRefs(media.renditions())) {
            into.add(ref.ref());
        }
    }

    /** The first image carrying the seller's lead tag, else the first image, else null. */
    public static Media leadMedia(Product product, StorefrontSettings settings) {
        Media first = null;
        for (Media media : product.media()) {
            if (!"IMAGE".equals(media.kind())) {
                continue;
            }
            if (first == null) {
                first = media;
            }
            if (settings.leadMediaTag() != null && settings.leadMediaTag().equalsIgnoreCase(media.tag())) {
                return media;
            }
        }
        return first;
    }

    record RenditionRef(int width, String ref) {
    }

    /**
     * The renditions of a picture, smallest first. {@code renditions_json} as the rendition job
     * writes it ({@code CommerceRenditionState}): a number key is a width and its value the
     * public URL; keys with a leading underscore are the job's own state and are never sent
     * out. A list under {@code renditions} or {@code items} of {@code {width, url | media_id}}
     * is read too.
     */
    static List<RenditionRef> renditionRefs(Map<String, Object> renditions) {
        List<RenditionRef> out = new ArrayList<>();
        if (renditions == null || renditions.isEmpty()) {
            return out;
        }
        Object list = renditions.containsKey("renditions") ? renditions.get("renditions") : renditions.get("items");
        if (list instanceof List<?> items) {
            for (Object item : items) {
                if (item instanceof Map<?, ?> map && map.get("width") instanceof Number width) {
                    Object ref = map.get("url") != null ? map.get("url") : map.get("media_id");
                    if (ref instanceof String s && !s.isBlank()) {
                        out.add(new RenditionRef(width.intValue(), s.trim()));
                    }
                }
            }
        } else {
            for (Map.Entry<String, Object> e : renditions.entrySet()) {
                try {
                    int width = Integer.parseInt(e.getKey().trim());
                    if (e.getValue() instanceof String s && !s.isBlank()) {
                        out.add(new RenditionRef(width, s.trim()));
                    }
                } catch (NumberFormatException ignored) {
                    // Not a width key.
                }
            }
        }
        out.sort(Comparator.comparingInt(RenditionRef::width));
        return out;
    }

    static StorefrontDtos.Media media(Media media, List<String> chain, Function<String, String> url) {
        String resolved = url.apply(media.mediaId());
        List<StorefrontDtos.Rendition> renditions = new ArrayList<>();
        for (RenditionRef ref : renditionRefs(media.renditions())) {
            String renditionUrl = url.apply(ref.ref());
            if (renditionUrl != null) {
                renditions.add(StorefrontDtos.Rendition.builder().width(ref.width()).url(renditionUrl).build());
            }
        }
        if (resolved == null && renditions.isEmpty()) {
            return null;
        }
        return StorefrontDtos.Media.builder()
                .kind(media.kind())
                .url(resolved != null ? resolved : renditions.get(renditions.size() - 1).getUrl())
                .alt(StorefrontLocale.text(media.altI18n(), chain))
                .tag(media.tag())
                .width(media.width())
                .height(media.height())
                .renditions(renditions)
                .variantId(media.packageSessionId())
                .position(media.position())
                .build();
    }

    private static StorefrontDtos.Media bareImage(String mediaId, String variantId, Function<String, String> url) {
        String resolved = mediaId == null ? null : url.apply(mediaId);
        if (resolved == null) {
            return null;
        }
        return StorefrontDtos.Media.builder().kind("IMAGE").url(resolved).renditions(List.of())
                .variantId(variantId).position(0).build();
    }

    // ------------------------------------------------------------------ text

    public static String name(Product product, List<String> chain) {
        String name = StorefrontLocale.textField(product.translations(), chain, Translation::name);
        return name != null ? name : product.slug();
    }

    /** Value labels of the option attributes of a variant, in option order ("Red / M"). */
    static String variantLabel(StorefrontSnapshot s, Product product, Variant variant, List<String> chain) {
        List<String> parts = new ArrayList<>();
        for (String attributeId : product.optionAttributeIds()) {
            AttributeValue value = s.attributeValues().get(variant.optionValueIds().get(attributeId));
            if (value != null) {
                String label = StorefrontLocale.text(value.labelI18n(), chain);
                parts.add(label != null ? label : value.code());
            }
        }
        if (!parts.isEmpty()) {
            return String.join(" / ", parts);
        }
        return variant.legacyName() != null && !variant.legacyName().equals(variant.sku()) ? variant.legacyName() : null;
    }

    // ------------------------------------------------------------------ card

    public static StorefrontDtos.ProductCard card(StorefrontSnapshot s, Product product, List<String> chain,
                                                  Function<String, String> url, Instant now) {
        StorefrontSettings settings = s.settings();
        StockStates.Stock stock = stockOf(product, settings);
        String locale = StorefrontLocale.served(product.translations(), chain);
        Media lead = leadMedia(product, settings);
        StorefrontDtos.Media image = lead == null ? null : media(lead, chain, url);
        if (image == null) {
            for (Variant variant : product.variants()) {
                image = bareImage(variant.mediaId(), null, url);
                if (image != null) {
                    break;
                }
            }
        }
        return StorefrontDtos.ProductCard.builder()
                .id(product.packageId())
                .slug(product.slug())
                .path(productPath(product.slug(), StorefrontLocale.effective(chain), settings.baseLocale()))
                .locale(locale)
                .name(name(product, chain))
                .shortDescription(StorefrontLocale.textField(product.translations(), chain,
                        Translation::shortDescription))
                .brand(product.brand())
                .unit(product.unit())
                .qtyScale(product.qtyScale())
                .qtyStep(product.qtyStep())
                .origin(product.originName())
                .image(image)
                .price(productPrice(product, settings))
                .stock(stock(stock))
                .badges(badges(product, stock, now))
                .swatches(swatches(s, product, chain))
                .variantCount(product.variants().size())
                .defaultVariantId(product.variants().size() == 1 ? product.variants().get(0).packageSessionId() : null)
                .publishedAt(product.publishedAt() == null ? null : product.publishedAt().toString())
                .build();
    }

    /** The values of the first SWATCH option the variants carry, for the dots on a card. */
    private static List<StorefrontDtos.Swatch> swatches(StorefrontSnapshot s, Product product, List<String> chain) {
        for (String attributeId : product.optionAttributeIds()) {
            Attribute attribute = s.attributes().get(attributeId);
            if (attribute == null || !"SWATCH".equals(attribute.kind())) {
                continue;
            }
            Set<String> seen = new LinkedHashSet<>();
            for (Variant variant : product.variants()) {
                String valueId = variant.optionValueIds().get(attributeId);
                if (valueId != null) {
                    seen.add(valueId);
                }
            }
            List<StorefrontDtos.Swatch> out = new ArrayList<>();
            for (AttributeValue value : orderedValues(s, seen)) {
                if (out.size() >= MAX_SWATCHES) {
                    break;
                }
                String label = StorefrontLocale.text(value.labelI18n(), chain);
                out.add(StorefrontDtos.Swatch.builder().code(value.code())
                        .label(label != null ? label : value.code()).swatchHex(value.swatchHex()).build());
            }
            return out;
        }
        return List.of();
    }

    private static List<AttributeValue> orderedValues(StorefrontSnapshot s, java.util.Collection<String> valueIds) {
        List<AttributeValue> out = new ArrayList<>();
        for (String id : valueIds) {
            AttributeValue value = s.attributeValues().get(id);
            if (value != null) {
                out.add(value);
            }
        }
        out.sort(Comparator.comparingInt(AttributeValue::position).thenComparing(AttributeValue::code));
        return out;
    }

    // ------------------------------------------------------------------ detail

    public static StorefrontDtos.ProductDetail detail(StorefrontSnapshot s, Product product, List<String> chain,
                                                      Function<String, String> url, Instant now) {
        StorefrontSettings settings = s.settings();
        String requested = StorefrontLocale.effective(chain);
        StockStates.Stock stock = stockOf(product, settings);

        List<StorefrontDtos.Media> gallery = new ArrayList<>();
        Map<String, StorefrontDtos.Media> firstOfVariant = new LinkedHashMap<>();
        for (Media media : product.media()) {
            StorefrontDtos.Media view = media(media, chain, url);
            if (view == null) {
                continue;
            }
            gallery.add(view);
            if (media.packageSessionId() != null && "IMAGE".equals(media.kind())) {
                firstOfVariant.putIfAbsent(media.packageSessionId(), view);
            }
        }

        List<StorefrontDtos.Option> options = new ArrayList<>();
        for (String attributeId : product.optionAttributeIds()) {
            Attribute attribute = s.attributes().get(attributeId);
            if (attribute == null) {
                continue;
            }
            Set<String> used = new LinkedHashSet<>();
            for (Variant variant : product.variants()) {
                String valueId = variant.optionValueIds().get(attributeId);
                if (valueId != null) {
                    used.add(valueId);
                }
            }
            List<StorefrontDtos.OptionValue> values = new ArrayList<>();
            for (AttributeValue value : orderedValues(s, used)) {
                String label = StorefrontLocale.text(value.labelI18n(), chain);
                values.add(StorefrontDtos.OptionValue.builder().code(value.code())
                        .label(label != null ? label : value.code()).swatchHex(value.swatchHex())
                        .position(value.position()).build());
            }
            String optionName = StorefrontLocale.text(attribute.nameI18n(), chain);
            options.add(StorefrontDtos.Option.builder().code(attribute.code())
                    .name(optionName != null ? optionName : attribute.code()).kind(attribute.kind())
                    .values(values).build());
        }

        List<StorefrontDtos.Variant> variants = new ArrayList<>();
        for (Variant variant : product.variants()) {
            Map<String, String> optionValues = new LinkedHashMap<>();
            for (String attributeId : product.optionAttributeIds()) {
                Attribute attribute = s.attributes().get(attributeId);
                AttributeValue value = s.attributeValues().get(variant.optionValueIds().get(attributeId));
                if (attribute != null && value != null) {
                    optionValues.put(attribute.code(), value.code());
                }
            }
            StorefrontDtos.Media image = firstOfVariant.get(variant.packageSessionId());
            if (image == null) {
                image = bareImage(variant.mediaId(), variant.packageSessionId(), url);
            }
            variants.add(StorefrontDtos.Variant.builder()
                    .id(variant.packageSessionId())
                    .sku(variant.sku())
                    .label(variantLabel(s, product, variant, chain))
                    .optionValues(optionValues)
                    .price(price(variant, false))
                    .stock(stock(stockOf(product, variant, settings)))
                    .weightGrams(variant.weightGrams())
                    .lengthMm(variant.lengthMm())
                    .widthMm(variant.widthMm())
                    .heightMm(variant.heightMm())
                    .image(image)
                    .position(variant.position())
                    .build());
        }

        return StorefrontDtos.ProductDetail.builder()
                .id(product.packageId())
                .slug(product.slug())
                .path(productPath(product.slug(), requested, settings.baseLocale()))
                .locale(StorefrontLocale.served(product.translations(), chain))
                .availableLocales(new ArrayList<>(new TreeSet<>(product.translations().keySet())))
                .name(name(product, chain))
                .shortDescription(StorefrontLocale.textField(product.translations(), chain,
                        Translation::shortDescription))
                .descriptionHtml(StorefrontLocale.field(product.translations(), chain,
                        t -> CatalogHtml.sanitize(t.descriptionHtml()), html -> true))
                .contentBlocks(contentBlocks(product, chain))
                .brand(product.brand())
                .unit(product.unit())
                .qtyScale(product.qtyScale())
                .qtyStep(product.qtyStep())
                .maxOrderQuantity(settings.maxOrderQuantity())
                .stockMode(product.piece() ? "PIECE" : "QUANTITY")
                .origin(product.originName())
                .price(productPrice(product, settings))
                .stock(stock(stock))
                .badges(badges(product, stock, now))
                .media(gallery)
                .options(options)
                .variants(variants)
                .specs(specs(s, product, chain))
                .collections(collectionRefs(s, product, chain))
                .seo(seo(product, chain, settings))
                .publishedAt(product.publishedAt() == null ? null : product.publishedAt().toString())
                .updatedAt(product.updatedAt() == null ? null : product.updatedAt().toString())
                .build();
    }

    /**
     * The content blocks of the first locale in the chain that has any; a block with no visible
     * text is dropped. HTML is sanitised on the way out.
     */
    static List<StorefrontDtos.ContentBlock> contentBlocks(Product product, List<String> chain) {
        List<Map<String, Object>> raw = StorefrontLocale.field(product.translations(), chain,
                Translation::contentBlocks, blocks -> !cleanBlocks(blocks).isEmpty());
        return raw == null ? List.of() : cleanBlocks(raw);
    }

    private static List<StorefrontDtos.ContentBlock> cleanBlocks(List<Map<String, Object>> blocks) {
        List<StorefrontDtos.ContentBlock> out = new ArrayList<>();
        if (blocks == null) {
            return out;
        }
        for (Map<String, Object> block : blocks) {
            if (block == null || !(block.get("code") instanceof String code) || code.isBlank()) {
                continue;
            }
            String html = block.get("html") instanceof String h ? CatalogHtml.sanitize(h) : null;
            if (html != null) {
                out.add(StorefrontDtos.ContentBlock.builder().code(code.trim()).html(html).build());
            }
        }
        return out;
    }

    /** Product-level attribute values that are not options, grouped by attribute. */
    private static List<StorefrontDtos.Spec> specs(StorefrontSnapshot s, Product product, List<String> chain) {
        Map<String, List<AttributeValue>> byAttribute = new LinkedHashMap<>();
        for (AttributeValue value : orderedValues(s, product.attributeValueIds())) {
            if (!product.optionAttributeIds().contains(value.attributeId())) {
                byAttribute.computeIfAbsent(value.attributeId(), k -> new ArrayList<>()).add(value);
            }
        }
        List<Attribute> attributes = new ArrayList<>();
        for (String attributeId : byAttribute.keySet()) {
            if (s.attributes().get(attributeId) != null) {
                attributes.add(s.attributes().get(attributeId));
            }
        }
        attributes.sort(Comparator.comparingInt(Attribute::position).thenComparing(Attribute::code));
        List<StorefrontDtos.Spec> out = new ArrayList<>();
        for (Attribute attribute : attributes) {
            List<String> labels = new ArrayList<>();
            for (AttributeValue value : byAttribute.get(attribute.id())) {
                String label = StorefrontLocale.text(value.labelI18n(), chain);
                labels.add(label != null ? label : value.code());
            }
            String name = StorefrontLocale.text(attribute.nameI18n(), chain);
            out.add(StorefrontDtos.Spec.builder().code(attribute.code())
                    .name(name != null ? name : attribute.code()).values(labels).build());
        }
        return out;
    }

    private static List<StorefrontDtos.CollectionRef> collectionRefs(StorefrontSnapshot s, Product product,
                                                                     List<String> chain) {
        List<StorefrontDtos.CollectionRef> out = new ArrayList<>();
        for (Collection collection : s.collections()) {
            if (product.collectionPositions().containsKey(collection.id())) {
                out.add(collectionRef(collection, chain, s.settings()));
            }
        }
        return out;
    }

    public static StorefrontDtos.CollectionRef collectionRef(Collection collection, List<String> chain,
                                                             StorefrontSettings settings) {
        String name = StorefrontLocale.text(collection.nameI18n(), chain);
        return StorefrontDtos.CollectionRef.builder()
                .slug(collection.slug())
                .kind(collection.kind())
                .name(name != null ? name : collection.slug())
                .path(collectionPath(collection.slug(), StorefrontLocale.effective(chain), settings.baseLocale()))
                .build();
    }

    /**
     * Title and description from {@code seo_i18n} ({@code {locale: {title, description}}} or
     * {@code {title: {locale: ...}, description: {locale: ...}}}), else generated from the name
     * and the text. One slug serves every language: the base locale owns the bare path.
     */
    static StorefrontDtos.Seo seo(Product product, List<String> chain, StorefrontSettings settings) {
        String title = seoText(product.seoI18n(), "title", chain);
        String description = seoText(product.seoI18n(), "description", chain);
        if (title == null) {
            title = name(product, chain);
        }
        if (description == null) {
            String text = StorefrontLocale.textField(product.translations(), chain, Translation::shortDescription);
            if (text == null) {
                text = StorefrontLocale.field(product.translations(), chain,
                        t -> CatalogHtml.plainText(t.descriptionHtml()), plain -> true);
            }
            description = CatalogHtml.summary(text, SEO_DESCRIPTION_MAX);
        }
        Set<String> locales = new TreeSet<>(product.translations().keySet());
        String base = StorefrontLocale.normalize(settings.baseLocale());
        if (base != null) {
            locales.add(base);
        }
        List<StorefrontDtos.Alternate> alternates = new ArrayList<>();
        for (String locale : locales) {
            if (StorefrontLocale.normalize(locale) != null) {
                alternates.add(StorefrontDtos.Alternate.builder().locale(locale)
                        .path(productPath(product.slug(), locale, settings.baseLocale())).build());
            }
        }
        return StorefrontDtos.Seo.builder()
                .title(title)
                .description(description)
                .canonicalPath(productPath(product.slug(), StorefrontLocale.effective(chain), settings.baseLocale()))
                .alternates(alternates)
                .build();
    }

    private static String seoText(Map<String, Object> seo, String field, List<String> chain) {
        if (seo == null || seo.isEmpty()) {
            return null;
        }
        Map<String, String> byLocale = new LinkedHashMap<>();
        if (seo.get(field) instanceof Map<?, ?> perLocale) {
            perLocale.forEach((k, v) -> {
                if (k instanceof String locale && v instanceof String text) {
                    byLocale.put(locale.toLowerCase(java.util.Locale.ROOT), text);
                }
            });
        } else {
            seo.forEach((locale, value) -> {
                if (value instanceof Map<?, ?> fields && fields.get(field) instanceof String text) {
                    byLocale.put(locale.toLowerCase(java.util.Locale.ROOT), text);
                }
            });
        }
        return StorefrontLocale.text(byLocale, chain);
    }

    /** For callers that have no picture to resolve (tests, a media service that is down). */
    public static Function<String, String> noMedia() {
        return id -> null;
    }
}
