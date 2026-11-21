package vacademy.io.admin_core_service.features.packages.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailDTO;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.service.CatalogPopularityService;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

@RestController
@RequestMapping("/admin-core-service/open/packages")
public class OpenPackageController {

    /** institute ids are varchar(255); anything longer cannot match and is not worth a cache slot. */
    static final int MAX_INSTITUTE_ID_LENGTH = 255;

    /** Popularity answers: same value @ClientCacheable(600, PUBLIC) writes, tied to the server TTL. */
    static final String POPULARITY_CACHE_CONTROL =
            "public, max-age=" + CatalogPopularityService.RANKS_TTL.toSeconds();

    /** The no-ranks stand-in for a failed load: never stored, so the next page view asks again. */
    static final String POPULARITY_UNAVAILABLE_CACHE_CONTROL = "no-store";

    @Autowired
    private OpenPackageService openPackageService;

    @Autowired
    private CatalogPopularityService catalogPopularityService;

    @PostMapping("/v1/search")
    public ResponseEntity<Page<PackageDetailDTO>> getLearnerPackages(
            @RequestBody LearnerPackageFilterDTO filterDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int page,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int size
    ) {
        Page<PackageDetailDTO> result = openPackageService.getLearnerPackageDetail(filterDTO,instituteId, page, size);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/v1/package-detail")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC)
    public ResponseEntity<PackageDetailDTO> getPackageDetailById(@RequestParam("packageId") String packageId) {
        PackageDetailDTO result = openPackageService.getPackageDetailById(packageId);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/v2/search")
    public ResponseEntity<Page<PackageDetailV2DTO>> getLearnerPackagesV2(
            @RequestBody LearnerPackageFilterDTO filterDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int page,
            @RequestParam(defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int size
    ) {
        Page<PackageDetailV2DTO> result = openPackageService.getLearnerPackageDetailV2(filterDTO, instituteId, page, size);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/v1/tags")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC)
    public ResponseEntity<java.util.List<String>> getInstituteDistinctTags(
            @RequestParam("instituteId") String instituteId
    ) {
        return ResponseEntity.ok(openPackageService.getDistinctCatalogTags(instituteId));
    }

    /**
     * Popularity ranks of the institute's catalogue courses:
     * {@code {"institute_id": "...", "ranks": [{"package_id": "...", "rank": 1}, ...]}}.
     * Rank 1 = most distinct active learners; ties broken deterministically; courses with no
     * active learners are absent; never any counts. Cached 10 minutes per institute on the server
     * (and read on the replica) plus {@code Cache-Control: public, max-age=600} for browsers/CDN.
     * A blank or impossibly long id gets an empty list without touching the cache or the DB.
     *
     * <p>When the ranks could not be loaded the answer is still 200 with an empty list (the public
     * site shows no popularity data), but sent with {@code Cache-Control: no-store}: the server
     * retries after a minute, so a browser must not keep that answer for 10 minutes. That is why
     * this method sets its headers itself instead of using {@code @ClientCacheable}, whose advice
     * overwrites Cache-Control on every response of the method.
     */
    @GetMapping("/v1/popularity")
    public ResponseEntity<CatalogPopularityDTO> getCatalogPopularity(
            @RequestParam("instituteId") String instituteId
    ) {
        CatalogPopularityDTO popularity =
                !StringUtils.hasText(instituteId) || instituteId.length() > MAX_INSTITUTE_ID_LENGTH
                        ? CatalogPopularityDTO.empty(instituteId)
                        : catalogPopularityService.getPopularity(instituteId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL,
                        popularity.isUnavailable() ? POPULARITY_UNAVAILABLE_CACHE_CONTROL : POPULARITY_CACHE_CONTROL)
                .body(popularity);
    }

}
