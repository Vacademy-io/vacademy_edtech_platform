package vacademy.io.admin_core_service.features.learner_home.resolve;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ShelfConfig;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ShelfSource;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Course shelves. Candidates come from the same search the learner Courses page uses
 * ({@link OpenPackageService#getLearnerPackageDetailV2}), so a shelf only shows courses a learner
 * could see in the catalogue today. Candidates are cached per (institute, block, version) for 5
 * minutes and carry no per-learner data; owned/hide-owned/limit are applied per request.
 */
@Slf4j
@Component
public class ShelfResolver {

    static final int CANDIDATES = 50;
    /** FREE shelves look at most this many pages of 50 newest courses (300 courses). */
    static final int MAX_FREE_PAGES = 6;
    private static final Set<String> INTERNAL_TYPES = Set.of("DELIVERY_CHARGE", "SECURITY_DEPOSIT");

    public record CourseCard(String packageId, String name, String thumbnailUrl, Double price, String currency) {
        public boolean isFree() {
            return isFreePrice(price);
        }
    }

    /** One card as one learner sees it. */
    public record ShelfItem(CourseCard card, boolean owned) {
    }

    private final OpenPackageService openPackageService;
    private final CatalogMediaResolver mediaResolver;
    private final Cache<String, List<CourseCard>> candidates = Caffeine.newBuilder()
            .maximumSize(5_000).expireAfterWrite(Duration.ofMinutes(5)).build();
    private final Cache<String, List<CourseCard>> previewCandidates = Caffeine.newBuilder()
            .maximumSize(1_000).expireAfterWrite(Duration.ofSeconds(60)).build();

    public ShelfResolver(OpenPackageService openPackageService, CatalogMediaResolver mediaResolver) {
        this.openPackageService = openPackageService;
        this.mediaResolver = mediaResolver;
    }

    /** {@code version < 0} = preview or publish check: cached briefly by the shelf's own settings. */
    public List<CourseCard> candidates(String instituteId, String blockKey, int version, ShelfConfig cfg) {
        if (version < 0) {
            String key = instituteId + "|" + cfg.source() + "|" + cfg.tags() + "|" + cfg.packageIds();
            return previewCandidates.get(key, k -> load(instituteId, cfg));
        }
        return candidates.get(instituteId + "|" + blockKey + "|" + version, k -> load(instituteId, cfg));
    }

    List<CourseCard> load(String instituteId, ShelfConfig cfg) {
        LearnerPackageFilterDTO filter = new LearnerPackageFilterDTO();
        filter.setExcludeChargePackages(true);
        switch (cfg.source()) {
            case TAG -> {
                if (cfg.tags().isEmpty()) return List.of();
                filter.setTag(cfg.tags());
                filter.setSortColumns(Map.of("createdAt", "DESC"));
            }
            case HAND_PICKED -> {
                if (cfg.packageIds().isEmpty()) return List.of();
                filter.setPackageIds(cfg.packageIds());
            }
            case NEWEST, FREE -> filter.setSortColumns(Map.of("createdAt", "DESC"));
        }
        List<PackageDetailV2DTO> rows = new ArrayList<>();
        // FREE has no price filter in the catalogue search, so it walks the newest courses page by
        // page (bounded) until it has a full candidate list of free ones. Other sources need one page.
        int pages = cfg.source() == ShelfSource.FREE ? MAX_FREE_PAGES : 1;
        for (int pageNo = 0; pageNo < pages; pageNo++) {
            Page<PackageDetailV2DTO> page = openPackageService.getLearnerPackageDetailV2(filter, instituteId, pageNo,
                    CANDIDATES);
            List<PackageDetailV2DTO> content = page == null ? List.of() : page.getContent();
            rows.addAll(content);
            if (content.size() < CANDIDATES || (page != null && page.isLast())) break;
            if (cfg.source() == ShelfSource.FREE
                    && rows.stream().filter(r -> isFreePrice(r.getMinPlanActualPrice())).map(PackageDetailV2DTO::getId)
                    .distinct().count() >= CANDIDATES) {
                break;
            }
        }
        if (cfg.source() == ShelfSource.FREE) {
            rows.removeIf(r -> r == null || !isFreePrice(r.getMinPlanActualPrice()));
        }
        Map<String, String> thumbs = mediaResolver.resolve(rows.stream()
                .map(ShelfResolver::thumbnailId).filter(Objects::nonNull).distinct().toList());
        return toCards(rows, cfg, thumbs);
    }

    /** Pure: dedupe by course (first row wins), drop internal types, apply FREE, restore hand-picked order. */
    static List<CourseCard> toCards(List<PackageDetailV2DTO> rows, ShelfConfig cfg, Map<String, String> thumbs) {
        Map<String, CourseCard> byId = new LinkedHashMap<>();
        for (PackageDetailV2DTO row : rows) {
            if (row == null || row.getId() == null || byId.containsKey(row.getId())) continue;
            if (row.getPackageType() != null && INTERNAL_TYPES.contains(row.getPackageType())) continue;
            String thumbId = thumbnailId(row);
            CourseCard card = new CourseCard(row.getId(), row.getPackageName(),
                    thumbId == null ? null : thumbs.get(thumbId), row.getMinPlanActualPrice(),
                    row.getCurrency() == null || row.getCurrency().isBlank() ? null : row.getCurrency());
            if (cfg.source() == ShelfSource.FREE && !card.isFree()) continue;
            byId.put(row.getId(), card);
        }
        if (cfg.source() == ShelfSource.HAND_PICKED) {
            List<CourseCard> ordered = new ArrayList<>();
            for (String id : cfg.packageIds()) {
                CourseCard c = byId.get(id);
                if (c != null) ordered.add(c);
            }
            return List.copyOf(ordered);
        }
        return List.copyOf(byId.values());
    }

    /** The learner app's rule: no price, or a price of 0, is free. */
    static boolean isFreePrice(Double price) {
        return price == null || price == 0d;
    }

    private static String thumbnailId(PackageDetailV2DTO row) {
        if (row.getThumbnailFileId() != null && !row.getThumbnailFileId().isBlank()) return row.getThumbnailFileId();
        if (row.getCoursePreviewImageMediaId() != null && !row.getCoursePreviewImageMediaId().isBlank()) {
            return row.getCoursePreviewImageMediaId();
        }
        return null;
    }

    /** Pure, per learner: mark owned, drop owned when hide_owned, cut to the limit. */
    public static List<ShelfItem> forLearner(List<CourseCard> cards, ShelfConfig cfg, LearnerFacts facts) {
        List<ShelfItem> out = new ArrayList<>();
        for (CourseCard c : cards) {
            boolean owned = facts.packageIds().contains(c.packageId());
            if (owned && cfg.hideOwned()) continue;
            out.add(new ShelfItem(c, owned));
            if (out.size() >= cfg.limit()) break;
        }
        return out;
    }
}
