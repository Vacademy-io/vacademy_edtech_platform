package vacademy.io.admin_core_service.features.enquiry.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.enquiry.dto.AdminEnquiryDetailResponseDTO;
import vacademy.io.admin_core_service.features.enquiry.dto.BulkEnquiryStatusUpdateRequestDTO;
import vacademy.io.admin_core_service.features.enquiry.dto.BulkEnquiryStatusUpdateResponseDTO;
import vacademy.io.admin_core_service.features.enquiry.dto.LinkCounselorDTO;
import vacademy.io.admin_core_service.features.enquiry.service.EnquiryService;

@RestController
@RequestMapping("/admin-core-service/enquiry")
public class EnquiryInternalController {

    @Autowired
    private EnquiryService enquiryService;

    @PostMapping("/link-counselor")
    @Auditable(
            entityType = "ENQUIRY",
            action = "ASSIGN",
            descriptionExpr = "'linked a counsellor to an enquiry'")
    public ResponseEntity<String> linkCounselor(@RequestBody LinkCounselorDTO request,
            @RequestAttribute("user") vacademy.io.common.auth.model.CustomUserDetails user) {
        String response = enquiryService.linkCounselorToSource(request, user);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/v1/admin/details")
    public ResponseEntity<AdminEnquiryDetailResponseDTO> getAdminEnquiryDetails(
            @RequestParam String enquiryId) {
        AdminEnquiryDetailResponseDTO response = enquiryService.getAdminEnquiryDetails(enquiryId);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/v1/admin/update-status")
    @Auditable(
            entityType = "ENQUIRY",
            action = "STATUS_CHANGE",
            descriptionExpr = "'changed the status of ' + (#request?.enquiryIds?.size() ?: 0) + ' enquiry(s)'"
                    + " + (#request?.enquiryStatus != null ? ' to ' + #request.enquiryStatus : '')")
    public ResponseEntity<BulkEnquiryStatusUpdateResponseDTO> bulkUpdateEnquiryStatus(
            @RequestBody BulkEnquiryStatusUpdateRequestDTO request,
            @RequestAttribute("user") vacademy.io.common.auth.model.CustomUserDetails user) {
        BulkEnquiryStatusUpdateResponseDTO response = enquiryService.bulkUpdateEnquiryStatus(request, user);
        return ResponseEntity.ok(response);
    }
}
