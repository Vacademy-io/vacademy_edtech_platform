package vacademy.io.assessment_service.features.question_library.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAccessRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryDifficultyRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagRequest;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.assessment_service.features.tags.entities.repository.TagCommunityRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Who is given what, tags and bulk difficulty: the owner's curation tools. */
class QuestionLibraryCurationServiceTest {

    private static final String OWNER = "owner-inst";
    private static final String CLIENT = "client-inst";

    private QuestionLibraryNodeRepository repository;
    private TagCommunityRepository tags;
    private AdminCoreServiceClient adminCore;
    private QuestionLibraryCurationService service;

    @BeforeEach
    void setUp() {
        QuestionLibraryAccess access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        repository = mock(QuestionLibraryNodeRepository.class);
        when(repository.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(OWNER, "ACTIVE")).thenReturn(List.of(
                QuestionLibraryTestScopes.node("upsc", null),
                QuestionLibraryTestScopes.node("polity", "upsc"),
                QuestionLibraryTestScopes.node("ssc", null)));
        when(repository.findByIdAndInstituteIdAndStatus("upsc", OWNER, "ACTIVE"))
                .thenReturn(Optional.of(QuestionLibraryTestScopes.node("upsc", null)));
        when(repository.findGrantedNodeIds(OWNER, CLIENT)).thenReturn(List.of("upsc"));
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", repository);
        tags = mock(TagCommunityRepository.class);
        adminCore = mock(AdminCoreServiceClient.class);
        service = new QuestionLibraryCurationService();
        ReflectionTestUtils.setField(service, "nodeRepository", repository);
        ReflectionTestUtils.setField(service, "treeResolver", resolver);
        ReflectionTestUtils.setField(service, "scope", QuestionLibraryTestScopes.scope(access, repository));
        ReflectionTestUtils.setField(service, "tagRepository", tags);
        ReflectionTestUtils.setField(service, "adminCoreServiceClient", adminCore);
    }

    private static LibraryAccessRequest give(String nodeId, String instituteId) {
        return LibraryAccessRequest.builder().nodeId(nodeId).instituteId(instituteId).build();
    }

    @Test
    void grantingStoresTheInstituteNameFromAdminCore() {
        when(adminCore.getInstituteName(CLIENT)).thenReturn(" Sharma IAS Academy ");

        assertThat(service.grant(null, OWNER, give("upsc", " client-inst ")).getInstituteName())
                .isEqualTo("Sharma IAS Academy");
        verify(repository).grantAccess("upsc", CLIENT, "Sharma IAS Academy", null);
    }

    @Test
    void anUnknownInstituteIdIsRefused() {
        assertThatThrownBy(() -> service.grant(null, OWNER, give("upsc", "typo-id")))
                .isInstanceOf(VacademyException.class).hasMessageContaining("No institute");
        verify(repository, never()).grantAccess(any(), any(), any(), any());
    }

    @Test
    void theOwnerCannotBeGivenItsOwnLibrary() {
        assertThatThrownBy(() -> service.grant(null, OWNER, give("upsc", OWNER)))
                .isInstanceOf(VacademyException.class);
        verifyNoInteractions(adminCore);
    }

    @Test
    void aTopicOutsideTheLibraryCannotBeGiven() {
        when(repository.findByIdAndInstituteIdAndStatus("elsewhere", OWNER, "ACTIVE")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.grant(null, OWNER, give("elsewhere", CLIENT)))
                .isInstanceOf(VacademyException.class).hasMessageContaining("Topic not found");
    }

    @Test
    void aNewTagIsCreatedOnceAndAnExistingOneIsReused() {
        when(repository.findTagIdByName(OWNER, "Article 21")).thenReturn(null);
        when(tags.insertTagIfNotExists(anyString(), eq("Article 21"), eq(OWNER))).thenReturn("tag-new");
        when(repository.findTagIdByName(OWNER, "PYQ 2023")).thenReturn("tag-old");

        service.addTag(OWNER, LibraryTagRequest.builder().kind("concept").name("  Article   21 ").questionIds(List.of("q1")).build());
        service.addTag(OWNER, LibraryTagRequest.builder().kind("PYQ").name("PYQ 2023").questionIds(List.of("q1", "q2")).build());

        verify(repository).addLibraryTag(OWNER, "q1", "tag-new", "CONCEPT");
        verify(repository).addLibraryTag(OWNER, "q1,q2", "tag-old", "PYQ");
        verify(tags, times(1)).insertTagIfNotExists(anyString(), anyString(), anyString());
    }

    @Test
    void onlyTheThreeLibraryKindsAreAccepted() {
        assertThatThrownBy(() -> service.addTag(OWNER,
                LibraryTagRequest.builder().kind("SUBJECT").name("x").questionIds(List.of("q1")).build()))
                .isInstanceOf(VacademyException.class);
        verify(repository, never()).addLibraryTag(any(), any(), any(), any());
    }

    @Test
    void difficultyMustBeOneOfTheThreeLevels() {
        assertThatThrownBy(() -> service.setDifficulty(OWNER,
                LibraryDifficultyRequest.builder().difficulty("VERY_HARD").questionIds(List.of("q1")).build()))
                .isInstanceOf(VacademyException.class);

        service.setDifficulty(OWNER, LibraryDifficultyRequest.builder().difficulty("hard").questionIds(List.of("q1")).build());
        verify(repository).setDifficulty(OWNER, "q1", "HARD");
    }

    @Test
    void aReaderSeesTagsOnlyFromTheTopicsItWasGiven() {
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[]{"tag-1", "Article 21", "CONCEPT", 4L});
        when(repository.findLibraryTagsWithCounts(OWNER, "1", "upsc,polity")).thenReturn(rows);

        List<LibraryTagDto> list = service.listTags(CLIENT, null);

        assertThat(list).extracting(LibraryTagDto::getTagName).containsExactly("Article 21");
        assertThat(service.listTags(CLIENT, "ssc")).isEmpty();
        assertThat(service.listTags("stranger-inst", null)).isEmpty();
    }

    @Test
    void theOwnersTagListAlsoCoversUnfiledQuestions() {
        service.listTags(OWNER, null);

        verify(repository).findLibraryTagsWithCounts(OWNER, null, null);
    }
}
