package vacademy.io.admin_core_service.features.commerce.storefront.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Attribute;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.AttributeValue;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Collection;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Product;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StockStates;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontFacets;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontLocale;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontSearch;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontViews;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * The public shop reads: listing with filters, facets, sorts and search; suggestions; one
 * product; the collection tree. Everything is answered from the institute's
 * {@link StorefrontSnapshot} (ACTIVE products of that institute only), so a listing of a few
 * hundred products with facets is a pass over memory and not a query per filter.
 */
@Slf4j
@Service
public class StorefrontCatalogService {

    public static final int MAX_PAGE_SIZE = 100;
    public static final int DEFAULT_PAGE_SIZE = 24;
    public static final int MAX_PAGE = 10_000;
    static final int SUGGEST_PRODUCTS = 6;
    static final int SUGGEST_COLLECTIONS = 3;
    static final int SUGGEST_MIN_CHARS = 2;
    static final int MAX_FILTER_VALUES = 50;
    private static final int MAX_TREE_DEPTH = 6;

    public static final String SORT_RECOMMENDED = "recommended";
    public static final String SORT_NEWEST = "newest";
    public static final String SORT_PRICE_ASC = "price_asc";
    public static final String SORT_PRICE_DESC = "price_desc";
    static final Set<String> SORTS = new LinkedHashSet<>(List.of(SORT_RECOMMENDED, SORT_NEWEST, SORT_PRICE_ASC,
            SORT_PRICE_DESC));

    private static final String G_SEARCH = "q";
    private static final String G_COLLECTION = "collection";
    private static final String G_PRICE = "price";
    private static final String G_AVAILABILITY = "availability";
    private static final String G_ATTRIBUTE = "attribute:";

    private final StorefrontSnapshotLoader loader;
    private final CatalogMediaResolver mediaResolver;

    /** "now" for the New badge; replaceable in tests. */
    Clock clock = Clock.systemUTC();

    public StorefrontCatalogService(StorefrontSnapshotLoader loader, CatalogMediaResolver mediaResolver) {
        this.loader = loader;
        this.mediaResolver = mediaResolver;
    }

    /**
     * The listing parameters. {@code attributes} maps an attribute code to the value codes
     * picked for it; {@code inStock} null leaves availability unfiltered. {@code priceMin} and
     * {@code priceMax} are per display unit for measured goods (per metre, not per 10 cm), as the
     * price sort and the price bands are; a card's {@code price.amount} stays per base unit.
     */
    public record ProductQuery(String q, String collection, Map<String, List<String>> attributes,
                               BigDecimal priceMin, BigDecimal priceMax, Boolean inStock, String sort, int page,
                               int pageSize, boolean facets, String locale) {
    }

    /**
     * A product with what every filter and sort needs, computed once per request. {@code price} is
     * the price of one display unit (a metre of cloth, not 10 cm), so sorts, the price filter and
     * the price bands compare like with like; the card itself keeps the per-base-unit amount.
     */
    record Item(Product product, StockStates.Stock stock, BigDecimal price) {
    }

    // ------------------------------------------------------------------ listing

    public StorefrontDtos.ProductList list(String instituteId, ProductQuery query) {
        StorefrontSnapshot s = loader.snapshot(instituteId);
        List<String> chain = StorefrontLocale.chain(query.locale(), s.settings().baseLocale());
        if (query.page() < 1 || query.page() > MAX_PAGE) {
            throw invalid("page must be between 1 and " + MAX_PAGE + ".", "page");
        }
        if (query.pageSize() < 1 || query.pageSize() > MAX_PAGE_SIZE) {
            throw invalid("page_size must be between 1 and " + MAX_PAGE_SIZE + ".", "page_size");
        }
        String sort = query.sort() == null || query.sort().isBlank() ? SORT_RECOMMENDED : query.sort().trim();
        if (!SORTS.contains(sort)) {
            throw invalid("sort must be one of " + String.join(", ", SORTS) + ".", "sort");
        }

        List<Item> all = items(s);
        Collection collection = collectionOf(s, query.collection());
        List<StorefrontFacets.Group<Item>> groups = groups(s, query, collection);
        List<Item> matched = new ArrayList<>(StorefrontFacets.apply(all, groups, null));
        matched.sort(comparator(sort, query.q(), collection, chain));

        long offset = (long) (query.page() - 1) * query.pageSize();
        int from = (int) Math.min(matched.size(), offset);
        int to = (int) Math.min(matched.size(), (long) from + query.pageSize());
        List<Item> pageItems = matched.subList(from, to);

        return StorefrontDtos.ProductList.builder()
                .data(cards(s, pageItems, chain))
                .total(matched.size())
                .page(query.page())
                .pageSize(query.pageSize())
                .hasMore(to < matched.size())
                .locale(StorefrontLocale.effective(chain))
                .facets(query.facets() ? facets(s, query, all, groups, chain) : null)
                .build();
    }

