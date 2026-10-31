package vacademy.io.admin_core_service.features.catalog_api.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriUtils;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.rules.*;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogPricing.CardPriceView;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogPricing.Kind;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogPricing.PriceState;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.Category;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.FolderNode;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.Stream;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Group;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Language;
import vacademy.io.admin_core_service.features.catalog_api.rules.LearningPaths.PathEntry;
import vacademy.io.admin_core_service.features.catalog_api.rules.LearningPaths.PathMapping;
import vacademy.io.admin_core_service.features.catalog_api.rules.LearningPaths.Step;
import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerModuleDTOWithDetails;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSubjectProjection;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerOpenStudyLibraryService;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageInviteMappingResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageResponse;
import vacademy.io.admin_core_service.features.study_library.dto.LevelDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.SessionDTOWithDetails;
import vacademy.io.common.auth.dto.UserDTO;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * The catalogue API's read views. Every rule here is the hosted site's (see the ported classes in
 * {@code rules}); this class only decides what to show for a request and shapes the public,
 * snake_case v1 views. It never returns an internal DTO.
 */
@Slf4j
@Service
public class CatalogApiService {

    public static final int MAX_PAGE_SIZE = 100;
    static final int SUBTITLE_MAX = 300;
    static final int SEO_DESCRIPTION_MAX = 160;
    private static final int MAX_SERIES_PATHS = 12;
    /** Sort tokens, in the order the error message lists them (the v1.0 four first). */
    static final Set<String> SORTS = new LinkedHashSet<>(List.of("newest", "title", "price_asc", "price_desc",
            "oldest", "rating", "title_desc", "popular", "relevance"));
    static final Set<String> AVAILABILITIES = Set.of("available", "coming_soon", "not_started", "closed");

    private final CatalogDataLoader loader;
    private final LearnerOpenStudyLibraryService openStudyLibraryService;
    private final PackagePageContentService pageContentService;

    /** "now" for the New badge; replaceable in tests. */
    java.time.Clock clock = java.time.Clock.systemUTC();

