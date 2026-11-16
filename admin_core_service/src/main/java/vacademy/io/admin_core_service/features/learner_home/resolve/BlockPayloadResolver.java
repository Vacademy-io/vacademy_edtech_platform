package vacademy.io.admin_core_service.features.learner_home.resolve;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.BlockState;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.LinkMeta;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.LiveInfo;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.Occurrence;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.PackageInfo;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.PageInfo;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver.CourseCard;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver.ShelfItem;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Turns one block into what the learner app receives: links resolved, unavailable targets removed,
 * shelves filled, event times computed, notice state attached. Returns null when the block has
 * nothing left to show. No I/O: everything it needs is in the {@link Context}.
 */
public final class BlockPayloadResolver {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private BlockPayloadResolver() {
    }

    /**
     * @param shelfCandidates the cached candidate cards of a shelf block
     * @param preview         admin preview: BUILTIN blocks are marked as placeholders
     */
    public record Context(String instituteId, Instant now, LearnerFacts facts, LinkMeta meta,
                          Map<String, LiveInfo> live, Map<String, BlockState> state,
                          Function<Block, List<CourseCard>> shelfCandidates, boolean preview) {
    }

    public static ObjectNode resolve(Block b, Context ctx) {
        ObjectNode config = switch (b.type()) {
            case BANNER_CAROUSEL -> banner((BannerConfig) b.config(), ctx);
            case SHORTCUTS -> shortcuts((ShortcutsConfig) b.config(), ctx);
            case COURSE_SHELF -> shelf(b, (ShelfConfig) b.config(), ctx);
            case NOTICE -> notice(b, (NoticeConfig) b.config(), ctx);
            case EVENT -> event((EventConfig) b.config(), ctx);
            case BUILTIN -> builtin((BuiltinConfig) b.config());
        };
        if (config == null) {
            return null;
        }
        ObjectNode out = F.objectNode();
        out.put("key", b.blockKey());
        out.put("type", b.type().name());
        if (b.builtinWidget() != null) {
            out.put("builtin_widget", b.builtinWidget().name());
        }
        out.put("placement", b.placement().name());
        out.put("devices", b.devices().name());
        out.put("ends_at", HomeWriter.instant(b.endsAt()));
        if (ctx.preview() && b.type() == BlockType.BUILTIN) {
            out.put("placeholder", true);
        }
        if (ctx.preview() && b.adminLabel() != null) {
            out.put("admin_label", b.adminLabel());
        }
        out.set("config", config);
        return out;
    }

    // ── Types ───────────────────────────────────────────────────────────────

    private static ObjectNode banner(BannerConfig c, Context ctx) {
        ArrayNode slides = F.arrayNode();
        for (Slide s : c.slides()) {
            if (s.image() == null) continue;
            if (s.startsAt() != null && ctx.now().isBefore(s.startsAt())) continue;
            if (s.endsAt() != null && !ctx.now().isBefore(s.endsAt())) continue;
            ObjectNode n = slides.addObject();
            n.put("key", s.key());
            n.set("image", HomeWriter.image(s.image()));
            n.set("desktop_image", HomeWriter.image(s.desktopImage()));
            ObjectNode link = s.link() == null ? null : link(s.link(), ctx);
            // A slide whose target is gone keeps its image but is not clickable.
            n.set("link", link == null ? F.nullNode() : link);
            n.put("ends_at", HomeWriter.instant(s.endsAt()));
        }
        if (slides.isEmpty()) {
            return null;
        }
        ObjectNode o = F.objectNode();
        o.put("title", c.title());
        o.put("auto_rotate", c.autoRotate());
        o.set("slides", slides);
        return o;
    }

    private static ObjectNode shortcuts(ShortcutsConfig c, Context ctx) {
        ArrayNode tiles = F.arrayNode();
        for (Tile t : c.tiles()) {
            if (t.link() == null || t.label() == null || t.label().isBlank()) continue;
            ObjectNode link = link(t.link(), ctx);
            if (link == null) continue;
            ObjectNode n = tiles.addObject();
            n.put("key", t.key());
            n.put("label", t.label());
            n.set("icon", HomeWriter.tileIcon(t.icon()));
            n.set("link", link);
        }
        if (tiles.isEmpty()) {
            return null;
        }
        ObjectNode o = F.objectNode();
        o.put("title", c.title());
        o.set("tiles", tiles);
        return o;
    }

    private static ObjectNode shelf(Block b, ShelfConfig c, Context ctx) {
        List<CourseCard> cards = ctx.shelfCandidates().apply(b);
        List<ShelfItem> items = ShelfResolver.forLearner(cards == null ? List.of() : cards, c, ctx.facts());
        if (items.isEmpty()) {
            return null;
        }
        ArrayNode courses = F.arrayNode();
        for (ShelfItem item : items) {
            CourseCard card = item.card();
            ObjectNode n = courses.addObject();
            n.put("package_id", card.packageId());
            n.put("name", card.name());
            n.put("thumbnail_url", card.thumbnailUrl());
            if (card.price() == null) n.putNull("price");
            else n.put("price", card.price());
            n.put("currency", card.currency());
            n.put("is_free", card.isFree());
            n.put("owned", item.owned());
            n.set("link", courseLink(card.packageId(), ctx));
        }
        LinkTarget seeAllTarget = c.seeAll() != null ? c.seeAll()
                : LinkTarget.courseList(c.source() == ShelfSource.TAG && !c.tags().isEmpty() ? c.tags().get(0) : null);
        ObjectNode seeAll = link(seeAllTarget, ctx);
        ObjectNode o = F.objectNode();
        o.put("title", c.title());
        o.put("show_price", c.showPrice());
        o.set("see_all", seeAll == null ? F.nullNode() : seeAll);
        o.set("courses", courses);
        return o;
    }

