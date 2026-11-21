package vacademy.io.assessment_service.features.assessment_folder.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.assessment_service.features.assessment_folder.dto.FolderTestOrderDto;
import vacademy.io.assessment_service.features.assessment_folder.dto.FolderTestOrderRequest;
import vacademy.io.assessment_service.features.assessment_folder.dto.MoveAssessmentsRequest;
import vacademy.io.assessment_service.features.assessment_folder.entity.AssessmentFolder;
import vacademy.io.assessment_service.features.assessment_folder.entity.AssessmentFolderMapping;
import vacademy.io.assessment_service.features.assessment_folder.repository.AssessmentFolderMappingRepository;
import vacademy.io.assessment_service.features.assessment_folder.repository.AssessmentFolderRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Test order inside a folder: display_order 0 for every test = by name (A to Z),
 * 1..N = arranged by an admin.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AssessmentFolderTestOrderTest {

    private static final String INSTITUTE = "inst-1";
    private static final String FOLDER = "f-1";

    @Mock
    private AssessmentFolderRepository folderRepository;
    @Mock
    private AssessmentFolderMappingRepository mappingRepository;
    @InjectMocks
    private AssessmentFolderService service;

    @BeforeEach
    void folderExists() {
        AssessmentFolder folder = AssessmentFolder.builder().id(FOLDER).instituteId(INSTITUTE).name("Chapter Tests")
                .displayOrder(0).status("ACTIVE").build();
        when(folderRepository.findByIdAndInstituteId(FOLDER, INSTITUTE)).thenReturn(Optional.of(folder));
    }

    private static Object[] row(String id, String name, String status, int order) {
        return new Object[]{id, name, status, order};
    }

    private static AssessmentFolderMapping mapping(String assessmentId, int order) {
        return AssessmentFolderMapping.builder().id("m-" + assessmentId).folderId(FOLDER)
                .assessmentId(assessmentId).instituteId(INSTITUTE).displayOrder(order).build();
    }

    private static FolderTestOrderRequest request(String mode, List<String> ids) {
        FolderTestOrderRequest r = new FolderTestOrderRequest();
        r.setFolderId(FOLDER);
        r.setMode(mode);
        r.setAssessmentIds(ids);
        return r;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Integer> savedOrders() {
        ArgumentCaptor<List<AssessmentFolderMapping>> captor = ArgumentCaptor.forClass(List.class);
        verify(mappingRepository).saveAll(captor.capture());
        return captor.getValue().stream()
                .collect(Collectors.toMap(AssessmentFolderMapping::getAssessmentId, AssessmentFolderMapping::getDisplayOrder));
    }

    @Test
    @DisplayName("all tests at 0 reads as NAME, any test above 0 reads as CUSTOM")
    void modeComesFromDisplayOrder() {
        List<Object[]> byName = new ArrayList<>();
        byName.add(row("a1", "Chapter Test 01A", "PUBLISHED", 0));
        byName.add(row("a2", "Chapter Test 02A", "DRAFT", 0));
        when(mappingRepository.findFolderTestsInOrder(FOLDER)).thenReturn(byName);
        FolderTestOrderDto dto = service.getTestOrder(INSTITUTE, FOLDER);
        assertEquals("NAME", dto.getMode());
        assertEquals(List.of("a1", "a2"), dto.getAssessments().stream().map(FolderTestOrderDto.Item::getAssessmentId).toList());

        List<Object[]> arranged = new ArrayList<>();
        arranged.add(row("a2", "Chapter Test 02A", "DRAFT", 1));
        arranged.add(row("a1", "Chapter Test 01A", "PUBLISHED", 2));
        when(mappingRepository.findFolderTestsInOrder(FOLDER)).thenReturn(arranged);
        assertEquals("CUSTOM", service.getTestOrder(INSTITUTE, FOLDER).getMode());
    }

    @Test
    @DisplayName("CUSTOM numbers the given tests 1..N, then the ones left out, then deleted ones")
    void customNumbersInGivenOrder() {
        List<Object[]> current = new ArrayList<>();
        current.add(row("a1", "Chapter Test 01A", "PUBLISHED", 0));
        current.add(row("a2", "Chapter Test 02A", "PUBLISHED", 0));
        current.add(row("a3", "Chapter Test 03A", "DRAFT", 0));
        when(mappingRepository.findFolderTestsInOrder(FOLDER)).thenReturn(current);
        when(mappingRepository.findByFolderId(FOLDER)).thenReturn(List.of(
                mapping("a1", 0), mapping("a2", 0), mapping("a3", 0), mapping("deleted", 0)));

        // a3 first, a1 second; a2 was left out; "other" is not in this folder and is ignored.
        service.saveTestOrder(INSTITUTE, request("custom", List.of("a3", "other", "a1")));

        assertEquals(Map.of("a3", 1, "a1", 2, "a2", 3, "deleted", 4), savedOrders());
    }

    @Test
    @DisplayName("NAME puts every test back at 0")
    void nameResets() {
        when(mappingRepository.findFolderTestsInOrder(FOLDER)).thenReturn(new ArrayList<>());
        FolderTestOrderDto dto = service.saveTestOrder(INSTITUTE, request("NAME", List.of()));
        verify(mappingRepository).resetDisplayOrder(FOLDER);
        verify(mappingRepository, never()).saveAll(anyList());
        assertEquals("NAME", dto.getMode());
    }

    @Test
    @DisplayName("an unknown mode or a foreign folder is refused")
    void refusesBadInput() {
        assertThrows(VacademyException.class, () -> service.saveTestOrder(INSTITUTE, request("RANDOM", List.of())));
        FolderTestOrderRequest foreign = request("NAME", List.of());
        foreign.setFolderId("someone-elses-folder");
        when(folderRepository.findByIdAndInstituteId("someone-elses-folder", INSTITUTE)).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.saveTestOrder(INSTITUTE, foreign));
        verify(mappingRepository, never()).resetDisplayOrder(FOLDER);
    }

    private static MoveAssessmentsRequest moveRequest(List<String> ids) {
        MoveAssessmentsRequest r = new MoveAssessmentsRequest();
        r.setFolderId(FOLDER);
        r.setAssessmentIds(ids);
        return r;
    }

    @Test
    @DisplayName("a test added to a folder in name order stays at 0")
    void addToNameFolderStaysAtZero() {
        when(mappingRepository.findInstituteAssessmentIds(INSTITUTE, List.of("n1", "n2"))).thenReturn(List.of("n1", "n2"));
        when(mappingRepository.findMaxDisplayOrder(FOLDER)).thenReturn(0);
        service.move(INSTITUTE, moveRequest(List.of("n1", "n2")));
        assertEquals(Map.of("n1", 0, "n2", 0), savedOrders());
    }

    @Test
    @DisplayName("a test added to an empty folder stays at 0 (name order)")
    void addToEmptyFolderStaysAtZero() {
        when(mappingRepository.findInstituteAssessmentIds(INSTITUTE, List.of("n1"))).thenReturn(List.of("n1"));
        when(mappingRepository.findMaxDisplayOrder(FOLDER)).thenReturn(-1);
        service.move(INSTITUTE, moveRequest(List.of("n1")));
        assertEquals(Map.of("n1", 0), savedOrders());
    }

    @Test
    @DisplayName("a test added to an arranged folder goes to the end")
    void addToCustomFolderGoesLast() {
        when(mappingRepository.findInstituteAssessmentIds(INSTITUTE, List.of("n1", "n2"))).thenReturn(List.of("n2", "n1"));
        when(mappingRepository.findMaxDisplayOrder(FOLDER)).thenReturn(5);
        service.move(INSTITUTE, moveRequest(List.of("n1", "n2")));
        assertEquals(Map.of("n1", 6, "n2", 7), savedOrders());
    }
}
