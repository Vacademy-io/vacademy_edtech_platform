package vacademy.io.assessment_service.features.question_paper_folder.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.assessment_service.features.question_paper_folder.dto.MoveQuestionPapersRequest;
import vacademy.io.assessment_service.features.question_paper_folder.dto.QuestionPaperFolderDto;
import vacademy.io.assessment_service.features.question_paper_folder.dto.QuestionPaperFolderLinkDto;
import vacademy.io.assessment_service.features.question_paper_folder.dto.QuestionPaperFolderRequest;
import vacademy.io.assessment_service.features.question_paper_folder.dto.ReorderQuestionPaperFoldersRequest;
import vacademy.io.assessment_service.features.question_paper_folder.entity.QuestionPaperFolder;
import vacademy.io.assessment_service.features.question_paper_folder.entity.QuestionPaperFolderMapping;
import vacademy.io.assessment_service.features.question_paper_folder.repository.QuestionPaperFolderMappingRepository;
import vacademy.io.assessment_service.features.question_paper_folder.repository.QuestionPaperFolderRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class QuestionPaperFolderServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String FOLDER = "f-1";

    @Mock
    private QuestionPaperFolderRepository folderRepository;
    @Mock
    private QuestionPaperFolderMappingRepository mappingRepository;
    @InjectMocks
    private QuestionPaperFolderService service;

    private QuestionPaperFolder folder(String id, int order) {
        return QuestionPaperFolder.builder().id(id).instituteId(INSTITUTE).name("Folder " + id)
                .displayOrder(order).status("ACTIVE").build();
    }

    @SuppressWarnings("unchecked")
    private List<QuestionPaperFolderMapping> savedMappings() {
        ArgumentCaptor<List<QuestionPaperFolderMapping>> captor = ArgumentCaptor.forClass(List.class);
        verify(mappingRepository).saveAll(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("create: trimmed name, next display order, ACTIVE, and the given papers moved in")
    void createPutsPapersInTheNewFolder() {
        when(folderRepository.findMaxDisplayOrder(INSTITUTE)).thenReturn(2);
        when(folderRepository.save(any())).thenAnswer(inv -> {
            QuestionPaperFolder f = inv.getArgument(0);
            f.setId(FOLDER);
            return f;
        });
        when(mappingRepository.findInstitutePaperIds(INSTITUTE, List.of("p1", "p2"))).thenReturn(List.of("p1", "p2"));

        QuestionPaperFolderRequest request = new QuestionPaperFolderRequest("  Class 10 Maths  ", " ", null,
                new ArrayList<>(List.of("p1", "p2", "p1", " ")));
        QuestionPaperFolderDto dto = service.create(null, INSTITUTE, request);

        assertEquals("Class 10 Maths", dto.getName());
        assertEquals(3, dto.getDisplayOrder());
        assertEquals("ACTIVE", dto.getStatus());
        assertEquals(2L, dto.getPaperCount());
        verify(mappingRepository).deleteByInstituteAndPaperIds(INSTITUTE, List.of("p1", "p2"));
        List<QuestionPaperFolderMapping> rows = savedMappings();
        assertEquals(List.of("p1", "p2"), rows.stream().map(QuestionPaperFolderMapping::getQuestionPaperId).toList());
        rows.forEach(r -> {
            assertEquals(FOLDER, r.getFolderId());
            assertEquals(INSTITUTE, r.getInstituteId());
        });
    }

    @Test
    @DisplayName("create: a blank name is refused before anything is saved")
    void createRefusesBlankName() {
        assertThrows(VacademyException.class,
                () -> service.create(null, INSTITUTE, new QuestionPaperFolderRequest("   ", null, null, List.of())));
        verify(folderRepository, never()).save(any());
    }

    @Test
    @DisplayName("move: only the institute's own papers are moved; another institute's paper is ignored")
    void moveIgnoresForeignPapers() {
        when(folderRepository.findByIdAndInstituteId(FOLDER, INSTITUTE)).thenReturn(Optional.of(folder(FOLDER, 0)));
        when(mappingRepository.findInstitutePaperIds(INSTITUTE, List.of("own", "foreign"))).thenReturn(List.of("own"));

        service.move(INSTITUTE, new MoveQuestionPapersRequest(FOLDER, List.of("own", "foreign")));

        verify(mappingRepository).deleteByInstituteAndPaperIds(INSTITUTE, List.of("own"));
        assertEquals(List.of("own"),
                savedMappings().stream().map(QuestionPaperFolderMapping::getQuestionPaperId).toList());
    }

    @Test
    @DisplayName("move: no paper of the institute at all is an error, nothing is written")
    void moveWithOnlyForeignPapersFails() {
        when(folderRepository.findByIdAndInstituteId(FOLDER, INSTITUTE)).thenReturn(Optional.of(folder(FOLDER, 0)));
        when(mappingRepository.findInstitutePaperIds(anyString(), anyList())).thenReturn(List.of());

        assertThrows(VacademyException.class,
                () -> service.move(INSTITUTE, new MoveQuestionPapersRequest(FOLDER, List.of("foreign"))));
        verify(mappingRepository, never()).saveAll(anyList());
        verify(mappingRepository, never()).deleteByInstituteAndPaperIds(anyString(), anyList());
    }

    @Test
    @DisplayName("move: a folder of another institute is not found")
    void moveToForeignFolderFails() {
        when(folderRepository.findByIdAndInstituteId("other", INSTITUTE)).thenReturn(Optional.empty());

        assertThrows(VacademyException.class,
                () -> service.move(INSTITUTE, new MoveQuestionPapersRequest("other", List.of("p1"))));
        verify(mappingRepository, never()).saveAll(anyList());
    }

    @Test
    @DisplayName("move with no folder: takes the papers out of their folder, never touching the folder rows")
    void moveToNoFolderRemovesMappings() {
        when(mappingRepository.findInstitutePaperIds(INSTITUTE, List.of("p1"))).thenReturn(List.of("p1"));

        assertEquals("Removed from folder", service.move(INSTITUTE, new MoveQuestionPapersRequest(null, List.of("p1"))));

        verify(mappingRepository).deleteByInstituteAndPaperIds(INSTITUTE, List.of("p1"));
        verify(mappingRepository, never()).saveAll(anyList());
        verify(folderRepository, never()).delete(any());
    }

    @Test
    @DisplayName("move: an empty selection is refused")
    void moveNeedsPapers() {
        assertThrows(VacademyException.class,
                () -> service.move(INSTITUTE, new MoveQuestionPapersRequest(FOLDER, List.of(" "))));
    }

    @Test
    @DisplayName("delete: removes the folder and its mappings only; papers are never deleted")
    void deleteKeepsPapers() {
        QuestionPaperFolder f = folder(FOLDER, 0);
        when(folderRepository.findByIdAndInstituteId(FOLDER, INSTITUTE)).thenReturn(Optional.of(f));

        service.delete(INSTITUTE, FOLDER);

        verify(mappingRepository).deleteByFolderId(FOLDER);
        verify(folderRepository).delete(f);
        verify(mappingRepository, never()).deleteByInstituteAndPaperIds(anyString(), anyList());
    }

    @Test
    @DisplayName("delete: a folder of another institute is not found and nothing is deleted")
    void deleteForeignFolderFails() {
        when(folderRepository.findByIdAndInstituteId(FOLDER, INSTITUTE)).thenReturn(Optional.empty());

        assertThrows(VacademyException.class, () -> service.delete(INSTITUTE, FOLDER));
        verify(mappingRepository, never()).deleteByFolderId(anyString());
        verify(folderRepository, never()).delete(any());
    }

    @Test
    @DisplayName("reorder: numbers the institute's folders 0..N in the given order, skipping unknown ids")
    @SuppressWarnings("unchecked")
    void reorderNumbersFolders() {
        QuestionPaperFolder a = folder("a", 0);
        QuestionPaperFolder b = folder("b", 1);
        when(folderRepository.findByInstituteIdAndIdIn(INSTITUTE, List.of("b", "x", "a"))).thenReturn(List.of(a, b));

        service.reorder(INSTITUTE, new ReorderQuestionPaperFoldersRequest(List.of("b", "x", "a")));

        ArgumentCaptor<List<QuestionPaperFolder>> captor = ArgumentCaptor.forClass(List.class);
        verify(folderRepository).saveAll(captor.capture());
        assertEquals(List.of("b", "a"), captor.getValue().stream().map(QuestionPaperFolder::getId).toList());
        assertEquals(0, b.getDisplayOrder());
        assertEquals(1, a.getDisplayOrder());
    }

    @Test
    @DisplayName("update: renames and clears an emptied description")
    void updateRenames() {
        QuestionPaperFolder f = folder(FOLDER, 0);
        f.setDescription("old");
        when(folderRepository.findByIdAndInstituteId(FOLDER, INSTITUTE)).thenReturn(Optional.of(f));
        when(folderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        QuestionPaperFolderDto dto = service.update(INSTITUTE, FOLDER,
                new QuestionPaperFolderRequest(" New name ", "", null, List.of()));

        assertEquals("New name", dto.getName());
        assertEquals(null, dto.getDescription());
    }

    @Test
    @DisplayName("list: maps the count column and keeps the query order")
    void listMapsRows() {
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[]{"a", "A", null, null, 0, "ACTIVE", null, 3L});
        rows.add(new Object[]{"b", "B", "desc", "img", 1, "ACTIVE", null, null});
        when(folderRepository.findAdminFolders(INSTITUTE)).thenReturn(rows);

        List<QuestionPaperFolderDto> folders = service.list(INSTITUTE);

        assertEquals(List.of("a", "b"), folders.stream().map(QuestionPaperFolderDto::getId).toList());
        assertEquals(3L, folders.get(0).getPaperCount());
        assertEquals(0L, folders.get(1).getPaperCount());
    }

    @Test
    @DisplayName("by-papers: no ids means no query")
    void foldersForNoPapers() {
        List<QuestionPaperFolderLinkDto> links = service.foldersForPapers(INSTITUTE, List.of());
        assertEquals(0, links.size());
        verify(mappingRepository, never()).findByInstituteIdAndQuestionPaperIdIn(anyString(), anyList());
    }
}
