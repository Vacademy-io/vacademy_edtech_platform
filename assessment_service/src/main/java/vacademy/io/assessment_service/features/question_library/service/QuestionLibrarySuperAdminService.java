package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAccessDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAccessRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryActionResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryInstituteAccessDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTreeResponse;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * The platform portal's view of the Content Library, institute by institute: the owner's
 * whole tree, which topics one institute was given, and giving or taking one back. It
 * acts on the owner's behalf, so it goes through the same curation code as the owner's
 * own Institutes dialog. The controller checks the caller is platform staff.
 */
@Service
public class QuestionLibrarySuperAdminService {

    @Autowired
    private QuestionLibraryAccess access;

    @Autowired
    private QuestionLibraryService libraryService;

    @Autowired
    private QuestionLibraryCurationService curationService;

    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    /** Every topic of the library with its question and institute counts. */
    public LibraryTreeResponse tree() {
        return libraryService.getTree(requireOwner());
    }

    public LibraryInstituteAccessDto accessOf(String instituteId) {
        String owner = access.ownerInstituteId();
        String target = clean(instituteId);
        if (owner == null) {
            return LibraryInstituteAccessDto.builder().libraryConfigured(false).grantedNodeIds(List.of()).build();
        }
        if (owner.equals(target)) {
            return LibraryInstituteAccessDto.builder().libraryConfigured(true).owner(true).grantedNodeIds(List.of()).build();
        }
        return LibraryInstituteAccessDto.builder()
                .libraryConfigured(true)
                .owner(false)
                .grantedNodeIds(nodeRepository.findGrantedNodeIds(owner, target))
                .build();
    }

    public LibraryAccessDto grant(CustomUserDetails user, String instituteId, String nodeId) {
        return curationService.grant(user, requireOwner(), request(instituteId, nodeId));
    }

    public LibraryActionResponse revoke(String instituteId, String nodeId) {
        return curationService.revoke(requireOwner(), request(instituteId, nodeId));
    }

    private String requireOwner() {
        String owner = access.ownerInstituteId();
        if (owner == null) throw new VacademyException("The Content Library is not set up");
        return owner;
    }

    private static LibraryAccessRequest request(String instituteId, String nodeId) {
        String target = clean(instituteId);
        if (target == null) throw new VacademyException("Institute ID is required");
        return LibraryAccessRequest.builder().instituteId(target).nodeId(clean(nodeId)).build();
    }

    private static String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
