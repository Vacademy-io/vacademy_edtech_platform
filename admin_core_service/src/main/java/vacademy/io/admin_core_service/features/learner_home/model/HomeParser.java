package vacademy.io.admin_core_service.features.learner_home.model;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;

import java.net.URI;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Strict reader for the editor's JSON. Unknown keys are rejected at every level, so a typo is
 * reported instead of being saved silently. Shape, enums, lengths and counts are checked here
 * (save time); whether required content is filled in is a publish check ({@code PublishChecks}),
 * so templates with empty placeholders can still be saved as drafts.
 *
 * <p>Every problem is appended to the caller's issue list; parsing goes on after a problem so
 * one response lists them all. A value with a problem is replaced by its default.
 */
public final class HomeParser {

    public static final int MAX_BLOCKS = 30;
    public static final int MAX_CONTENT_BLOCKS = 20;
    public static final int MAX_BANNERS = 3;
    public static final int MAX_EVENTS = 3;
    public static final int MAX_SHELVES = 6;
    public static final int MAX_BODY_BYTES = 256 * 1024;

    public static final int MAX_SLIDES = 5;
    public static final int MAX_TILES = 16;
    public static final int MAX_SHELF_TAGS = 5;
    public static final int MAX_SHELF_PACKAGES = 20;
    public static final int MAX_CONDITIONS = 5;
    public static final int MAX_CONDITION_IDS = 200;
    public static final int MIN_SHELF_LIMIT = 4;
    public static final int MAX_SHELF_LIMIT = 20;
    public static final int DEFAULT_SHELF_LIMIT = 10;
    public static final int MAX_JOIN_OPENS_MINUTES = 120;
    public static final int DEFAULT_JOIN_OPENS_MINUTES = 15;
    public static final String DEFAULT_ACK_LABEL = "I have read this";

    private static final Pattern KEY = Pattern.compile("^[A-Za-z0-9_-]{1,36}$");
    private static final int MAX_ID = 255;
    private static final int MAX_URL = 2000;
    private static final int MAX_APP_PATH = 500;
    private static final Set<String> RENDITION_WIDTHS = Set.of("320", "640", "960", "1600");

    private final List<Issue> issues;
    private String blockKey;

    public HomeParser(List<Issue> issues) {
        this.issues = issues;
    }

    // ── Layout ──────────────────────────────────────────────────────────────

    /** Settings plus the ordered block list, with the layout-level rules. */
    public LayoutBody parseLayout(JsonNode settingsNode, JsonNode blocksNode) {
        Settings settings = parseSettings(settingsNode);
        List<Block> blocks = new ArrayList<>();
        blockKey = null;
        if (blocksNode == null || blocksNode.isNull()) {
            issue("blocks", "REQUIRED", "blocks is required");
        } else if (!blocksNode.isArray()) {
            issue("blocks", "INVALID_TYPE", "blocks must be an array");
        } else {
            int i = 0;
            for (JsonNode node : blocksNode) {
                Block block = parseBlock(node, i++);
                if (block != null) {
                    blocks.add(block);
                }
            }
        }
        checkLayoutRules(blocks, issues);
        return new LayoutBody(settings, blocks);
    }

    /** Count limits, key uniqueness, built-in uniqueness and the required HERO. */
    public static void checkLayoutRules(List<Block> blocks, List<Issue> out) {
        if (blocks.size() > MAX_BLOCKS) {
            out.add(new Issue(null, "blocks", "TOO_MANY", "At most " + MAX_BLOCKS + " blocks"));
        }
        long content = blocks.stream().filter(b -> b.type() != BlockType.BUILTIN).count();
        if (content > MAX_CONTENT_BLOCKS) {
            out.add(new Issue(null, "blocks", "TOO_MANY", "At most " + MAX_CONTENT_BLOCKS + " blocks that are not built-in"));
        }
        Map<BlockType, Integer> perType = new EnumMap<>(BlockType.class);
        blocks.forEach(b -> perType.merge(b.type(), 1, Integer::sum));
        limit(perType, BlockType.BANNER_CAROUSEL, MAX_BANNERS, "banner carousels", out);
        limit(perType, BlockType.EVENT, MAX_EVENTS, "events", out);
        limit(perType, BlockType.COURSE_SHELF, MAX_SHELVES, "course shelves", out);

        Set<String> keys = new HashSet<>();
        Set<BuiltinWidget> widgets = new HashSet<>();
        for (Block b : blocks) {
            if (!keys.add(b.blockKey())) {
                out.add(new Issue(b.blockKey(), "block_key", "DUPLICATE", "Two blocks use the same block_key"));
            }
            if (b.builtinWidget() != null && !widgets.add(b.builtinWidget())) {
                out.add(new Issue(b.blockKey(), "builtin_widget", "DUPLICATE",
                        b.builtinWidget() + " can appear only once"));
            }
        }
        if (!widgets.contains(BuiltinWidget.HERO)) {
            out.add(new Issue(null, "blocks", "HERO_REQUIRED", "The HERO block is required"));
        }
    }

