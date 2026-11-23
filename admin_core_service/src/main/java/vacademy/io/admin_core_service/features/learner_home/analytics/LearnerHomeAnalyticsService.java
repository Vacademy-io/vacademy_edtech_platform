package vacademy.io.admin_core_service.features.learner_home.analytics;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Total;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.PublishedLayout;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The admin results tab: views (daily totals), clicks (event rows), dismisses and acks per block,
 * split by device and by item, over a date range in the institute's timezone.
 */
@Service
public class LearnerHomeAnalyticsService {

    public static final int MAX_RANGE_DAYS = 92;
    public static final int MAX_ACK_PAGE = 100;
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final List<String> DEVICE_ORDER = List.of("PHONE", "TABLET", "DESKTOP");

    private final LearnerHomeJdbc jdbc;
    private final LearnerHomeViewAggregator aggregator;
    private final LearnerHomeLayoutCache layoutCache;
    private final AuthService authService;

    public LearnerHomeAnalyticsService(LearnerHomeJdbc jdbc, LearnerHomeViewAggregator aggregator,
                                       LearnerHomeLayoutCache layoutCache, AuthService authService) {
        this.jdbc = jdbc;
        this.aggregator = aggregator;
        this.layoutCache = layoutCache;
        this.authService = authService;
    }

    /** One block's figures while they are being summed. */
    static final class Acc {
        long views;
        long clicks;
        long uniqueClickers;
        long dismisses;
        long acks;
        final Map<String, long[]> byDevice = new LinkedHashMap<>();
        final Map<String, long[]> items = new LinkedHashMap<>();

        long[] device(String d) {
            return byDevice.computeIfAbsent(d, k -> new long[2]);
        }

        long[] item(String k) {
            return items.computeIfAbsent(k, x -> new long[2]);
        }
    }

