package vacademy.io.admin_core_service.features.access_pass.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.access_pass.dto.AccessPassDTOs.*;
import vacademy.io.admin_core_service.features.access_pass.service.AccessPassService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Dashboard side of access passes. Reads need institute STAFF; every change needs an
 * institute ADMIN (checks live in the service, as in CatalogueFolderController).
 */
@RestController
@RequestMapping("/admin-core-service/v1/access-pass")
public class AccessPassController {

    @Autowired
    private AccessPassService service;

    @PostMapping
    public ResponseEntity<AccessPassResponse> create(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam String instituteId,
                                                     @RequestBody AccessPassRequest request) {
        return ResponseEntity.ok(service.create(user, instituteId, request));
    }

    @GetMapping("/list")
    public ResponseEntity<List<AccessPassResponse>> list(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam String instituteId,
                                                         @RequestParam(required = false) List<String> status) {
        return ResponseEntity.ok(service.list(user, instituteId, status));
    }

    @GetMapping("/{id}")
    public ResponseEntity<AccessPassResponse> get(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam String instituteId,
                                                  @PathVariable String id) {
        return ResponseEntity.ok(service.get(user, instituteId, id));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AccessPassResponse> update(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam String instituteId,
                                                     @PathVariable String id,
                                                     @RequestBody AccessPassRequest request) {
        return ResponseEntity.ok(service.update(user, instituteId, id, request));
    }

    @PutMapping("/{id}/status")
    public ResponseEntity<AccessPassResponse> updateStatus(@RequestAttribute("user") CustomUserDetails user,
                                                           @RequestParam String instituteId,
                                                           @PathVariable String id,
                                                           @RequestParam String status) {
        return ResponseEntity.ok(service.updateStatus(user, instituteId, id, status));
    }

    @PostMapping("/{id}/items")
    public ResponseEntity<AccessPassResponse> addItems(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestParam String instituteId,
                                                       @PathVariable String id,
                                                       @RequestBody ItemsRequest request) {
        return ResponseEntity.ok(service.addItems(user, instituteId, id,
                request != null ? request.getPackageSessionIds() : List.of()));
    }

    @DeleteMapping("/{id}/items/{packageSessionId}")
    public ResponseEntity<AccessPassResponse> removeItem(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam String instituteId,
                                                         @PathVariable String id,
                                                         @PathVariable String packageSessionId) {
        return ResponseEntity.ok(service.removeItem(user, instituteId, id, packageSessionId));
    }

    @GetMapping("/{id}/holders")
    public ResponseEntity<Page<HolderResponse>> holders(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestParam String instituteId,
                                                        @PathVariable String id,
                                                        @RequestParam(required = false) List<String> planStatus,
                                                        @RequestParam(defaultValue = "0") int pageNo,
                                                        @RequestParam(defaultValue = "20") int pageSize) {
        return ResponseEntity.ok(service.holders(user, instituteId, id, planStatus, pageNo, pageSize));
    }

    /** Runs the holder sync now and returns its report (waits for it; small passes take seconds). */
    @PostMapping("/{id}/sync")
    public ResponseEntity<SyncReport> sync(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam String instituteId,
                                           @PathVariable String id) {
        return ResponseEntity.ok(service.syncNow(user, instituteId, id));
    }

    /** B2B: sub-orgs holding the pass. */
    @GetMapping("/{id}/sub-orgs")
    public ResponseEntity<List<SubOrgLinkResponse>> subOrgs(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestParam String instituteId,
                                                            @PathVariable String id) {
        return ResponseEntity.ok(service.subOrgs(user, instituteId, id));
    }

    /** B2B: give a sub-org the pass (links its courses now, and every course added later). */
    @PostMapping("/{id}/sub-orgs/{subOrgId}")
    public ResponseEntity<List<SubOrgLinkResponse>> assignSubOrg(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestParam String instituteId,
                                                                 @PathVariable String id,
                                                                 @PathVariable String subOrgId) {
        return ResponseEntity.ok(service.assignSubOrg(user, instituteId, id, subOrgId));
    }

    /** B2B: stop syncing the pass to a sub-org (already-linked courses stay with it). */
    @DeleteMapping("/{id}/sub-orgs/{subOrgId}")
    public ResponseEntity<List<SubOrgLinkResponse>> unassignSubOrg(@RequestAttribute("user") CustomUserDetails user,
                                                                   @RequestParam String instituteId,
                                                                   @PathVariable String id,
                                                                   @PathVariable String subOrgId) {
        return ResponseEntity.ok(service.unassignSubOrg(user, instituteId, id, subOrgId));
    }

    /** Which passes include each of these courses — for the course-list badge. */
    @PostMapping("/by-courses")
    public ResponseEntity<List<CoursePassMembership>> byCourses(@RequestAttribute("user") CustomUserDetails user,
                                                                @RequestParam String instituteId,
                                                                @RequestBody ItemsRequest request) {
        return ResponseEntity.ok(service.passesForCourses(user, instituteId,
                request != null ? request.getPackageSessionIds() : List.of()));
    }
}