    private static void limit(Map<BlockType, Integer> perType, BlockType type, int max, String noun, List<Issue> out) {
        if (perType.getOrDefault(type, 0) > max) {
            out.add(new Issue(null, "blocks", "TOO_MANY", "At most " + max + " " + noun));
        }
    }

    public Settings parseSettings(JsonNode node) {
        blockKey = null;
        JsonNode o = obj(node, "settings", "phone_spacing", "show_header", "carousel_autoplay_default");
        if (o == null) {
            return Settings.DEFAULT;
        }
        PhoneSpacing spacing = enumValue(PhoneSpacing.class, o, "phone_spacing", "settings", PhoneSpacing.COMPACT);
        boolean showHeader = bool(o, "show_header", "settings", true);
        boolean autoplay = bool(o, "carousel_autoplay_default", "settings", true);
        return new Settings(spacing, showHeader, autoplay);
    }

    // ── Block envelope ──────────────────────────────────────────────────────

    public Block parseBlock(JsonNode node, int index) {
        blockKey = null;
        String where = "blocks[" + index + "]";
        JsonNode o = obj(node, where, "block_key", "type", "builtin_widget", "desktop_placement", "devices",
                "enabled", "admin_label", "starts_at", "ends_at", "audience", "config");
        if (o == null) {
            issue(where, "INVALID_TYPE", "A block must be an object");
            return null;
        }
        String key = text(o, "block_key", "", 64);
        if (key == null || key.isBlank()) {
            key = UUID.randomUUID().toString();
        } else if (!KEY.matcher(key).matches()) {
            issue("block_key", "INVALID_VALUE", "block_key must be 1-36 letters, digits, '-' or '_'");
            key = UUID.randomUUID().toString();
        }
        blockKey = key;

        BlockType type = enumValue(BlockType.class, o, "type", "", null);
        if (type == null) {
            if (!o.hasNonNull("type")) {
                issue("type", "REQUIRED", "type is required");
            }
            return null;
        }
        BuiltinWidget widget = enumValue(BuiltinWidget.class, o, "builtin_widget", "", null);
        if (type == BlockType.BUILTIN && widget == null) {
            if (!o.hasNonNull("builtin_widget")) {
                issue("builtin_widget", "REQUIRED", "builtin_widget is required for a BUILTIN block");
            }
            return null;
        }
        if (type != BlockType.BUILTIN && o.hasNonNull("builtin_widget")) {
            issue("builtin_widget", "INVALID_VALUE", "builtin_widget is only for BUILTIN blocks");
            widget = null;
        }
        Placement placement = enumValue(Placement.class, o, "desktop_placement", "", Placement.MAIN);
        Devices devices = enumValue(Devices.class, o, "devices", "", Devices.BOTH);
        boolean enabled = bool(o, "enabled", "", true);
        String adminLabel = text(o, "admin_label", "", 120);
        Instant startsAt = instant(o, "starts_at", "");
        Instant endsAt = instant(o, "ends_at", "");
        if (startsAt != null && endsAt != null && !startsAt.isBefore(endsAt)) {
            issue("ends_at", "INVALID_VALUE", "ends_at must be after starts_at");
            endsAt = null;
        }
        Audience audience = parseAudience(o.get("audience"), "audience");
        BlockConfig config = parseConfig(type, widget, o.get("config"), "config");
        return new Block(key, type, widget, placement, devices, enabled, adminLabel, startsAt, endsAt, audience, config);
    }

