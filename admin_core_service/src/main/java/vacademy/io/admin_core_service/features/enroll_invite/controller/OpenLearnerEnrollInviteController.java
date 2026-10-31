package vacademy.io.admin_core_service.features.enroll_invite.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.enroll_invite.service.InviteFormAdminNotificationService;
import vacademy.io.admin_core_service.features.enroll_invite.service.LearnerEnrollInviteService;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;

@RestController
@RequestMapping("/admin-core-service/open/learner/enroll-invite")
public class OpenLearnerEnrollInviteController {

    @Autowired
    private LearnerEnrollInviteService learnerEnrollInviteService;

    @Autowired
    private EnrollInviteService enrollInviteService;

    @Autowired
    private InviteFormAdminNotificationService inviteFormAdminNotificationService;

    @Autowired
    private RegionalPriceResolver regionalPriceResolver;

    // Both reads show the viewer their regional price when the plan's option has regional
    // pricing on; checkout resolves the same price again server-side.
    @GetMapping
    public ResponseEntity<EnrollInviteDTO> getEnrollInvite(String instituteId, String inviteCode) {
        EnrollInviteDTO dto = learnerEnrollInviteService.getEnrollInvite(instituteId, inviteCode);
        regionalPriceResolver.localize(dto);
        return ResponseEntity.ok(dto);
    }

    @GetMapping("/{instituteId}/{enrollInviteId}")
    public ResponseEntity<EnrollInviteDTO> getEnrollInviteById(@PathVariable("instituteId") String instituteId,
            @PathVariable("enrollInviteId") String enrollInviteId) {
        EnrollInviteDTO dto = enrollInviteService.findByEnrollInviteId(enrollInviteId, instituteId);
        // Open endpoint — strip the team-notification email list before it reaches the browser.
        dto.setSettingJson(inviteFormAdminNotificationService.redactFromSettingJson(dto.getSettingJson()));
        regionalPriceResolver.localize(dto);
        return ResponseEntity.ok(dto);
    }
}
