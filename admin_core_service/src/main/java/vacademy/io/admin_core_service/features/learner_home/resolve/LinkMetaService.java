package vacademy.io.admin_core_service.features.learner_home.resolve;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * What the server must know about the targets a layout links to: course status, product page
 * status and the next public occurrence of live sessions. Course and page facts are cached per
 * (institute, layout version) for 5 minutes; live sessions per session for 60 seconds.
 */
@Slf4j
@Component
public class LinkMetaService {

    /** How far ahead a live session's next occurrence is looked for. */
    public static final int LIVE_LOOKAHEAD_DAYS = 120;

    public record PackageInfo(String id, String status, boolean inInstitute, String name) {
        public boolean activeIn() {
            return inInstitute && "ACTIVE".equals(status);
        }
    }

    public record PageInfo(String code, String instituteId, String status) {
    }

    public record LinkMeta(Map<String, PackageInfo> packages, Map<String, PageInfo> productPages) {
        public static final LinkMeta EMPTY = new LinkMeta(Map.of(), Map.of());
    }

    public record Occurrence(Instant start, Instant end) {
    }

    public record LiveInfo(String sessionId, String instituteId, String title, boolean isPublic, boolean live,
                           List<Occurrence> occurrences, boolean paid, Set<String> batchIds) {

        /** First occurrence that has not ended at {@code now}. */
        public Occurrence next(Instant now) {
            for (Occurrence o : occurrences) {
                if (o.end().isAfter(now)) return o;
            }
            return null;
        }

        public boolean availableFor(String institute, Instant now) {
            return institute.equals(instituteId) && isPublic && live && next(now) != null;
        }
    }

    private final LearnerHomeJdbc jdbc;
    private final Cache<String, LinkMeta> metaCache = Caffeine.newBuilder()
            .maximumSize(5_000).expireAfterWrite(Duration.ofMinutes(5)).build();
    private final Cache<String, Optional<LiveInfo>> liveCache = Caffeine.newBuilder()
            .maximumSize(5_000).expireAfterWrite(Duration.ofSeconds(60)).build();
    private Clock clock = Clock.systemUTC();

