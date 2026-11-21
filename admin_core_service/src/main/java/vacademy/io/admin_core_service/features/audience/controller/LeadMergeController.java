package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.LeadMergeDTOs;
import vacademy.io.admin_core_service.features.audience.service.LeadMergeService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Merging duplicate people in the CRM: preview, merge, undo, a person's merge state, and the
 * similar-lead check (same phone or email, or a similar name) used when a lead is added by hand.
 * Merge, preview and undo are for institute admins; the state and the similar-lead check for any
 * staff member of the institute.
 */
@RestController
@RequestMapping("/admin-core-service/v1/audience/lead-merge")
@RequiredArgsConstructor
public class LeadMergeController {

    private final LeadMergeService leadMergeService;

    /** What merging would do, and why it cannot be done when it cannot. Changes nothing. */
    @GetMapping("/preview")
    public ResponseEntity<LeadMergeDTOs.Preview> preview(@RequestParam("instituteId") String instituteId,
                                                         @RequestParam("keepUserId") String keepUserId,
                                                         @RequestParam("duplicateUserId") String duplicateUserId,
                                                         @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadMergeService.preview(instituteId,
                new LeadMergeDTOs.MergeRequest(keepUserId, duplicateUserId), user));
    }

    @PostMapping
    @Auditable(entityType = "LEAD", action = "MERGE", descriptionExpr = "'merged a duplicate person into another'")
    public ResponseEntity<LeadMergeDTOs.MergeResult> merge(@RequestParam("instituteId") String instituteId,
                                                           @RequestBody LeadMergeDTOs.MergeRequest request,
                                                           @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadMergeService.merge(instituteId, request, user));
    }

    @PostMapping("/undo")
    @Auditable(entityType = "LEAD", action = "UNMERGE", descriptionExpr = "'undid a person merge'")
    public ResponseEntity<LeadMergeDTOs.UnmergeResult> unmerge(@RequestParam("instituteId") String instituteId,
                                                               @RequestBody LeadMergeDTOs.UnmergeRequest request,
                                                               @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadMergeService.unmerge(instituteId, request, user));
    }

    @GetMapping("/state")
    public ResponseEntity<LeadMergeDTOs.MergeState> state(@RequestParam("instituteId") String instituteId,
                                                          @RequestParam("userId") String userId,
                                                          @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadMergeService.state(instituteId, userId, user));
    }

    @GetMapping("/similar-names")
    public ResponseEntity<LeadMergeDTOs.SimilarNames> similarNames(@RequestParam("instituteId") String instituteId,
                                                                   @RequestParam(value = "name", required = false) String name,
                                                                   @RequestParam(value = "phone", required = false) String phone,
                                                                   @RequestParam(value = "email", required = false) String email,
                                                                   @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadMergeService.similarLeads(instituteId, name, phone, email, user));
    }
}
