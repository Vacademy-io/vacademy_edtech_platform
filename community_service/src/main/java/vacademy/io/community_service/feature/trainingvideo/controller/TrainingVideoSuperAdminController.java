package vacademy.io.community_service.feature.trainingvideo.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.community_service.feature.trainingvideo.dto.TrainingVideoDto;
import vacademy.io.community_service.feature.trainingvideo.dto.UpsertTrainingVideoRequest;
import vacademy.io.community_service.feature.trainingvideo.service.TrainingVideoService;

import java.util.List;

/**
 * Super-admin CRUD for LMS training videos, driven by the health-check dashboard: upload the
 * video to S3 via media-service, then store name / description / module path here. Consumed
 * read-only by the admin dashboard's Assist Dock "Training" popup.
 */
@RestController
@RequestMapping("/community-service/super-admin/v1/training-videos")
public class TrainingVideoSuperAdminController {

    @Autowired
    private TrainingVideoService service;

    @GetMapping
    public ResponseEntity<List<TrainingVideoDto>> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.listAll());
    }

    @PostMapping
    public ResponseEntity<TrainingVideoDto> create(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestBody UpsertTrainingVideoRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.create(request));
    }

    @PutMapping("/{id}")
    public ResponseEntity<TrainingVideoDto> update(@RequestAttribute("user") CustomUserDetails user,
                                                   @PathVariable String id,
                                                   @RequestBody UpsertTrainingVideoRequest request) {
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
