package vacademy.io.assessment_service.features.question_library.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAccessRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryInstituteAccessDto;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** The platform portal acts on the owner's behalf, per institute. */
class QuestionLibrarySuperAdminServiceTest {

    private static final String OWNER = "owner-inst";
    private static final String CLIENT = "client-inst";

    private QuestionLibraryAccess access;
    private QuestionLibraryNodeRepository repository;
    private QuestionLibraryService library;
    private QuestionLibraryCurationService curation;
    private QuestionLibrarySuperAdminService service;

    @BeforeEach
    void setUp() {
        access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        repository = mock(QuestionLibraryNodeRepository.class);
        library = mock(QuestionLibraryService.class);
        curation = mock(QuestionLibraryCurationService.class);
        service = new QuestionLibrarySuperAdminService();
        ReflectionTestUtils.setField(service, "access", access);
        ReflectionTestUtils.setField(service, "nodeRepository", repository);
        ReflectionTestUtils.setField(service, "libraryService", library);
        ReflectionTestUtils.setField(service, "curationService", curation);
    }

    @Test
    void treeIsTheOwnersWholeTree() {
        service.tree();
        verify(library).getTree(OWNER);
    }

    @Test
    void accessOfAClientListsWhatItWasGiven() {
        when(repository.findGrantedNodeIds(OWNER, CLIENT)).thenReturn(List.of("upsc"));
        LibraryInstituteAccessDto dto = service.accessOf(" " + CLIENT + " ");
        assertThat(dto.isLibraryConfigured()).isTrue();
        assertThat(dto.isOwner()).isFalse();
        assertThat(dto.getGrantedNodeIds()).containsExactly("upsc");
    }

    @Test
    void theOwnerIsReportedAsOwnerWithoutGrants() {
        LibraryInstituteAccessDto dto = service.accessOf(OWNER);
        assertThat(dto.isOwner()).isTrue();
        assertThat(dto.getGrantedNodeIds()).isEmpty();
        verifyNoInteractions(repository);
    }

    @Test
    void noOwnerConfiguredMeansNoLibrary() {
        ReflectionTestUtils.setField(access, "ownerInstituteId", "");
        assertThat(service.accessOf(CLIENT).isLibraryConfigured()).isFalse();
        assertThatThrownBy(() -> service.tree()).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.grant(null, CLIENT, "upsc")).isInstanceOf(VacademyException.class);
        verifyNoInteractions(curation);
    }

    @Test
    void grantAndRevokeGoThroughTheOwnersCurationCode() {
        service.grant(null, CLIENT, " upsc ");
        service.revoke(CLIENT, "upsc");
        LibraryAccessRequest expected = LibraryAccessRequest.builder().instituteId(CLIENT).nodeId("upsc").build();
        verify(curation).grant(any(), eq(OWNER), eq(expected));
        verify(curation).revoke(OWNER, expected);
    }

    @Test
    void aBlankInstituteIsRefused() {
        assertThatThrownBy(() -> service.grant(null, " ", "upsc")).isInstanceOf(VacademyException.class);
        verifyNoInteractions(curation);
    }
}
