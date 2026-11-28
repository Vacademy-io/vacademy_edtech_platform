package vacademy.io.admin_core_service.features.catalog_api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogRow;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.FolderNode;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.Stream;
import vacademy.io.admin_core_service.features.catalog_api.rules.SiteConfig;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.TreeResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.service.CatalogueFolderService;
import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueResponse;
import vacademy.io.admin_core_service.features.course_catalogue.service.CourseCatalogueService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.service.CatalogPopularityService;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageResponse;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageService;
import vacademy.io.admin_core_service.features.study_library.service.StudyLibraryService;
import vacademy.io.common.institute.entity.Institute;

import java.time.Duration;
import java.util.*;

/**
 * Loads (and caches) what the hosted catalogue site reads, through the same services its public
 * endpoints use, so the API and the site never disagree:
 * <ul>
 *   <li>course rows: {@link OpenPackageService#getLearnerPackageDetailV2} (the open v2 search the
 *       site posts to), every page of 500 up to 5,000 rows;</li>
 *   <li>site config: the site tag's catalogue_json ({@link CourseCatalogueService}, as the public
 *       by-tag endpoint);</li>
 *   <li>stream library / learning-path library: {@link CatalogueFolderService#publicTree};</li>
 *   <li>learning paths: {@link ProductPageService#getProductPageByCode}; course details:
 *       {@link StudyLibraryService#getCourseInitDetails} (course-init);</li>
 *   <li>enrolment ranks (Popular sort, badges): {@link CatalogPopularityService#getPopularity}, the
 *       source of the site's {@code /open/packages/v1/popularity}, itself cached 10 min per
 *       institute (60 s after a failed load).</li>
 * </ul>
 * Everything is cached in memory for 60 s per institute; media URLs for 24 h.
 */
@Slf4j
@Component
public class CatalogDataLoader {

    static final int PAGE_SIZE = 500;
    static final int MAX_ROWS = 5000;
    private static final Duration TTL = Duration.ofSeconds(60);

    private final OpenPackageService openPackageService;
    private final CatalogSiteResolver siteResolver;
    private final CourseCatalogueService courseCatalogueService;
    private final CatalogueFolderService folderService;
    private final ProductPageService productPageService;
    private final StudyLibraryService studyLibraryService;
    private final InstituteRepository instituteRepository;
    private final CatalogMediaResolver mediaResolver;
    private final ObjectMapper objectMapper;
    private final CatalogPopularityService popularityService;

    /**
     * Refreshed in the background once older than {@link #TTL}: callers keep getting the previous
     * snapshot while it reloads, so only an institute's first request ever waits on a load.
     */
    private final LoadingCache<String, CatalogSnapshot> snapshots = Caffeine.newBuilder()
            .refreshAfterWrite(TTL).expireAfterWrite(Duration.ofMinutes(10)).maximumSize(2_000)
            .build(this::load);
    private final Cache<String, Optional<List<FolderNode>>> trees = Caffeine.newBuilder()
            .expireAfterWrite(TTL).maximumSize(2_000).build();
    private final Cache<String, Optional<ProductPageResponse>> productPages = Caffeine.newBuilder()
            .expireAfterWrite(TTL).maximumSize(10_000).build();
    private final Cache<String, Optional<CourseDTOWithDetails>> courseInits = Caffeine.newBuilder()
            .expireAfterWrite(TTL).maximumSize(10_000).build();

    public CatalogDataLoader(OpenPackageService openPackageService, CatalogSiteResolver siteResolver,
                             CourseCatalogueService courseCatalogueService, CatalogueFolderService folderService,
                             ProductPageService productPageService, StudyLibraryService studyLibraryService,
                             InstituteRepository instituteRepository, CatalogMediaResolver mediaResolver,
                             ObjectMapper objectMapper, CatalogPopularityService popularityService) {
        this.openPackageService = openPackageService;
        this.siteResolver = siteResolver;
        this.courseCatalogueService = courseCatalogueService;
        this.folderService = folderService;
        this.productPageService = productPageService;
        this.studyLibraryService = studyLibraryService;
        this.instituteRepository = instituteRepository;
        this.mediaResolver = mediaResolver;
        this.objectMapper = objectMapper;
        this.popularityService = popularityService;
    }

    /** The institute's catalogue, loaded at most once a minute (concurrent callers share one load). */
    public CatalogSnapshot snapshot(String instituteId) {
        return snapshots.get(instituteId);
    }

    /** Drop the cached snapshot (after the institute's API settings change). */
    public void evict(String instituteId) {
        snapshots.invalidate(instituteId);
    }

    private CatalogSnapshot load(String instituteId) {
        CatalogSiteResolver.Resolution resolution = siteResolver.resolve(instituteId);
        SiteConfig site = loadSite(instituteId, resolution.siteTag());
        List<CatalogRow> rows = loadRows(instituteId);

        String streamsSource = null;
        List<Stream> streams = List.of();
        List<FolderNode> roots = List.of();
        if (site.streams() != null) {
            if (site.streams().folderLibrary()) {
                streamsSource = "folder_library";
                roots = folderTree(instituteId, site.streams().libraryId()).orElse(List.of());
                streams = CatalogStreams.streamsFromFolderTree(roots);
            } else {
                streamsSource = "tags";
                streams = CatalogStreams.streamsFromTagItems(site.streams().items());
            }
        }

        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        String logoId = institute == null ? null : institute.getLogoFileId();

        Set<String> mediaIds = new LinkedHashSet<>();
        for (CatalogRow r : rows) {
            for (String id : new String[]{r.imageMediaId(), r.previewImageId(), r.bannerImageId(), r.thumbnailId()}) {
                if (id != null) mediaIds.add(id);
            }
            for (CatalogRow.Person p : r.instructors()) if (p.imageFileId() != null) mediaIds.add(p.imageFileId());
        }
        if (logoId != null && !logoId.isBlank()) mediaIds.add(logoId);
        Map<String, String> media = mediaIds.isEmpty() ? Map.of() : mediaResolver.resolve(mediaIds);

        return new CatalogSnapshot(instituteId,
                institute == null ? null : institute.getInstituteName(),
                logoId,
                institute == null ? null : institute.getWebsiteUrl(),
                resolution, site, List.copyOf(rows), streamsSource, List.copyOf(streams), List.copyOf(roots),
                Map.copyOf(media));
    }

