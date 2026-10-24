package vacademy.io.admin_core_service.features.catalogue_blog.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.config.cache.CacheScope;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostPageResponse;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostResponse;
import vacademy.io.admin_core_service.features.catalogue_blog.service.CatalogueBlogService;

/**
 * What the public site (and the edge SEO middleware) reads. Serves only
 * PUBLISHED posts whose publish time has passed; drafts are unreachable here
 * by construction. Cached briefly like the catalogue JSON itself.
 */
@RestController
@RequestMapping("/admin-core-service/public/catalogue-blog/v1")
public class PublicCatalogueBlogController {

    @Autowired
    private CatalogueBlogService service;

    @GetMapping("/posts")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC)
    public ResponseEntity<BlogPostPageResponse> list(@RequestParam String instituteId,
                                                     @RequestParam(required = false) String category,
                                                     @RequestParam(defaultValue = "0") int page,
                                                     @RequestParam(defaultValue = "12") int size) {
        return ResponseEntity.ok(service.publicList(instituteId, category, page, size));
    }

    @GetMapping("/post")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC)
    public ResponseEntity<BlogPostResponse> get(@RequestParam String instituteId,
                                                @RequestParam String slug) {
        return service.publicGet(instituteId, slug)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
