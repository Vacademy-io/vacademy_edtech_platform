package vacademy.io.assessment_service.features.learner_assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentAssessmentFilter;

import java.util.ArrayList;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Only a folder's list uses the folder-ordered query; every other learner list (tabs,
 * dashboard, "Others") keeps the original query with the same arguments as before.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerAssessmentFolderRoutingTest {

    @Mock
    private AssessmentRepository assessmentRepository;
    @InjectMocks
    private LearnerAssessmentGetManager manager;

    private final Page<Object[]> empty = new PageImpl<>(new ArrayList<>());

    @BeforeEach
    void emptyPages() {
        when(assessmentRepository.studentAssessments(any(), any(), anyList(), anyList(), any(), any(), any(), anyList(),
                anyList(), anyBoolean(), anyList(), anyList(), any(), any(), any())).thenReturn(empty);
        when(assessmentRepository.studentAssessmentsInFolder(any(), any(), anyList(), anyList(), any(), any(), any(),
                anyList(), anyList(), anyBoolean(), anyList(), anyList(), any(), any(), any())).thenReturn(empty);
    }

    private static StudentAssessmentFilter filter(String folderId, Boolean unfiledOnly) {
        StudentAssessmentFilter f = new StudentAssessmentFilter();
        f.setBatchIds(List.of("b-1"));
        f.setUserIds(List.of("u-1"));
        f.setInstituteIds(List.of("inst-1"));
        f.setAssessmentTypes(List.of("ASSESSMENT"));
        f.setFolderId(folderId);
        f.setUnfiledOnly(unfiledOnly);
        return f;
    }

    @Test
    @DisplayName("a folder id uses the folder-ordered query")
    void folderUsesOrderedQuery() {
        manager.assessmentListFilter(null, filter("f-1", null), "inst-1", 0, 5);
        verify(assessmentRepository).studentAssessmentsInFolder(any(), eq(true), eq(List.of("b-1")), anyList(), any(), any(),
                any(), anyList(), eq(List.of("inst-1")), eq(true), eq(List.of("u-1")), eq(List.of("ASSESSMENT")),
                eq("f-1"), isNull(), any());
        verify(assessmentRepository, never()).studentAssessments(any(), any(), anyList(), anyList(), any(), any(), any(),
                anyList(), anyList(), anyBoolean(), anyList(), anyList(), any(), any(), any());
    }

    @Test
    @DisplayName("no folder, a blank folder id, or Others keep the original query")
    void otherListsKeepOriginalQuery() {
        manager.assessmentListFilter(null, filter(null, null), "inst-1", 0, 5);
        manager.assessmentListFilter(null, filter("  ", null), "inst-1", 0, 5);
        verify(assessmentRepository, org.mockito.Mockito.times(2)).studentAssessments(any(), eq(true), eq(List.of("b-1")),
                anyList(), any(), any(), any(), anyList(), eq(List.of("inst-1")), eq(true), eq(List.of("u-1")),
                eq(List.of("ASSESSMENT")), isNull(), isNull(), any());

        manager.assessmentListFilter(null, filter(null, true), "inst-1", 0, 5);
        verify(assessmentRepository).studentAssessments(any(), eq(true), eq(List.of("b-1")), anyList(), any(), any(),
                any(), anyList(), eq(List.of("inst-1")), eq(true), eq(List.of("u-1")), eq(List.of("ASSESSMENT")),
                isNull(), eq(true), any());
        verify(assessmentRepository, never()).studentAssessmentsInFolder(any(), any(), anyList(), anyList(), any(), any(),
                any(), anyList(), anyList(), anyBoolean(), anyList(), anyList(), any(), any(), any());
    }
}