    private SiteConfig loadSite(String instituteId, String tag) {
        if (tag == null || tag.isBlank()) return SiteConfig.empty(null);
        try {
            CourseCatalogueResponse response = courseCatalogueService.getCatalogueByInstituteAndTag(instituteId, tag);
            return SiteConfig.parse(tag, response == null ? null : response.getCatalogueJson(), objectMapper);
        } catch (Exception e) {
            log.warn("catalog-api: no catalogue '{}' for institute {} ({}); using defaults", tag, instituteId,
                    e.getMessage());
            return SiteConfig.empty(tag);
        }
    }

    /** Every catalogue row of the institute, as the hosted site's open search returns them. */
    List<CatalogRow> loadRows(String instituteId) {
        List<CatalogRow> out = new ArrayList<>();
        for (int page = 0; out.size() < MAX_ROWS; page++) {
            Page<PackageDetailV2DTO> result =
                    openPackageService.getLearnerPackageDetailV2(siteSearchFilter(), instituteId, page, PAGE_SIZE);
            List<PackageDetailV2DTO> content = result == null ? List.of() : result.getContent();
            for (PackageDetailV2DTO d : content) {
                if (d != null && d.getId() != null && out.size() < MAX_ROWS) out.add(CatalogRow.from(d));
            }
            if (content.size() < PAGE_SIZE || result.isLast()) break;
        }
        return out;
    }

    /** The body CourseCatalogComponent posts (empty filters, no name search). */
    static LearnerPackageFilterDTO siteSearchFilter() {
        LearnerPackageFilterDTO f = new LearnerPackageFilterDTO();
        f.setStatus(new ArrayList<>());
        f.setLevelIds(new ArrayList<>());
        f.setFacultyIds(new ArrayList<>());
        f.setSearchByName("");
        f.setTag(new ArrayList<>());
        f.setMinPercentageCompleted(0);
        f.setMaxPercentageCompleted(0);
        return f;
    }

    /** A folder library's public tree (ACTIVE nodes, ACTIVE product pages), empty when the library is gone. */
    public Optional<List<FolderNode>> folderTree(String instituteId, String libraryId) {
        if (libraryId == null || libraryId.isBlank()) return Optional.empty();
        return trees.get(instituteId + "|" + libraryId, k -> {
            try {
                Optional<TreeResponse> tree = folderService.publicTree(instituteId, libraryId);
                return tree.map(t -> FolderNode.fromAll(t.getRoots()));
            } catch (Exception e) {
                log.warn("catalog-api: folder library {} unreadable for {}: {}", libraryId, instituteId, e.getMessage());
                return Optional.empty();
            }
        });
    }

    /** A product page of this institute by code (null when missing, foreign or deleted). */
    public Optional<ProductPageResponse> productPage(String instituteId, String code) {
        if (code == null || code.isBlank()) return Optional.empty();
        return productPages.get(instituteId + "|" + code, k -> {
            try {
                return Optional.ofNullable(productPageService.getProductPageByCode(code, instituteId));
            } catch (Exception e) {
                log.debug("catalog-api: product page {} unreadable for {}: {}", code, instituteId, e.getMessage());
                return Optional.empty();
            }
        });
    }

    /** course-init for one course (the hosted course page's own read). */
    public Optional<CourseDTOWithDetails> courseInit(String instituteId, String packageId) {
        return courseInits.get(instituteId + "|" + packageId, k -> {
            try {
                List<CourseDTOWithDetails> list = studyLibraryService.getCourseInitDetails(packageId, instituteId);
                return list == null || list.isEmpty() ? Optional.empty() : Optional.ofNullable(list.get(0));
            } catch (Exception e) {
                log.warn("catalog-api: course-init failed for {} / {}: {}", instituteId, packageId, e.getMessage());
                return Optional.empty();
            }
        });
    }

    /**
     * Package id → enrolment rank (1 = most enrolled) for the institute; empty — never an error —
     * when the ranks cannot be read, so the courses still list (unranked).
     */
    public Map<String, Integer> ranks(String instituteId) {
        try {
            CatalogPopularityDTO popularity = popularityService.getPopularity(instituteId);
            if (popularity == null || popularity.getRanks() == null) return Map.of();
            Map<String, Integer> out = new HashMap<>();
            for (CatalogPopularityDTO.PackageRank r : popularity.getRanks()) {
                if (r == null || r.getPackageId() == null || r.getPackageId().isBlank() || r.getRank() < 1) continue;
                out.merge(r.getPackageId().trim(), r.getRank(), Math::min);
            }
            return out;
        } catch (Exception e) {
            log.warn("catalog-api: popularity ranks unreadable for {}: {}", instituteId, e.getMessage());
            return Map.of();
        }
    }

    public Map<String, String> resolveMedia(Collection<String> ids) {
        return mediaResolver.resolve(ids);
    }
}