    /** For a stored block: the envelope comes from columns, so only the JSON parts are read. */
    public Block parseStored(String key, BlockType type, BuiltinWidget widget, Placement placement, Devices devices,
                             boolean enabled, String adminLabel, Instant startsAt, Instant endsAt,
                             JsonNode audienceNode, JsonNode configNode) {
        blockKey = key;
        Audience audience = parseAudience(audienceNode, "audience");
        BlockConfig config = parseConfig(type, widget, configNode, "config");
        return new Block(key, type, widget, placement, devices, enabled, adminLabel, startsAt, endsAt, audience, config);
    }

    // ── Audience ────────────────────────────────────────────────────────────

    public Audience parseAudience(JsonNode node, String path) {
        JsonNode o = obj(node, path, "mode", "all_of");
        if (o == null) {
            return Audience.EVERYONE;
        }
        String mode = text(o, "mode", path, 16);
        if (mode == null || "EVERYONE".equals(mode)) {
            if (o.has("all_of") && !o.get("all_of").isNull() && o.get("all_of").size() > 0) {
                issue(path + ".all_of", "INVALID_VALUE", "all_of is only for mode RULES");
            }
            return Audience.EVERYONE;
        }
        if (!"RULES".equals(mode)) {
            issue(path + ".mode", "INVALID_VALUE", "mode must be EVERYONE or RULES");
            return Audience.EVERYONE;
        }
        List<Condition> conditions = new ArrayList<>();
        List<JsonNode> rows = array(o, "all_of", path, MAX_CONDITIONS);
        for (int i = 0; i < rows.size(); i++) {
            String rowPath = path + ".all_of[" + i + "]";
            JsonNode row = rows.get(i);
            if (row == null || !row.isObject()) {
                issue(rowPath, "INVALID_TYPE", "A condition must be an object");
                continue;
            }
            ConditionKind kind = enumValue(ConditionKind.class, row, "kind", rowPath, null);
            if (kind == null) {
                if (!row.hasNonNull("kind")) issue(rowPath + ".kind", "REQUIRED", "kind is required");
                continue;
            }
            String idsField = switch (kind) {
                case PACKAGE_SESSION -> "ids";
                case ENROLLED_IN_COURSE, NOT_ENROLLED_IN_COURSE -> "package_ids";
                case USER_TAG -> "tag_ids";
            };
            rejectUnknown(row, rowPath, Set.of("kind", idsField));
            conditions.add(new Condition(kind, idList(row, idsField, rowPath, MAX_CONDITION_IDS)));
        }
        return new Audience(false, List.copyOf(conditions));
    }

    // ── Configs ─────────────────────────────────────────────────────────────

    public BlockConfig parseConfig(BlockType type, BuiltinWidget widget, JsonNode node, String path) {
        return switch (type) {
            case BANNER_CAROUSEL -> banner(node, path);
            case SHORTCUTS -> shortcuts(node, path);
            case COURSE_SHELF -> shelf(node, path);
            case NOTICE -> notice(node, path);
            case EVENT -> event(node, path);
            case BUILTIN -> builtin(widget, node, path);
        };
    }