    /** Up to six products and three collections for the search overlay; empty under two characters. */
    public StorefrontDtos.Suggestions suggest(String instituteId, String q, String locale) {
        StorefrontSnapshot s = loader.snapshot(instituteId);
        List<String> chain = StorefrontLocale.chain(locale, s.settings().baseLocale());
        String normalized = StorefrontSearch.normalize(q);
        if (normalized == null || normalized.length() < SUGGEST_MIN_CHARS) {
            return StorefrontDtos.Suggestions.builder().products(List.of()).collections(List.of()).total(0)
                    .locale(StorefrontLocale.effective(chain)).build();
        }
        List<String> words = StorefrontSearch.words(normalized);
        List<Item> matched = new ArrayList<>();
        for (Item item : items(s)) {
            if (StorefrontSearch.matches(item.product().searchText(), words)) {
                matched.add(item);
            }
        }
        matched.sort(comparator(SORT_RECOMMENDED, normalized, null, chain));
        List<StorefrontDtos.CollectionRef> collections = new ArrayList<>();
        for (Collection collection : s.collections()) {
            if (collections.size() >= SUGGEST_COLLECTIONS) {
                break;
            }
            String names = StorefrontSearch.normalize(String.join(" ", collection.nameI18n().values()));
            if (StorefrontSearch.matches(names, words)) {
                collections.add(StorefrontViews.collectionRef(collection, chain, s.settings()));
            }
        }
        return StorefrontDtos.Suggestions.builder()
                .products(cards(s, matched.subList(0, Math.min(SUGGEST_PRODUCTS, matched.size())), chain))
                .collections(collections)
                .total(matched.size())
                .locale(StorefrontLocale.effective(chain))
                .build();
    }

    static List<Item> items(StorefrontSnapshot s) {
        List<Item> out = new ArrayList<>(s.products().size());
        for (Product product : s.products()) {
            out.add(new Item(product, StorefrontViews.stockOf(product, s.settings()),
                    displayUnitPrice(StorefrontViews.cardPrice(product, s.settings()), product.qtyScale())));
        }
        return out;
    }

    /** The card price of one display unit: per-base-unit price × scale (12.34 at scale 10 gives 123.40). */
    static BigDecimal displayUnitPrice(BigDecimal basePrice, int qtyScale) {
        if (basePrice == null || qtyScale <= 1) {
            return basePrice;
        }
        return basePrice.multiply(BigDecimal.valueOf(qtyScale));
    }

    private List<StorefrontDtos.ProductCard> cards(StorefrontSnapshot s, List<Item> items, List<String> chain) {
        Set<String> refs = new LinkedHashSet<>();
        for (Item item : items) {
            StorefrontViews.collectMediaRefs(item.product(), true, s.settings(), refs);
        }
        Function<String, String> url = urls(refs);
        Instant now = clock.instant();
        List<StorefrontDtos.ProductCard> out = new ArrayList<>(items.size());
        for (Item item : items) {
            out.add(StorefrontViews.card(s, item.product(), chain, url, now));
        }
        return out;
    }

    /** A picture that cannot be resolved is left out; the rest of the response is unaffected. */
    private Function<String, String> urls(java.util.Collection<String> refs) {
        Map<String, String> resolved;
        try {
            resolved = refs.isEmpty() ? Map.of() : mediaResolver.resolve(refs);
        } catch (RuntimeException e) {
            log.warn("storefront: media lookup failed, pictures left out: {}", e.getMessage());
            resolved = Map.of();
        }
        Map<String, String> map = resolved;
        return ref -> ref == null ? null : map.get(ref);
    }

    // ------------------------------------------------------------------ filters

    private static Collection collectionOf(StorefrontSnapshot s, String slug) {
        if (slug == null || slug.isBlank()) {
            return null;
        }
        for (Collection collection : s.collections()) {
            if (collection.slug().equals(slug.trim())) {
                return collection;
            }
        }
        throw new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", "Collection not found.");
    }

    /** The collection and everything under it. */
    static Set<String> withDescendants(StorefrontSnapshot s, String collectionId) {
        Set<String> out = new HashSet<>();
        out.add(collectionId);
        boolean grew = true;
        for (int depth = 0; grew && depth < MAX_TREE_DEPTH; depth++) {
            grew = false;
            for (Collection collection : s.collections()) {
                if (collection.parentId() != null && out.contains(collection.parentId()) && out.add(collection.id())) {
                    grew = true;
                }
            }
        }
        return out;
    }

