package vacademy.io.admin_core_service.features.learner_home.summary;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Learner home summary (class-first home). The learner is always the token's user; the institute
 * must be the one the token was minted for (clientId), with no root-user bypass.
 */
@RestController
@RequestMapping("/admin-core-service/learner-home/v1")
@RequiredArgsConstructor
public class LearnerHomeSummaryController {

    private final InstituteAccessValidator accessValidator;
    private final LearnerHomeSummaryService summaryService;

    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> summary(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestParam("instituteId") String instituteId) {
        accessValidator.requireInstituteMember(user, instituteId);
        // Personalised: never cached by a CDN or shared cache.
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore().cachePrivate())
                .body(summaryService.summary(instituteId, user.getUserId()));
    }
}
