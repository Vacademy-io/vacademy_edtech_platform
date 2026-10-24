package vacademy.io.admin_core_service.features.crm_dashboard.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.crm_dashboard.dto.CrmDashboardRequestDTO;
import vacademy.io.admin_core_service.features.crm_dashboard.dto.CrmDashboardResponseDTO;
import vacademy.io.admin_core_service.features.crm_dashboard.service.CrmDashboardService;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/v1/crm-dashboard")
@RequiredArgsConstructor
public class CrmDashboardController {

    private final CrmDashboardService crmDashboardService;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * The CRM Dashboard's numbers, block by block. Staff of the institute only; what
     * each caller sees inside it is their CRM Leads list scope.
     */
    @PostMapping
    public ResponseEntity<CrmDashboardResponseDTO> getDashboard(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody CrmDashboardRequestDTO request) {
        instituteAccessValidator.requireInstituteStaff(user, request != null ? request.getInstituteId() : null);
        return ResponseEntity.ok(crmDashboardService.getDashboard(request, user));
    }
}
