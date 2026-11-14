package vacademy.io.admin_core_service.features.subject.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.subject.dto.UpdateSubjectOrderDTO;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.institute.dto.SubjectDTO;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/subject/v1")
@RequiredArgsConstructor
public class SubjectController {
    private final SubjectService subjectService;

    /**
     * Names for a set of subject ids the caller already has (an assessment stores a raw
     * subject id). POST, not a query param, so a page resolving a full list of ids does
     * not have to encode them into the URL.
     */
    @PostMapping("/subjects-by-ids")
    public ResponseEntity<List<SubjectDTO>> getSubjectsByIds(@RequestBody List<String> subjectIds,
                                                            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(subjectService.getSubjectsByIds(subjectIds));
    }

    @PostMapping("/add-subject")
    public ResponseEntity<SubjectDTO> addSubject(@RequestBody SubjectDTO subjectDTO, String commaSeparatedPackageSessionIds, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(subjectService.addSubject(subjectDTO, commaSeparatedPackageSessionIds, user));
    }

    @PutMapping("/update-subject")
    public ResponseEntity<SubjectDTO> updateSubject(@RequestBody SubjectDTO subjectDTO, String subjectId, @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(subjectService.updateSubject(subjectDTO, subjectId, user));
    }

    @DeleteMapping("/delete-subject")
    public ResponseEntity<String> updateSubject(@RequestBody List<String> subjectIds,
                                                @RequestParam String packageSessionId,
                                                @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(subjectService.deleteSubject(subjectIds,packageSessionId, user));
    }

    /**
     * Updates the order of subjects for a session.
     *
     * @param updateSubjectOrderDTOS List of UpdateSubjectOrderDTO containing subject order updates.
     * @return ResponseEntity with success message.
     */
    @PutMapping("/update-subject-order")
    public ResponseEntity<String> updateSubjectOrder(@RequestBody List<UpdateSubjectOrderDTO> updateSubjectOrderDTOS, @RequestAttribute("user") CustomUserDetails user) {
        String result = subjectService.updateSubjectOrder(updateSubjectOrderDTOS, user);
        return ResponseEntity.ok(result);
    }
}