    private BannerConfig banner(JsonNode node, String path) {
        JsonNode o = objOrEmpty(node, path, "title", "auto_rotate", "slides");
        String title = text(o, "title", path, 60);
        boolean autoRotate = bool(o, "auto_rotate", path, true);
        List<Slide> slides = new ArrayList<>();
        List<JsonNode> rows = array(o, "slides", path, MAX_SLIDES);
        for (int i = 0; i < rows.size(); i++) {
            String p = path + ".slides[" + i + "]";
            JsonNode s = obj(rows.get(i), p, "key", "image", "desktop_image", "link", "starts_at", "ends_at");
            if (s == null) {
                issue(p, "INVALID_TYPE", "A slide must be an object");
                continue;
            }
            Instant startsAt = instant(s, "starts_at", p);
            Instant endsAt = instant(s, "ends_at", p);
            if (startsAt != null && endsAt != null && !startsAt.isBefore(endsAt)) {
                issue(p + ".ends_at", "INVALID_VALUE", "ends_at must be after starts_at");
                endsAt = null;
            }
            slides.add(new Slide(itemKey(s, p), image(s.get("image"), p + ".image"),
                    image(s.get("desktop_image"), p + ".desktop_image"), link(s.get("link"), p + ".link"),
                    startsAt, endsAt));
        }
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < slides.size(); i++) {
            Slide sl = slides.get(i);
            if (!seen.add(sl.key())) {
                issue(path + ".slides[" + i + "].key", "DUPLICATE", "Two slides use the same key");
            }
        }
        return new BannerConfig(nz(title), autoRotate, List.copyOf(slides));
    }

    private ShortcutsConfig shortcuts(JsonNode node, String path) {
        JsonNode o = objOrEmpty(node, path, "title", "tiles");
        String title = text(o, "title", path, 40);
        List<Tile> tiles = new ArrayList<>();
        List<JsonNode> rows = array(o, "tiles", path, MAX_TILES);
        for (int i = 0; i < rows.size(); i++) {
            String p = path + ".tiles[" + i + "]";
            JsonNode t = obj(rows.get(i), p, "key", "label", "icon", "link");
            if (t == null) {
                issue(p, "INVALID_TYPE", "A tile must be an object");
                continue;
            }
            tiles.add(new Tile(itemKey(t, p), nz(text(t, "label", p, 20)), tileIcon(t.get("icon"), p + ".icon"),
                    link(t.get("link"), p + ".link")));
        }
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < tiles.size(); i++) {
            if (!seen.add(tiles.get(i).key())) {
                issue(path + ".tiles[" + i + "].key", "DUPLICATE", "Two tiles use the same key");
            }
        }
        return new ShortcutsConfig(nz(title), List.copyOf(tiles));
    }

    private TileIcon tileIcon(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isObject()) {
            issue(path, "INVALID_TYPE", "icon must be an object");
            return null;
        }
        String kind = text(node, "kind", path, 8);
        if ("ICON".equals(kind)) {
            rejectUnknown(node, path, Set.of("kind", "name"));
            ShortcutIcon name = enumValue(ShortcutIcon.class, node, "name", path, null);
            return new TileIcon("ICON", name, null);
        }
        if ("IMAGE".equals(kind)) {
            rejectUnknown(node, path, Set.of("kind", "image"));
            return new TileIcon("IMAGE", null, image(node.get("image"), path + ".image"));
        }
        issue(path + ".kind", kind == null ? "REQUIRED" : "INVALID_VALUE", "icon.kind must be ICON or IMAGE");
        return null;
    }

    private ShelfConfig shelf(JsonNode node, String path) {
        JsonNode o = objOrEmpty(node, path, "title", "source", "tags", "package_ids", "limit", "hide_owned",
                "show_price", "see_all");
        String title = text(o, "title", path, 60);
        ShelfSource source = enumValue(ShelfSource.class, o, "source", path, ShelfSource.NEWEST);
        List<String> tags = textList(o, "tags", path, MAX_SHELF_TAGS, 255);
        List<String> packageIds = idList(o, "package_ids", path, MAX_SHELF_PACKAGES);
        int limit = integer(o, "limit", path, DEFAULT_SHELF_LIMIT, MIN_SHELF_LIMIT, MAX_SHELF_LIMIT);
        boolean hideOwned = bool(o, "hide_owned", path, true);
        boolean showPrice = bool(o, "show_price", path, true);
        LinkTarget seeAll = link(o.get("see_all"), path + ".see_all");
        return new ShelfConfig(nz(title), source, tags, packageIds, limit, hideOwned, showPrice, seeAll);
    }

    private NoticeConfig notice(JsonNode node, String path) {
        JsonNode o = objOrEmpty(node, path, "title", "body", "image", "button", "tone", "dismissible",
                "require_ack", "ack_label");
        String title = text(o, "title", path, 80);
        String body = text(o, "body", path, 600);
        ImageRef image = image(o.get("image"), path + ".image");
        Cta button = cta(o.get("button"), path + ".button");
        Tone tone = enumValue(Tone.class, o, "tone", path, Tone.NEUTRAL);
        boolean dismissible = bool(o, "dismissible", path, true);
        boolean requireAck = bool(o, "require_ack", path, false);
        String ackLabel = text(o, "ack_label", path, 40);
        return new NoticeConfig(nz(title), nz(body), image, button, tone, dismissible, requireAck,
                ackLabel == null || ackLabel.isBlank() ? DEFAULT_ACK_LABEL : ackLabel);
    }

    private EventConfig event(JsonNode node, String path) {
        JsonNode o = objOrEmpty(node, path, "title", "subtitle", "image", "source", "live_session_id", "starts_at",
                "ends_at", "register_cta", "join_cta", "join_opens_minutes", "show_countdown");
        String title = text(o, "title", path, 80);
        String subtitle = text(o, "subtitle", path, 140);
        ImageRef image = image(o.get("image"), path + ".image");
        EventSource source = enumValue(EventSource.class, o, "source", path, EventSource.CUSTOM);
        String sessionId = id(o, "live_session_id", path);
        Instant startsAt = instant(o, "starts_at", path);
        Instant endsAt = instant(o, "ends_at", path);
        if (startsAt != null && endsAt != null && !startsAt.isBefore(endsAt)) {
            issue(path + ".ends_at", "INVALID_VALUE", "ends_at must be after starts_at");
            endsAt = null;
        }
        Cta register = cta(o.get("register_cta"), path + ".register_cta");
        Cta join = cta(o.get("join_cta"), path + ".join_cta");
        int joinOpens = integer(o, "join_opens_minutes", path, DEFAULT_JOIN_OPENS_MINUTES, 0, MAX_JOIN_OPENS_MINUTES);
        boolean countdown = bool(o, "show_countdown", path, true);
        return new EventConfig(nz(title), nz(subtitle), image, source, sessionId, startsAt, endsAt, register, join,
                joinOpens, countdown);
    }

    private BuiltinConfig builtin(BuiltinWidget widget, JsonNode node, String path) {
        JsonNode o = objOrEmpty(node, path, "options");
        String p = path + ".options";
        JsonNode opts = o.get("options");
        Map<String, Object> out = new LinkedHashMap<>();
        if (opts != null && !opts.isNull() && !opts.isObject()) {
            issue(p, "INVALID_TYPE", "options must be an object");
            return new BuiltinConfig(Map.of());
        }
        JsonNode on = opts == null || opts.isNull() ? null : opts;
        switch (widget) {
            case HERO -> {
                rejectUnknown(on, p, Set.of("getting_started"));
                out.put("getting_started", bool(on, "getting_started", p, true));
            }
            case STATS_ROW -> {
                rejectUnknown(on, p, Set.of("cards"));
                List<String> cards = new ArrayList<>();
                if (on == null || !on.has("cards") || on.get("cards").isNull()) {
                    for (StatsCard c : StatsCard.values()) cards.add(c.name());
                } else if (!on.get("cards").isArray()) {
                    issue(p + ".cards", "INVALID_TYPE", "cards must be an array");
                } else {
                    Set<String> seen = new LinkedHashSet<>();
                    int i = 0;
                    for (JsonNode c : on.get("cards")) {
                        String cp = p + ".cards[" + i++ + "]";
                        if (!c.isTextual() || !isEnum(StatsCard.class, c.asText())) {
                            issue(cp, "INVALID_VALUE", "card must be one of COURSES, LIVE_CLASSES, EVALUATIONS");
                        } else if (!seen.add(c.asText())) {
                            issue(cp, "DUPLICATE", "card listed twice");
                        }
                    }
                    cards.addAll(seen);
                }
                out.put("cards", List.copyOf(cards));
            }
            case ENROLLED_COURSES -> {
                rejectUnknown(on, p, Set.of("show_all"));
                out.put("show_all", bool(on, "show_all", p, false));
            }
            case EXPLORE_BUTTONS -> {
                rejectUnknown(on, p, Set.of("memberships", "books"));
                out.put("memberships", bool(on, "memberships", p, true));
                out.put("books", bool(on, "books", p, true));
            }
            default -> rejectUnknown(on, p, Set.of());
        }
        return new BuiltinConfig(Collections.unmodifiableMap(out));
    }

    // ── Shared value types ──────────────────────────────────────────────────

    public ImageRef image(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return null;
        }
        JsonNode o = obj(node, path, "file_id", "alt", "decorative", "url", "width", "height", "renditions");
        if (o == null) {
            return null;
        }
        String fileId = id(o, "file_id", path);
        String alt = text(o, "alt", path, 140);
        boolean decorative = bool(o, "decorative", path, false);
        String url = httpUrl(o, "url", path);
        Integer width = optInt(o, "width", path, 1, 30_000);
        Integer height = optInt(o, "height", path, 1, 30_000);
        Map<String, String> renditions = null;
        JsonNode r = o.get("renditions");
        if (r != null && !r.isNull()) {
            if (!r.isObject()) {
                issue(path + ".renditions", "INVALID_TYPE", "renditions must be an object");
            } else {
                renditions = new LinkedHashMap<>();
                Iterator<Map.Entry<String, JsonNode>> it = r.fields();
                while (it.hasNext()) {
                    Map.Entry<String, JsonNode> e = it.next();
                    String rp = path + ".renditions." + e.getKey();
                    if (!RENDITION_WIDTHS.contains(e.getKey())) {
                        issue(rp, "UNKNOWN_FIELD", "Unknown rendition width");
                    } else if (!e.getValue().isTextual() || !isHttpUrl(e.getValue().asText())) {
                        issue(rp, "INVALID_URL", "A rendition must be an http(s) URL");
                    } else {
                        renditions.put(e.getKey(), e.getValue().asText());
                    }
                }
                renditions = renditions.isEmpty() ? null : Collections.unmodifiableMap(renditions);
            }
        }
        if (fileId == null && url == null) {
            // An empty image object from the editor = no image yet.
            return null;
        }
        return new ImageRef(fileId, alt, decorative, url, width, height, renditions);
    }

    public LinkTarget link(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isObject()) {
            issue(path, "INVALID_TYPE", "link must be an object");
            return null;
        }
        LinkKind kind = enumValue(LinkKind.class, node, "kind", path, null);
        if (kind == null) {
            if (!node.hasNonNull("kind")) issue(path + ".kind", "REQUIRED", "link.kind is required");
            return null;
        }
        return switch (kind) {
            case COURSE -> {
                rejectUnknown(node, path, Set.of("kind", "package_id"));
                yield LinkTarget.course(id(node, "package_id", path));
            }
            case COURSE_LIST -> {
                rejectUnknown(node, path, Set.of("kind", "tag"));
                String tag = text(node, "tag", path, 255);
                yield LinkTarget.courseList(tag == null || tag.isBlank() ? null : tag.trim());
            }
            case PRODUCT_PAGE -> {
                rejectUnknown(node, path, Set.of("kind", "code"));
                yield new LinkTarget(kind, null, null, id(node, "code", path), null, null, null, null, null, null);
            }
            case LIVE_CLASS -> {
                rejectUnknown(node, path, Set.of("kind", "session_id"));
                yield LinkTarget.liveClass(id(node, "session_id", path));
            }
            case ASSESSMENT -> {
                rejectUnknown(node, path, Set.of("kind", "assessment_id"));
                yield new LinkTarget(kind, null, null, null, null, id(node, "assessment_id", path), null, null, null,
                        null);
            }
            case FEATURE -> {
                rejectUnknown(node, path, Set.of("kind", "feature"));
                yield new LinkTarget(kind, null, null, null, null, null,
                        enumValue(Feature.class, node, "feature", path, null), null, null, null);
            }
            case URL -> {
                rejectUnknown(node, path, Set.of("kind", "url", "sells_something"));
                String url = text(node, "url", path, MAX_URL);
                if (url != null && !url.isBlank() && !isAllowedLinkUrl(url.trim())) {
                    issue(path + ".url", "INVALID_URL", "Only https, http, mailto and tel links are allowed");
                    url = null;
                }
                yield new LinkTarget(kind, null, null, null, null, null, null,
                        url == null || url.isBlank() ? null : url.trim(), bool(node, "sells_something", path, false),
                        null);
            }
            case APP_PATH -> {
                rejectUnknown(node, path, Set.of("kind", "path"));
                String p = text(node, "path", path, MAX_APP_PATH);
                if (p != null && !p.isBlank() && (!p.startsWith("/") || p.startsWith("//") || hasControl(p))) {
                    issue(path + ".path", "INVALID_VALUE", "An app path must start with a single '/'");
                    p = null;
                }
                yield new LinkTarget(kind, null, null, null, null, null, null, null, null,
                        p == null || p.isBlank() ? null : p);
            }
        };
    }

    public Cta cta(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return null;
        }
        JsonNode o = obj(node, path, "label", "link");
        if (o == null) {
            return null;
        }
        return new Cta(nz(text(o, "label", path, 24)), link(o.get("link"), path + ".link"));
    }

    // ── URL rules ───────────────────────────────────────────────────────────

    /** https, http, mailto and tel only; javascript:, data: and relative links are refused. */
    public static boolean isAllowedLinkUrl(String url) {
        if (url == null || url.isBlank() || hasControl(url)) return false;
        String lower = url.trim().toLowerCase(Locale.ROOT);
        if (lower.startsWith("mailto:")) return lower.length() > "mailto:".length();
        if (lower.startsWith("tel:")) return lower.length() > "tel:".length();
        return isHttpUrl(url);
    }

    public static boolean isHttpUrl(String url) {
        if (url == null || url.isBlank() || hasControl(url)) return false;
        try {
            URI uri = URI.create(url.trim());
            String scheme = uri.getScheme();
            return scheme != null && (scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))
                    && uri.getHost() != null && !uri.getHost().isBlank();
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static boolean hasControl(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
    }

    // ── Low-level readers ───────────────────────────────────────────────────

    private void issue(String path, String code, String message) {
        issues.add(new Issue(blockKey, path, code, message));
    }

    private static String join(String path, String field) {
        return path == null || path.isEmpty() ? field : path + "." + field;
    }

    /** The node as an object with only the allowed keys; null when absent, null or not an object. */
    private JsonNode obj(JsonNode node, String path, String... allowed) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isObject()) {
            issue(path, "INVALID_TYPE", "Expected an object");
            return null;
        }
        rejectUnknown(node, path, Set.of(allowed));
        return node;
    }

    private JsonNode objOrEmpty(JsonNode node, String path, String... allowed) {
        JsonNode o = obj(node, path, allowed);
        return o == null ? com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode() : o;
    }

    private void rejectUnknown(JsonNode node, String path, Set<String> allowed) {
        if (node == null || !node.isObject()) {
            return;
        }
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!allowed.contains(name)) {
                issue(join(path, name), "UNKNOWN_FIELD", "Unknown field '" + name + "'");
            }
        }
    }

    private String text(JsonNode o, String field, String path, int max) {
        if (o == null) return null;
        JsonNode v = o.get(field);
        if (v == null || v.isNull()) return null;
        if (!v.isTextual()) {
            issue(join(path, field), "INVALID_TYPE", field + " must be a string");
            return null;
        }
        String s = v.asText();
        if (s.codePointCount(0, s.length()) > max) {
            issue(join(path, field), "TOO_LONG", field + " must be at most " + max + " characters");
            return s.substring(0, s.offsetByCodePoints(0, max));
        }
        return s;
    }

    private String id(JsonNode o, String field, String path) {
        String s = text(o, field, path, MAX_ID);
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        if (hasControl(t) || t.contains(" ")) {
            issue(join(path, field), "INVALID_VALUE", field + " is not a valid id");
            return null;
        }
        return t;
    }

    private String httpUrl(JsonNode o, String field, String path) {
        String s = text(o, field, path, MAX_URL);
        if (s == null || s.isBlank()) return null;
        if (!isHttpUrl(s.trim())) {
            issue(join(path, field), "INVALID_URL", field + " must be an http(s) URL");
            return null;
        }
        return s.trim();
    }

    private boolean bool(JsonNode o, String field, String path, boolean def) {
        if (o == null) return def;
        JsonNode v = o.get(field);
        if (v == null || v.isNull()) return def;
        if (!v.isBoolean()) {
            issue(join(path, field), "INVALID_TYPE", field + " must be true or false");
            return def;
        }
        return v.asBoolean();
    }

    private int integer(JsonNode o, String field, String path, int def, int min, int max) {
        Integer v = optInt(o, field, path, min, max);
        return v == null ? def : v;
    }

    private Integer optInt(JsonNode o, String field, String path, int min, int max) {
        if (o == null) return null;
        JsonNode v = o.get(field);
        if (v == null || v.isNull()) return null;
        if (!v.isIntegralNumber() || !v.canConvertToInt()) {
            issue(join(path, field), "INVALID_TYPE", field + " must be a whole number");
            return null;
        }
        int i = v.asInt();
        if (i < min || i > max) {
            issue(join(path, field), "OUT_OF_RANGE", field + " must be between " + min + " and " + max);
            return null;
        }
        return i;
    }

    private Instant instant(JsonNode o, String field, String path) {
        if (o == null) return null;
        JsonNode v = o.get(field);
        if (v == null || v.isNull()) return null;
        if (!v.isTextual()) {
            issue(join(path, field), "INVALID_TYPE", field + " must be an ISO date-time string");
            return null;
        }
        Instant parsed = parseInstant(v.asText());
        if (parsed == null) {
            issue(join(path, field), "INVALID_VALUE", field + " must be an instant with a zone, e.g. 2026-12-01T13:30:00Z");
        }
        return parsed;
    }

    /** An instant with an explicit offset or Z. A naive local date-time is refused on purpose. */
    public static Instant parseInstant(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return Instant.parse(s.trim());
        } catch (Exception ignored) {
            // fall through
        }
        try {
            return OffsetDateTime.parse(s.trim()).toInstant();
        } catch (Exception e) {
            return null;
        }
    }

    private <E extends Enum<E>> E enumValue(Class<E> type, JsonNode o, String field, String path, E def) {
        if (o == null) return def;
        JsonNode v = o.get(field);
        if (v == null || v.isNull()) return def;
        if (!v.isTextual() || !isEnum(type, v.asText())) {
            issue(join(path, field), "INVALID_VALUE", field + " has an unknown value");
            return def;
        }
        return Enum.valueOf(type, v.asText());
    }

    private static <E extends Enum<E>> boolean isEnum(Class<E> type, String value) {
        for (E e : type.getEnumConstants()) {
            if (e.name().equals(value)) return true;
        }
        return false;
    }

    private List<JsonNode> array(JsonNode o, String field, String path, int max) {
        List<JsonNode> out = new ArrayList<>();
        if (o == null) return out;
        JsonNode v = o.get(field);
        if (v == null || v.isNull()) return out;
        if (!v.isArray()) {
            issue(join(path, field), "INVALID_TYPE", field + " must be an array");
            return out;
        }
        if (v.size() > max) {
            issue(join(path, field), "TOO_MANY", field + " holds at most " + max + " items");
        }
        int i = 0;
        for (JsonNode n : v) {
            if (i++ >= max) break;
            out.add(n);
        }
        return out;
    }

    private List<String> idList(JsonNode o, String field, String path, int max) {
        return stringList(o, field, path, max, MAX_ID, true);
    }

    private List<String> textList(JsonNode o, String field, String path, int max, int maxLen) {
        return stringList(o, field, path, max, maxLen, false);
    }

    private List<String> stringList(JsonNode o, String field, String path, int max, int maxLen, boolean ids) {
        List<JsonNode> rows = array(o, field, path, max);
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (int i = 0; i < rows.size(); i++) {
            JsonNode n = rows.get(i);
            String p = join(path, field) + "[" + i + "]";
            if (n == null || !n.isTextual() || n.asText().isBlank()) {
                issue(p, "INVALID_VALUE", "Expected a non-empty string");
                continue;
            }
            String s = n.asText().trim();
            if (s.length() > maxLen || hasControl(s) || (ids && s.contains(" "))) {
                issue(p, "INVALID_VALUE", "Not a valid value");
                continue;
            }
            out.add(s);
        }
        return List.copyOf(out);
    }

    private String itemKey(JsonNode o, String path) {
        String key = text(o, "key", path, 64);
        if (key == null || key.isBlank()) {
            return UUID.randomUUID().toString();
        }
        if (!KEY.matcher(key).matches()) {
            issue(path + ".key", "INVALID_VALUE", "key must be 1-36 letters, digits, '-' or '_'");
            return UUID.randomUUID().toString();
        }
        return key;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
