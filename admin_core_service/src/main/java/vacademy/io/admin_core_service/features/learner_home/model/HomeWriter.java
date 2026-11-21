package vacademy.io.admin_core_service.features.learner_home.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Writes the typed model back to its canonical JSON (stored and served to the editor). */
public final class HomeWriter {

    public static final ObjectMapper MAPPER = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private HomeWriter() {
    }

    public static ObjectNode settings(Settings s) {
        ObjectNode o = F.objectNode();
        o.put("phone_spacing", s.phoneSpacing().name());
        o.put("show_header", s.showHeader());
        o.put("carousel_autoplay_default", s.carouselAutoplayDefault());
        return o;
    }

    /** The editor's block shape (admin API). */
    public static ObjectNode block(Block b) {
        ObjectNode o = F.objectNode();
        o.put("block_key", b.blockKey());
        o.put("type", b.type().name());
        o.put("builtin_widget", b.builtinWidget() == null ? null : b.builtinWidget().name());
        o.put("desktop_placement", b.placement().name());
        o.put("devices", b.devices().name());
        o.put("enabled", b.enabled());
        o.put("admin_label", b.adminLabel());
        o.put("starts_at", instant(b.startsAt()));
        o.put("ends_at", instant(b.endsAt()));
        o.set("audience", audience(b.audience()));
        o.set("config", config(b.config()));
        return o;
    }

    public static ObjectNode audience(Audience a) {
        ObjectNode o = F.objectNode();
        if (a == null || a.everyone()) {
            o.put("mode", "EVERYONE");
            return o;
        }
        o.put("mode", "RULES");
        ArrayNode rows = o.putArray("all_of");
        for (Condition c : a.allOf()) {
            ObjectNode row = rows.addObject();
            row.put("kind", c.kind().name());
            String field = switch (c.kind()) {
                case PACKAGE_SESSION -> "ids";
                case ENROLLED_IN_COURSE, NOT_ENROLLED_IN_COURSE -> "package_ids";
                case USER_TAG -> "tag_ids";
            };
            strings(row.putArray(field), c.ids());
        }
        return o;
    }

    public static ObjectNode config(BlockConfig c) {
        ObjectNode o = F.objectNode();
        if (c instanceof BannerConfig b) {
            o.put("title", b.title());
            o.put("auto_rotate", b.autoRotate());
            ArrayNode slides = o.putArray("slides");
            for (Slide s : b.slides()) {
                ObjectNode n = slides.addObject();
                n.put("key", s.key());
                n.set("image", image(s.image()));
                n.set("desktop_image", image(s.desktopImage()));
                n.set("link", link(s.link()));
                n.put("starts_at", instant(s.startsAt()));
                n.put("ends_at", instant(s.endsAt()));
            }
        } else if (c instanceof ShortcutsConfig sc) {
            o.put("title", sc.title());
            ArrayNode tiles = o.putArray("tiles");
            for (Tile t : sc.tiles()) {
                ObjectNode n = tiles.addObject();
                n.put("key", t.key());
                n.put("label", t.label());
                n.set("icon", tileIcon(t.icon()));
                n.set("link", link(t.link()));
            }
        } else if (c instanceof ShelfConfig s) {
            o.put("title", s.title());
            o.put("source", s.source().name());
            strings(o.putArray("tags"), s.tags());
            strings(o.putArray("package_ids"), s.packageIds());
            o.put("limit", s.limit());
            o.put("hide_owned", s.hideOwned());
            o.put("show_price", s.showPrice());
            o.set("see_all", link(s.seeAll()));
        } else if (c instanceof NoticeConfig n) {
            o.put("title", n.title());
            o.put("body", n.body());
            o.set("image", image(n.image()));
            o.set("button", cta(n.button()));
            o.put("tone", n.tone().name());
            o.put("dismissible", n.dismissible());
            o.put("require_ack", n.requireAck());
            o.put("ack_label", n.ackLabel());
        } else if (c instanceof EventConfig e) {
            o.put("title", e.title());
            o.put("subtitle", e.subtitle());
            o.set("image", image(e.image()));
            o.put("source", e.source().name());
            o.put("live_session_id", e.liveSessionId());
            o.put("starts_at", instant(e.startsAt()));
            o.put("ends_at", instant(e.endsAt()));
            o.set("register_cta", cta(e.registerCta()));
            o.set("join_cta", cta(e.joinCta()));
            o.put("join_opens_minutes", e.joinOpensMinutes());
            o.put("show_countdown", e.showCountdown());
        } else if (c instanceof BuiltinConfig bc) {
            o.set("options", MAPPER.valueToTree(bc.options()));
        }
        return o;
    }

    public static JsonNode image(ImageRef i) {
        if (i == null) {
            return F.nullNode();
        }
        ObjectNode o = F.objectNode();
        o.put("file_id", i.fileId());
        o.put("alt", i.alt());
        o.put("decorative", i.decorative());
        if (i.url() != null) o.put("url", i.url());
        if (i.width() != null) o.put("width", i.width());
        if (i.height() != null) o.put("height", i.height());
        if (i.renditions() != null && !i.renditions().isEmpty()) {
            ObjectNode r = o.putObject("renditions");
            for (Map.Entry<String, String> e : i.renditions().entrySet()) {
                r.put(e.getKey(), e.getValue());
            }
        }
        return o;
    }

    public static JsonNode tileIcon(TileIcon icon) {
        if (icon == null) {
            return F.nullNode();
        }
        ObjectNode o = F.objectNode();
        o.put("kind", icon.kind());
        if ("ICON".equals(icon.kind())) {
            o.put("name", icon.name() == null ? null : icon.name().name());
        } else {
            o.set("image", image(icon.image()));
        }
        return o;
    }

    /** Only the fields of the link's kind (plus sells_something for URL). */
    public static JsonNode link(LinkTarget l) {
        if (l == null) {
            return F.nullNode();
        }
        return linkObject(l);
    }

    public static ObjectNode linkObject(LinkTarget l) {
        ObjectNode o = F.objectNode();
        o.put("kind", l.kind().name());
        switch (l.kind()) {
            case COURSE -> o.put("package_id", l.packageId());
            case COURSE_LIST -> o.put("tag", l.tag());
            case PRODUCT_PAGE -> o.put("code", l.code());
            case LIVE_CLASS -> o.put("session_id", l.sessionId());
            case ASSESSMENT -> o.put("assessment_id", l.assessmentId());
            case FEATURE -> o.put("feature", l.feature() == null ? null : l.feature().name());
            case URL -> {
                o.put("url", l.url());
                o.put("sells_something", Boolean.TRUE.equals(l.sellsSomething()));
            }
            case APP_PATH -> o.put("path", l.path());
        }
        return o;
    }

    public static JsonNode cta(Cta c) {
        if (c == null) {
            return F.nullNode();
        }
        ObjectNode o = F.objectNode();
        o.put("label", c.label());
        o.set("link", link(c.link()));
        return o;
    }

    public static String instant(Instant i) {
        return i == null ? null : i.toString();
    }

    private static void strings(ArrayNode arr, List<String> values) {
        if (values != null) values.forEach(arr::add);
    }

    public static String toJson(JsonNode node) {
        try {
            return MAPPER.writeValueAsString(node);
        } catch (Exception e) {
            throw new IllegalStateException("Could not write JSON", e);
        }
    }

    /** The stored JSON, or null when it is missing or not valid JSON (the caller must then refuse it). */
    public static JsonNode readTreeStrict(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    public static JsonNode readTree(String json) {
        if (json == null || json.isBlank()) {
            return F.objectNode();
        }
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            return F.objectNode();
        }
    }
}