    static List<StorefrontFacets.Group<Item>> groups(StorefrontSnapshot s, ProductQuery query, Collection collection) {
        List<StorefrontFacets.Group<Item>> groups = new ArrayList<>();
        List<String> words = StorefrontSearch.words(query.q());
        if (!words.isEmpty()) {
            groups.add(new StorefrontFacets.Group<>(G_SEARCH,
                    item -> StorefrontSearch.matches(item.product().searchText(), words)));
        }
        if (collection != null) {
            Set<String> ids = withDescendants(s, collection.id());
            groups.add(new StorefrontFacets.Group<>(G_COLLECTION, item -> {
                for (String id : item.product().collectionPositions().keySet()) {
                    if (ids.contains(id)) {
                        return true;
                    }
                }
                return false;
            }));
        }
        if (query.priceMin() != null || query.priceMax() != null) {
            if (query.priceMin() != null && query.priceMax() != null
                    && query.priceMin().compareTo(query.priceMax()) > 0) {
                throw invalid("price_min cannot be above price_max.", "price_min");
            }
            groups.add(new StorefrontFacets.Group<>(G_PRICE, item -> item.price() != null
                    && (query.priceMin() == null || item.price().compareTo(query.priceMin()) >= 0)
                    && (query.priceMax() == null || item.price().compareTo(query.priceMax()) <= 0)));
        }
        if (query.inStock() != null) {
            boolean wanted = query.inStock();
            groups.add(new StorefrontFacets.Group<>(G_AVAILABILITY, item -> item.stock().purchasable() == wanted));
        }
        if (query.attributes() != null) {
            for (Map.Entry<String, List<String>> picked : query.attributes().entrySet()) {
                Attribute attribute = filterable(s, picked.getKey());
                if (attribute == null) {
                    throw invalid("Unknown filter: " + shown(picked.getKey()) + ".", "filter." + shown(picked.getKey()));
                }
                Set<String> valueIds = new HashSet<>();
                for (AttributeValue value : s.attributeValues().values()) {
                    if (value.attributeId().equals(attribute.id()) && picked.getValue().contains(value.code())) {
                        valueIds.add(value.id());
                    }
                }
                groups.add(new StorefrontFacets.Group<>(G_ATTRIBUTE + attribute.code(),
                        item -> hasAny(item.product().attributeValueIds(), valueIds)));
            }
        }
        return groups;
    }

    private static Attribute filterable(StorefrontSnapshot s, String code) {
        for (Attribute attribute : s.attributes().values()) {
            if (attribute.filterable() && attribute.code().equals(code)) {
                return attribute;
            }
        }
        return null;
    }

    private static boolean hasAny(Set<String> have, Set<String> wanted) {
        for (String id : wanted) {
            if (have.contains(id)) {
                return true;
            }
        }
        return false;
    }

    private static String shown(String value) {
        String v = value == null ? "" : value.replaceAll("[^A-Za-z0-9_.-]", "");
        return v.length() > 64 ? v.substring(0, 64) : v;
    }

    // ------------------------------------------------------------------ sort

    /**
     * In stock first for every sort. Recommended: best name match when there
     * is a query, then the position in the collection being viewed, then newest.
     */
    static Comparator<Item> comparator(String sort, String q, Collection collection, List<String> chain) {
        Comparator<Item> inStockFirst = Comparator.comparing((Item item) -> !item.stock().purchasable());
        Comparator<Item> newest = Comparator.comparing((Item item) -> item.product().publishedAt(),
                Comparator.nullsLast(Comparator.reverseOrder()));
        Comparator<Item> byId = Comparator.comparing((Item item) -> item.product().packageId());
        Comparator<Item> order = switch (sort) {
            case SORT_NEWEST -> newest;
            case SORT_PRICE_ASC -> Comparator.comparing(Item::price, Comparator.nullsLast(Comparator.naturalOrder()));
            case SORT_PRICE_DESC -> Comparator.comparing(Item::price, Comparator.nullsLast(Comparator.reverseOrder()));
            default -> {
                Comparator<Item> c = Comparator.comparingInt((Item item) -> 0);
                if (StorefrontSearch.normalize(q) != null) {
                    Map<String, Integer> scores = new HashMap<>();
                    c = c.thenComparingInt(item -> -scores.computeIfAbsent(item.product().packageId(),
                            id -> StorefrontSearch.nameScore(StorefrontViews.name(item.product(), chain), q)));
                }
                if (collection != null) {
                    c = c.thenComparingInt(item -> item.product().collectionPositions()
                            .getOrDefault(collection.id(), Integer.MAX_VALUE));
                }
                yield c.thenComparing(newest);
            }
        };
        return inStockFirst.thenComparing(order).thenComparing(byId);
    }