    public ObjectNode summary(String instituteId, LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from) || ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new LearnerHomeException(HttpStatus.BAD_REQUEST, "BAD_RANGE",
                    "from and to are dates, from <= to, at most " + MAX_RANGE_DAYS + " days");
        }
        ZoneId zone = aggregator.zone(instituteId);
        Instant fromTs = from.atStartOfDay(zone).toInstant();
        Instant toTs = to.plusDays(1).atStartOfDay(zone).toInstant();
        Map<String, Acc> acc = aggregate(jdbc.viewTotals(instituteId, from, to), jdbc.eventTotals(instituteId, fromTs, toTs),
                jdbc.uniqueClickers(instituteId, fromTs, toTs));

        // Order: blocks of the published layout first (list order), then any other key with data.
        Map<String, Block> known = new LinkedHashMap<>();
        Optional<PublishedLayout> pub = layoutCache.get(instituteId);
        pub.ifPresent(p -> p.blocks().forEach(b -> known.put(b.blockKey(), b)));
        Set<String> others = new LinkedHashSet<>(acc.keySet());
        others.removeAll(known.keySet());
        Map<String, Block> older = olderBlocks(instituteId, others);

        Set<String> courseIds = new LinkedHashSet<>();
        acc.forEach((key, a) -> {
            Block b = known.containsKey(key) ? known.get(key) : older.get(key);
            if (b != null && b.type() == BlockType.COURSE_SHELF) courseIds.addAll(a.items.keySet());
        });
        Map<String, String> courseNames = new HashMap<>();
        if (!courseIds.isEmpty()) {
            courseIds.remove("");
            jdbc.packageNames(instituteId, courseIds).forEach(r -> courseNames.put(r[0], r[1]));
        }

        ObjectNode out = F.objectNode();
        out.put("from", from.toString());
        out.put("to", to.toString());
        out.put("timezone", zone.getId());
        ArrayNode arr = out.putArray("blocks");
        List<String> order = new ArrayList<>(known.keySet());
        order.addAll(others);
        for (String key : order) {
            Block b = known.containsKey(key) ? known.get(key) : older.get(key);
            arr.add(blockJson(key, b, acc.getOrDefault(key, new Acc()), courseNames));
        }
        return out;
    }

    static Map<String, Acc> aggregate(List<Total> views, List<Total> events, List<Total> uniques) {
        Map<String, Acc> acc = new LinkedHashMap<>();
        for (Total t : views) {
            Acc a = acc.computeIfAbsent(t.blockKey(), k -> new Acc());
            if (t.itemKey() == null || t.itemKey().isEmpty()) {
                a.views += t.count();
                a.device(t.device())[0] += t.count();
            } else {
                a.item(t.itemKey())[0] += t.count();
            }
        }
        for (Total t : events) {
            Acc a = acc.computeIfAbsent(t.blockKey(), k -> new Acc());
            switch (t.eventType()) {
                case "CLICK" -> {
                    a.clicks += t.count();
                    if (!t.device().isEmpty()) a.device(t.device())[1] += t.count();
                    if (!t.itemKey().isEmpty()) a.item(t.itemKey())[1] += t.count();
                }
                case "DISMISS" -> a.dismisses += t.count();
                case "ACK" -> a.acks += t.count();
                default -> {
                }
            }
        }
        for (Total t : uniques) {
            acc.computeIfAbsent(t.blockKey(), k -> new Acc()).uniqueClickers = t.count();
        }
        return acc;
    }

    private ObjectNode blockJson(String key, Block b, Acc a, Map<String, String> courseNames) {
        ObjectNode o = F.objectNode();
        o.put("block_key", key);
        o.put("admin_label", b == null ? null : b.adminLabel());
        o.put("type", b == null ? null : b.type().name());
        if (b != null && b.builtinWidget() != null) o.put("builtin_widget", b.builtinWidget().name());
        // A block-level view is counted once per mount; when only item views exist (older clients), use their max.
        long views = a.views;
        if (views == 0) {
            for (long[] v : a.items.values()) views = Math.max(views, v[0]);
        }
        o.put("views", views);
        o.put("clicks", a.clicks);
        o.put("unique_clickers", a.uniqueClickers);
        o.put("ctr", views == 0 ? 0d : Math.round(a.clicks * 10_000d / views) / 10_000d);
        ObjectNode byDevice = o.putObject("by_device");
        for (String d : DEVICE_ORDER) {
            long[] v = a.byDevice.getOrDefault(d, new long[2]);
            ObjectNode dn = byDevice.putObject(d);
            dn.put("views", v[0]);
            dn.put("clicks", v[1]);
        }
        ArrayNode items = o.putArray("items");
        for (Map.Entry<String, long[]> e : a.items.entrySet()) {
            ObjectNode n = items.addObject();
            n.put("item_key", e.getKey());
            n.put("label", itemLabel(b, e.getKey(), courseNames));
            n.put("views", e.getValue()[0]);
            n.put("clicks", e.getValue()[1]);
        }
        o.put("dismisses", a.dismisses);
        o.put("acks", a.acks);
        return o;
    }

    static String itemLabel(Block b, String itemKey, Map<String, String> courseNames) {
        if (b == null) return null;
        if (b.config() instanceof BannerConfig bc) {
            for (int i = 0; i < bc.slides().size(); i++) {
                if (itemKey.equals(bc.slides().get(i).key())) return "Slide " + (i + 1);
            }
        } else if (b.config() instanceof ShortcutsConfig sc) {
            for (Tile t : sc.tiles()) {
                if (itemKey.equals(t.key())) return t.label();
            }
        } else if (b.type() == BlockType.COURSE_SHELF) {
            return courseNames.get(itemKey);
        }
        return null;
    }

    private Map<String, Block> olderBlocks(String instituteId, Set<String> keys) {
        Map<String, Block> out = new HashMap<>();
        if (keys.isEmpty()) return out;
        for (String[] row : jdbc.blockLabels(instituteId, keys)) {
            try {
                BlockType type = BlockType.valueOf(row[1]);
                BuiltinWidget widget = row[2] == null ? null : BuiltinWidget.valueOf(row[2]);
                Block b = new HomeParser(new ArrayList<>()).parseStored(row[0], type, widget, Placement.MAIN,
                        Devices.BOTH, true, row[3], null, null, null, HomeWriter.readTree(row[4]));
                out.put(row[0], b);
            } catch (RuntimeException ignored) {
                // a row that no longer parses keeps its figures without a label
            }
        }
        return out;
    }

    // ── Who acknowledged ────────────────────────────────────────────────────

    public ObjectNode acks(String instituteId, String blockKey, int page, int size) {
        if (blockKey == null || blockKey.isBlank()) {
            throw new LearnerHomeException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "block_key is required");
        }
        int s = Math.max(1, Math.min(size, MAX_ACK_PAGE));
        int p = Math.max(0, page);
        long total = jdbc.ackCount(instituteId, blockKey);
        List<LearnerHomeJdbc.AckRow> rows = jdbc.ackPage(instituteId, blockKey, s, p * s);
        Map<String, UserDTO> users = new HashMap<>();
        if (!rows.isEmpty()) {
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(
                        rows.stream().map(LearnerHomeJdbc.AckRow::userId).distinct().toList())) {
                    if (u != null && u.getId() != null) users.put(u.getId(), u);
                }
            } catch (RuntimeException ignored) {
                // names are a nicety; the list still answers who acknowledged
            }
        }
        ObjectNode out = F.objectNode();
        out.put("total", total);
        ArrayNode arr = out.putArray("rows");
        for (LearnerHomeJdbc.AckRow r : rows) {
            UserDTO u = users.get(r.userId());
            ObjectNode n = arr.addObject();
            n.put("user_id", r.userId());
            n.put("full_name", u == null ? null : u.getFullName());
            n.put("email", u == null ? null : u.getEmail());
            n.put("acknowledged_at", HomeWriter.instant(r.acknowledgedAt()));
        }
        return out;
    }
}
