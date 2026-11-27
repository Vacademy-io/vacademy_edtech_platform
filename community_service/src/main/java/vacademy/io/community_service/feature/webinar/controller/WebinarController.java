package vacademy.io.community_service.feature.webinar.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.community_service.feature.dashboardwidget.service.LeadTagResolver;
import vacademy.io.community_service.feature.webinar.dto.WebinarDto;
import vacademy.io.community_service.feature.webinar.service.WebinarService;

import java.util.List;

/**
 * Read-only: every logged-in admin-dashboard user sees the same published webinars in the Assist
 * Dock "Webinars" panel. Same posture as the training-video and roadmap reader controllers.
 *
 * <p>Admins of a PROD institute also get each webinar's live class id, so their Join button
 * drops them straight into the class. Everyone else gets the public join link only.
 */
@RestController
@RequestMapping("/community-service/webinars/v1")
public class WebinarController {

    static final String ADMIN_ROLE = "ADMIN";
    static final String PROD_TAG = "PROD";

    @Autowired
    private WebinarService service;
    @Autowired
    private LeadTagResolver leadTagResolver;

    /** Published webinars, newest start first. The panel splits them into live / upcoming / past. */
    @GetMapping
    public ResponseEntity<List<WebinarDto>> list(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestHeader(value = "clientId", required = false) String clientId) {
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return ResponseEntity.ok(service.listPublished(canJoinLiveClass(user, clientId)));
    }

    /**
     * An ADMIN of the institute the request is made for (the admin dashboard sends it as the
     * {@code clientId} header, and the user's authorities are already scoped to that institute),
     * when that institute is tagged PROD. The tag lookup is cached and never throws: if
     * admin-core can't be reached the answer is simply "no", and the public link still works.
     */
    boolean canJoinLiveClass(CustomUserDetails user, String clientId) {
        if (!StringUtils.hasText(clientId) || user.getAuthorities() == null) {
            return false;
        }
        boolean isAdmin = user.getAuthorities().stream()
                .anyMatch(a -> ADMIN_ROLE.equalsIgnoreCase(a.getAuthority()));
        return isAdmin && PROD_TAG.equalsIgnoreCase(leadTagResolver.resolve(clientId.trim()));
    }
}
