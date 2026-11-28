package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Language;

import java.util.*;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * The Courses section's discovery props (sort, quick filters, price / language / category
 * filters, badges, authored filter groups, hero "Popular:" chips), validated the way the hosted
 * site validates them: wrong types and unknown values are dropped, never an error.
 *
 * <p>Ports of {@code resolveCatalogDiscovery} ({@code resolveBadges}, {@code resolveQuickFilters},
 * {@code resolveAmounts}) in {@code -components/components/catalog/catalog-config.ts},
 * {@code resolveCustomFilters} in {@code catalog/catalog-custom-filters.ts},
 * {@code resolveCategoryFilterExtension} in {@code catalog/catalog-sidebar-config.ts},
 * {@code resolvePopularChip} / the band of {@code resolveCatalogHero} in
 * {@code catalog/catalog-hero-config.ts}, and {@code resolveDefaultSort} / the Popular-sort
 * menu rule of {@code CourseCatalogComponent.tsx}.
 */
public record CatalogDiscovery(
        boolean active,
        String defaultSort,
        List<String> sortOptions,
        boolean showFilterCounts,
        Toggle languageFilter,
        PriceFilter priceFilter,
        CategoryFilter categoryFilter,
        List<CustomFilter> customFilters,
        BadgeRules badges,
        List<QuickFilter> quickFilters,
        List<PopularChip> popular,
        List<String> levelOrder,
        List<String> tagOrder) {

    /** The site's sort names ({@code COURSE_CATALOG_SORT_OPTIONS}) → the API's sort tokens. */
    public static final Map<String, String> SORT_TOKENS;

    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("Newest", "newest");
        m.put("Oldest", "oldest");
        m.put("Price: Low to High", "price_asc");
        m.put("Price: High to Low", "price_desc");
        m.put("Rating", "rating");
        m.put("Name A-Z", "title");
        m.put("Name Z-A", "title_desc");
        m.put("Popular", "popular");
        SORT_TOKENS = Collections.unmodifiableMap(m);
    }

    public static final List<String> ALL_BADGES = CourseBadges.ALL_BADGES;
    public static final List<String> QUICK_FILTER_KINDS = List.of("popular", "new", "free", "bestseller", "language",
            "priceMax");
    /** Query parameters other catalogue features read: never a custom group id ({@code RESERVED_FILTER_IDS}). */
    public static final List<String> RESERVED_FILTER_IDS = List.of("stream", "category", "language", "price", "sort",
            "q", "quick", "path", "badge", "lang", "page", "goal", "folder");
    public static final int MAX_CUSTOM_FILTERS = 6;
    public static final int MAX_CUSTOM_OPTIONS = 30;
    public static final int MAX_HERO_POPULAR = 8;

    public record Toggle(boolean enabled, String label) {
    }

    public record PriceFilter(boolean enabled, String label, boolean showFree, List<Double> maxOptions) {
    }

    /** categoryFilter + its opt-in extension fields (null = not set by the section). */
    public record CategoryFilter(boolean enabled, String label, String scope, String labelMode, String sort,
                                 boolean hideComingSoon, Integer visibleCount, String showAllLabel) {
    }

    /** One authored option: lower-case tags and level names it matches. */
    public record CustomOption(String id, String label, List<String> tags, List<String> levels) {
    }

    /** An authored option group (FORMAT, FOR…); {@code source} is "courseFormats" or null. */
    public record CustomFilter(String id, String label, String source, Boolean showCounts, boolean showEmpty,
                               Integer visibleCount, List<CustomOption> options) {
    }

    /** Badge rules; null fields = the defaults of {@code computeCourseBadges}. */
    public record BadgeRules(boolean enabled, List<String> types, Integer newDays, Integer bestsellerTop, Integer max) {
        public int newDaysOrDefault() {
            return newDays != null && newDays > 0 ? newDays : 60;
        }

        public int bestsellerTopOrDefault() {
            return bestsellerTop != null && bestsellerTop > 0 ? bestsellerTop : 3;
        }

        public int maxOrDefault() {
            return max != null && max > 0 ? max : 2;
        }
    }

    /** value: a lower-case language code (language) or a positive amount (priceMax), else null. */
    public record QuickFilter(String id, String label, String kind, Object value) {
    }

    /** kind: search | stream | quick | route. */
    public record PopularChip(String kind, String label, String search, String streamSlug, String categorySlug,
                              String quickFilterId, String route) {
    }

    public static CatalogDiscovery resolve(JsonNode rawProps, boolean courseLanguagesOn, List<Language> languages,
                                           CatalogStreams.StreamsConfig streams, CourseFormats.Resolved formats) {
        JsonNode p = isObject(rawProps) ? rawProps : JsonNodeFactory.instance.objectNode();

        Toggle languageRaw = enabledWithLabel(p.get("languageFilter"));
        Toggle categoryRaw = enabledWithLabel(p.get("categoryFilter"));
        JsonNode priceRaw = isObject(p.get("priceFilter")) ? p.get("priceFilter") : JsonNodeFactory.instance.objectNode();
        PriceFilter priceFilter = new PriceFilter(isTrue(priceRaw.get("enabled")), text(priceRaw.get("label")),
                !(priceRaw.path("showFree").isBoolean() && !priceRaw.get("showFree").booleanValue()),
                resolveAmounts(priceRaw.get("maxOptions")));
        BadgeRules badges = resolveBadges(p.get("badges"));
        List<QuickFilter> quickFilters = resolveQuickFilters(p.get("quickFilters"), courseLanguagesOn, languages);
        List<CustomFilter> customFilters = resolveCustomFilters(p.get("customFilters"), formats);
        boolean groupingRequested = isTrue(p.get("groupLanguageVersions"));
        boolean showFilterCounts = isTrue(p.get("showFilterCounts"));
        boolean active = streams != null
                || isTrue(p.get("syncUrl"))
                || showFilterCounts
                || isTrue(p.get("showAppliedChips"))
                || isTrue(p.get("mobileFilterSheet"))
                || !quickFilters.isEmpty()
                || languageRaw.enabled()
                || priceFilter.enabled()
                || categoryRaw.enabled()
                || !customFilters.isEmpty()
                || groupingRequested
                || badges != null;

        String defaultName = p.path("defaultSort").isTextual() && SORT_TOKENS.containsKey(p.get("defaultSort").asText())
                ? p.get("defaultSort").asText() : "Newest";
        // "Popular" is offered only where the section opted into discovery or pins it as its default.
        List<String> sortOptions = new ArrayList<>();
        for (Map.Entry<String, String> e : SORT_TOKENS.entrySet()) {
            if (!"Popular".equals(e.getKey()) || active || "Popular".equals(defaultName)) sortOptions.add(e.getValue());
        }

        return new CatalogDiscovery(active, SORT_TOKENS.get(defaultName), List.copyOf(sortOptions), showFilterCounts,
                new Toggle(languageRaw.enabled() && courseLanguagesOn, languageRaw.label()),
                priceFilter,
                resolveCategoryFilter(p.get("categoryFilter"), categoryRaw,
                        streams != null && streams.folderLibrary()),
                customFilters, badges, quickFilters, resolvePopular(p.get("hero")),
                stringList(p.get("levelOrder")), stringList(p.get("tagOrder")));
    }

    private static Toggle enabledWithLabel(JsonNode raw) {
        return new Toggle(isObject(raw) && isTrue(raw.get("enabled")), isObject(raw) ? text(raw.get("label")) : "");
    }

    /** TS positiveNumber: a number (or numeric string) above zero, else null. */
    static Double positiveNumber(JsonNode v) {
        if (v == null) return null;
        double n;
        if (v.isNumber()) {
            n = v.asDouble();
        } else if (v.isTextual() && !v.asText().trim().isEmpty()) {
            try {
                n = Double.parseDouble(v.asText().trim());
            } catch (NumberFormatException e) {
                return null;
            }
        } else {
            return null;
        }
        return Double.isFinite(n) && n > 0 ? n : null;
    }

    static Integer positiveInt(JsonNode v) {
        Double n = positiveNumber(v);
        if (n == null || n < 1) return null;
        return (int) Math.floor(n);
    }

    /** Positive amounts, unique, ascending, at most 8 ({@code resolveAmounts}). */
    static List<Double> resolveAmounts(JsonNode raw) {
        if (raw == null || !raw.isArray()) return List.of();
        TreeSet<Double> out = new TreeSet<>();
        for (JsonNode n : raw) {
            Double v = positiveNumber(n);
            if (v != null) out.add(v);
        }
        return out.stream().limit(8).toList();
    }

    /**
     * Badge rules ({@code resolveBadges}): null unless {@code enabled === true}; {@code types}
     * absent = all four; a types list with nothing valid left in it means badges off.
     */
    static BadgeRules resolveBadges(JsonNode raw) {
        if (!isObject(raw) || !isTrue(raw.get("enabled"))) return null;
        List<String> types;
        if (raw.get("types") != null && raw.get("types").isArray()) {
            LinkedHashSet<String> picked = new LinkedHashSet<>();
            for (JsonNode t : raw.get("types")) if (t.isTextual() && ALL_BADGES.contains(t.asText())) picked.add(t.asText());
            types = List.copyOf(picked);
        } else {
            types = ALL_BADGES;
        }
        if (types.isEmpty()) return null;
        return new BadgeRules(true, types, positiveInt(raw.get("newDays")), positiveInt(raw.get("bestsellerTop")),
                positiveInt(raw.get("max")));
    }

    static List<QuickFilter> resolveQuickFilters(JsonNode raw, boolean courseLanguagesOn, List<Language> languages) {
        if (raw == null || !raw.isArray()) return List.of();
        Set<String> ids = new HashSet<>();
        List<QuickFilter> out = new ArrayList<>();
        int index = -1;
        for (JsonNode item : raw) {
            index++;
            if (!isObject(item)) continue;
            String kind = item.path("kind").isTextual() ? item.get("kind").asText() : "";
            if (!QUICK_FILTER_KINDS.contains(kind)) continue;
            Object value = null;
            if ("language".equals(kind)) {
                String code = lower(text(item.get("value")));
                if (!courseLanguagesOn || languages.stream().noneMatch(l -> l.code().equals(code))) continue;
                value = code;
            } else if ("priceMax".equals(kind)) {
                Double amount = positiveNumber(item.get("value"));
                if (amount == null) continue;
                value = amount;
            }
            String id = text(item.get("id"));
            if (id.isEmpty()) id = kind + "-" + index;
            while (ids.contains(id)) id = id + "-" + index;
            ids.add(id);
            out.add(new QuickFilter(id, text(item.get("label")), kind, value));
        }
        return List.copyOf(out);
    }

    private static CategoryFilter resolveCategoryFilter(JsonNode raw, Toggle toggle, boolean folderLibrary) {
        String scope = null, labelMode = null, sort = null, showAll = null;
        boolean hide = false;
        Integer visible = null;
        if (isObject(raw)) {
            if ("all".equals(raw.path("scope").asText(null))) scope = "all";
            String lm = raw.path("labelMode").asText(null);
            if ("subtitle".equals(lm) || "both".equals(lm)) labelMode = lm;
            if ("count".equals(raw.path("sort").asText(null))) sort = "count";
            hide = isTrue(raw.get("hideComingSoon"));
            visible = positiveInt(raw.get("visibleCount"));
            String s = text(raw.get("showAllLabel"));
            showAll = s.isEmpty() ? null : s;
        }
        return new CategoryFilter(toggle.enabled() && folderLibrary, toggle.label(), scope, labelMode, sort, hide,
                visible, showAll);
    }

    private static List<String> lowerList(JsonNode v) {
        if (v == null || !v.isArray()) return List.of();
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (JsonNode n : v) {
            String s = n.isTextual() ? lower(n.asText()) : "";
            if (!s.isEmpty()) out.add(s);
        }
        return List.copyOf(out);
    }

    private static List<String> stringList(JsonNode v) {
        if (v == null || !v.isArray()) return List.of();
        List<String> out = new ArrayList<>();
        for (JsonNode n : v) if (n.isTextual() || n.isNumber()) out.add(n.asText());
        return List.copyOf(out);
    }

    /** {@code resolveCustomFilters}: bad ids, reserved ids, duplicates and empty groups dropped; at most 6. */
    static List<CustomFilter> resolveCustomFilters(JsonNode raw, CourseFormats.Resolved formats) {
        if (raw == null || !raw.isArray()) return List.of();
        Set<String> ids = new HashSet<>();
        List<CustomFilter> out = new ArrayList<>();
        for (JsonNode item : raw) {
            if (!isObject(item)) continue;
            if (item.path("enabled").isBoolean() && !item.get("enabled").booleanValue()) continue;
            String id = CatalogStreams.toSlug(text(item.get("id")));
            if (id.isEmpty() || ids.contains(id) || RESERVED_FILTER_IDS.contains(id) || id.startsWith("utm")) continue;
            boolean fromFormats = "courseFormats".equals(item.path("source").asText(null));
            List<CustomOption> options = fromFormats ? formatOptions(formats) : authoredOptions(item.get("options"));
            if (options.isEmpty()) continue;
            ids.add(id);
            out.add(new CustomFilter(id, text(item.get("label")), fromFormats ? "courseFormats" : null,
                    item.path("showCounts").isBoolean() ? item.get("showCounts").booleanValue() : null,
                    !(item.path("showEmpty").isBoolean() && !item.get("showEmpty").booleanValue()),
                    positiveInt(item.get("visibleCount")), options));
            if (out.size() >= MAX_CUSTOM_FILTERS) break;
        }
        return List.copyOf(out);
    }

    private static List<CustomOption> authoredOptions(JsonNode raw) {
        if (raw == null || !raw.isArray()) return List.of();
        Set<String> seen = new HashSet<>();
        List<CustomOption> out = new ArrayList<>();
        for (JsonNode item : raw) {
            if (!isObject(item)) continue;
            String label = text(item.get("label"));
            String idSrc = text(item.get("id"));
            String id = CatalogStreams.toSlug(idSrc.isEmpty() ? label : idSrc);
            List<String> tags = lowerList(item.get("tags"));
            List<String> levels = lowerList(item.get("levels"));
            if (id.isEmpty() || label.isEmpty() || seen.contains(id) || (tags.isEmpty() && levels.isEmpty())) continue;
            seen.add(id);
            out.add(new CustomOption(id, label, tags, levels));
            if (out.size() >= MAX_CUSTOM_OPTIONS) break;
        }
        return List.copyOf(out);
    }

    private static List<CustomOption> formatOptions(CourseFormats.Resolved formats) {
        if (formats == null) return List.of();
        List<CustomOption> out = new ArrayList<>();
        for (CourseFormats.Format f : formats.list()) {
            String id = CatalogStreams.toSlug(f.key());
            if (id.isEmpty()) continue;
            out.add(new CustomOption(id, f.label(), f.tags(), f.levels()));
            if (out.size() >= MAX_CUSTOM_OPTIONS) break;
        }
        return List.copyOf(out);
    }

    /** Does one version carry the option (a tag or its level name, both case-insensitive)? ({@code rowMatchesCustomOption}) */
    public static boolean rowMatchesCustomOption(CatalogRow row, CustomOption option) {
        if (!option.tags().isEmpty()) {
            List<String> tags = CourseFormats.rowTags(row.tags(), null);
            for (String t : option.tags()) if (tags.contains(t)) return true;
        }
        if (!option.levels().isEmpty()) {
            String level = lower(row.levelName());
            if (!level.isEmpty() && option.levels().contains(level)) return true;
        }
        return false;
    }

    /** The hero band's "Popular:" chips: only on a band with {@code enabled === true}; at most 8. */
    static List<PopularChip> resolvePopular(JsonNode hero) {
        if (!isObject(hero) || !isTrue(hero.get("enabled"))) return List.of();
        JsonNode raw = hero.get("popular");
        if (raw == null || !raw.isArray()) return List.of();
        List<PopularChip> out = new ArrayList<>();
        for (JsonNode item : raw) {
            PopularChip chip = resolvePopularChip(item);
            if (chip != null) out.add(chip);
            if (out.size() >= MAX_HERO_POPULAR) break;
        }
        return List.copyOf(out);
    }

    static PopularChip resolvePopularChip(JsonNode raw) {
        if (!isObject(raw)) return null;
        String label = text(raw.get("label"));
        if (label.isEmpty()) return null;
        String value = text(raw.get("searchValue"));
        if (!value.isEmpty()) return new PopularChip("search", label, value, null, null, null, null);
        String streamSlug = text(raw.get("streamSlug"));
        if (!streamSlug.isEmpty()) {
            String cat = text(raw.get("categorySlug"));
            return new PopularChip("stream", label, null, streamSlug, cat.isEmpty() ? null : cat, null, null);
        }
        String quick = text(raw.get("quickFilterId"));
        if (!quick.isEmpty()) return new PopularChip("quick", label, null, null, null, quick, null);
        String route = text(raw.get("route"));
        if (!route.isEmpty()) return new PopularChip("route", label, null, null, null, null, route);
        return null;
    }
}
