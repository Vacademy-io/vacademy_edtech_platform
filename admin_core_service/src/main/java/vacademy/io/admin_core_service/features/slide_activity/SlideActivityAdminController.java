package vacademy.io.admin_core_service.features.slide_activity;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Poll results and game scores for staff (institute staff, slide in one of its courses). */
@RestController
@RequestMapping("/admin-core-service/slide-activity/admin/v1")
@RequiredArgsConstructor
public class SlideActivityAdminController {

    private final SlideActivityService service;

    @GetMapping("/poll/results")
    public ResponseEntity<SlideActivityService.PollResults> pollResults(@RequestParam String slideId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.pollResults(user, slideId, instituteId, packageSessionId));
    }

    @GetMapping("/game/scores")
    public ResponseEntity<SlideActivityService.GameResults> gameScores(@RequestParam String slideId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String packageSessionId,
            @RequestParam(defaultValue = "100") int limit,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.gameResults(user, slideId, instituteId, packageSessionId, limit));
    }
}
