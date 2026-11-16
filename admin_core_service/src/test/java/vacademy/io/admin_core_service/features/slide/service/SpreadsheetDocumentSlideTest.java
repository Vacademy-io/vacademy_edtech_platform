package vacademy.io.admin_core_service.features.slide.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.slide.dto.DocumentSlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.DocumentSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.DocumentSlideRepository;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spreadsheet (Excel) slides are DOCUMENT slides with type SPREADSHEET whose
 * data / published_data hold the grid JSON written by the admin app. They rely
 * on the generic document paths, so these tests pin that those paths carry the
 * type and the JSON through unchanged.
 */
@ExtendWith(MockitoExtension.class)
class SpreadsheetDocumentSlideTest {

    private static final String SHEET_JSON = """
            {"version":1,"sheet":{"sheets":[{"name":"TB","cells":{"A1":{"v":"Cash"},\
            "B1":{"v":1200,"f":"=SUM(B2:B3)","s":{"nf":"#,##0"}}},"merges":["A1:C1"]},\
            {"name":"Notes","cells":{"A1":{"v":"a < b"}}}]},\
            "file_id":"file-123","file_name":"TB 2026.xlsx","file_size":4096,"allow_download":true}""";

    @Mock
    private DocumentSlideRepository documentSlideRepository;

    @InjectMocks
    private SlideService slideService;

    @Test
    @DisplayName("Copying a published spreadsheet slide keeps its type and grid JSON")
    void copyKeepsTypeAndJson() {
        DocumentSlide source = new DocumentSlide();
        source.setId("src-doc");
        source.setType("SPREADSHEET");
        source.setTitle("TB 2026");
        // A published slide may have its draft column empty: the copy must fall back.
        source.setData(null);
        source.setPublishedData(SHEET_JSON);
        source.setTotalPages(1);
        when(documentSlideRepository.findById("src-doc")).thenReturn(Optional.of(source));
        when(documentSlideRepository.save(any(DocumentSlide.class))).thenAnswer(inv -> inv.getArgument(0));

        Slide slide = new Slide();
        slide.setSourceType("DOCUMENT");
        slide.setSourceId("src-doc");
        String newId = slideService.copySlideSourceForSlide(slide);

        ArgumentCaptor<DocumentSlide> saved = ArgumentCaptor.forClass(DocumentSlide.class);
        verify(documentSlideRepository).save(saved.capture());
        DocumentSlide copy = saved.getValue();
        assertThat(newId).isEqualTo(copy.getId()).isNotEqualTo("src-doc");
        assertThat(copy.getType()).isEqualTo("SPREADSHEET");
        assertThat(copy.getData()).isEqualTo(SHEET_JSON);
        assertThat(copy.getPublishedData()).isEqualTo(SHEET_JSON);
        assertThat(copy.getTitle()).isEqualTo("TB 2026");
    }

    @Test
    @DisplayName("Publishing stores the spreadsheet JSON in both data and published_data")
    void publishStoresJson() {
        DocumentSlide stored = new DocumentSlide();
        stored.setType("SPREADSHEET");
        stored.setData(SHEET_JSON);

        DocumentSlideDTO dto = new DocumentSlideDTO();
        dto.setType("SPREADSHEET");
        dto.setData(SHEET_JSON);
        dto.setPublishedData(SHEET_JSON);
        dto.setPublishedDocumentTotalPages(1);

        slideService.handlePublishedDocumentSlide(stored, dto);

        assertThat(stored.getPublishedData()).isEqualTo(SHEET_JSON);
        assertThat(stored.getData()).isEqualTo(SHEET_JSON);
    }

    @Test
    @DisplayName("Replacing one workbook with another is not mistaken for lost document blocks")
    void replacingWorkbookIsNotStructuralLoss() {
        String replacement = SHEET_JSON.replace("TB 2026.xlsx", "TB 2027.xlsx").replace("1200", "1500");
        assertThat(SlideService.describeStructuralLoss(SHEET_JSON, replacement)).isEmpty();
    }
}
