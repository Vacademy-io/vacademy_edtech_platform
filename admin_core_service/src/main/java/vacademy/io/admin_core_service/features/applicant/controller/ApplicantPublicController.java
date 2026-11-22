package vacademy.io.admin_core_service.features.applicant.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.applicant.dto.ApplicantStageDTO;
import vacademy.io.admin_core_service.features.applicant.dto.BulkApplyRequestDTO;
import vacademy.io.admin_core_service.features.applicant.dto.BulkApplyResponseDTO;
import vacademy.io.admin_core_service.features.applicant.dto.BulkApplyRowDTO;
import vacademy.io.admin_core_service.features.applicant.dto.BulkRowResultDTO;
import vacademy.io.admin_core_service.features.applicant.dto.ApplyRequestDTO;
import vacademy.io.admin_core_service.features.applicant.dto.ApplyResponseDTO;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.applicant.service.ApplicantService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.features.applicant.dto.ParentWithChildrenResponseDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import java.util.List;

/**
 * Public-facing endpoints for applicant operations
 * Handles application submission and payment initiation
 * No authentication required (or optional authentication)
 */
@RestController
@RequestMapping("/admin-core-service/v1/applicant")
public class ApplicantPublicController {

    private static final Logger logger = LoggerFactory.getLogger(ApplicantPublicController.class);

    private final ApplicantService applicantService;
    private final InstituteAccessValidator instituteAccessValidator;

    @Autowired
    public ApplicantPublicController(ApplicantService applicantService,
                                     InstituteAccessValidator instituteAccessValidator) {
        this.applicantService = applicantService;
        this.instituteAccessValidator = instituteAccessValidator;
    }

    /**
     * Submit application form - handles both pre-filled (from enquiry) and manual
     * (direct) submissions. workflowType is hardcoded to APPLICATION on the backend.
     */
    @PostMapping("/apply")
    public ResponseEntity<ApplyResponseDTO> submitApplication(@Valid @RequestBody ApplyRequestDTO request) {
        logger.info("Request to submit application. InstituteId: {}, Source: {}, SourceId: {}, EnquiryId: {}",
                request.getInstituteId(), request.getSource(), request.getSourceId(), request.getEnquiryId());
        request.setWorkflowType("APPLICATION");
        ApplyResponseDTO response = applicantService.submitApplication(request);
        return ResponseEntity.ok(response);
    }

