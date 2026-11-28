package vacademy.io.admin_core_service.features.learner_home.resolve;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.BlockState;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.LinkMeta;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService.LiveInfo;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Picks the blocks one learner may see and resolves their payloads (spec 5.4).
 *
 * <pre>
 * module off, Holistic, or no published layout  -> LEGACY
 * live   = enabled blocks inside their window
 * facts  = enrolments (+ tags when a live block targets tags), only when something needs them
 * state  = notice state, only when a live NOTICE exists
 * for each live block in order: audience, dismissed, then the payload (may drop the block)
 * </pre>
 * Devices are not filtered here: the learner app filters on its own viewport.
 */
@Service
public class LearnerHomeResolver {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    /** Who the admin previews as. */
    public record PreviewAs(List<String> packageSessionIds, List<String> userTagIds) {
        public static final PreviewAs NOBODY = new PreviewAs(List.of(), List.of());
    }

    private final LearnerHomeGate gate;
    private final LearnerHomeLayoutCache layoutCache;
    private final LearnerHomeJdbc jdbc;
    private final LinkMetaService linkMeta;
    private final ShelfResolver shelfResolver;
    private Clock clock = Clock.systemUTC();

    public LearnerHomeResolver(LearnerHomeGate gate, LearnerHomeLayoutCache layoutCache, LearnerHomeJdbc jdbc,
                               LinkMetaService linkMeta, ShelfResolver shelfResolver) {
        this.gate = gate;
        this.layoutCache = layoutCache;
        this.jdbc = jdbc;
        this.linkMeta = linkMeta;
        this.shelfResolver = shelfResolver;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    public static ObjectNode legacy() {
        ObjectNode o = F.objectNode();
        o.put("mode", "LEGACY");
        return o;
    }

    public ObjectNode resolve(String instituteId, String userId) {
        return resolve(instituteId, userId, clock.instant());
    }

    public ObjectNode resolve(String instituteId, String userId, Instant now) {
        if (!gate.moduleEnabled(instituteId) || gate.isHolistic(instituteId)) {
            return legacy();
        }
        Optional<PublishedLayout> pub = layoutCache.get(instituteId);
        if (pub.isEmpty()) {
            return legacy();
        }
        PublishedLayout layout = pub.get();
        List<Block> live = layout.blocks().stream().filter(b -> b.enabled() && b.inWindow(now)).toList();

        LearnerFacts facts = LearnerFacts.EMPTY;
        if (needsFacts(live)) {
            facts = LearnerFacts.load(jdbc, instituteId, userId, live.stream().anyMatch(b -> b.audience().usesTags()));
        }
        Map<String, BlockState> state = new HashMap<>();
        if (live.stream().anyMatch(b -> b.type() == BlockType.NOTICE)) {
            for (BlockState s : jdbc.states(instituteId, userId)) {
                state.put(s.blockKey(), s);
            }
        }
        LinkMeta meta = linkMeta.meta(instituteId, layout.version(), layout.blocks());
        Set<String> sessionIds = LinkMetaService.liveSessionIds(live);
        Map<String, LiveInfo> liveInfo = sessionIds.isEmpty() ? Map.of() : linkMeta.live(sessionIds);

        BlockPayloadResolver.Context ctx = new BlockPayloadResolver.Context(instituteId, now, facts, meta, liveInfo,
                state, b -> shelfResolver.candidates(instituteId, b.blockKey(), layout.version(),
                (ShelfConfig) b.config()), false);
        ArrayNode out = F.arrayNode();
        for (Block b : live) {
            if (!AudienceEvaluator.matches(b.audience(), facts)) continue;
            if (b.type() == BlockType.NOTICE) {
                BlockState s = state.get(b.blockKey());
                if (s != null && s.dismissedAt() != null) continue;
            }
            ObjectNode rb = BlockPayloadResolver.resolve(b, ctx);
            if (rb != null) out.add(rb);
        }
        return builder(layout.version(), now, layout.settings(), out);
    }

    /**
     * The admin preview: same resolution with synthesised facts (the given batches and their
     * courses, the given tags), no learner state, optional device filter and time travel.
     */
    public ObjectNode preview(String instituteId, int version, Settings settings, List<Block> blocks, PreviewAs as,
                              Devices device, Instant at) {
        Instant now = at != null ? at : clock.instant();
        PreviewAs who = as == null ? PreviewAs.NOBODY : as;
        List<Block> live = blocks.stream().filter(b -> b.enabled() && b.inWindow(now))
                .filter(b -> device == null || device == Devices.BOTH || b.devices() == Devices.BOTH
                        || b.devices() == device)
                .toList();
        List<LearnerHomeJdbc.Enrolment> enrolments = new ArrayList<>(
                jdbc.batchPackages(instituteId, who.packageSessionIds()));
        LearnerFacts facts = LearnerFacts.of(enrolments, who.userTagIds());
        LinkMeta meta = linkMeta.loadMeta(instituteId, blocks);
        Set<String> sessionIds = LinkMetaService.liveSessionIds(live);
        Map<String, LiveInfo> liveInfo = sessionIds.isEmpty() ? Map.of() : linkMeta.live(sessionIds);
        BlockPayloadResolver.Context ctx = new BlockPayloadResolver.Context(instituteId, now, facts, meta, liveInfo,
                Map.of(), b -> shelfResolver.candidates(instituteId, b.blockKey(), -1, (ShelfConfig) b.config()),
                true);
        ArrayNode out = F.arrayNode();
        for (Block b : live) {
            if (!AudienceEvaluator.matches(b.audience(), facts)) continue;
            ObjectNode rb = BlockPayloadResolver.resolve(b, ctx);
            if (rb != null) out.add(rb);
        }
        ObjectNode o = builder(version, now, settings, out);
        o.put("preview", true);
        return o;
    }

    static boolean needsFacts(Collection<Block> live) {
        for (Block b : live) {
            if (!b.audience().everyone() || b.type() == BlockType.COURSE_SHELF) return true;
            for (LinkRef ref : LinkMetaService.links(b)) {
                LinkKind k = ref.link().kind();
                if (k == LinkKind.COURSE || k == LinkKind.LIVE_CLASS) return true;
            }
            if (b.config() instanceof EventConfig e && e.source() == EventSource.LIVE_SESSION) return true;
        }
        return false;
    }

    private static ObjectNode builder(int version, Instant now, Settings settings, ArrayNode blocks) {
        ObjectNode o = F.objectNode();
        o.put("mode", "BUILDER");
        o.put("layout_version", version);
        o.put("server_time", now.toString());
        o.set("settings", HomeWriter.settings(settings == null ? Settings.DEFAULT : settings));
        o.set("blocks", blocks);
        return o;
    }
}