    // ------------------------------------------------------------------ facets

    static StorefrontDtos.Facets facets(StorefrontSnapshot s, ProductQuery query, List<Item> all,
                                        List<StorefrontFacets.Group<Item>> groups, List<String> chain) {
        List<StorefrontDtos.Facet> attributeFacets = new ArrayList<>();
        for (Attribute attribute : s.attributes().values()) {
            if (!attribute.filterable()) {
                continue;
            }
            List<AttributeValue> values = new ArrayList<>();
            Map<String, Predicate<Item>> options = new LinkedHashMap<>();
            for (AttributeValue value : s.attributeValues().values()) {
                if (value.attributeId().equals(attribute.id())) {
                    values.add(value);
                    options.put(value.code(), item -> item.product().attributeValueIds().contains(value.id()));
                }
            }
            Map<String, Integer> counts = StorefrontFacets.count(all, groups, G_ATTRIBUTE + attribute.code(), options);
            List<String> picked = query.attributes() == null ? List.of()
                    : query.attributes().getOrDefault(attribute.code(), List.of());
            List<StorefrontDtos.FacetValue> out = new ArrayList<>();
            for (AttributeValue value : values) {
                int count = counts.getOrDefault(value.code(), 0);
                boolean selected = picked.contains(value.code());
                if (count == 0 && !selected) {
                    continue;
                }
                String label = StorefrontLocale.text(value.labelI18n(), chain);
                out.add(StorefrontDtos.FacetValue.builder().code(value.code())
                        .label(label != null ? label : value.code()).swatchHex(value.swatchHex())
                        .count(count).selected(selected).build());
            }
            if (!out.isEmpty()) {
                String name = StorefrontLocale.text(attribute.nameI18n(), chain);
                attributeFacets.add(StorefrontDtos.Facet.builder().code(attribute.code())
                        .name(name != null ? name : attribute.code()).kind(attribute.kind()).values(out).build());
            }
        }

        List<Item> pricePool = StorefrontFacets.apply(all, groups, G_PRICE);
        BigDecimal min = null;
        BigDecimal max = null;
        for (Item item : pricePool) {
            if (item.price() == null) {
                continue;
            }
            min = min == null || item.price().compareTo(min) < 0 ? item.price() : min;
            max = max == null || item.price().compareTo(max) > 0 ? item.price() : max;
        }
        List<StorefrontDtos.PriceBand> bands = new ArrayList<>();
        BigDecimal lower = null;
        List<BigDecimal> edges = new ArrayList<>(s.settings().priceBands());
        if (!edges.isEmpty()) {
            edges.add(null);
        }
        for (BigDecimal upper : edges) {
            BigDecimal from = lower;
            int count = 0;
            for (Item item : pricePool) {
                if (item.price() != null && (from == null || item.price().compareTo(from) > 0)
                        && (upper == null || item.price().compareTo(upper) <= 0)) {
                    count++;
                }
            }
            bands.add(StorefrontDtos.PriceBand.builder().from(from).to(upper).count(count).build());
            lower = upper;
        }

        List<Item> stockPool = StorefrontFacets.apply(all, groups, G_AVAILABILITY);
        int inStock = 0;
        for (Item item : stockPool) {
            if (item.stock().purchasable()) {
                inStock++;
            }
        }
        return StorefrontDtos.Facets.builder()
                .attributes(attributeFacets)
                .price(StorefrontDtos.PriceFacet.builder().min(min).max(max).bands(bands).build())
                .availability(StorefrontDtos.AvailabilityFacet.builder().inStock(inStock)
                        .outOfStock(stockPool.size() - inStock).build())
                .build();
    }

    // ------------------------------------------------------------------ detail

    public StorefrontDtos.ProductDetail detail(String instituteId, String slug, String locale) {
        StorefrontSnapshot s = loader.snapshot(instituteId);
        Product product = slug == null ? null : s.bySlug().get(slug.trim());
        if (product == null) {
            throw new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", "Product not found.");
        }
        List<String> chain = StorefrontLocale.chain(locale, s.settings().baseLocale());
        Set<String> refs = new LinkedHashSet<>();
        StorefrontViews.collectMediaRefs(product, false, s.settings(), refs);
        // The shop copy holds no long text; the description and the content blocks are read here.
        return StorefrontViews.detail(s, loader.withDetailTexts(instituteId, product), chain, urls(refs),
                clock.instant());
    }