    /**
     * Bulk submit applications.
     *
     * Request shape is intentionally similar to the enquiry bulk import style:
     * - top-level institute_id
     * - rows[] where each row maps to one manual/direct application
     *
     * This endpoint returns:
     * - summary.successful / summary.failed
     * - results[] with per-row SUCCESS/FAILED
     */
    @PostMapping("/bulk-apply")
    public ResponseEntity<BulkApplyResponseDTO> bulkSubmitApplication(
            @RequestBody BulkApplyRequestDTO request) {

        int successful = 0;
        int failed = 0;

        List<BulkRowResultDTO> results = new java.util.ArrayList<>();

        if (request == null || request.getRows() == null) {
            return ResponseEntity.ok(
                    BulkApplyResponseDTO.builder()
                            .summary(BulkApplyResponseDTO.BulkSummaryDTO.builder().successful(0).failed(0).build())
                            .results(new java.util.ArrayList<>())
                            .build());
        }

        for (int i = 0; i < request.getRows().size(); i++) {
            BulkApplyRowDTO row = request.getRows().get(i);
            try {
                if (row == null) throw new IllegalArgumentException("Row is null");

                // Build ApplyRequestDTO expected by ApplicantService
                ApplyRequestDTO applyRequest = new ApplyRequestDTO();
                applyRequest.setEnquiryId(null);
                applyRequest.setInstituteId(request.getInstituteId());
                applyRequest.setSessionId(row.getSessionId());
                applyRequest.setSource("INSTITUTE");
                applyRequest.setSourceId(request.getInstituteId());
                applyRequest.setDestinationPackageSessionId(row.getDestinationPackageSessionId());
                applyRequest.setWorkflowType("APPLICATION");

                java.util.Map<String, Object> formData = new java.util.HashMap<>();
                formData.put("child_name", row.getChildName());
                formData.put("child_dob", row.getChildDob());
                formData.put("child_gender", row.getChildGender());
                formData.put("father_name", row.getFatherName());
                formData.put("father_mobile", row.getFatherMobile());
                formData.put("father_email", row.getFatherEmail());
                formData.put("mother_name", row.getMotherName());
                formData.put("mother_mobile", row.getMotherMobile());
                formData.put("mother_email", row.getMotherEmail());
                formData.put("address_line", row.getAddressLine() != null ? row.getAddressLine() : "");

                applyRequest.setFormData(formData);
                applyRequest.setCustomFieldValues(new java.util.HashMap<>());

                applicantService.submitApplication(applyRequest);

                successful++;
                results.add(BulkRowResultDTO.builder()
                        .rowIndex(i)
                        .status("SUCCESS")
                        .success(true)
                        .message(null)
                        .build());
            } catch (Exception e) {
                failed++;
                results.add(BulkRowResultDTO.builder()
                        .rowIndex(i)
                        .status("FAILED")
                        .success(false)
                        .message(e.getMessage())
                        .build());
            }
        }

        BulkApplyResponseDTO response = BulkApplyResponseDTO.builder()
                .summary(BulkApplyResponseDTO.BulkSummaryDTO.builder()
                        .successful(successful)
                        .failed(failed)
                        .build())
                .results(results)
                .build();

        return ResponseEntity.ok(response);
    }

    /**
     * Initiate Payment for Applicant
     * Wrapper that calls Payment Service and updates Applicant JSON
     */
    @PostMapping("/{applicantId}/payment/initiate")
    public ResponseEntity<PaymentResponseDTO> initiatePayment(
            @PathVariable String applicantId,
            @RequestParam String paymentOptionId,
            @RequestBody PaymentInitiationRequestDTO requestDTO,
            @RequestAttribute(name = "user", required = false) CustomUserDetails userDetails) {

        logger.info("Request to initiate payment. Applicant: {}, Option: {}, Vendor: {}", applicantId, paymentOptionId,
                requestDTO.getVendor());

        // MANUAL (offline/cash) payments are staff-only
        if ("MANUAL".equalsIgnoreCase(requestDTO.getVendor())) {
            if (userDetails == null) {
                logger.warn("Rejected unauthenticated attempt to record manual payment for applicant: {}", applicantId);
                return ResponseEntity.status(403).build();
            }
            // Recording an offline payment is for staff of the institute the applicant applied to.
            instituteAccessValidator.requireInstituteStaffOrSuperAdmin(userDetails,
                    applicantService.getInstituteIdForApplicant(applicantId));
        }

        PaymentResponseDTO response = applicantService.preparePayment(applicantId, paymentOptionId,
                requestDTO, userDetails);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/parent/{parentUserId}")
    public ResponseEntity<ParentWithChildrenResponseDTO> getParentWithChildren(@PathVariable String parentUserId) {
        logger.info("Request to fetch parent details with children for parentUserId: {}", parentUserId);
        ParentWithChildrenResponseDTO response = applicantService.getParentWithChildren(parentUserId);
        return ResponseEntity.ok(response);
    }

    /**
     * Get all stages for an applicant
     */
    @GetMapping("/{applicantId}/stages")
    public ResponseEntity<List<ApplicantStageDTO>> getApplicantStages(@PathVariable String applicantId) {
        logger.info("Request to fetch stages for applicantId: {}", applicantId);
        List<ApplicantStageDTO> stages = applicantService.getApplicantStages(applicantId);
        return ResponseEntity.ok(stages);
    }
}
