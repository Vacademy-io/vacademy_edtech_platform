package vacademy.io.assessment_service.features.question_bank.manager;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionPaperFilter;
import vacademy.io.assessment_service.features.question_bank.repository.QuestionPaperRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The paper list keeps its original query unless the Question Papers page asks for a
 * folder (folder_id) or for the papers in no folder (unfiled_only).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GetQuestionPaperManagerFolderRoutingTest {

    private static final String INSTITUTE = "inst-1";

    @Mock
    private QuestionPaperRepository questionPaperRepository;
    @InjectMocks
    private GetQuestionPaperManager manager;

    private QuestionPaperFilter filter() {
        QuestionPaperFilter f = new QuestionPaperFilter();
        f.setStatuses(new ArrayList<>(List.of("ACTIVE", "FAVOURITE")));
        f.setTagIds(new ArrayList<>(List.of("t1", "t2")));
        f.setSortColumns(Map.of("createdOn", "DESC"));
        return f;
    }

    private void stubBoth() {
        when(questionPaperRepository.findQuestionPapersByFilters(any(), anyList(), anyList(), anyList(), any(), anyList(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));
        when(questionPaperRepository.findQuestionPapersByFiltersInFolder(any(), anyList(), anyList(), anyList(), anyString(), any(), any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));
    }

    @Test
    @DisplayName("no folder fields: the original query, called exactly as before")
    void noFolderUsesOriginalQuery() {
        stubBoth();
        manager.getQuestionPapers(null, filter(), INSTITUTE, 0, 10);

        verify(questionPaperRepository).findQuestionPapersByFilters(isNull(), eq(List.of("ACTIVE", "FAVOURITE")),
                eq(List.of()), eq(List.of()), isNull(), eq(List.of(INSTITUTE)), eq("t1,t2"), any(Pageable.class));
        verify(questionPaperRepository, never()).findQuestionPapersByFiltersInFolder(any(), anyList(), anyList(), anyList(), anyString(), any(), any(), any(), any(Pageable.class));
    }

    @Test
    @DisplayName("blank folder id and unfiled_only=false: still the original query")
    void blankFolderUsesOriginalQuery() {
        stubBoth();
        QuestionPaperFilter f = filter();
        f.setFolderId("   ");
        f.setUnfiledOnly(false);
        manager.getQuestionPapers(null, f, INSTITUTE, 0, 10);

        verify(questionPaperRepository).findQuestionPapersByFilters(any(), anyList(), anyList(), anyList(), any(), anyList(), any(), any(Pageable.class));
        verify(questionPaperRepository, never()).findQuestionPapersByFiltersInFolder(any(), anyList(), anyList(), anyList(), anyString(), any(), any(), any(), any(Pageable.class));
    }

    @Test
    @DisplayName("folder_id: the folder query, scoped to that folder and the institute")
    void folderUsesFolderQuery() {
        stubBoth();
        QuestionPaperFilter f = filter();
        f.setFolderId(" folder-1 ");
        f.setUnfiledOnly(true);
        manager.getQuestionPapers(null, f, INSTITUTE, 0, 10);

        verify(questionPaperRepository).findQuestionPapersByFiltersInFolder(isNull(), eq(List.of("ACTIVE", "FAVOURITE")),
                eq(List.of()), eq(List.of()), eq(INSTITUTE), eq("t1,t2"), eq("folder-1"), isNull(), any(Pageable.class));
        verify(questionPaperRepository, never()).findQuestionPapersByFilters(any(), anyList(), anyList(), anyList(), any(), anyList(), any(), any(Pageable.class));
    }

    @Test
    @DisplayName("unfiled_only: the folder query with the unfiled flag and no folder id")
    void unfiledUsesFolderQuery() {
        stubBoth();
        QuestionPaperFilter f = filter();
        f.setUnfiledOnly(true);
        manager.getQuestionPapers(null, f, INSTITUTE, 0, 10);

        verify(questionPaperRepository).findQuestionPapersByFiltersInFolder(isNull(), anyList(), anyList(), anyList(),
                eq(INSTITUTE), eq("t1,t2"), isNull(), eq("Y"), any(Pageable.class));
        verify(questionPaperRepository, never()).findQuestionPapersByFilters(any(), anyList(), anyList(), anyList(), any(), anyList(), any(), any(Pageable.class));
    }
}
