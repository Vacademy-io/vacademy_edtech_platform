package vacademy.io.community_service.feature.webinar.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.community_service.feature.webinar.dto.WebinarDto;
import vacademy.io.community_service.feature.webinar.service.WebinarService;

import java.util.List;

/**
 * Read-only: every logged-in admin-dashboard user sees the same published webinars in the Assist
 * Dock "Webinars" panel. Same posture as the training-video and roadmap reader controllers.
 */
@RestController
@RequestMapping("/community-service/webinars/v1")
public class WebinarController {

    @Autowired
    private WebinarService service;

    /** Published webinars, newest start first. The panel splits them into live / upcoming / past. */
    @GetMapping
    public ResponseEntity<List<WebinarDto>> list(@RequestAttribute("user") CustomUserDetails user) {
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return ResponseEntity.ok(service.listPublished());
    }
}
