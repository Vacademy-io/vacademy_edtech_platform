package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.NodeResponse;

import java.net.URI;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * Stream tabs and their categories, from a folder library or a hand-written tag list.
 *
 * <p>Ports of {@code -components/components/catalog/catalog-streams.ts}
 * ({@code folderTagSet}, {@code streamsFromFolderTree}, {@code streamsFromTagItems},
 * {@code countCardsByStream}), {@code -services/folder-library-service.ts} ({@code folderSlug},
 * {@code folderCourseTag}, {@code pathTo}, {@code nodeTitle}), the stream part of
 * {@code catalog/catalog-config.ts} ({@code toSlug}, {@code resolveStreams},
 * {@code resolveStreamItems}), {@code safeImageSrc}/{@code safeAccentColor} of
 * {@code -components/header/header-links.ts} and {@code placeLabel} of
 * {@code $courseId/-utils/course-page-context.ts}.
 *
 * <p>A stream (and a category) filters courses by COURSE TAG: a folder's tag is its
 * course_tag, else its slug. A course belongs to a stream when it carries the stream's tag or
 * the tag of any folder below it.
 */
public final class CatalogStreams {

    private CatalogStreams() {
    }

    public static final String FOLDER = "FOLDER";
    public static final String PRODUCT_PAGE = "PRODUCT_PAGE";

    /** A node of the public folder tree (PublicCatalogueFolderController / CatalogueFolderService.publicTree). */
    public record FolderNode(String id, String nodeType, String title, String subtitle, String description,
                             String slug, String courseTag, String productPageCode, String productPageName,
                             String imageUrl, String accentColor, boolean comingSoon, String audienceId,
                             List<FolderNode> children) {

        public static FolderNode from(NodeResponse n) {
            List<FolderNode> kids = new ArrayList<>();
            if (n.getChildren() != null) for (NodeResponse c : n.getChildren()) if (c != null) kids.add(from(c));
            return new FolderNode(n.getId(), n.getNodeType(), n.getTitle(), n.getSubtitle(), n.getDescription(),
                    n.getSlug(), n.getCourseTag(), n.getProductPageCode(), n.getProductPageName(), n.getImageUrl(),
                    n.getAccentColor(), Boolean.TRUE.equals(n.getComingSoon()), n.getAudienceId(), List.copyOf(kids));
        }

        public static List<FolderNode> fromAll(List<NodeResponse> nodes) {
            List<FolderNode> out = new ArrayList<>();
            if (nodes != null) for (NodeResponse n : nodes) if (n != null) out.add(from(n));
            return out;
        }

        public boolean isFolder() {
            return FOLDER.equals(nodeType);
        }
    }

    public record Category(String id, String slug, String title, String subtitle, List<String> tags,
                           boolean comingSoon, String audienceId, String imageUrl, String accentColor) {
    }

    public record Stream(String id, String slug, String title, String subtitle, String tag, List<String> tags,
                         boolean comingSoon, String audienceId, String imageUrl, String accentColor,
                         List<Category> categories) {
    }

    /** A hand-written stream item ({label, slug, tag, imageUrl?}), validated. */
    public record StreamItem(String label, String slug, String tag, String imageUrl) {
    }

    /** courseCatalog.props.streams, validated (null when streams are off). */
    public record StreamsConfig(String source, String libraryId, List<StreamItem> items, String labelMode) {
        public boolean folderLibrary() {
            return "folderLibrary".equals(source);
        }
    }

    private static String text(String s) {
        return s == null ? "" : s.trim();
    }

    private static final Pattern COMBINING = Pattern.compile("[\\u0300-\\u036f]");
    private static final Pattern NON_SLUG = Pattern.compile("[^a-z0-9]+");
    private static final Pattern EDGE_DASHES = Pattern.compile("^-+|-+$");

    private static String slugify(String value) {
        String s = Normalizer.normalize(value, Normalizer.Form.NFKD);
        s = COMBINING.matcher(s).replaceAll("").toLowerCase(Locale.ROOT);
        s = NON_SLUG.matcher(s).replaceAll("-");
        return EDGE_DASHES.matcher(s).replaceAll("");
    }

    /** The folder's link key: its slug, else a slug made from its subtitle or title, else its id. */
    public static String folderSlug(FolderNode n) {
        String explicit = text(n.slug());
        if (!explicit.isEmpty()) return explicit;
        // JS `n.subtitle || n.title || ""`: only an EMPTY subtitle falls through to the title.
        String source = n.subtitle() != null && !n.subtitle().isEmpty() ? n.subtitle()
                : (n.title() == null ? "" : n.title());
        String fromText = slugify(source);
        return fromText.isEmpty() ? n.id() : fromText;
    }

