package vacademy.io.admin_core_service.features.catalogue_folder.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.DeleteResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.LibraryRequest;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.LibraryResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.MoveRequest;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.NodeRequest;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.TreeResponse;
import vacademy.io.admin_core_service.features.catalogue_folder.service.CatalogueFolderService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Dashboard side of folder libraries. Reads need institute STAFF of
 * `instituteId`; every change needs an institute ADMIN, because edits go
 * live on the public sites with no publish step. Neither check has a root
 * bypass (see InstituteAccessValidator). The checks live in the service.
 */
@RestController
@RequestMapping("/admin-core-service/v1/folder-library")
public class CatalogueFolderController {

    @Autowired
    private CatalogueFolderService service;

    @GetMapping("/libraries")
    public ResponseEntity<List<LibraryResponse>> list(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam String instituteId) {
        return ResponseEntity.ok(service.listLibraries(user, instituteId));
    }

    @PostMapping("/library")
    public ResponseEntity<LibraryResponse> create(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam String instituteId,
                                                  @RequestBody LibraryRequest request) {
        return ResponseEntity.ok(service.createLibrary(user, instituteId, request));
    }

    @PutMapping("/library")
    public ResponseEntity<LibraryResponse> update(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam String instituteId,
                                                  @RequestParam String libraryId,
                                                  @RequestBody LibraryRequest request) {
        return ResponseEntity.ok(service.updateLibrary(user, instituteId, libraryId, request));
    }

    @DeleteMapping("/library")
    public ResponseEntity<Void> delete(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestParam String instituteId,
                                       @RequestParam String libraryId) {
        service.deleteLibrary(user, instituteId, libraryId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/tree")
    public ResponseEntity<TreeResponse> tree(@RequestAttribute("user") CustomUserDetails user,
                                             @RequestParam String instituteId,
                                             @RequestParam String libraryId) {
        return ResponseEntity.ok(service.getTree(user, instituteId, libraryId));
    }

    @PostMapping("/node")
    public ResponseEntity<TreeResponse> createNode(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam String instituteId,
                                                   @RequestParam String libraryId,
                                                   @RequestBody NodeRequest request) {
        return ResponseEntity.ok(service.createNode(user, instituteId, libraryId, request));
    }

    @PutMapping("/node")
    public ResponseEntity<TreeResponse> updateNode(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam String instituteId,
                                                   @RequestParam String nodeId,
                                                   @RequestBody NodeRequest request) {
        return ResponseEntity.ok(service.updateNode(user, instituteId, nodeId, request));
    }

    @PostMapping("/node/move")
    public ResponseEntity<TreeResponse> moveNode(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestParam String instituteId,
                                                 @RequestParam String nodeId,
                                                 @RequestBody MoveRequest request) {
        return ResponseEntity.ok(service.moveNode(user, instituteId, nodeId, request));
    }

    @DeleteMapping("/node")
    public ResponseEntity<DeleteResponse> deleteNode(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam String instituteId,
                                                     @RequestParam String nodeId) {
        return ResponseEntity.ok(service.deleteNode(user, instituteId, nodeId));
    }
}
