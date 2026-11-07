package vacademy.io.admin_core_service.features.catalogue_blog.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostPageResponse;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostRequest;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostResponse;
import vacademy.io.admin_core_service.features.catalogue_blog.enums.BlogPostStatus;
import vacademy.io.admin_core_service.features.catalogue_blog.service.CatalogueBlogService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Dashboard / MCP side of catalogue blog posts. Every call is checked against
 * the caller's institute membership; `instituteId` is a parameter (not read
 * from the token) because an admin may belong to several institutes.
 */
@RestController
@RequestMapping("/admin-core-service/v1/catalogue-blog")
public class CatalogueBlogController {

    @Autowired
    private CatalogueBlogService service;

    @GetMapping("/posts")
    public ResponseEntity<BlogPostPageResponse> list(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam String instituteId,
                                                     @RequestParam(required = false) String status,
                                                     @RequestParam(required = false) String category,
                                                     @RequestParam(required = false) String q,
                                                     @RequestParam(defaultValue = "0") int page,
                                                     @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(service.list(user, instituteId, status, category, q, page, size));
    }

    @GetMapping("/post")
    public ResponseEntity<BlogPostResponse> get(@RequestAttribute("user") CustomUserDetails user,
                                                @RequestParam String instituteId,
                                                @RequestParam String postId) {
        return ResponseEntity.ok(service.get(user, instituteId, postId));
    }

    @PostMapping("/post")
    public ResponseEntity<BlogPostResponse> create(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam String instituteId,
                                                   @RequestBody BlogPostRequest request) {
        return ResponseEntity.ok(service.create(user, instituteId, request));
    }

    @PutMapping("/post")
    public ResponseEntity<BlogPostResponse> update(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam String instituteId,
                                                   @RequestParam String postId,
                                                   @RequestBody BlogPostRequest request) {
        return ResponseEntity.ok(service.update(user, instituteId, postId, request));
    }

    @PostMapping("/post/publish")
    public ResponseEntity<BlogPostResponse> publish(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestParam String instituteId,
                                                    @RequestParam String postId) {
        return ResponseEntity.ok(service.setStatus(user, instituteId, postId, BlogPostStatus.PUBLISHED));
    }

    @PostMapping("/post/unpublish")
    public ResponseEntity<BlogPostResponse> unpublish(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam String instituteId,
                                                      @RequestParam String postId) {
        return ResponseEntity.ok(service.setStatus(user, instituteId, postId, BlogPostStatus.DRAFT));
    }

    @PostMapping("/post/archive")
    public ResponseEntity<BlogPostResponse> archive(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestParam String instituteId,
                                                    @RequestParam String postId) {
        return ResponseEntity.ok(service.setStatus(user, instituteId, postId, BlogPostStatus.ARCHIVED));
    }

    @DeleteMapping("/post")
    public ResponseEntity<Void> delete(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestParam String instituteId,
                                       @RequestParam String postId) {
        service.delete(user, instituteId, postId);
        return ResponseEntity.ok().build();
    }
}