    /** The course tag a folder filters by: its explicit tag, else its slug. */
    public static String folderCourseTag(FolderNode n) {
        String tag = text(n.courseTag());
        return tag.isEmpty() ? folderSlug(n) : tag;
    }

    /** A folder's tag plus the tags of every folder below it, lower-case and unique, with their level keys. */
    public static List<String> folderTagSet(FolderNode node) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        walk(node, out);
        return new ArrayList<>(out);
    }

    private static void walk(FolderNode n, Set<String> out) {
        if (!n.isFolder()) return;
        String tag = lower(folderCourseTag(n));
        if (!tag.isEmpty()) out.add(tag);
        out.addAll(LevelKeys.levelKeys(folderCourseTag(n), n.title(), n.subtitle()));
        for (FolderNode c : n.children()) walk(c, out);
    }

    private static String folderTitle(FolderNode n) {
        String t = text(n.title());
        if (!t.isEmpty()) return t;
        String s = text(n.subtitle());
        if (!s.isEmpty()) return s;
        return text(n.productPageName());
    }

    /** Top-level folders are streams; their direct sub-folders are categories. Duplicate slugs keep the first. */
    public static List<Stream> streamsFromFolderTree(List<FolderNode> roots) {
        List<Stream> streams = new ArrayList<>();
        if (roots == null) return streams;
        Set<String> seen = new HashSet<>();
        for (FolderNode node : roots) {
            if (node == null || !node.isFolder()) continue;
            String slug = folderSlug(node);
            if (slug == null || slug.isEmpty() || seen.contains(slug.toLowerCase(Locale.ROOT))) continue;
            seen.add(slug.toLowerCase(Locale.ROOT));
            Set<String> categorySlugs = new HashSet<>();
            List<Category> categories = new ArrayList<>();
            for (FolderNode child : node.children()) {
                if (child == null || !child.isFolder()) continue;
                String childSlug = folderSlug(child);
                if (childSlug == null || childSlug.isEmpty()
                        || categorySlugs.contains(childSlug.toLowerCase(Locale.ROOT))) continue;
                categorySlugs.add(childSlug.toLowerCase(Locale.ROOT));
                categories.add(new Category(child.id(), childSlug, folderTitle(child), text(child.subtitle()),
                        folderTagSet(child), child.comingSoon(), emptyToNull(text(child.audienceId())),
                        safeImageSrc(child.imageUrl()), safeAccentColor(child.accentColor())));
            }
            streams.add(new Stream(node.id(), slug, folderTitle(node), text(node.subtitle()),
                    lower(folderCourseTag(node)), folderTagSet(node), node.comingSoon(),
                    emptyToNull(text(node.audienceId())), safeImageSrc(node.imageUrl()),
                    safeAccentColor(node.accentColor()), List.copyOf(categories)));
        }
        return streams;
    }

    /** Streams from a hand-written list; items are pre-validated by {@link #resolveStreams}. */
    public static List<Stream> streamsFromTagItems(List<StreamItem> items) {
        List<Stream> out = new ArrayList<>();
        for (StreamItem item : items) {
            String tag = lower(item.tag());
            LinkedHashSet<String> tags = new LinkedHashSet<>();
            if (!tag.isEmpty()) tags.add(tag);
            tags.addAll(LevelKeys.levelKeys(item.tag(), item.label()));
            out.add(new Stream(item.slug(), item.slug(), item.label(), "", tag,
                    List.copyOf(tags), false, null, safeImageSrc(item.imageUrl()), null,
                    List.of()));
        }
        return out;
    }

    /** A URL key: lower-case letters, digits and dashes, at most 120 characters ({@code toSlug}). */
    public static String toSlug(String value) {
        String s = slugify(value == null ? "" : value);
        if (s.length() > 120) s = s.substring(0, 120);
        return s.replaceAll("-+$", "");
    }

    /** courseCatalog.props.streams → config, or null unless {@code enabled === true}. */
    public static StreamsConfig resolveStreams(JsonNode raw) {
        if (!isObject(raw) || !isTrue(raw.get("enabled"))) return null;
        String source = "tags".equals(raw.path("source").asText(null)) ? "tags" : "folderLibrary";
        String labelModeRaw = raw.path("labelMode").isTextual() ? raw.get("labelMode").asText() : "";
        String labelMode = "subtitle".equals(labelModeRaw) || "both".equals(labelModeRaw) ? labelModeRaw : "title";
        List<StreamItem> items = "tags".equals(source) ? resolveStreamItems(raw.get("items")) : List.of();
        return new StreamsConfig(source, CatalogJson.text(raw.get("libraryId")), items, labelMode);
    }

    private static List<StreamItem> resolveStreamItems(JsonNode raw) {
        if (raw == null || !raw.isArray()) return List.of();
        Set<String> seen = new HashSet<>();
        List<StreamItem> out = new ArrayList<>();
        for (JsonNode item : raw) {
            if (!isObject(item)) continue;
            String label = CatalogJson.text(item.get("label"));
            String tag = CatalogJson.text(item.get("tag"));
            String slugSrc = CatalogJson.text(item.get("slug"));
            if (slugSrc.isEmpty()) slugSrc = !tag.isEmpty() ? tag : label;
            String slug = toSlug(slugSrc);
            if (slug.isEmpty() || seen.contains(slug)) continue;
            seen.add(slug);
            String imageUrl = CatalogJson.text(item.get("imageUrl"));
            out.add(new StreamItem(!label.isEmpty() ? label : (!tag.isEmpty() ? tag : slug), slug,
                    tag.isEmpty() ? slug : tag, imageUrl.isEmpty() ? null : imageUrl));
        }
        return out;
    }

    /** The first stream (folder order) whose tags the card carries — category-level tags count. */
    public static Stream streamOf(Set<String> tagSet, List<Stream> streams) {
        for (Stream s : streams) for (String t : s.tags()) if (tagSet.contains(t)) return s;
        return null;
    }

    /** The stream's first category the card carries a tag of. */
    public static Category categoryOf(Stream stream, Set<String> tagSet) {
        if (stream == null) return null;
        for (Category c : stream.categories()) for (String t : c.tags()) if (tagSet.contains(t)) return c;
        return null;
    }

    public static boolean matchesAny(List<String> tags, Set<String> tagSet) {
        for (String t : tags) if (tagSet.contains(t)) return true;
        return false;
    }

    /** Cards per stream: a card counts in every stream any of whose tags it carries. */
    public static Map<String, Integer> countCardsByStream(List<Set<String>> cardTagSets, List<Stream> streams) {
        Map<String, Integer> bySlug = new LinkedHashMap<>();
        for (Stream s : streams) {
            int n = 0;
            for (Set<String> card : cardTagSets) if (matchesAny(s.tags(), card)) n++;
            bySlug.put(s.slug(), n);
        }
        return bySlug;
    }

    private static final Pattern DEVANAGARI = Pattern.compile("[\\u0900-\\u097F]");
    private static final Set<String> DEVANAGARI_LOCALES = Set.of("hi", "mr", "ne", "sa", "kok", "mai", "bho");

    /**
     * A stream or category as the visitor reads it, by the section's label mode: its title, its
     * subtitle, or ("both") the title — unless the title is Devanagari and the visitor reads
     * another language, when the subtitle is the one they can read.
     */
    public static String placeLabel(String title, String subtitle, String labelMode, String locale) {
        String t = text(title);
        String s = text(subtitle);
        if ("subtitle".equals(labelMode)) return s.isEmpty() ? t : s;
        if ("both".equals(labelMode) && !s.isEmpty() && DEVANAGARI.matcher(t).find()) {
            String lang = lower(locale).split("[-_]")[0];
            if (!DEVANAGARI_LOCALES.contains(lang)) return s;
        }
        return t.isEmpty() ? s : t;
    }

    /** Path from the top down to {@code id}, inclusive; empty when it is not in {@code nodes}. */
    public static List<FolderNode> pathTo(List<FolderNode> nodes, String id) {
        if (id == null || id.isEmpty()) return List.of();
        for (FolderNode n : nodes) {
            if (id.equals(n.id())) return List.of(n);
            List<FolderNode> below = pathTo(n.children(), id);
            if (!below.isEmpty()) {
                List<FolderNode> out = new ArrayList<>();
                out.add(n);
                out.addAll(below);
                return out;
            }
        }
        return List.of();
    }

    public static String nodeTitle(FolderNode n) {
        String t = text(n.title());
        return t.isEmpty() ? text(n.productPageName()) : t;
    }

    /** An image source from untrusted data: a site path ("/x", never "//host") or a full http(s) URL. */
    public static String safeImageSrc(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == 0x7f) return null;
        }
        if (value.startsWith("/") && value.length() >= 1
                && !(value.length() > 1 && (value.charAt(1) == '/' || value.charAt(1) == '\\'))) {
            return value;
        }
        if (value.regionMatches(true, 0, "http://", 0, 7) || value.regionMatches(true, 0, "https://", 0, 8)) {
            try {
                URI uri = new URI(value);
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
                if ((scheme.equals("http") || scheme.equals("https")) && uri.getHost() != null) return value;
            } catch (Exception ignored) {
                // Not a URL at all.
            }
        }
        return null;
    }

    private static final Pattern HEX_COLOR = Pattern.compile("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$");

    /** Accent colours from folder data: #rgb, #rrggbb or #rrggbbaa only. */
    public static String safeAccentColor(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        return HEX_COLOR.matcher(value).matches() ? value : null;
    }

    private static String emptyToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }
}