    // ------------------------------------------------------------------ categories

    /**
     * The ACTIVE collections as a tree. {@code kind} narrows to CATEGORY or COLLECTION (null =
     * both); an entry with fewer than {@code minInStock} buyable products is left out with
     * everything under it. An entry whose parent is not ACTIVE is not shown.
     */
    public StorefrontDtos.CategoryTree categories(String instituteId, String locale, String kind, int minInStock) {
        StorefrontSnapshot s = loader.snapshot(instituteId);
        List<String> chain = StorefrontLocale.chain(locale, s.settings().baseLocale());
        String wantedKind = kind == null || kind.isBlank() ? null : kind.trim().toUpperCase(java.util.Locale.ROOT);
        if (wantedKind != null && !wantedKind.equals("CATEGORY") && !wantedKind.equals("COLLECTION")) {
            throw invalid("kind must be CATEGORY or COLLECTION.", "kind");
        }
        List<Item> items = items(s);
        Set<String> refs = new LinkedHashSet<>();
        for (Collection collection : s.collections()) {
            if (collection.mediaId() != null) {
                refs.add(collection.mediaId());
            }
        }
        Function<String, String> url = urls(refs);
        List<StorefrontDtos.Category> roots = new ArrayList<>();
        for (Collection collection : s.collections()) {
            if (collection.parentId() == null && (wantedKind == null || wantedKind.equals(collection.kind()))) {
                StorefrontDtos.Category node = category(s, collection, items, chain, url, minInStock, 1);
                if (node != null) {
                    roots.add(node);
                }
            }
        }
        return StorefrontDtos.CategoryTree.builder().data(roots).locale(StorefrontLocale.effective(chain)).build();
    }

    private static StorefrontDtos.Category category(StorefrontSnapshot s, Collection collection, List<Item> items,
                                                    List<String> chain, Function<String, String> url,
                                                    int minInStock, int depth) {
        Set<String> ids = withDescendants(s, collection.id());
        int products = 0;
        int inStock = 0;
        for (Item item : items) {
            if (hasAny(item.product().collectionPositions().keySet(), ids)) {
                products++;
                if (item.stock().purchasable()) {
                    inStock++;
                }
            }
        }
        if (inStock < minInStock) {
            return null;
        }
        List<StorefrontDtos.Category> children = new ArrayList<>();
        if (depth < MAX_TREE_DEPTH) {
            for (Collection child : s.collections()) {
                if (collection.id().equals(child.parentId())) {
                    StorefrontDtos.Category node = category(s, child, items, chain, url, minInStock, depth + 1);
                    if (node != null) {
                        children.add(node);
                    }
                }
            }
        }
        String name = StorefrontLocale.text(collection.nameI18n(), chain);
        return StorefrontDtos.Category.builder()
                .slug(collection.slug())
                .kind(collection.kind())
                .name(name != null ? name : collection.slug())
                .description(StorefrontLocale.text(collection.descriptionI18n(), chain))
                .imageUrl(url.apply(collection.mediaId()))
                .path(StorefrontViews.collectionPath(collection.slug(), StorefrontLocale.effective(chain),
                        s.settings().baseLocale()))
                .position(collection.position())
                .productCount(products)
                .inStockCount(inStock)
                .children(children)
                .build();
    }

    // ------------------------------------------------------------------ sitemap

    /** Product and collection pages under {@code baseUrl}, bare paths (the base-locale address). */
    public List<Map<String, Object>> sitemapEntries(String instituteId, String baseUrl) {
        StorefrontSnapshot s = loader.snapshot(instituteId);
        StorefrontSettings settings = s.settings();
        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Product product : s.products()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("url", base + StorefrontViews.productPath(product.slug(), settings.baseLocale(),
                    settings.baseLocale()));
            entry.put("type", "product");
            entry.put("id", product.packageId());
            Instant lastmod = product.updatedAt() != null ? product.updatedAt() : product.publishedAt();
            entry.put("lastmod", lastmod == null ? null : lastmod.toString());
            out.add(entry);
        }
        for (Collection collection : s.collections()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("url", base + StorefrontViews.collectionPath(collection.slug(), settings.baseLocale(),
                    settings.baseLocale()));
            entry.put("type", "collection");
            entry.put("id", collection.slug());
            entry.put("lastmod", collection.updatedAt() == null ? null : collection.updatedAt().toString());
            out.add(entry);
        }
        return out;
    }

    static CatalogApiException invalid(String message, String param) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("param", param);
        return new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", message, details, null);
    }
}