    private static ObjectNode notice(Block b, NoticeConfig c, Context ctx) {
        ObjectNode o = F.objectNode();
        o.put("title", c.title());
        o.put("body", c.body());
        o.set("image", HomeWriter.image(c.image()));
        o.set("button", cta(c.button(), ctx));
        o.put("tone", c.tone().name());
        o.put("dismissible", c.dismissible());
        o.put("require_ack", c.requireAck());
        o.put("ack_label", c.ackLabel());
        BlockState s = ctx.state() == null ? null : ctx.state().get(b.blockKey());
        ObjectNode state = o.putObject("state");
        state.put("dismissed", s != null && s.dismissedAt() != null);
        state.put("acknowledged_at", s == null ? null : HomeWriter.instant(s.acknowledgedAt()));
        return o;
    }

    private static ObjectNode event(EventConfig c, Context ctx) {
        Instant startsAt;
        Instant endsAt;
        Cta register = c.registerCta();
        Cta join = c.joinCta();
        String title = c.title();
        if (c.source() == EventSource.LIVE_SESSION) {
            LiveInfo info = c.liveSessionId() == null ? null : ctx.live().get(c.liveSessionId());
            if (info == null || !info.availableFor(ctx.instituteId(), ctx.now())) {
                return null;
            }
            Occurrence next = info.next(ctx.now());
            startsAt = next.start();
            endsAt = next.end();
            // Default buttons carry no label: the learner app shows its own translated
            // "Register" / "Join" when label is null.
            if (register == null) register = new Cta(null, LinkTarget.liveClass(info.sessionId()));
            if (join == null) join = new Cta(null, LinkTarget.liveClass(info.sessionId()));
            if (title == null || title.isBlank()) title = info.title();
        } else {
            startsAt = c.startsAt();
            endsAt = c.endsAt();
            if (startsAt == null || endsAt == null) {
                return null;
            }
        }
        if (!ctx.now().isBefore(endsAt)) {
            return null;
        }
        ObjectNode o = F.objectNode();
        o.put("title", title);
        o.put("subtitle", c.subtitle());
        o.set("image", HomeWriter.image(c.image()));
        o.put("source", c.source().name());
        o.put("live_session_id", c.liveSessionId());
        o.put("starts_at", startsAt.toString());
        o.put("ends_at", endsAt.toString());
        o.put("join_opens_at", startsAt.minus(Duration.ofMinutes(c.joinOpensMinutes())).toString());
        o.set("register_cta", cta(register, ctx));
        o.set("join_cta", cta(join, ctx));
        o.put("show_countdown", c.showCountdown());
        return o;
    }

    private static ObjectNode builtin(BuiltinConfig c) {
        ObjectNode o = F.objectNode();
        o.set("options", HomeWriter.MAPPER.valueToTree(c.options()));
        return o;
    }

    // ── Links ───────────────────────────────────────────────────────────────

    private static com.fasterxml.jackson.databind.JsonNode cta(Cta c, Context ctx) {
        if (c == null || c.link() == null) {
            return F.nullNode();
        }
        ObjectNode link = link(c.link(), ctx);
        if (link == null) {
            return F.nullNode();
        }
        ObjectNode o = F.objectNode();
        o.put("label", c.label());
        o.set("link", link);
        return o;
    }

    private static ObjectNode courseLink(String packageId, Context ctx) {
        ObjectNode o = HomeWriter.linkObject(LinkTarget.course(packageId));
        boolean owned = ctx.facts().packageIds().contains(packageId);
        o.put("commerce", !owned);
        o.put("available", true);
        o.put("owned", owned);
        o.put("package_session_id", owned ? ctx.facts().packageSessionByPackage().get(packageId) : null);
        return o;
    }

    /** The ResolvedLink, or null when the target is unavailable for this learner now. */
    public static ObjectNode link(LinkTarget l, Context ctx) {
        if (l == null) return null;
        switch (l.kind()) {
            case COURSE -> {
                if (l.packageId() == null) return null;
                PackageInfo p = ctx.meta().packages().get(l.packageId());
                if (p == null || !p.activeIn()) return null;
                return courseLink(l.packageId(), ctx);
            }
            case COURSE_LIST -> {
                return base(l, false);
            }
            case PRODUCT_PAGE -> {
                if (l.code() == null) return null;
                PageInfo page = ctx.meta().productPages().get(l.code());
                if (page == null || !ctx.instituteId().equals(page.instituteId()) || !"ACTIVE".equals(page.status())) {
                    return null;
                }
                return base(l, true);
            }
            case LIVE_CLASS -> {
                if (l.sessionId() == null) return null;
                LiveInfo info = ctx.live().get(l.sessionId());
                if (info == null || !info.availableFor(ctx.instituteId(), ctx.now())) return null;
                ObjectNode o = base(l, info.paid());
                o.put("is_paid", info.paid());
                boolean inBatch = info.batchIds().stream().anyMatch(ctx.facts().packageSessionIds()::contains);
                o.put("in_my_batch", inBatch);
                return o;
            }
            case ASSESSMENT -> {
                return l.assessmentId() == null ? null : base(l, false);
            }
            case FEATURE -> {
                return l.feature() == null ? null : base(l, l.feature().isStore());
            }
            case URL -> {
                return l.url() == null ? null : base(l, Boolean.TRUE.equals(l.sellsSomething()));
            }
            case APP_PATH -> {
                return l.path() == null ? null : base(l, HomeModel.isReaderBlockedPath(l.path()));
            }
            default -> {
                return null;
            }
        }
    }

    private static ObjectNode base(LinkTarget l, boolean commerce) {
        ObjectNode o = HomeWriter.linkObject(l);
        o.put("commerce", commerce);
        o.put("available", true);
        return o;
    }
}
