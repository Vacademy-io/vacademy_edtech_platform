package vacademy.io.admin_core_service.features.catalogue_folder.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.config.cache.CacheScope;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.TreeResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.service.CatalogueFolderService;

/**
 * What the public site's `folderBrowser` section reads: ACTIVE nodes only,
 * product page leaves only while their page is ACTIVE. Cached briefly, so an
 * admin edit reaches visitors within a minute.
 */
@RestController
@RequestMapping("/admin-core-service/public/folder-library/v1")
public class PublicCatalogueFolderController {

    @Autowired
    private CatalogueFolderService service;

    @GetMapping("/tree")
    @ClientCacheable(maxAgeSeconds = 60, scope = CacheScope.PUBLIC)
    public ResponseEntity<TreeResponse> tree(@RequestParam String instituteId,
                                             @RequestParam String libraryId) {
        return service.publicTree(instituteId, libraryId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
