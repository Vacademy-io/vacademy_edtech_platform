package vacademy.io.admin_core_service.features.course_catalogue.manager;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueRequest;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueResponse;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CreateCatalogueRequest;
import vacademy.io.admin_core_service.features.course_catalogue.service.CourseCatalogueService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

@Component
public class CourseCatalogueManager {

    @Autowired
    private CourseCatalogueService service;

    @Autowired
    private InstituteRepository instituteRepository;

    public ResponseEntity<List<CourseCatalogueResponse>> createCataloguesForInstitute(CustomUserDetails userDetails, CreateCatalogueRequest request, String instituteId) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if(institute.isEmpty()) throw new VacademyException(HttpStatus.NOT_FOUND, "Institute Not Found");

        return ResponseEntity.ok(service.createCatalogues(request.getCatalogues(), instituteId, institute.get()));
    }

    public ResponseEntity<CourseCatalogueResponse> updateCatalogue(CustomUserDetails userDetails, String catalogueId, CourseCatalogueRequest request) {
        return ResponseEntity.ok(service.updateCatalogue(catalogueId, request, userDetails != null ? userDetails.getUserId() : null));
    }

    public ResponseEntity<List<CourseCatalogueResponse>> getAllCatalogues(CustomUserDetails userDetails, String instituteId) {
        return ResponseEntity.ok(service.getAllCataloguesByInstitute(instituteId));
    }

    public ResponseEntity<List<CourseCatalogueResponse>> getAllCataloguesForSourceAndSourceId(CustomUserDetails userDetails, String instituteId, String source, String sourceId) {
        return ResponseEntity.ok(service.getCataloguesForInstituteAndSourceAndSourceId(instituteId,source,sourceId));
    }

    public ResponseEntity<CourseCatalogueResponse>getDefaultCatalogueForInstitute(CustomUserDetails userDetails, String instituteId) {
        return ResponseEntity.ok(service.getDefaultCatalogueForInstituteId(instituteId));
    }

    public ResponseEntity<CourseCatalogueResponse> getCatalogueByTag(CustomUserDetails userDetails, String instituteId, String tagName) {
        return ResponseEntity.ok(service.getCatalogueByInstituteAndTagForEditor(instituteId, tagName));
    }

    // Public method without authentication
    public ResponseEntity<CourseCatalogueResponse> getCatalogueByTagPublic(String instituteId, String tagName) {
        return ResponseEntity.ok(service.getCatalogueByInstituteAndTag(instituteId, tagName));
    }
}
