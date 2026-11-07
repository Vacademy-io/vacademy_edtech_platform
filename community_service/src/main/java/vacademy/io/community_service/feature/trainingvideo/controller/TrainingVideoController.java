package vacademy.io.community_service.feature.trainingvideo.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.community_service.feature.trainingvideo.dto.TrainingVideoDto;
import vacademy.io.community_service.feature.trainingvideo.service.TrainingVideoService;

import java.util.List;

/**
 * Read-only: any logged-in admin-dashboard user sees the same published training videos in
 * the Assist Dock "Training" popup. Same posture as the roadmap reader controller.
 */
@RestController
@RequestMapping("/community-service/training/v1")
public class TrainingVideoController {

    @Autowired
    private TrainingVideoService service;

    /**
     * Active training videos. {@code search} is optional — the popup filters client-side for
     * an instant feel, but the server honours it too so large libraries stay cheap to query.
     */
    @GetMapping("/videos")
    public ResponseEntity<List<TrainingVideoDto>> videos(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam(name = "search", required = false) String search) {
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return ResponseEntity.ok(service.listActive(search));
    }
}
