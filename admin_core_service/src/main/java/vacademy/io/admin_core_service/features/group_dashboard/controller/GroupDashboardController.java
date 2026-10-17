package vacademy.io.admin_core_service.features.group_dashboard.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.group_dashboard.service.GroupDashboardService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/v1/group-dashboard")
@RequiredArgsConstructor
public class GroupDashboardController {

    private final GroupDashboardService groupDashboardService;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * Contacts, Automations or Engagement dashboard numbers for the whole institute.
     * Institute admins only: these count every contact, workflow run and engine task.
     */
    @GetMapping("/{group}")
    public ResponseEntity<Map<String, Object>> getDashboard(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("group") String group,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "days", required = false) Integer days,
            @RequestParam(value = "timezone", required = false) String timezone) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(groupDashboardService.getDashboard(group, instituteId, days, timezone));
    }
}