    public LinkMetaService(LearnerHomeJdbc jdbc) {
        this.jdbc = jdbc;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── Links in a block ────────────────────────────────────────────────────

    /** Every link of a block with its path (slides, tiles, see-all, buttons, CTAs). */
    public static List<LinkRef> links(Block b) {
        List<LinkRef> out = new ArrayList<>();
        BlockConfig c = b.config();
        if (c instanceof BannerConfig bc) {
            for (int i = 0; i < bc.slides().size(); i++) {
                add(out, "config.slides[" + i + "].link", bc.slides().get(i).link());
            }
        } else if (c instanceof ShortcutsConfig sc) {
            for (int i = 0; i < sc.tiles().size(); i++) {
                add(out, "config.tiles[" + i + "].link", sc.tiles().get(i).link());
            }
        } else if (c instanceof ShelfConfig s) {
            add(out, "config.see_all", s.seeAll());
        } else if (c instanceof NoticeConfig n) {
            if (n.button() != null) add(out, "config.button.link", n.button().link());
        } else if (c instanceof EventConfig e) {
            if (e.registerCta() != null) add(out, "config.register_cta.link", e.registerCta().link());
            if (e.joinCta() != null) add(out, "config.join_cta.link", e.joinCta().link());
        }
        return out;
    }

    private static void add(List<LinkRef> out, String path, LinkTarget link) {
        if (link != null) out.add(new LinkRef(path, link));
    }

    /** Live session ids a set of blocks needs: LIVE_CLASS links and LIVE_SESSION events. */
    public static Set<String> liveSessionIds(Collection<Block> blocks) {
        Set<String> ids = new LinkedHashSet<>();
        for (Block b : blocks) {
            for (LinkRef ref : links(b)) {
                if (ref.link().kind() == LinkKind.LIVE_CLASS && ref.link().sessionId() != null) {
                    ids.add(ref.link().sessionId());
                }
            }
            if (b.config() instanceof EventConfig e && e.source() == EventSource.LIVE_SESSION
                    && e.liveSessionId() != null) {
                ids.add(e.liveSessionId());
            }
        }
        return ids;
    }

    // ── Course and page meta ────────────────────────────────────────────────

    /** Cached per (institute, version); {@code version < 0} (preview, publish checks) is never cached. */
    public LinkMeta meta(String instituteId, int version, Collection<Block> blocks) {
        if (version < 0) {
            return loadMeta(instituteId, blocks);
        }
        return metaCache.get(instituteId + "|" + version, k -> loadMeta(instituteId, blocks));
    }

    public LinkMeta loadMeta(String instituteId, Collection<Block> blocks) {
        Set<String> packageIds = new LinkedHashSet<>();
        Set<String> codes = new LinkedHashSet<>();
        for (Block b : blocks) {
            for (LinkRef ref : links(b)) {
                LinkTarget l = ref.link();
                if (l.kind() == LinkKind.COURSE && l.packageId() != null) packageIds.add(l.packageId());
                if (l.kind() == LinkKind.PRODUCT_PAGE && l.code() != null) codes.add(l.code());
            }
        }
        if (packageIds.isEmpty() && codes.isEmpty()) {
            return LinkMeta.EMPTY;
        }
        return new LinkMeta(packages(instituteId, packageIds), pages(codes));
    }

    public Map<String, PackageInfo> packages(String instituteId, Collection<String> packageIds) {
        Map<String, PackageInfo> out = new HashMap<>();
        for (LearnerHomeJdbc.Owner row : jdbc.packageOwners(packageIds)) {
            PackageInfo prev = out.get(row.id());
            boolean inInstitute = instituteId.equals(row.instituteId()) || (prev != null && prev.inInstitute());
            out.put(row.id(), new PackageInfo(row.id(), row.status(), inInstitute, row.name()));
        }
        return Collections.unmodifiableMap(out);
    }

    private Map<String, PageInfo> pages(Collection<String> codes) {
        Map<String, PageInfo> out = new HashMap<>();
        for (LearnerHomeJdbc.Owner row : jdbc.productPages(codes)) {
            out.put(row.id(), new PageInfo(row.id(), row.instituteId(), row.status()));
        }
        return Collections.unmodifiableMap(out);
    }

    // ── Live sessions ───────────────────────────────────────────────────────

    /** Cached per session; missing ones are loaded in one query. Unknown sessions are absent from the map. */
    public Map<String, LiveInfo> live(Collection<String> sessionIds) {
        Map<String, LiveInfo> out = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (String id : sessionIds) {
            Optional<LiveInfo> cached = liveCache.getIfPresent(id);
            if (cached == null) {
                missing.add(id);
            } else {
                cached.ifPresent(info -> out.put(id, info));
            }
        }
        if (!missing.isEmpty()) {
            Map<String, LiveInfo> loaded = loadLive(missing);
            for (String id : missing) {
                LiveInfo info = loaded.get(id);
                liveCache.put(id, Optional.ofNullable(info));
                if (info != null) out.put(id, info);
            }
        }
        return out;
    }

    Map<String, LiveInfo> loadLive(Collection<String> ids) {
        LocalDate today = clock.instant().atOffset(ZoneOffset.UTC).toLocalDate();
        List<LearnerHomeJdbc.LiveRow> rows = jdbc.liveSessions(ids, today.minusDays(1),
                today.plusDays(LIVE_LOOKAHEAD_DAYS));
        Map<String, Set<String>> batches = new HashMap<>();
        for (String[] row : jdbc.sessionBatches(ids)) {
            batches.computeIfAbsent(row[0], k -> new HashSet<>()).add(row[1]);
        }
        return toInfos(rows, batches);
    }

    /** Pure: rows (one per upcoming schedule, or one with null dates) to session infos. */
    static Map<String, LiveInfo> toInfos(List<LearnerHomeJdbc.LiveRow> rows, Map<String, Set<String>> batches) {
        Map<String, List<LearnerHomeJdbc.LiveRow>> bySession = new LinkedHashMap<>();
        rows.forEach(r -> bySession.computeIfAbsent(r.sessionId(), k -> new ArrayList<>()).add(r));
        Map<String, LiveInfo> out = new LinkedHashMap<>();
        for (Map.Entry<String, List<LearnerHomeJdbc.LiveRow>> e : bySession.entrySet()) {
            LearnerHomeJdbc.LiveRow first = e.getValue().get(0);
            ZoneId zone = zoneOf(first.timezone());
            List<Occurrence> occurrences = new ArrayList<>();
            for (LearnerHomeJdbc.LiveRow r : e.getValue()) {
                if (r.meetingDate() == null || r.startTime() == null) continue;
                ZonedDateTime start = ZonedDateTime.of(r.meetingDate(), r.startTime(), zone);
                ZonedDateTime end = ZonedDateTime.of(r.meetingDate(),
                        r.lastEntryTime() != null ? r.lastEntryTime() : r.startTime(), zone);
                if (end.isBefore(start)) end = end.plusDays(1);
                if (!end.isAfter(start)) end = start.plusHours(1);
                occurrences.add(new Occurrence(start.toInstant(), end.toInstant()));
            }
            occurrences.sort((a, b) -> a.start().compareTo(b.start()));
            boolean isPublic = first.accessLevel() != null
                    && "PUBLIC".equals(first.accessLevel().trim().toUpperCase(Locale.ROOT));
            boolean live = "LIVE".equals(first.status());
            boolean paid = first.price() != null && first.price() > 0;
            out.put(e.getKey(), new LiveInfo(e.getKey(), first.instituteId(), first.title(), isPublic, live,
                    List.copyOf(occurrences), paid,
                    Collections.unmodifiableSet(batches.getOrDefault(e.getKey(), Set.of()))));
        }
        return out;
    }

    static ZoneId zoneOf(String timezone) {
        try {
            return ZoneId.of(TimezoneNormalizer.normalize(timezone));
        } catch (Exception e) {
            return ZoneId.of(TimezoneNormalizer.DEFAULT_TIMEZONE);
        }
    }
}
