package vacademy.io.assessment_service.features.question_library.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_library.dto.AssignLibraryQuestionsRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryNodeRequest;
import vacademy.io.assessment_service.features.question_library.dto.MoveLibraryNodeRequest;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class QuestionLibraryServiceTest {

    private static final String INSTITUTE = "inst-1";

    // physics > mechanics > laws > friction > static friction (5 levels, the limit), chemistry (1 level)
    private static final List<QuestionLibraryNode> TREE = List.of(
            node("physics", null, "Physics"),
            node("mechanics", "physics", "Mechanics"),
            node("laws", "mechanics", "Laws of motion"),
            node("friction", "laws", "Friction"),
            node("static", "friction", "Static friction"),
            node("chemistry", null, "Chemistry"));

    private QuestionLibraryNodeRepository repository;
    private QuestionLibraryService service;

    private static QuestionLibraryNode node(String id, String parentId, String name) {
        return QuestionLibraryNode.builder().id(id).parentId(parentId).name(name)
                .instituteId(INSTITUTE).status("ACTIVE").displayOrder(0).build();
    }

    @BeforeEach
    void setUp() {
        repository = mock(QuestionLibraryNodeRepository.class);
        when(repository.findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(INSTITUTE, "ACTIVE")).thenReturn(TREE);
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", repository);
        service = new QuestionLibraryService();
        ReflectionTestUtils.setField(service, "nodeRepository", repository);
        ReflectionTestUtils.setField(service, "treeResolver", resolver);
    }

    @Test
    void depthHeightAndSubtree() {
        Map<String, QuestionLibraryNode> byId = TREE.stream().collect(Collectors.toMap(QuestionLibraryNode::getId, n -> n));
        var children = QuestionLibraryTreeResolver.childrenByParent(TREE);

        assertThat(QuestionLibraryTreeResolver.depthOf("physics", byId)).isEqualTo(1);
        assertThat(QuestionLibraryTreeResolver.depthOf("friction", byId)).isEqualTo(4);
        assertThat(QuestionLibraryTreeResolver.depthOf("static", byId)).isEqualTo(5);
        assertThat(QuestionLibraryTreeResolver.heightOf("physics", children)).isEqualTo(5);
        assertThat(QuestionLibraryTreeResolver.heightOf("chemistry", children)).isEqualTo(1);
        assertThat(QuestionLibraryTreeResolver.subtreeIds(children, List.of("mechanics")))
                .containsExactlyInAnyOrder("mechanics", "laws", "friction", "static");
    }

    @Test
    void cannotCreateBelowTheFifthLevel() {
        LibraryNodeRequest request = LibraryNodeRequest.builder().name("Rolling").parentId("static").build();

        assertThatThrownBy(() -> service.createNode(null, INSTITUTE, request))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("levels deep");
        verify(repository, never()).save(any());
    }

    @Test
    void siblingNamesAreUniqueIgnoringCase() {
        LibraryNodeRequest request = LibraryNodeRequest.builder().name("  physics ").build();

        assertThatThrownBy(() -> service.createNode(null, INSTITUTE, request))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("already exists");
    }

    @Test
    void cannotMoveATopicInsideItself() {
        MoveLibraryNodeRequest request = MoveLibraryNodeRequest.builder().nodeId("mechanics").parentId("friction").build();

        assertThatThrownBy(() -> service.moveNode(INSTITUTE, request))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("inside itself");
    }

    @Test
    void moveThatWouldExceedTheDepthLimitIsRefused() {
        // physics subtree is 5 levels tall, so it cannot go under chemistry.
        MoveLibraryNodeRequest request = MoveLibraryNodeRequest.builder().nodeId("physics").parentId("chemistry").build();

        assertThatThrownBy(() -> service.moveNode(INSTITUTE, request))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("levels deep");
    }

    @Test
    void moveModeTakesQuestionsOffTheSourceTopicFirst() {
        when(repository.findByInstituteIdAndStatusAndIdIn(INSTITUTE, "ACTIVE", List.of("chemistry")))
                .thenReturn(List.of(TREE.get(5)));
        when(repository.addQuestionsToNode(INSTITUTE, "chemistry", "q1,q2")).thenReturn(2);
        AssignLibraryQuestionsRequest request = AssignLibraryQuestionsRequest.builder()
                .questionIds(List.of("q1", "q2", "q1", " ", "bad,id"))
                .nodeIds(List.of("chemistry"))
                .mode("MOVE")
                .fromNodeId("physics")
                .build();

        var response = service.assignQuestions(INSTITUTE, request);

        assertThat(response.getAffected()).isEqualTo(2);
        var order = inOrder(repository);
        order.verify(repository).removeQuestionsFromNodes(INSTITUTE, "q1,q2", "physics");
        order.verify(repository).addQuestionsToNode(INSTITUTE, "chemistry", "q1,q2");
    }

    @Test
    void assignToAForeignTopicIsRefused() {
        when(repository.findByInstituteIdAndStatusAndIdIn(eq(INSTITUTE), eq("ACTIVE"), anyList())).thenReturn(List.of());
        AssignLibraryQuestionsRequest request = AssignLibraryQuestionsRequest.builder()
                .questionIds(List.of("q1")).nodeIds(List.of("other-institute-topic")).build();

        assertThatThrownBy(() -> service.assignQuestions(INSTITUTE, request)).isInstanceOf(VacademyException.class);
        verify(repository, never()).addQuestionsToNode(any(), any(), any());
    }

    @Test
    void tagNamesBecomeReadableTopicNames() {
        assertThat(QuestionLibraryService.displayName("  organic   chemistry ")).isEqualTo("Organic chemistry");
        assertThat(QuestionLibraryService.displayName("")).isEmpty();
    }
}
