package vacademy.io.admin_core_service.features.course_catalogue.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CatalogueRevisionDTOs.RevisionResponse;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CatalogueRevisionDTOs.SaveDraftRequest;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueRequest;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueResponse;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CreateCatalogueRequest;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueInstituteMapping;
import vacademy.io.admin_core_service.features.course_catalogue.manager.CourseCatalogueManager;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.course_catalogue.service.CatalogueRevisionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;

@RestController
@RequestMapping("admin-core-service/v1/course-catalogue")
public class CourseCatalogueController {

    @Autowired
    private CourseCatalogueManager catalogueManager;

    @Autowired
    private CatalogueInstituteMappingRepository catalogueInstituteMappingRepository;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    /**
     * The caller must be STAFF of the institute that owns the catalogue — these
     * endpoints take only a catalogue id, so without this any logged-in user
     * could read, overwrite, publish or discard another institute's site.
     *
     * <p>No root-user bypass: learners and invited staff are created as root
     * users, and every site's catalogue id is public (the by-tag endpoint
     * returns it), so the bypass in validateUserAccess would let any learner
     * of any institute publish over another institute's site. The admin
     * dashboard and ai_service both send clientId = the institute.
     */
    void requireCatalogueAccess(CustomUserDetails user, String catalogueId) {
        String instituteId = catalogueInstituteMappingRepository.findByCourseCatalogueId(catalogueId)
                .map(CatalogueInstituteMapping::getInstitute)
                .map(Institute::getId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Catalogue not found"));
        try {
            instituteAccessValidator.requireInstituteStaff(user, instituteId);
        } catch (ForbiddenException e) {
            throw e;
        } catch (VacademyException e) {
            throw new ForbiddenException(e.getMessage());
        }
    }

    @PostMapping("/create")
    public ResponseEntity<List<CourseCatalogueResponse>> createCatalogues(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                          @RequestBody CreateCatalogueRequest request,
                                                                          @RequestParam("instituteId") String instituteId) {
        return catalogueManager.createCataloguesForInstitute(userDetails, request, instituteId);
    }

    @PutMapping("/update")
    public ResponseEntity<CourseCatalogueResponse> updateCatalogue(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                   @RequestParam("catalogueId") String catalogueId,
                                                                   @RequestBody CourseCatalogueRequest request) {
        requireCatalogueAccess(userDetails, catalogueId);
        return catalogueManager.updateCatalogue(userDetails, catalogueId, request);
    }

    @GetMapping("/institute/get-all")
    public ResponseEntity<List<CourseCatalogueResponse>> getAllCatalogues(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                          @RequestParam("instituteId") String instituteId) {
        return catalogueManager.getAllCatalogues(userDetails, instituteId);
    }

    @GetMapping("/institute/source")
    public ResponseEntity<List<CourseCatalogueResponse>> getCataloguesForSource(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                                @RequestParam("instituteId") String instituteId,
                                                                                @RequestParam("source") String source,
                                                                                @RequestParam("sourceId") String sourceId){
        return catalogueManager.getAllCataloguesForSourceAndSourceId(userDetails,instituteId,source,sourceId);
    }

    @GetMapping("/institute/default")
    public ResponseEntity<CourseCatalogueResponse> getDefaultCatalogue(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                             @RequestParam("instituteId") String instituteId) {
        return catalogueManager.getDefaultCatalogueForInstitute(userDetails, instituteId);
    }

    @GetMapping("/institute/get/by-tag")
    public ResponseEntity<CourseCatalogueResponse> getByTag(@RequestAttribute("user") CustomUserDetails userDetails,
                                                            @RequestParam("instituteId") String instituteId,
                                                            @RequestParam("tagName") String tagName) {
        return catalogueManager.getCatalogueByTag(userDetails, instituteId, tagName);
    }

    /* ── Revisions: draft / publish / history (AI Page Builder Phase A) ── */

    @Autowired
    private CatalogueRevisionService revisionService;

    @GetMapping("/revision/draft")
    public ResponseEntity<RevisionResponse> getDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                                     @RequestParam("catalogueId") String catalogueId) {
        requireCatalogueAccess(userDetails, catalogueId);
        // 204 when no draft exists — the editor then loads the published config
        return revisionService.getDraft(catalogueId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/revision/save-draft")
    public ResponseEntity<RevisionResponse> saveDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                                      @RequestParam("catalogueId") String catalogueId,
                                                      @RequestBody SaveDraftRequest request) {
        requireCatalogueAccess(userDetails, catalogueId);
        return ResponseEntity.ok(revisionService.saveDraft(catalogueId, request, userDetails.getUserId()));
    }

    @PostMapping("/revision/publish")
    public ResponseEntity<RevisionResponse> publishDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                                         @RequestParam("catalogueId") String catalogueId,
                                                         @RequestParam(value = "overrideStale", defaultValue = "false") boolean overrideStale,
                                                         @RequestParam(value = "expectedLiveRevisionNo", required = false) Integer expectedLiveRevisionNo,
                                                         @RequestParam(value = "expectedDraftSha256", required = false) String expectedDraftSha256) {
        requireCatalogueAccess(userDetails, catalogueId);
        // 409 DRAFT_OLDER_THAN_LIVE when the draft would undo a newer live change;
        // 409 DRAFT_CHANGED when the draft is not the one the caller checked (MCP publish)
        if (expectedDraftSha256 == null) {
            return ResponseEntity.ok(revisionService.publish(catalogueId, userDetails.getUserId(),
                    overrideStale, expectedLiveRevisionNo));
        }
        return ResponseEntity.ok(revisionService.publish(catalogueId, userDetails.getUserId(),
                overrideStale, expectedLiveRevisionNo, expectedDraftSha256));
    }

    @PostMapping("/revision/discard-draft")
    public ResponseEntity<Void> discardDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                             @RequestParam("catalogueId") String catalogueId) {
        requireCatalogueAccess(userDetails, catalogueId);
        revisionService.discardDraft(catalogueId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/revision/history")
    public ResponseEntity<List<RevisionResponse>> getRevisionHistory(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                     @RequestParam("catalogueId") String catalogueId) {
        requireCatalogueAccess(userDetails, catalogueId);
        return ResponseEntity.ok(revisionService.getHistory(catalogueId));
    }

    @GetMapping("/revision/get")
    public ResponseEntity<RevisionResponse> getRevision(@RequestAttribute("user") CustomUserDetails userDetails,
                                                        @RequestParam("revisionId") String revisionId) {
        requireCatalogueAccess(userDetails, revisionService.catalogueIdOf(revisionId));
        return ResponseEntity.ok(revisionService.getRevision(revisionId));
    }
}
