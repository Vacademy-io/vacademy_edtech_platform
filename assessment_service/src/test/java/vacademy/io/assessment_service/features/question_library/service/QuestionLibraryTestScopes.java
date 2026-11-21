package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;

/** A real QuestionLibraryScope over the given repository, for tests that wire services by hand. */
final class QuestionLibraryTestScopes {

    private QuestionLibraryTestScopes() {
    }

    static QuestionLibraryScope scope(QuestionLibraryAccess access, QuestionLibraryNodeRepository repository) {
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", repository);
        QuestionLibraryScope scope = new QuestionLibraryScope();
        ReflectionTestUtils.setField(scope, "access", access);
        ReflectionTestUtils.setField(scope, "treeResolver", resolver);
        ReflectionTestUtils.setField(scope, "nodeRepository", repository);
        return scope;
    }

    static QuestionLibraryNode node(String id, String parentId) {
        return QuestionLibraryNode.builder()
                .id(id).name(id).parentId(parentId).instituteId("owner-inst").status("ACTIVE").displayOrder(0)
                .build();
    }
}
