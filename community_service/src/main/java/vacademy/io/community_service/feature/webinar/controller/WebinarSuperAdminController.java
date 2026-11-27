package vacademy.io.community_service.feature.webinar.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.community_service.feature.webinar.dto.UpsertWebinarRequest;
import vacademy.io.community_service.feature.webinar.dto.WebinarDto;
import vacademy.io.community_service.feature.webinar.service.WebinarService;

import java.util.List;

/**
 * Super-admin CRUD for webinars, driven by the health-check dashboard's Webinars page: add the
 * next webinar with its date and join link, then its recording once it is over. Consumed
 * read-only by the admin dashboard's Assist Dock "Webinars" panel.
 */
@RestController
@RequestMapping("/community-service/super-admin/v1/webinars")
public class WebinarSuperAdminController {

    @Autowired
    private WebinarService service;

    @GetMapping
    public ResponseEntity<List<WebinarDto>> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.listAll());
    }

    @PostMapping
    public ResponseEntity<WebinarDto> create(@RequestAttribute("user") CustomUserDetails user,
                                             @RequestBody UpsertWebinarRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.create(request));
    }

    @PutMapping("/{id}")
    public ResponseEntity<WebinarDto> update(@RequestAttribute("user") CustomUserDetails user,
                                             @PathVariable String id,
                                             @RequestBody UpsertWebinarRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@RequestAttribute("user") CustomUserDetails user,
                                       @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