    private final Cache<String, Map<String, Object>> outlines = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(5)).maximumSize(5_000).build();

    public CatalogApiService(CatalogDataLoader loader, LearnerOpenStudyLibraryService openStudyLibraryService,
                             PackagePageContentService pageContentService) {
        this.loader = loader;
        this.openStudyLibraryService = openStudyLibraryService;
        this.pageContentService = pageContentService;
    }

    // ── Cards ──────────────────────────────────────────────────────────────────

    /** One course as the API lists it: its versions (a language-grouped card), tags and formats. */
    record Card(Group<CatalogRow> group, int order, Set<String> tagSet, List<String> formatKeys, Instant createdAt) {
        CatalogRow primary() {
            return group.primary();
        }

        List<CatalogRow> rows() {
            return group.variants();
        }

        boolean hasPackage(String packageId) {
            for (CatalogRow r : rows()) if (packageId.equals(r.packageId())) return true;
            return false;
        }

        /** Every package id of the card, first-seen order. */
        List<String> packageIds() {
            LinkedHashSet<String> ids = new LinkedHashSet<>();
            for (CatalogRow r : rows()) if (r.packageId() != null) ids.add(r.packageId());
            return List.copyOf(ids);
        }

        /** The card's enrolment rank: a card folding several packages ranks as its best one ({@code bestRankedId}). */
        Integer rank(Map<String, Integer> ranks) {
            return ranks.isEmpty() ? null : CourseBadges.bestRank(packageIds(), ranks);
        }
    }

    /**
     * The institute's courses, one card per package (or per authored version group when the site
     * groups language versions), in catalogue order. Unlike the site with grouping off (one card
     * per level), a package's levels are always one card here, so a course id names one card;
     * its levels are the card's variants.
     */
    List<Card> cards(CatalogSnapshot s, String preferredLanguage) {
        SiteConfig site = s.site();
        String preferred = site.courseLanguagesOn() ? preferredLanguage : null;
        List<Group<CatalogRow>> groups = CourseLanguages.groupRows(s.rows(), true, site.languages(), preferred,
                site.grouping() ? site.versionGroups() : null);
        List<Card> out = new ArrayList<>(groups.size());
        int i = 0;
        for (Group<CatalogRow> g : groups) {
            Set<String> tagSet = new LinkedHashSet<>();
            Instant created = null;
            for (CatalogRow r : g.variants()) {
                for (String t : CourseFormats.rowTags(r.tags(), null)) if (!LevelKeys.isLevelKey(t)) tagSet.add(t);
                // A course levelled like a stream or category belongs to it (LevelKeys).
                String level = LevelKeys.levelKey(r.levelName());
                if (level != null) tagSet.add(level);
                if (r.createdAt() != null && (created == null || r.createdAt().isAfter(created))) created = r.createdAt();
            }
            out.add(new Card(g, i++, tagSet, CourseFormats.cardFormatKeys(g.variants(), site.formats()), created));
        }
        return out;
    }

    private static Language languageOf(CatalogSnapshot s, CatalogRow r) {
        return CourseLanguages.languageOfRow(r, s.site().languages());
    }

    /** A site language code (lower-case) when languages are on and the code is one of them, else null. */
    private static String siteLanguage(CatalogSnapshot s, String language) {
        if (language == null || language.isBlank() || !s.site().courseLanguagesOn()) return null;
        String code = language.trim().toLowerCase(Locale.ROOT);
        for (Language l : s.site().languages()) if (l.code().equals(code)) return code;
        return code; // unknown code: filters to nothing, never silently to everything
    }

    // ── Request extras: enrolment ranks and badges ─────────────────────────────

    /**
     * What a request knows beyond the snapshot: enrolment ranks (package id → rank) and every
     * badge each card earned (card id → badges, in the site's priority order).
     */
    record Extras(Map<String, Integer> ranks, Map<String, List<String>> badges) {
        static final Extras NONE = new Extras(Map.of(), Map.of());
    }

    /** Ranks never fail a request: an unreadable popularity source is "nothing ranked". */
    private Map<String, Integer> ranksOf(String instituteId) {
        try {
            Map<String, Integer> ranks = loader.ranks(instituteId);
            return ranks == null ? Map.of() : ranks;
        } catch (Exception e) {
            log.warn("catalog-api: popularity ranks failed for {}: {}", instituteId, e.getMessage());
            return Map.of();
        }
    }

    Extras extras(CatalogSnapshot s, List<Card> cards) {
        Map<String, Integer> ranks = ranksOf(s.instituteId());
        return new Extras(ranks, earnedBadges(s, cards, ranks, clock.instant()));
    }

    /**
     * Badge priority: the section's {@code badges.types} first (its display order), then the
     * other badges in the default order.
     */
    static List<String> badgeOrder(SiteConfig site) {
        CatalogDiscovery.BadgeRules rules = site.discovery().badges();
        LinkedHashSet<String> order = new LinkedHashSet<>();
        if (rules != null) order.addAll(rules.types());
        order.addAll(CourseBadges.ALL_BADGES);
        return List.copyOf(order);
    }

    /**
     * Every badge each card earned, uncapped and over all four kinds — the site's
     * {@code earnedBadges}, which its badge filter reads (CourseCatalogComponent.tsx) — with the
     * section's newDays / bestsellerTop. One input per card: the first date seen per package
     * (the newest across a version group's packages), the cheapest version on sale now (null when
     * none is), the card's tags plus the tag of every stream it is in; a card folding several
     * packages ranks as its best one.
     */
    static Map<String, List<String>> earnedBadges(CatalogSnapshot s, List<Card> cards, Map<String, Integer> ranks,
                                                  Instant now) {
        CatalogDiscovery.BadgeRules rules = s.site().discovery().badges();
        List<String> streamTags = new ArrayList<>();
        for (Stream st : s.streams()) if (st.tag() != null && !st.tag().isEmpty()) streamTags.add(st.tag());
        List<CourseBadges.Input> inputs = new ArrayList<>(cards.size());
        Map<String, Integer> cardRanks = new HashMap<>();
        for (Card card : cards) {
            Map<String, Instant> firstDate = new LinkedHashMap<>();
            Double price = null;
            for (CatalogRow r : card.rows()) {
                if (r.packageId() != null && !firstDate.containsKey(r.packageId())) firstDate.put(r.packageId(), r.createdAt());
                if (CatalogPricing.isBuyableNow(r)) price = price == null ? r.price() : Math.min(price, r.price());
            }
            Instant created = null;
            for (Instant t : firstDate.values()) if (t != null && (created == null || t.isAfter(created))) created = t;
            Set<String> tags = new LinkedHashSet<>(card.tagSet());
            for (Stream st : s.streams()) if (CatalogStreams.matchesAny(st.tags(), card.tagSet())) tags.add(st.tag());
            String id = card.group().courseId();
            inputs.add(new CourseBadges.Input(id, created, price, tags));
            Integer rank = card.rank(ranks);
            if (rank != null) cardRanks.put(id, rank);
        }
        return CourseBadges.compute(inputs, cardRanks, streamTags, now, badgeOrder(s.site()),
                rules == null ? 60 : rules.newDaysOrDefault(), rules == null ? 3 : rules.bestsellerTopOrDefault(),
                CourseBadges.ALL_BADGES.size());
    }

    // ── GET /site ───────────────────────────────────────────────────────────────

    public Map<String, Object> site(String instituteId) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        Map<String, Object> institute = new LinkedHashMap<>();
        institute.put("id", s.instituteId());
        institute.put("name", s.instituteName());
        institute.put("logo_url", s.mediaUrl(s.instituteLogoFileId()));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("institute", institute);
        out.put("course_base_url", s.courseBaseUrl());
        out.put("languages", s.site().courseLanguagesOn() ? languageViews(s.site().languages()) : List.of());
        out.put("formats", formatViews(s, s.site().formats() == null ? List.of()
                : s.site().formats().list().stream().map(CourseFormats.Format::key).toList()));
        String currency = dominantCurrency(s.rows());
        out.put("currency", currency);
        out.put("price_visible", s.site().paymentEnabled());
        out.put("catalog", catalogView(s.site()));
        return out;
    }

    /**
     * The Courses section's discovery settings as the hosted site reads them
     * ({@link CatalogDiscovery}), so a client can offer the same sort menu, quick filters,
     * filter groups and badges.
     */
    static Map<String, Object> catalogView(SiteConfig site) {
        CatalogDiscovery d = site.discovery();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("default_sort", d.defaultSort());
        out.put("sort_options", d.sortOptions());
        out.put("show_filter_counts", d.showFilterCounts());
        out.put("quick_filters", d.quickFilters().stream().map(qf -> quickFilterView(site, qf)).toList());

        Map<String, Object> price = new LinkedHashMap<>();
        price.put("enabled", d.priceFilter().enabled());
        price.put("label", blankToNull(d.priceFilter().label()));
        price.put("show_free", d.priceFilter().showFree());
        price.put("max_options", d.priceFilter().maxOptions());
        out.put("price_filter", price);

        Map<String, Object> language = new LinkedHashMap<>();
        language.put("enabled", d.languageFilter().enabled());
        language.put("label", blankToNull(d.languageFilter().label()));
        out.put("language_filter", language);

        CatalogDiscovery.CategoryFilter cf = d.categoryFilter();
        Map<String, Object> category = new LinkedHashMap<>();
        category.put("enabled", cf.enabled());
        category.put("label", blankToNull(cf.label()));
        category.put("scope", cf.scope() == null ? "stream" : cf.scope());
        category.put("label_mode", cf.labelMode() == null ? "title" : cf.labelMode());
        category.put("sort", cf.sort() == null ? "folder" : cf.sort());
        category.put("hide_coming_soon", cf.hideComingSoon());
        category.put("visible_count", cf.visibleCount());
        category.put("show_all_label", cf.showAllLabel());
        out.put("category_filter", category);

        CatalogDiscovery.BadgeRules rules = d.badges();
        Map<String, Object> badges = new LinkedHashMap<>();
        badges.put("enabled", rules != null);
        badges.put("types", rules == null ? List.of() : rules.types());
        badges.put("new_days", rules == null ? 60 : rules.newDaysOrDefault());
        badges.put("bestseller_top", rules == null ? 3 : rules.bestsellerTopOrDefault());
        badges.put("max", rules == null ? 2 : rules.maxOrDefault());
        out.put("badges", badges);

        out.put("custom_filters", d.customFilters().stream().map(f -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", f.id());
            m.put("label", blankToNull(f.label()));
            m.put("source", f.source() == null ? null : "course_formats");
            m.put("options", f.options().stream().map(o -> {
                Map<String, Object> om = new LinkedHashMap<>();
                om.put("id", o.id());
                om.put("label", o.label());
                return om;
            }).toList());
            m.put("show_counts", f.showCounts() == null ? d.showFilterCounts() : f.showCounts());
            m.put("show_empty", f.showEmpty());
            m.put("visible_count", f.visibleCount());
            return m;
        }).toList());

        out.put("popular_searches", d.popular().stream().map(c -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("label", c.label());
            m.put("kind", "quick".equals(c.kind()) ? "quick_filter" : c.kind());
            m.put("search", c.search());
            m.put("stream", c.streamSlug());
            m.put("category", c.categorySlug());
            m.put("quick_filter", c.quickFilterId());
            m.put("route", c.route());
            return m;
        }).toList());
        return out;
    }

    /**
     * A quick filter: its authored label, else the site's English default; {@code params} are
     * the /courses parameters that apply it (the site toggles the same state:
     * catalog-quick-filters.ts).
     */
    private static Map<String, Object> quickFilterView(SiteConfig site, CatalogDiscovery.QuickFilter qf) {
        Map<String, Object> params = new LinkedHashMap<>();
        String fallback;
        switch (qf.kind()) {
            case "popular" -> {
                params.put("sort", "popular");
                fallback = "Popular";
            }
            case "new" -> {
                params.put("badge", "new");
                fallback = "New";
            }
            case "bestseller" -> {
                params.put("badge", "bestseller");
                fallback = "Bestsellers";
            }
            case "free" -> {
                params.put("price", "free");
                fallback = "Free";
            }
            case "language" -> {
                params.put("language", qf.value());
                fallback = site.languages().stream().filter(l -> l.code().equals(qf.value())).findFirst()
                        .map(l -> languageLabel(l)).orElse(String.valueOf(qf.value()).toUpperCase(Locale.ROOT));
            }
            default -> { // priceMax
                params.put("price_max", qf.value());
                fallback = "Under " + plainAmount((Double) qf.value());
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", qf.id());
        m.put("label", qf.label().isEmpty() ? fallback : qf.label());
        m.put("kind", "priceMax".equals(qf.kind()) ? "price_max" : qf.kind());
        m.put("value", qf.value());
        m.put("params", params);
        return m;
    }

    private static String plainAmount(Double v) {
        if (v == null) return "";
        return v == Math.rint(v) ? String.valueOf(v.longValue()) : String.valueOf(v);
    }

    private static String dominantCurrency(List<CatalogRow> rows) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (CatalogRow r : rows) {
            if (r.currency() != null && !r.currency().isBlank()) {
                counts.merge(r.currency().trim().toUpperCase(Locale.ROOT), 1, Integer::sum);
            }
        }
        return counts.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
    }

    // ── GET /courses ────────────────────────────────────────────────────────────

    /**
     * A /courses request. List parameters are comma lists (OR within a parameter, AND across
     * parameters); null = not given.
     */
    public record CourseQuery(String q, String stream, String category, String format, String language, String tag,
                              String availability, int page, int pageSize, String sort,
                              String level, String instructor, String session, String badge, String price,
                              String priceMin, String priceMax, String custom, boolean facets) {

        /** The v1.0 parameters only. */
        public CourseQuery(String q, String stream, String category, String format, String language, String tag,
                           String availability, int page, int pageSize, String sort) {
            this(q, stream, category, format, language, tag, availability, page, pageSize, sort,
                    null, null, null, null, null, null, null, null, false);
        }
    }

    /** The filter group ids (catalog-filters.ts GROUP_IDS, plus the API's format and availability). */
    static final String G_SEARCH = "search", G_STREAM = "stream", G_CATEGORY = "category", G_FORMAT = "format",
            G_BADGE = "badge", G_LANGUAGE = "language", G_PRICE = "price", G_LEVEL = "level", G_SESSION = "session",
            G_TAG = "tag", G_INSTRUCTOR = "instructor", G_PRICE_RANGE = "price_range", G_AVAILABILITY = "availability",
            G_CUSTOM = "custom:";

    /** A parsed, validated query and the cards it runs over. */
    private record Criteria(String sort, String q, List<String> streamSlugs, List<Stream> streams,
                            List<String> categorySlugs, List<Category> categories, List<String> formats,
                            List<String> languages, List<String> tags, List<String> levels, List<String> instructors,
                            List<String> sessions, List<String> badges, CatalogFilters.PriceChoice price,
                            Double priceMin, Double priceMax, Map<String, List<CatalogDiscovery.CustomOption>> custom,
                            String availability) {
    }

    public Map<String, Object> courses(String instituteId, CourseQuery query) {
        String sort = query.sort() == null || query.sort().isBlank() ? "newest" : query.sort().trim().toLowerCase(Locale.ROOT);
        if (!SORTS.contains(sort)) {
            throw invalid("sort must be one of " + String.join(", ", SORTS) + ".", "sort");
        }
        if (query.page() < 1) throw invalid("page starts at 1.", "page");
        if (query.pageSize() < 1 || query.pageSize() > MAX_PAGE_SIZE) {
            throw invalid("page_size must be between 1 and " + MAX_PAGE_SIZE + ".", "page_size");
        }
        String availability = blankToNull(query.availability());
        if (availability != null && !AVAILABILITIES.contains(availability.toLowerCase(Locale.ROOT))) {
            throw invalid("availability must be one of available, coming_soon, not_started, closed.", "availability");
        }
        List<String> badges = lowerList(query.badge());
        for (String b : badges) {
            if (!CourseBadges.ALL_BADGES.contains(b)) throw invalid("badge must be a comma list of bestseller, popular, new, free.", "badge");
        }
        CatalogFilters.PriceChoice price = null;
        if (blankToNull(query.price()) != null) {
            price = switch (query.price().trim().toLowerCase(Locale.ROOT)) {
                case "free" -> CatalogFilters.PriceChoice.FREE;
                case "paid" -> CatalogFilters.PriceChoice.PAID;
                default -> throw invalid("price must be free or paid.", "price");
            };
        }
        Double priceMin = amountParam("price_min", query.priceMin());
        Double priceMax = amountParam("price_max", query.priceMax());

        CatalogSnapshot s = loader.snapshot(instituteId);
        Map<String, List<CatalogDiscovery.CustomOption>> custom = customParam(s.site(), query.custom());
        List<String> languages = new ArrayList<>();
        for (String code : list(query.language())) {
            String c = siteLanguage(s, code);
            if (c != null && !languages.contains(c)) languages.add(c);
        }
        // A single language opens that version of every card (the site: "a single language filter wins").
        List<Card> all = cards(s, languages.size() == 1 ? languages.get(0) : null);
        Extras extras = extras(s, all);

        List<String> streamSlugs = list(query.stream());
        List<Stream> streams = s.streams().stream()
                .filter(st -> streamSlugs.stream().anyMatch(slug -> slug.equalsIgnoreCase(st.slug()))).toList();
        List<String> categorySlugs = list(query.category());
        List<Stream> scope = streamSlugs.isEmpty() ? s.streams() : streams;
        List<Category> categories = new ArrayList<>();
        for (String slug : categorySlugs) {
            scope.stream().flatMap(st -> st.categories().stream()).filter(c -> c.slug().equalsIgnoreCase(slug))
                    .findFirst().ifPresent(c -> {
                        if (!categories.contains(c)) categories.add(c);
                    });
        }
        String q = blankToNull(query.q()) == null ? null : query.q().trim().toLowerCase(Locale.ROOT);
        Criteria c = new Criteria(sort, q, streamSlugs, streams, categorySlugs, categories, lowerList(query.format()),
                languages, lowerList(query.tag()), list(query.level()), list(query.instructor()), list(query.session()),
                badges, price, priceMin, priceMax, custom,
                availability == null ? null : availability.toLowerCase(Locale.ROOT));

        boolean priceSort = sort.startsWith("price");
        List<CatalogFilters.Group<Card, CatalogRow>> groups = CatalogFilters.remember(groups(s, c, extras, priceSort));
        List<Card> matched = CatalogFilters.apply(all, Card::rows, groups, null);

        record Hit(Card card, Map<String, Object> view, double sortPrice, Integer rank, double relevance) {
        }
        List<String> qWords = "relevance".equals(sort) && q != null ? CatalogSearch.queryWords(q) : List.of();
        List<Hit> hits = new ArrayList<>();
        for (Card card : matched) {
            List<CatalogRow> matching = CatalogFilters.rowsMatching(card, Card::rows, groups);
            Map<String, Object> view = summary(s, extras, card, card.primary(), matching, priceSort);
            hits.add(new Hit(card, view, CatalogPricing.sortPrice(matching), card.rank(extras.ranks()),
                    "relevance".equals(sort) ? relevance(card, q, qWords) : 0));
        }

        Comparator<Hit> byOrder = Comparator.comparingInt(h -> h.card().order());
        Comparator<Hit> comparator = switch (sort) {
            case "title" -> Comparator.comparing((Hit h) -> h.card().primary().title(), String.CASE_INSENSITIVE_ORDER)
                    .thenComparing(byOrder);
            case "title_desc" -> Comparator.comparing((Hit h) -> h.card().primary().title(),
                    String.CASE_INSENSITIVE_ORDER.reversed()).thenComparing(byOrder);
            case "price_asc" -> Comparator.comparingDouble(Hit::sortPrice).thenComparing(byOrder);
            case "price_desc" -> Comparator.comparingDouble((Hit h) -> -h.sortPrice()).thenComparing(byOrder);
            case "oldest" -> Comparator.comparing((Hit h) -> h.card().createdAt(),
                    Comparator.nullsLast(Comparator.naturalOrder())).thenComparing(byOrder);
            case "rating" -> Comparator.comparing((Hit h) -> ratingOf(h.card().primary()),
                    Comparator.nullsLast(Comparator.reverseOrder())).thenComparing(byOrder);
            // catalog-sort.ts "Popular": ranked by rank, the rest after them in catalogue order.
            case "popular" -> ((Comparator<Hit>) (a, b) -> CourseBadges.comparePopularity(a.rank(), b.rank()))
                    .thenComparing(byOrder);
            // Best title match to q first (CatalogSearch.titleScore), then newest; without q, newest.
            case "relevance" -> Comparator.comparingDouble((Hit h) -> -h.relevance())
                    .thenComparing((Hit h) -> h.card().createdAt(), Comparator.nullsLast(Comparator.reverseOrder()))
                    .thenComparing(byOrder);
            default -> Comparator.comparing((Hit h) -> h.card().createdAt(),
                    Comparator.nullsLast(Comparator.reverseOrder())).thenComparing(byOrder);
        };
        hits.sort(comparator);
        long offset = (long) (query.page() - 1) * query.pageSize();
        int from = (int) Math.min(hits.size(), offset);
        int to = (int) Math.min(hits.size(), (long) from + query.pageSize());
        List<Map<String, Object>> data = hits.subList(from, to).stream().map(Hit::view).toList();
        Map<String, Object> out = page(data, query, hits.size());
        if (query.facets()) out.put("facets", facets(s, c, extras, all, groups));
        return out;
    }

    /** A card's best version title score against q (0 without q). */
    private static double relevance(Card card, String q, List<String> qWords) {
        if (q == null) return 0;
        double best = 0;
        for (CatalogRow r : card.rows()) best = Math.max(best, CatalogSearch.titleScore(r.title(), q, qWords));
        return best;
    }

    private static Double ratingOf(CatalogRow r) {
        return r.rating() != null && r.rating() > 0 ? r.rating() : null;
    }

    /** The filter groups of one request, in catalog-filters.ts order (card groups, row groups, authored groups). */
    private List<CatalogFilters.Group<Card, CatalogRow>> groups(CatalogSnapshot s, Criteria c, Extras extras,
                                                                boolean priceSort) {
        List<CatalogFilters.Group<Card, CatalogRow>> g = new ArrayList<>();
        List<String> qWords = c.q() == null ? List.of() : CatalogSearch.queryWords(c.q());
        g.add(new CatalogFilters.Group<>(G_SEARCH, c.q() != null, card -> matchesText(card, c.q(), qWords), null));
        // An unknown stream / category slug matches nothing, never silently everything.
        g.add(new CatalogFilters.Group<>(G_STREAM, !c.streamSlugs().isEmpty(),
                card -> c.streams().stream().anyMatch(st -> CatalogStreams.matchesAny(st.tags(), card.tagSet())), null));
        g.add(new CatalogFilters.Group<>(G_CATEGORY, !c.categorySlugs().isEmpty(),
                card -> c.categories().stream().anyMatch(cat -> CatalogStreams.matchesAny(cat.tags(), card.tagSet())),
                null));
        g.add(new CatalogFilters.Group<>(G_FORMAT, !c.formats().isEmpty(),
                card -> card.formatKeys().stream().anyMatch(c.formats()::contains), null));
        g.add(new CatalogFilters.Group<>(G_BADGE, !c.badges().isEmpty(),
                card -> extras.badges().getOrDefault(card.group().courseId(), List.of()).stream()
                        .anyMatch(c.badges()::contains), null));
        g.add(new CatalogFilters.Group<>(G_LANGUAGE, !c.languages().isEmpty(), null, r -> {
            Language l = languageOf(s, r);
            return l != null && c.languages().contains(l.code());
        }));
        g.add(new CatalogFilters.Group<>(G_PRICE, c.price() != null, null,
                r -> CatalogFilters.rowMatchesPrice(r, c.price())));
        g.add(new CatalogFilters.Group<>(G_LEVEL, !c.levels().isEmpty(), null,
                r -> CatalogFilters.rowMatchesLevels(r, c.levels())));
        g.add(new CatalogFilters.Group<>(G_SESSION, !c.sessions().isEmpty(), null,
                r -> r.sessionId() != null && c.sessions().contains(r.sessionId())));
        g.add(new CatalogFilters.Group<>(G_TAG, !c.tags().isEmpty(), null,
                r -> rowTagKeys(r).stream().anyMatch(c.tags()::contains)));
        g.add(new CatalogFilters.Group<>(G_INSTRUCTOR, !c.instructors().isEmpty(), null, r -> {
            String name = r.firstInstructorName();
            return name != null && c.instructors().stream().anyMatch(i -> i.equalsIgnoreCase(name.trim()));
        }));
        g.add(new CatalogFilters.Group<>(G_PRICE_RANGE, c.priceMin() != null || c.priceMax() != null, null,
                r -> CatalogFilters.rowInPriceRange(r, c.priceMin(), c.priceMax())));
        for (Map.Entry<String, List<CatalogDiscovery.CustomOption>> e : c.custom().entrySet()) {
            List<CatalogDiscovery.CustomOption> options = e.getValue();
            g.add(new CatalogFilters.Group<>(G_CUSTOM + e.getKey(), true,
                    card -> options.stream().anyMatch(o -> card.rows().stream()
                            .anyMatch(r -> CatalogDiscovery.rowMatchesCustomOption(r, o))), null));
        }
        if (c.availability() != null) {
            // What the card would say, over the versions every row group lets through.
            List<CatalogFilters.Group<Card, CatalogRow>> rowGroups = List.copyOf(g);
            g.add(new CatalogFilters.Group<>(G_AVAILABILITY, true, card -> {
                List<CatalogRow> matching = CatalogFilters.rowsMatching(card, Card::rows, rowGroups);
                if (matching.isEmpty()) return false;
                PriceState state = displayedState(s.site(), card.primary(), matching, priceSort);
                return c.availability().equals(CatalogPricing.availabilityOf(state));
            }, null));
        }
        return g;
    }

    /** A version's tags as the tag filter matches them: lower-case course tags and its level key. */
    static Set<String> rowTagKeys(CatalogRow r) {
        Set<String> out = new LinkedHashSet<>();
        for (String t : CourseFormats.rowTags(r.tags(), null)) if (!LevelKeys.isLevelKey(t)) out.add(t);
        String level = LevelKeys.levelKey(r.levelName());
        if (level != null) out.add(level);
        return out;
    }

    private static Double amountParam(String name, String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            double v = Double.parseDouble(raw.trim());
            if (Double.isFinite(v) && v >= 0) return v;
        } catch (NumberFormatException ignored) {
            // falls through to the error
        }
        throw invalid(name + " must be a number of 0 or more.", name);
    }

    /**
     * {@code custom=<groupId>:<optionId>,…} → selected options per authored group. An unknown
     * group or option selects nothing (so that group matches no course), as an unknown stream does.
     */
    static Map<String, List<CatalogDiscovery.CustomOption>> customParam(SiteConfig site, String raw) {
        Map<String, List<CatalogDiscovery.CustomOption>> out = new LinkedHashMap<>();
        for (String token : list(raw)) {
            int at = token.indexOf(':');
            String group = at < 0 ? "" : token.substring(0, at).trim().toLowerCase(Locale.ROOT);
            String option = at < 0 ? "" : token.substring(at + 1).trim().toLowerCase(Locale.ROOT);
            if (group.isEmpty() || option.isEmpty()) {
                throw invalid("custom must be a comma list of <group id>:<option id>.", "custom");
            }
            List<CatalogDiscovery.CustomOption> selected = out.computeIfAbsent(group, k -> new ArrayList<>());
            site.discovery().customFilters().stream().filter(f -> f.id().equals(group)).findFirst()
                    .flatMap(f -> f.options().stream().filter(o -> o.id().equals(option)).findFirst())
                    .ifPresent(o -> {
                        if (!selected.contains(o)) selected.add(o);
                    });
        }
        return out;
    }

    /** Comma list: trimmed, blanks dropped, duplicates (case-insensitive) dropped. */
    static List<String> list(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String part : raw.split(",")) {
            String v = part.trim();
            if (!v.isEmpty() && seen.add(v.toLowerCase(Locale.ROOT))) out.add(v);
        }
        return out;
    }

    private static List<String> lowerList(String raw) {
        return list(raw).stream().map(v -> v.toLowerCase(Locale.ROOT)).toList();
    }

    /** Plain-text descriptions, lower-case, per row object (rows live as long as their snapshot). */
    private final Cache<CatalogRow, String> searchDescriptions = Caffeine.newBuilder().weakKeys()
            .maximumSize(100_000).build();

    /** Search words per row object: title, tags, instructors and plain-text description ({@link CatalogSearch}). */
    private final Cache<CatalogRow, Set<String>> searchWords = Caffeine.newBuilder().weakKeys()
            .maximumSize(100_000).build();

    /**
     * Search: the whole query as a substring of any version's title or description (plain text) — the
     * site's {@code rowMatchesSearch} — or of any version's instructor name, or of a course tag; else
     * every query word among the card's words ({@link CatalogSearch}). Level keys are internal and never match.
     */
    private boolean matchesText(Card card, String q, List<String> qWords) {
        if (matchesPhrase(card, q)) return true;
        if (qWords.isEmpty()) return false;
        Set<String> words = new HashSet<>();
        for (CatalogRow r : card.rows()) words.addAll(searchWords.get(r, this::rowWords));
        return CatalogSearch.matchesAll(qWords, words);
    }

    private Set<String> rowWords(CatalogRow row) {
        Set<String> words = new HashSet<>(CatalogSearch.words(row.title()));
        for (String t : CourseFormats.rowTags(row.tags(), null)) {
            if (!LevelKeys.isLevelKey(t)) words.addAll(CatalogSearch.words(t));
        }
        for (CatalogRow.Person p : row.instructors()) words.addAll(CatalogSearch.words(p.name()));
        words.addAll(CatalogSearch.words(plainDescription(row)));
        return words;
    }

    private String plainDescription(CatalogRow row) {
        return searchDescriptions.get(row, r -> {
            String text = CatalogHtml.plainText(r.descriptionHtml());
            return text == null ? "" : text.toLowerCase(Locale.ROOT);
        });
    }

    private boolean matchesPhrase(Card card, String q) {
        for (CatalogRow r : card.rows()) {
            if (r.title() != null && r.title().toLowerCase(Locale.ROOT).contains(q)) return true;
        }
        for (String t : card.tagSet()) if (!LevelKeys.isLevelKey(t) && t.contains(q)) return true;
        for (CatalogRow r : card.rows()) {
            for (CatalogRow.Person p : r.instructors()) {
                if (p.name() != null && p.name().toLowerCase(Locale.ROOT).contains(q)) return true;
            }
            if (plainDescription(r).contains(q)) return true;
        }
        return false;
    }

    private static Map<String, Object> page(List<Map<String, Object>> data, CourseQuery query, int total) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        out.put("page", query.page());
        out.put("page_size", query.pageSize());
        out.put("total", total);
        out.put("has_more", (long) query.page() * query.pageSize() < total);
        return out;
    }

    // ── facets ──────────────────────────────────────────────────────────────────

    /**
     * Live counts per filter option, each counted against every OTHER active filter
     * ({@code countFacetOptions}; CourseCatalogComponent's facetCounts). Only options with a
     * count above 0 are listed, except authored groups whose {@code showEmpty} is on.
     */
    private Map<String, Object> facets(CatalogSnapshot s, Criteria c, Extras extras, List<Card> all,
                                       List<CatalogFilters.Group<Card, CatalogRow>> groups) {
        SiteConfig site = s.site();
        Map<String, Object> out = new LinkedHashMap<>();

        List<CatalogFilters.Option<Card, CatalogRow>> streamOptions = new ArrayList<>();
        Map<String, String> streamLabels = new LinkedHashMap<>();
        for (Stream st : s.streams()) {
            streamOptions.add(new CatalogFilters.Option<>(st.slug(),
                    card -> CatalogStreams.matchesAny(st.tags(), card.tagSet()), null));
            streamLabels.put(st.slug(), CatalogStreams.placeLabel(st.title(), st.subtitle(), site.labelMode(), null));
        }
        out.put("streams", facetList("slug", streamLabels,
                CatalogFilters.countOptions(all, Card::rows, groups, G_STREAM, streamOptions)));

        List<Stream> scope = c.streams().isEmpty() ? s.streams() : c.streams();
        List<CatalogFilters.Option<Card, CatalogRow>> categoryOptions = new ArrayList<>();
        Map<String, String> categoryLabels = new LinkedHashMap<>();
        Set<String> seenCategories = new HashSet<>();
        for (Stream st : scope) {
            for (Category cat : st.categories()) {
                if (!seenCategories.add(cat.slug().toLowerCase(Locale.ROOT))) continue;
                categoryOptions.add(new CatalogFilters.Option<>(cat.slug(),
                        card -> CatalogStreams.matchesAny(cat.tags(), card.tagSet()), null));
                categoryLabels.put(cat.slug(), CatalogStreams.placeLabel(cat.title(), cat.subtitle(), site.labelMode(), null));
            }
        }
        out.put("categories", facetList("slug", categoryLabels,
                CatalogFilters.countOptions(all, Card::rows, groups, G_CATEGORY, categoryOptions)));

        List<CatalogFilters.Option<Card, CatalogRow>> formatOptions = new ArrayList<>();
        Map<String, String> formatLabels = new LinkedHashMap<>();
        if (site.formats() != null) {
            for (CourseFormats.Format f : site.formats().list()) {
                formatOptions.add(new CatalogFilters.Option<>(f.key(), card -> card.formatKeys().contains(f.key()), null));
                formatLabels.put(f.key(), f.label());
            }
        }
        out.put("formats", facetList("key", formatLabels,
                CatalogFilters.countOptions(all, Card::rows, groups, G_FORMAT, formatOptions)));

        List<CatalogFilters.Option<Card, CatalogRow>> languageOptions = new ArrayList<>();
        Map<String, String> languageLabels = new LinkedHashMap<>();
        if (site.courseLanguagesOn()) {
            Set<String> present = new HashSet<>();
            for (CatalogRow r : s.rows()) {
                Language l = languageOf(s, r);
                if (l != null) present.add(l.code());
            }
            for (Language l : site.languages()) {
                if (!present.contains(l.code())) continue;
                languageOptions.add(new CatalogFilters.Option<>(l.code(), null, r -> {
                    Language rl = languageOf(s, r);
                    return rl != null && rl.code().equals(l.code());
                }));
                languageLabels.put(l.code(), languageLabel(l));
            }
        }
        out.put("languages", facetList("code", languageLabels,
                CatalogFilters.countOptions(all, Card::rows, groups, G_LANGUAGE, languageOptions)));

        // Levels: real level names (no placeholder; with grouping, no level that is only a language).
        Map<String, String> levelLabels = new LinkedHashMap<>();
        Set<String> seenLevels = new HashSet<>();
        for (CatalogRow r : s.rows()) {
            String name = r.levelName() == null ? null : r.levelName().trim();
            if (CatalogFilters.isSentinel(name)) continue;
            if (site.grouping() && CatalogFilters.isPureLanguageLevel(name, site.languages())) continue;
            if (seenLevels.add(name.toLowerCase(Locale.ROOT))) levelLabels.put(name, name);
        }
        List<String> levelKeys = new ArrayList<>(levelLabels.keySet());
        levelKeys.sort(authoredOrder(site.discovery().levelOrder()));
        Map<String, String> sortedLevels = new LinkedHashMap<>();
        for (String k : levelKeys) sortedLevels.put(k, levelLabels.get(k));
        out.put("levels", facetList("key", sortedLevels, CatalogFilters.countOptions(all, Card::rows, groups, G_LEVEL,
                levelKeys.stream().map(l -> new CatalogFilters.Option<Card, CatalogRow>(l, null,
                        r -> CatalogFilters.rowMatchesLevels(r, List.of(l)))).toList())));

        Map<String, String> sessionLabels = new LinkedHashMap<>();
        for (CatalogRow r : s.rows()) {
            if (r.sessionId() == null || sessionLabels.containsKey(r.sessionId())) continue;
            String name = r.sessionName() != null ? r.sessionName() : r.sessionId();
            if (!CatalogFilters.isSentinel(name)) sessionLabels.put(r.sessionId(), name.trim());
        }
        List<String> sessionIds = new ArrayList<>(sessionLabels.keySet());
        sessionIds.sort((a, b) -> naturalCompare(sessionLabels.get(a), sessionLabels.get(b)));
        Map<String, String> sortedSessions = new LinkedHashMap<>();
        for (String id : sessionIds) sortedSessions.put(id, sessionLabels.get(id));
        out.put("sessions", facetList("id", sortedSessions, CatalogFilters.countOptions(all, Card::rows, groups,
                G_SESSION, sessionIds.stream().map(id -> new CatalogFilters.Option<Card, CatalogRow>(id, null,
                        r -> id.equals(r.sessionId()))).toList())));

        Map<String, String> instructorLabels = new LinkedHashMap<>();
        Set<String> seenInstructors = new HashSet<>();
        for (CatalogRow r : s.rows()) {
            String name = r.firstInstructorName();
            if (name != null && !name.isBlank() && seenInstructors.add(name.trim().toLowerCase(Locale.ROOT))) {
                instructorLabels.put(name.trim(), name.trim());
            }
        }
        out.put("instructors", facetList("key", instructorLabels, CatalogFilters.countOptions(all, Card::rows, groups,
                G_INSTRUCTOR, instructorLabels.keySet().stream().map(n -> new CatalogFilters.Option<Card, CatalogRow>(n,
                        null, r -> r.firstInstructorName() != null
                        && r.firstInstructorName().trim().equalsIgnoreCase(n))).toList())));

        Map<String, String> tagLabels = new LinkedHashMap<>();
        for (CatalogRow r : s.rows()) {
            if (r.tags() == null) continue;
            for (String t : r.tags().split(",")) {
                String v = t.trim();
                String key = v.toLowerCase(Locale.ROOT);
                if (!v.isEmpty() && !LevelKeys.isLevelKey(key)) tagLabels.putIfAbsent(key, v);
            }
        }
        List<String> tagKeys = new ArrayList<>(tagLabels.keySet());
        if (!site.discovery().tagOrder().isEmpty()) tagKeys.sort(authoredOrder(site.discovery().tagOrder()));
        Map<String, String> sortedTags = new LinkedHashMap<>();
        for (String k : tagKeys) sortedTags.put(k, tagLabels.get(k));
        out.put("tags", facetList("key", sortedTags, CatalogFilters.countOptions(all, Card::rows, groups, G_TAG,
                tagKeys.stream().map(t -> new CatalogFilters.Option<Card, CatalogRow>(t, null,
                        r -> rowTagKeys(r).contains(t))).toList())));

        Map<String, String> badgeLabels = new LinkedHashMap<>();
        for (String b : badgeOrder(site)) badgeLabels.put(b, BADGE_LABELS.get(b));
        out.put("badges", facetList("key", badgeLabels, CatalogFilters.countOptions(all, Card::rows, groups, G_BADGE,
                badgeLabels.keySet().stream().map(b -> new CatalogFilters.Option<Card, CatalogRow>(b,
                        card -> extras.badges().getOrDefault(card.group().courseId(), List.of()).contains(b),
                        null)).toList())));

        Map<String, Integer> priceCounts = CatalogFilters.countOptions(all, Card::rows, groups, G_PRICE, List.of(
                new CatalogFilters.Option<>("free", null, r -> CatalogFilters.rowMatchesPrice(r, CatalogFilters.PriceChoice.FREE)),
                new CatalogFilters.Option<>("paid", null, r -> CatalogFilters.rowMatchesPrice(r, CatalogFilters.PriceChoice.PAID))));
        Map<String, Object> priceFacet = new LinkedHashMap<>();
        priceFacet.put("free", priceCounts.get("free"));
        priceFacet.put("paid", priceCounts.get("paid"));
        List<Double> maxOptions = site.discovery().priceFilter().maxOptions();
        Map<String, Integer> under = CatalogFilters.countOptions(all, Card::rows, groups, G_PRICE_RANGE,
                maxOptions.stream().map(max -> new CatalogFilters.Option<Card, CatalogRow>(String.valueOf(max), null,
                        r -> CatalogFilters.rowInPriceRange(r, null, max))).toList());
        priceFacet.put("under", maxOptions.stream().map(max -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("max", max);
            m.put("count", under.get(String.valueOf(max)));
            return m;
        }).toList());
        out.put("price", priceFacet);

        Map<String, Object> custom = new LinkedHashMap<>();
        for (CatalogDiscovery.CustomFilter f : site.discovery().customFilters()) {
            Map<String, Integer> counts = CatalogFilters.countOptions(all, Card::rows, groups, G_CUSTOM + f.id(),
                    f.options().stream().map(o -> new CatalogFilters.Option<Card, CatalogRow>(o.id(),
                            card -> card.rows().stream().anyMatch(r -> CatalogDiscovery.rowMatchesCustomOption(r, o)),
                            null)).toList());
            Map<String, Integer> shown = new LinkedHashMap<>();
            counts.forEach((k, v) -> {
                if (v > 0 || f.showEmpty()) shown.put(k, v);
            });
            custom.put(f.id(), shown);
        }
        out.put("custom", custom);
        return out;
    }

    static final Map<String, String> BADGE_LABELS = Map.of("bestseller", "Bestseller", "popular", "Popular",
            "new", "New", "free", "Free");

    private static List<Map<String, Object>> facetList(String keyName, Map<String, String> labels,
                                                       Map<String, Integer> counts) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, String> e : labels.entrySet()) {
            int n = counts.getOrDefault(e.getKey(), 0);
            if (n <= 0) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put(keyName, e.getKey());
            m.put("label", e.getValue());
            m.put("count", n);
            out.add(m);
        }
        return out;
    }

    /** Names listed in {@code order} (case-insensitive) first, in that order; the rest in natural order ({@code byAuthoredOrder}). */
    static Comparator<String> authoredOrder(List<String> order) {
        Map<String, Integer> rank = new HashMap<>();
        for (int i = 0; i < order.size(); i++) rank.putIfAbsent(order.get(i).trim().toLowerCase(Locale.ROOT), i);
        return (a, b) -> {
            int ra = rank.getOrDefault(a.trim().toLowerCase(Locale.ROOT), Integer.MAX_VALUE);
            int rb = rank.getOrDefault(b.trim().toLowerCase(Locale.ROOT), Integer.MAX_VALUE);
            return ra == rb ? naturalCompare(a, b) : Integer.compare(ra, rb);
        };
    }

    /** "Class 2" before "Class 10": digit runs compare as numbers, the rest case-insensitively. */
    static int naturalCompare(String a, String b) {
        int i = 0, j = 0;
        while (i < a.length() && j < b.length()) {
            char ca = a.charAt(i), cb = b.charAt(j);
            if (Character.isDigit(ca) && Character.isDigit(cb)) {
                int si = i, sj = j;
                while (i < a.length() && Character.isDigit(a.charAt(i))) i++;
                while (j < b.length() && Character.isDigit(b.charAt(j))) j++;
                String na = a.substring(si, i).replaceFirst("^0+(?=.)", "");
                String nb = b.substring(sj, j).replaceFirst("^0+(?=.)", "");
                int cmp = na.length() != nb.length() ? Integer.compare(na.length(), nb.length()) : na.compareTo(nb);
                if (cmp != 0) return cmp;
            } else {
                int cmp = Character.compare(Character.toLowerCase(ca), Character.toLowerCase(cb));
                if (cmp != 0) return cmp;
                i++;
                j++;
            }
        }
        return Integer.compare(a.length() - i, b.length() - j);
    }

    // ── CourseSummary ───────────────────────────────────────────────────────────

    /** The price state a card shows for {@code primary} over {@code matching} (summary's price area). */
    static PriceState displayedState(SiteConfig site, CatalogRow primary, List<CatalogRow> matching, boolean priceSort) {
        CardPriceView view = CatalogPricing.cardPriceView(primary, matching);
        CatalogRow priceRow = CatalogPricing.editorialPriceRow(primary, view, matching, priceSort);
        return primary.comingSoon() != null || priceRow == null
                ? CatalogPricing.priceStateOf(primary, site.paymentEnabled())
                : CatalogPricing.priceStateOf(priceRow, site.paymentEnabled());
    }

    /** The CourseSummary view of a card displayed as {@code primary}, priced over {@code matching}. */
    Map<String, Object> summary(CatalogSnapshot s, Extras extras, Card card, CatalogRow primary,
                                List<CatalogRow> matching, boolean priceSort) {
        SiteConfig site = s.site();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", card.group().courseId());
        out.put("title", primary.title());
        out.put("subtitle", subtitleOf(site, card.rows(), primary));
        out.put("image_url", s.mediaUrl(primary.imageMediaId()));
        out.put("images", imagesView(s.mediaUrl(primary.previewImageId()), s.mediaUrl(primary.bannerImageId()),
                s.mediaUrl(primary.thumbnailId())));
        out.put("url", hostedUrl(s, primary.packageId(), primary.packageSessionId(), primary.enrollInviteId(),
                primary.levelName()));
        out.put("formats", formatViews(s, card.formatKeys()));
        Stream stream = CatalogStreams.streamOf(card.tagSet(), s.streams());
        Category category = CatalogStreams.categoryOf(stream, card.tagSet());
        out.put("stream", stream == null ? null : place(stream.slug(),
                CatalogStreams.placeLabel(stream.title(), stream.subtitle(), site.labelMode(), null)));
        out.put("category", category == null ? null : place(category.slug(),
                CatalogStreams.placeLabel(category.title(), category.subtitle(), site.labelMode(), null)));
        out.put("languages", site.courseLanguagesOn() ? languageViews(card.group().languages()) : List.of());
        out.put("tags", displayTags(card.rows()));
        out.put("level", levelLabel(primary.levelName()));

        CardPriceView view = CatalogPricing.cardPriceView(primary, matching);
        CatalogRow priceRow = CatalogPricing.editorialPriceRow(primary, view, matching, priceSort);
        PriceState state = displayedState(site, primary, matching, priceSort);
        CatalogRow pricedBy = priceRow == null || primary.comingSoon() != null ? primary : priceRow;
        out.put("availability", CatalogPricing.availabilityOf(state));
        out.put("price_visible", priceVisible(state, site.paymentEnabled()));
        Map<String, Object> price = priceView(state, pricedBy);
        if (price != null) {
            price.put("varies", view != null && view.from());
            // The "from ₹X" range over the versions on sale now (catalog-cards.ts cardPriceView);
            // with prices hidden it never reveals a paid amount.
            double amount = (double) price.get("amount");
            double min = amount, max = amount;
            if (view != null && site.paymentEnabled()) {
                min = view.minPrice();
                for (CatalogRow r : matching) if (CatalogPricing.isBuyableNow(r)) max = Math.max(max, r.price());
            }
            price.put("min_amount", min);
            price.put("max_amount", max);
        }
        out.put("price", price);
        out.put("instructors", primary.instructors().stream().filter(p -> p.name() != null).map(p -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", p.name());
            if (p.role() != null) m.put("role", p.role());
            m.put("image_url", s.mediaUrl(p.imageFileId()));
            return m;
        }).toList());
        out.put("rating", ratingOf(primary));
        out.put("created_at", card.createdAt() == null ? null : card.createdAt().toString());
        out.put("badges", extras.badges().getOrDefault(card.group().courseId(), List.of()));
        out.put("popularity_rank", card.rank(extras.ranks()));
        out.put("duration_minutes", primary.readTimeMinutes() != null && primary.readTimeMinutes() > 0
                ? primary.readTimeMinutes() : null);
        out.put("available_slots", primary.availableSlots());
        out.put("max_seats", primary.maxSeats());
        out.put("package_type", primary.packageType());
        out.put("coming_soon", comingSoonView(primary.comingSoon()));

        List<Map<String, Object>> variants = new ArrayList<>();
        for (CatalogRow r : card.rows()) {
            PriceState vs = CatalogPricing.priceStateOf(r, site.paymentEnabled());
            Language lang = site.courseLanguagesOn() ? languageOf(s, r) : null;
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("package_session_id", r.packageSessionId());
            v.put("enroll_invite_id", r.enrollInviteId());
            v.put("title", r.title());
            v.put("level", levelLabel(r.levelName()));
            v.put("session_id", r.sessionId());
            v.put("session_name", CatalogFilters.isSentinel(r.sessionName()) ? null : r.sessionName());
            v.put("language", lang == null ? null : languageView(lang));
            v.put("url", hostedUrl(s, r.packageId(), r.packageSessionId(), r.enrollInviteId(), r.levelName()));
            v.put("availability", CatalogPricing.availabilityOf(vs));
            v.put("price", priceView(vs, r));
            variants.add(v);
        }
        out.put("variants", variants);
        return out;
    }

    private static Map<String, Object> imagesView(String preview, String banner, String thumbnail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("preview_url", preview);
        m.put("banner_url", banner);
        m.put("thumbnail_url", thumbnail);
        return m;
    }

    /** {launch_date, button_text, ribbon_text, notify_campaign_id} of a Coming Soon course; null otherwise. */
    static Map<String, Object> comingSoonView(CatalogRow.ComingSoon cs) {
        if (cs == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("launch_date", cs.launchDate());
        m.put("button_text", cs.buttonText());
        m.put("ribbon_text", cs.ribbonText());
        m.put("notify_campaign_id", cs.audienceId());
        return m;
    }

    /**
     * The card text ({@code descriptionOf} in catalog-card-view.ts): the authored description of
     * the displayed package, else of any of the card's packages, else the course description, else
     * its about text; plain, at most 300 characters.
     */
    static String subtitleOf(SiteConfig site, List<CatalogRow> rows, CatalogRow primary) {
        String own = site.descriptions().get(primary.packageId());
        if (own != null) return CatalogHtml.summary(own, SUBTITLE_MAX);
        for (CatalogRow r : rows) {
            String d = site.descriptions().get(r.packageId());
            if (d != null) return CatalogHtml.summary(d, SUBTITLE_MAX);
        }
        String text = CatalogHtml.plainText(primary.descriptionHtml());
        if (text == null) text = CatalogHtml.plainText(primary.aboutHtml());
        return CatalogHtml.summary(text, SUBTITLE_MAX);
    }

    private static boolean priceVisible(PriceState state, boolean paymentEnabled) {
        return switch (state.kind()) {
            case HIDDEN -> false;
            case FREE, AMOUNT -> true;
            default -> paymentEnabled;
        };
    }

    /** {amount, compare_at_amount, currency, is_free} for a free or priced state; null otherwise. */
    private static Map<String, Object> priceView(PriceState state, CatalogRow row) {
        if (state.kind() != Kind.FREE && state.kind() != Kind.AMOUNT) return null;
        Map<String, Object> p = new LinkedHashMap<>();
        double amount = state.kind() == Kind.FREE ? 0 : state.amount();
        p.put("amount", amount);
        p.put("compare_at_amount", row.elevatedPrice() != null && row.elevatedPrice() > amount ? row.elevatedPrice() : null);
        p.put("currency", row.currency());
        p.put("is_free", amount == 0);
        return p;
    }

    private static Map<String, Object> place(String slug, String label) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("slug", slug);
        m.put("label", label);
        return m;
    }

    private static List<String> displayTags(List<CatalogRow> rows) {
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        for (CatalogRow r : rows) {
            if (r.tags() == null) continue;
            for (String t : r.tags().split(",")) {
                String v = t.trim();
                if (!v.isEmpty()) out.putIfAbsent(v.toLowerCase(Locale.ROOT), v);
            }
        }
        return List.copyOf(out.values());
    }

    /** The level's name, or null for the platform's placeholder level ("default"). */
    static String levelLabel(String levelName) {
        if (levelName == null || levelName.isBlank() || "default".equalsIgnoreCase(levelName.trim())) return null;
        return levelName.trim();
    }

    private static List<Map<String, Object>> formatViews(CatalogSnapshot s, List<String> keys) {
        CourseFormats.Resolved formats = s.site().formats();
        if (formats == null) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (String key : keys) {
            String label = formats.labelOf(key);
            if (label == null) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", key);
            m.put("label", label);
            out.add(m);
        }
        return out;
    }

    private static String languageLabel(Language l) {
        return l.label() == null || l.label().isBlank() ? l.code().toUpperCase(Locale.ROOT) : l.label();
    }

    /** {code, label, chip}; chip is the card chip text ({@code l.chip || l.label || CODE}, CardDiscoveryMeta). */
    private static Map<String, Object> languageView(Language l) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", l.code());
        m.put("label", languageLabel(l));
        m.put("chip", l.chip() != null && !l.chip().isBlank() ? l.chip() : languageLabel(l));
        return m;
    }

    private static List<Map<String, Object>> languageViews(List<Language> languages) {
        return languages.stream().map(CatalogApiService::languageView).toList();
    }

    /**
     * The course's page on the hosted site: {@code <course_base_url>/<custom route ‖ package id>}
     * with CourseShowcaseComponent.openCourse's query ({@code enrollInviteId}, {@code packageSessionId},
     * {@code level}; empty ones omitted). Custom routes: {@code resolveCoursePageRoute}.
     */
    static String hostedUrl(CatalogSnapshot s, String packageId, String packageSessionId, String enrollInviteId,
                            String levelName) {
        String base = s.courseBaseUrl();
        if (base == null || packageId == null) return null;
        String route = CoursePageRouting.resolveCoursePageRoute(s.site().globalSettings(), packageId, packageSessionId);
        StringBuilder url = new StringBuilder(base);
        url.append('/').append(UriUtils.encodePathSegment(route != null ? route : packageId, StandardCharsets.UTF_8));
        char sep = '?';
        String[][] params = {{"enrollInviteId", enrollInviteId}, {"packageSessionId", packageSessionId},
                {"level", levelName}};
        for (String[] p : params) {
            if (p[1] == null || p[1].isBlank()) continue;
            url.append(sep).append(p[0]).append('=').append(UriUtils.encodeQueryParam(p[1].trim(), StandardCharsets.UTF_8));
            sep = '&';
        }
        return url.toString();
    }

    /** A site path ("/x") made absolute against the hosted site's origin; URLs pass through. */
    static String absolute(CatalogSnapshot s, String safeSrc) {
        if (safeSrc == null) return null;
        if (!safeSrc.startsWith("/")) return safeSrc;
        String base = s.courseBaseUrl();
        if (base == null) return null;
        try {
            URI uri = URI.create(base);
            return uri.getScheme() + "://" + uri.getRawAuthority() + safeSrc;
        } catch (Exception e) {
            return null;
        }
    }

    // ── GET /courses/{id} ────────────────────────────────────────────────────────

    /** The card holding package {@code id}, displayed as the requested language / package. */
    private record Found(Card card, CatalogRow primary) {
    }

    private Found find(CatalogSnapshot s, String id, String language) {
        if (id == null || id.isBlank()) throw notFound();
        String code = siteLanguage(s, language);
        for (Card card : cards(s, null)) {
            if (!card.hasPackage(id)) continue;
            CatalogRow primary = null;
            if (code != null) {
                primary = card.rows().stream().filter(r -> {
                    Language l = languageOf(s, r);
                    return l != null && l.code().equals(code);
                }).findFirst().orElse(null);
            }
            if (primary == null && !id.equals(card.group().courseId())) {
                primary = card.rows().stream().filter(r -> id.equals(r.packageId())).findFirst().orElse(null);
            }
            return new Found(card, primary == null ? card.primary() : primary);
        }
        throw notFound();
    }

    public Map<String, Object> course(String instituteId, String id, String language) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        Found found = find(s, id, language);
        Card card = found.card();
        CatalogRow primary = found.primary();
        Map<String, Object> out = summary(s, extras(s, cards(s, null)), card, primary, card.rows(), false);

        out.put("description_html", CatalogHtml.sanitize(primary.descriptionHtml()));
        out.put("description_text", CatalogHtml.plainText(primary.descriptionHtml()));
        out.put("about_html", CatalogHtml.sanitize(primary.aboutHtml()));
        out.put("about_text", CatalogHtml.plainText(primary.aboutHtml()));
        out.put("why_learn_html", CatalogHtml.sanitize(primary.whyLearnHtml()));
        out.put("who_should_learn_html", CatalogHtml.sanitize(primary.whoShouldLearnHtml()));

        Optional<CourseDTOWithDetails> init = loader.courseInit(instituteId, primary.packageId());
        String pageJson = init.map(i -> i.getCourse() == null ? null : i.getCourse().getCoursePageJson()).orElse(null);
        if (pageJson == null && init.isEmpty()) {
            try {
                pageJson = pageContentService.getContentJson(primary.packageId());
            } catch (Exception e) {
                log.debug("catalog-api: page content unreadable for {}: {}", primary.packageId(), e.getMessage());
            }
        }
        CoursePageContent.Content content = CoursePageContent.parseCoursePageJson(pageJson);
        out.put("mode", content.mode() == null ? null : content.mode().toLowerCase(Locale.ROOT));
        out.put("faqs", content.faqs().stream().map(f -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("question", f.q());
            m.put("answer_html", CatalogHtml.sanitize(f.a()));
            return m;
        }).toList());
        out.put("preview_video", previewVideoView(primary.courseMediaId()));

        List<CatalogRow.Person> authors = authorsOf(init.orElse(null), primary);
        Map<String, String> authorPics = loader.resolveMedia(authors.stream().map(CatalogRow.Person::imageFileId)
                .filter(Objects::nonNull).toList());
        out.put("authors", authors.stream().map(a -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", a.name());
            if (a.role() != null) m.put("role", a.role());
            m.put("subtitle", a.subtitle());
            m.put("bio_html", CatalogHtml.sanitize(a.bioHtml()));
            m.put("image_url", a.imageFileId() == null ? null : authorPics.get(a.imageFileId()));
            return m;
        }).toList());
        out.put("series", seriesOf(s, card, primary));

        String url = (String) out.get("url");
        String description = (String) out.get("subtitle");
        if (description == null) description = CatalogHtml.summary(CatalogHtml.plainText(primary.aboutHtml()), SEO_DESCRIPTION_MAX);
        String seoDescription = CatalogHtml.summary(description, SEO_DESCRIPTION_MAX);
        Map<String, Object> seo = new LinkedHashMap<>();
        seo.put("title", primary.title());
        seo.put("description", seoDescription);
        seo.put("image_url", out.get("image_url"));
        // The bare page address: the enrolment query only picks a version, and one canonical per
        // course keeps search engines from treating each version link as a separate page.
        seo.put("canonical_url", withoutQuery(url));
        out.put("seo", seo);
        out.put("structured_data", structuredData(s, out, primary, seoDescription));
        return out;
    }

    static String withoutQuery(String url) {
        if (url == null) return null;
        int q = url.indexOf('?');
        return q < 0 ? url : url.substring(0, q);
    }

    private Map<String, Object> previewVideoView(String courseMediaId) {
        CoursePageContent.PreviewVideo video = CoursePageContent.previewVideoOf(courseMediaId);
        if (video == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        switch (video.kind()) {
            case "youtube", "vimeo" -> {
                m.put("kind", video.kind());
                m.put("id", video.id());
                m.put("embed_url", CoursePageContent.embedUrlOf(video));
            }
            case "url" -> {
                m.put("kind", "url");
                m.put("url", video.url());
                m.put("embed_url", null);
            }
            default -> { // a media-service file: its public URL
                String url = loader.resolveMedia(List.of(video.id())).get(video.id());
                if (url == null) return null;
                m.put("kind", "url");
                m.put("url", url);
                m.put("embed_url", null);
            }
        }
        return m;
    }

    /**
     * The course page's authors: course-init's instructors of the displayed version's level (its
     * session and level), else of any level, else the catalogue row's instructors. Never an email.
     */
    static List<CatalogRow.Person> authorsOf(CourseDTOWithDetails init, CatalogRow primary) {
        List<UserDTO> chosen = null;
        List<UserDTO> any = new ArrayList<>();
        if (init != null && init.getSessions() != null) {
            for (SessionDTOWithDetails session : init.getSessions()) {
                if (session == null || session.getLevelWithDetails() == null) continue;
                boolean sameSession = session.getSessionDTO() != null && primary.sessionId() != null
                        && primary.sessionId().equals(session.getSessionDTO().getId());
                for (LevelDTOWithDetails level : session.getLevelWithDetails()) {
                    if (level == null || level.getInstructors() == null) continue;
                    any.addAll(level.getInstructors());
                    boolean sameLevel = (primary.levelId() != null && primary.levelId().equals(level.getId()))
                            || (primary.levelName() != null && level.getName() != null
                            && primary.levelName().trim().equalsIgnoreCase(level.getName().trim()));
                    if (sameSession && sameLevel && chosen == null && !level.getInstructors().isEmpty()) {
                        chosen = level.getInstructors();
                    }
                }
            }
        }
        List<UserDTO> users = chosen != null ? chosen : any;
        if (users.isEmpty()) return primary.instructors().stream().filter(p -> p.name() != null).toList();
        Map<String, CatalogRow.Person> unique = new LinkedHashMap<>();
        for (UserDTO u : users) {
            if (u == null) continue;
            String name = u.getFullName() == null ? null : u.getFullName().trim();
            if (name == null || name.isEmpty()) continue;
            String key = u.getId() != null ? u.getId() : name;
            unique.putIfAbsent(key, new CatalogRow.Person(u.getId(), name, blankToNull(u.getProfilePicFileId()),
                    blankToNull(u.getAuthorSubtitle()), u.getAuthorDescription(), blankToNull(u.getRoleLabel())));
        }
        return List.copyOf(unique.values());
    }

    private static Map<String, Object> structuredData(CatalogSnapshot s, Map<String, Object> view, CatalogRow primary,
                                                      String description) {
        Map<String, Object> ld = new LinkedHashMap<>();
        ld.put("@context", "https://schema.org");
        ld.put("@type", "Course");
        ld.put("name", primary.title());
        ld.put("description", description != null ? description : primary.title());
        if (view.get("image_url") != null) ld.put("image", view.get("image_url"));
        if (view.get("url") != null) ld.put("url", withoutQuery((String) view.get("url")));
        Language lang = s.site().courseLanguagesOn() ? languageOf(s, primary) : null;
        if (lang != null) ld.put("inLanguage", lang.code());
        Map<String, Object> provider = new LinkedHashMap<>();
        provider.put("@type", "Organization");
        provider.put("name", s.instituteName());
        String sameAs = blankToNull(s.instituteWebsiteUrl());
        if (sameAs == null) sameAs = absolute(s, "/");
        if (sameAs != null) provider.put("sameAs", sameAs);
        ld.put("provider", provider);
        @SuppressWarnings("unchecked")
        Map<String, Object> price = (Map<String, Object>) view.get("price");
        if (price != null) {
            Map<String, Object> offer = new LinkedHashMap<>();
            offer.put("@type", "Offer");
            offer.put("price", price.get("amount"));
            if (price.get("currency") != null) offer.put("priceCurrency", price.get("currency"));
            offer.put("category", Boolean.TRUE.equals(price.get("is_free")) ? "Free" : "Paid");
            if (view.get("url") != null) offer.put("url", view.get("url"));
            offer.put("availability", switch (String.valueOf(view.get("availability"))) {
                case "available" -> "https://schema.org/InStock";
                case "coming_soon", "not_started" -> "https://schema.org/PreOrder";
                default -> "https://schema.org/Discontinued";
            });
            ld.put("offers", List.of(offer));
        }
        Map<String, Object> instance = new LinkedHashMap<>();
        instance.put("@type", "CourseInstance");
        instance.put("courseMode", "online");
        ld.put("hasCourseInstance", List.of(instance));
        return ld;
    }

    /**
     * The learning path the course is a step of ({@code useCourseSeries}): the paths in the
     * course's stream first, then the rest (at most 12); the first that lists the course wins; a
     * path of fewer than two steps is no series.
     */
    Map<String, Object> seriesOf(CatalogSnapshot s, Card card, CatalogRow primary) {
        String libraryId = s.site().pathLibraryId();
        if (libraryId == null) return null;
        List<FolderNode> roots = loader.folderTree(s.instituteId(), libraryId).orElse(List.of());
        if (roots.isEmpty()) return null;
        Stream stream = CatalogStreams.streamOf(card.tagSet(), s.streams());
        FolderNode folder = stream == null ? null : LearningPaths.findFolderBySlug(roots, stream.slug());
        List<PathEntry> inStream = folder == null ? List.of()
                : LearningPaths.collectPathEntries(folder.children(), folder, new HashSet<>());
        Set<String> inStreamCodes = inStream.stream().map(PathEntry::code).collect(Collectors.toSet());
        List<PathEntry> entries = new ArrayList<>(inStream);
        for (PathEntry e : LearningPaths.collectPathEntries(roots)) if (!inStreamCodes.contains(e.code())) entries.add(e);
        if (entries.size() > MAX_SERIES_PATHS) entries = entries.subList(0, MAX_SERIES_PATHS);
        String courseId = primary.packageId();
        for (PathEntry entry : entries) {
            List<PathMapping> mappings = mappingsOf(loader.productPage(s.instituteId(), entry.code()).orElse(null));
            boolean listed = mappings.stream().anyMatch(m -> courseId.equals(m.packageId())
                    && "ACTIVE".equalsIgnoreCase(m.status() == null ? "ACTIVE" : m.status()));
            if (!listed) continue;
            List<Step> steps = LearningPaths.buildPathSteps(mappings, s.site().courseLanguagesOn(),
                    s.site().languages(), null);
            if (steps.size() < 2) return null;
            List<Map<String, Object>> stepViews = new ArrayList<>();
            for (Step step : steps) {
                PathMapping m = step.primary();
                Map<String, Object> v = new LinkedHashMap<>();
                v.put("course_id", step.courseId());
                v.put("title", m.packageName() == null ? "" : m.packageName().trim());
                v.put("url", hostedUrl(s, m.packageId(), m.packageSessionId(), m.enrollInviteId(), m.levelName()));
                v.put("current", step.courseId().equals(courseId) || card.hasPackage(step.courseId()));
                stepViews.add(v);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("name", CatalogStreams.nodeTitle(entry.node()));
            out.put("steps", stepViews);
            return out;
        }
        return null;
    }

    static List<PathMapping> mappingsOf(ProductPageResponse page) {
        if (page == null || page.getMappings() == null) return List.of();
        List<PathMapping> out = new ArrayList<>();
        for (ProductPageInviteMappingResponse m : page.getMappings()) {
            if (m == null) continue;
            var plan = m.getPaymentPlan();
            out.add(new PathMapping(m.getPackageId(), m.getPackageSessionId(), m.getLevelName(), m.getPackageName(),
                    m.getStatus(), m.getEnrollInviteId(),
                    plan == null ? null : plan.getActualPrice(),
                    plan == null ? null : plan.getElevatedPrice(),
                    plan != null && plan.getCurrency() != null ? plan.getCurrency() : page.getCurrency(),
                    m.getTags(), m.getCoursePreviewImageMediaId()));
        }
        return out;
    }

    // ── GET /courses/{id}/outline ────────────────────────────────────────────────

    public Map<String, Object> outline(String instituteId, String id, String language) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        Found found = find(s, id, null);
        String code = siteLanguage(s, language);
        List<CatalogRow> rows = found.card().rows();
        if (code != null) {
            List<CatalogRow> inLanguage = rows.stream().filter(r -> {
                Language l = languageOf(s, r);
                return l != null && l.code().equals(code);
            }).toList();
            if (!inLanguage.isEmpty()) rows = inLanguage;
        }
        final List<CatalogRow> levels = rows;
        // Keyed by the levels actually chosen, not the requested code: any language that matches
        // none falls back to every level, and must share that entry rather than rebuild it.
        String key = instituteId + "|" + levels.stream().map(CatalogRow::packageSessionId)
                .filter(Objects::nonNull).sorted().collect(Collectors.joining(","));
        return outlines.get(key, k -> buildOutline(levels));
    }

    private Map<String, Object> buildOutline(List<CatalogRow> rows) {
        List<Map<String, Object>> levels = new ArrayList<>();
        for (CatalogRow r : rows) {
            if (r.packageSessionId() == null) continue;
            List<Map<String, Object>> subjects = new ArrayList<>();
            List<LearnerSubjectProjection> subjectRows =
                    new ArrayList<>(openStudyLibraryService.getSubjectsByPackageSessionId(r.packageSessionId()));
            subjectRows.sort(Comparator.comparing(LearnerSubjectProjection::getSubjectOrder,
                    Comparator.nullsLast(Comparator.naturalOrder())));
            for (LearnerSubjectProjection subject : subjectRows) {
                List<Map<String, Object>> modules = new ArrayList<>();
                List<LearnerModuleDTOWithDetails> moduleRows = new ArrayList<>(
                        openStudyLibraryService.getModulesDetailsWithChapters(subject.getId(), r.packageSessionId()));
                moduleRows.sort(Comparator.comparing(LearnerModuleDTOWithDetails::getModuleOrder,
                        Comparator.nullsLast(Comparator.naturalOrder())));
                for (LearnerModuleDTOWithDetails module : moduleRows) {
                    if (module == null || module.getModule() == null) continue;
                    List<Map<String, Object>> chapters = new ArrayList<>();
                    if (module.getChapters() != null) {
                        module.getChapters().stream()
                                // is_hidden is not selected by the open query today; kept so a
                                // hidden chapter can never surface once it is.
                                .filter(c -> c != null && !Boolean.TRUE.equals(c.getIsHidden()))
                                .forEach(c -> chapters.add(named(c.getId(), c.getChapterName())));
                    }
                    Map<String, Object> m = named(module.getModule().getId(), module.getModule().getModuleName());
                    m.put("chapters", chapters);
                    modules.add(m);
                }
                Map<String, Object> sv = named(subject.getId(), subject.getSubjectName());
                sv.put("modules", modules);
                subjects.add(sv);
            }
            Map<String, Object> level = new LinkedHashMap<>();
            level.put("package_session_id", r.packageSessionId());
            level.put("level", levelLabel(r.levelName()));
            level.put("subjects", subjects);
            levels.add(level);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("levels", levels);
        return out;
    }

    private static Map<String, Object> named(String id, String name) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        return m;
    }

    // ── GET /streams ────────────────────────────────────────────────────────────

    public Map<String, Object> streams(String instituteId) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        List<Set<String>> tagSets = cards(s, null).stream().map(Card::tagSet).toList();
        List<Map<String, Object>> streams = new ArrayList<>();
        for (Stream st : s.streams()) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("slug", st.slug());
            v.put("label", st.title());
            v.put("subtitle", blankToNull(st.subtitle()));
            v.put("image_url", absolute(s, st.imageUrl()));
            v.put("accent_color", st.accentColor());
            v.put("coming_soon", st.comingSoon());
            v.put("course_count", count(st.tags(), tagSets));
            v.put("tag", blankToNull(st.tag()));
            v.put("notify_campaign_id", st.audienceId());
            List<Map<String, Object>> categories = new ArrayList<>();
            for (Category c : st.categories()) {
                Map<String, Object> cv = new LinkedHashMap<>();
                cv.put("slug", c.slug());
                cv.put("label", c.title());
                cv.put("subtitle", blankToNull(c.subtitle()));
                cv.put("image_url", absolute(s, c.imageUrl()));
                cv.put("coming_soon", c.comingSoon());
                cv.put("course_count", count(c.tags(), tagSets));
                cv.put("accent_color", c.accentColor());
                cv.put("notify_campaign_id", c.audienceId());
                categories.add(cv);
            }
            v.put("categories", categories);
            streams.add(v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", s.streamsSource());
        out.put("streams", streams);
        return out;
    }

    private static int count(List<String> tags, List<Set<String>> tagSets) {
        int n = 0;
        for (Set<String> card : tagSets) if (CatalogStreams.matchesAny(tags, card)) n++;
        return n;
    }

    // ── GET /learning-paths ─────────────────────────────────────────────────────

    public Map<String, Object> learningPaths(String instituteId, String stream) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        List<Map<String, Object>> data = new ArrayList<>();
        String libraryId = s.site().pathLibraryId();
        if (libraryId != null) {
            List<FolderNode> roots = loader.folderTree(instituteId, libraryId).orElse(List.of());
            for (PathEntry entry : LearningPaths.pathsInScope(roots, blankToNull(stream))) {
                List<PathMapping> mappings = mappingsOf(loader.productPage(instituteId, entry.code()).orElse(null));
                List<Step> steps = LearningPaths.buildPathSteps(mappings, s.site().courseLanguagesOn(),
                        s.site().languages(), null);
                List<FolderNode> trail = CatalogStreams.pathTo(roots, entry.node().id());
                FolderNode top = trail.isEmpty() ? null : trail.get(0);
                Map<String, Object> v = new LinkedHashMap<>();
                v.put("code", entry.code());
                v.put("name", CatalogStreams.nodeTitle(entry.node()));
                v.put("stream_slug", top != null && top.isFolder() ? CatalogStreams.folderSlug(top) : null);
                v.put("image_url", absolute(s, CatalogStreams.safeImageSrc(entry.node().imageUrl())));
                v.put("step_count", steps.size());
                data.add(v);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        return out;
    }

    public Map<String, Object> learningPath(String instituteId, String code) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        String libraryId = s.site().pathLibraryId();
        if (libraryId == null || code == null || code.isBlank()) throw notFound("Learning path");
        List<FolderNode> roots = loader.folderTree(instituteId, libraryId).orElse(List.of());
        PathEntry entry = LearningPaths.collectPathEntries(roots).stream()
                .filter(e -> e.code().equals(code.trim())).findFirst().orElse(null);
        if (entry == null) throw notFound("Learning path");
        ProductPageResponse page = loader.productPage(instituteId, entry.code()).orElse(null);
        if (page == null) throw notFound("Learning path");
        List<Step> steps = LearningPaths.buildPathSteps(mappingsOf(page), s.site().courseLanguagesOn(),
                s.site().languages(), null);

        List<Card> cards = cards(s, null);
        Extras extras = extras(s, cards);
        Set<String> missingImages = new LinkedHashSet<>();
        for (Step step : steps) {
            if (cardOf(cards, step.primary().packageId()) == null && step.primary().imageMediaId() != null) {
                missingImages.add(step.primary().imageMediaId());
            }
        }
        Map<String, String> images = missingImages.isEmpty() ? Map.of() : loader.resolveMedia(missingImages);

        List<Map<String, Object>> stepViews = new ArrayList<>();
        int position = 1;
        for (Step step : steps) {
            Card card = cardOf(cards, step.primary().packageId());
            Map<String, Object> course;
            if (card != null) {
                CatalogRow primary = card.rows().stream()
                        .filter(r -> Objects.equals(r.packageSessionId(), step.primary().packageSessionId()))
                        .findFirst().orElse(card.primary());
                course = summary(s, extras, card, primary, card.rows(), false);
            } else {
                course = mappingSummary(s, step, images, extras);
            }
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("position", position++);
            v.put("course", course);
            stepViews.add(v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", entry.code());
        String name = CatalogStreams.nodeTitle(entry.node());
        out.put("name", name.isEmpty() ? page.getName() : name);
        out.put("description_html", CatalogHtml.sanitize(entry.node().description()));
        out.put("steps", stepViews);
        return out;
    }

    private static Card cardOf(List<Card> cards, String packageId) {
        if (packageId == null) return null;
        for (Card c : cards) if (c.hasPackage(packageId)) return c;
        return null;
    }

    /**
     * A path step whose course is not in the catalogue (not published to it): the summary the
     * path's own product-page mapping can give — its price is the mapping's payment plan.
     */
    private Map<String, Object> mappingSummary(CatalogSnapshot s, Step step, Map<String, String> images, Extras extras) {
        SiteConfig site = s.site();
        PathMapping primary = step.primary();
        Set<String> tagSet = new LinkedHashSet<>();
        for (PathMapping m : step.variants()) tagSet.addAll(CourseFormats.rowTags(m.tags(), null));
        List<String> formatKeys = new ArrayList<>();
        for (PathMapping m : step.variants()) {
            for (String k : CourseFormats.courseFormatKeys(m.tags(), m.levelName(), site.formats())) {
                if (!formatKeys.contains(k)) formatKeys.add(k);
            }
        }
        Stream stream = CatalogStreams.streamOf(tagSet, s.streams());
        Category category = CatalogStreams.categoryOf(stream, tagSet);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", step.courseId());
        out.put("title", primary.packageName());
        out.put("subtitle", null);
        String imageUrl = primary.imageMediaId() == null ? null : images.get(primary.imageMediaId());
        out.put("image_url", imageUrl);
        out.put("images", imagesView(imageUrl, null, null));
        out.put("url", hostedUrl(s, primary.packageId(), primary.packageSessionId(), primary.enrollInviteId(),
                primary.levelName()));
        out.put("formats", formatViews(s, formatKeys));
        out.put("stream", stream == null ? null : place(stream.slug(),
                CatalogStreams.placeLabel(stream.title(), stream.subtitle(), site.labelMode(), null)));
        out.put("category", category == null ? null : place(category.slug(),
                CatalogStreams.placeLabel(category.title(), category.subtitle(), site.labelMode(), null)));
        out.put("languages", site.courseLanguagesOn() ? languageViews(step.languages()) : List.of());
        LinkedHashMap<String, String> tags = new LinkedHashMap<>();
        for (PathMapping m : step.variants()) {
            if (m.tags() == null) continue;
            for (String t : m.tags().split(",")) if (!t.isBlank()) tags.putIfAbsent(t.trim().toLowerCase(Locale.ROOT), t.trim());
        }
        out.put("tags", List.copyOf(tags.values()));
        out.put("level", levelLabel(primary.levelName()));
        out.put("availability", "available");
        Map<String, Object> price = mappingPrice(primary, site.paymentEnabled());
        out.put("price_visible", price != null || site.paymentEnabled());
        if (price != null) {
            Set<Double> prices = step.variants().stream().map(PathMapping::price).filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            price.put("varies", prices.size() > 1);
            double amount = (double) price.get("amount");
            double min = amount, max = amount;
            if (site.paymentEnabled()) {
                for (Double p : prices) {
                    min = Math.min(min, Math.max(0, p));
                    max = Math.max(max, Math.max(0, p));
                }
            }
            price.put("min_amount", min);
            price.put("max_amount", max);
        }
        out.put("price", price);
        out.put("instructors", List.of());
        out.put("rating", null);
        out.put("created_at", null);
        out.put("badges", List.of());
        out.put("popularity_rank", CourseBadges.bestRank(step.variants().stream().map(PathMapping::packageId)
                .filter(Objects::nonNull).distinct().toList(), extras.ranks()));
        out.put("duration_minutes", null);
        out.put("available_slots", null);
        out.put("max_seats", null);
        out.put("package_type", null);
        out.put("coming_soon", null);
        List<Map<String, Object>> variants = new ArrayList<>();
        for (PathMapping m : step.variants()) {
            Language lang = site.courseLanguagesOn()
                    ? CourseLanguages.languageOfRow(m.levelName(), m.tags(), site.languages()) : null;
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("package_session_id", m.packageSessionId());
            v.put("enroll_invite_id", m.enrollInviteId());
            v.put("title", m.packageName() == null ? null : m.packageName().trim());
            v.put("level", levelLabel(m.levelName()));
            v.put("session_id", null);
            v.put("session_name", null);
            v.put("language", lang == null ? null : languageView(lang));
            v.put("url", hostedUrl(s, m.packageId(), m.packageSessionId(), m.enrollInviteId(), m.levelName()));
            v.put("availability", "available");
            v.put("price", mappingPrice(m, site.paymentEnabled()));
            variants.add(v);
        }
        out.put("variants", variants);
        return out;
    }

    private static Map<String, Object> mappingPrice(PathMapping m, boolean paymentEnabled) {
        if (m.price() == null) return null;
        double amount = Math.max(0, m.price());
        if (amount > 0 && !paymentEnabled) return null;
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("amount", amount);
        p.put("compare_at_amount", m.elevatedPrice() != null && m.elevatedPrice() > amount ? m.elevatedPrice() : null);
        p.put("currency", m.currency());
        p.put("is_free", amount == 0);
        return p;
    }

    // ── GET /sitemap ────────────────────────────────────────────────────────────

    public Map<String, Object> sitemap(String instituteId) {
        CatalogSnapshot s = loader.snapshot(instituteId);
        List<Map<String, Object>> data = new ArrayList<>();
        for (Card card : cards(s, null)) {
            CatalogRow p = card.primary();
            String url = hostedUrl(s, p.packageId(), p.packageSessionId(), p.enrollInviteId(), p.levelName());
            if (url == null) continue;
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("url", withoutQuery(url)); // the canonical page address, as in seo.canonical_url
            v.put("type", "course");
            v.put("id", card.group().courseId());
            v.put("lastmod", card.createdAt() == null ? null : card.createdAt().toString());
            data.add(v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        return out;
    }

    /** Whether package {@code id} is a published catalogue course of the institute. */
    public boolean isCatalogueCourse(String instituteId, String id) {
        if (id == null || id.isBlank()) return false;
        for (CatalogRow r : loader.snapshot(instituteId).rows()) if (id.equals(r.packageId())) return true;
        return false;
    }

    // ── errors ──────────────────────────────────────────────────────────────────

    static CatalogApiException invalid(String message, String param) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("param", param);
        return new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", message, details, null);
    }

    static CatalogApiException notFound() {
        return notFound("Course");
    }

    static CatalogApiException notFound(String what) {
        return new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", what + " not found.");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
