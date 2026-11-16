package vacademy.io.admin_core_service.features.learner_study_library.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.GetMapping;
import vacademy.io.admin_core_service.features.chapter.dto.ChapterDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicChapterOutlineDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicSlideOutlineDTO;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerOpenStudyLibraryService;
import vacademy.io.admin_core_service.features.slide.dto.DocumentSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.SlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.VideoSlideDTO;
import vacademy.io.admin_core_service.features.study_library.dto.ChapterDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.service.StudyLibraryService;

import java.lang.reflect.Method;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OpenLearnerStudyLibraryControllerTest {

    private static final String MARKER = "CONTENT-MARKER";

    private final ObjectMapper mapper = new ObjectMapper();
    private final LearnerOpenStudyLibraryService openService = mock(LearnerOpenStudyLibraryService.class);
    private final StudyLibraryService studyLibraryService = mock(StudyLibraryService.class);
    private OpenLearnerStudyLibraryController controller;

    @BeforeEach
    void setUp() {
        controller = new OpenLearnerStudyLibraryController();
        ReflectionTestUtils.setField(controller, "learnerStudyLibraryService", openService);
        ReflectionTestUtils.setField(controller, "studyLibraryService", studyLibraryService);
    }

    private static DocumentSlideDTO document() {
        DocumentSlideDTO document = new DocumentSlideDTO();
        document.setId("d1");
        document.setType("PDF");
        document.setData(MARKER + " data");
        document.setPublishedData(MARKER + " published");
        document.setTotalPages(3);
        return document;
    }

    private static VideoSlideDTO video() {
        VideoSlideDTO video = new VideoSlideDTO();
        video.setId("v1");
        video.setUrl("https://media.example/" + MARKER);
        video.setPublishedUrl("https://media.example/" + MARKER);
        video.setVideoLengthInMillis(1000L);
        return video;
    }

    @Test
    void slidesReturnsOutlineWithoutContent() throws Exception {
        LearnerSlidesDetailDTO doc = new LearnerSlidesDetailDTO();
        doc.setId("s1");
        doc.setTitle("Notes");
        doc.setSourceType("DOCUMENT");
        doc.setDescription(MARKER);
        doc.setDocumentSlide(document());
        LearnerSlidesDetailDTO vid = new LearnerSlidesDetailDTO();
        vid.setId("s2");
        vid.setTitle("Intro");
        vid.setSourceType("VIDEO");
        vid.setVideoSlide(video());
        when(openService.getLearnerSlides("c1")).thenReturn(List.of(doc, vid));

        ResponseEntity<List<PublicSlideOutlineDTO>> response = controller.getLearnerSlidesByChapterId("c1");
        String json = mapper.writeValueAsString(response.getBody());

        assertFalse(json.contains(MARKER), json);
        assertEquals(2, response.getBody().size());
        assertEquals("PDF", response.getBody().get(0).getDocumentSlide().getType());
        assertEquals(1000L, response.getBody().get(1).getVideoSlide().getVideoLengthInMillis());
    }

    @Test
    void chaptersWithSlidesReturnsOutlineWithoutContent() throws Exception {
        ChapterDTO chapter = new ChapterDTO();
        chapter.setId("c1");
        chapter.setChapterName("Basics");
        chapter.setDripConditionJson(MARKER);
        SlideDTO slide = new SlideDTO();
        slide.setId("s1");
        slide.setTitle("Notes");
        slide.setSourceType("DOCUMENT");
        slide.setStatus("PUBLISHED");
        slide.setDocumentSlide(document());
        ChapterDTOWithDetails details = new ChapterDTOWithDetails();
        details.setChapter(chapter);
        details.setSlides(List.of(slide));
        when(studyLibraryService.getChaptersWithSlides(org.mockito.ArgumentMatchers.eq("m1"),
                org.mockito.ArgumentMatchers.eq("ps1"), isNull())).thenReturn(List.of(details));

        ResponseEntity<List<PublicChapterOutlineDTO>> response = controller.getChaptersWithSlides("m1", "ps1");
        String json = mapper.writeValueAsString(response.getBody());

        assertFalse(json.contains(MARKER), json);
        assertEquals("Basics", response.getBody().get(0).getChapter().getChapterName());
        assertEquals(1, response.getBody().get(0).getSlides().size());
    }

    /** The open slide endpoints are typed to the outline DTOs, so content cannot be added by accident. */
    @Test
    void openSlideEndpointsAreTypedToOutlines() {
        assertEquals(PublicSlideOutlineDTO.class, listElementOf(OpenLearnerStudyLibraryController.class, "getLearnerSlidesByChapterId"));
        assertEquals(PublicChapterOutlineDTO.class, listElementOf(OpenLearnerStudyLibraryController.class, "getChaptersWithSlides"));
    }

    /** The signed-in learner endpoints keep the full slide DTO. */
    @Test
    void learnerSlideEndpointIsUnchanged() {
        assertEquals(LearnerSlidesDetailDTO.class, listElementOf(LearnerStudyLibraryController.class, "getLearnerSlidesByChapterId"));
    }

    private static Type listElementOf(Class<?> controller, String methodName) {
        Method method = Arrays.stream(controller.getDeclaredMethods())
                .filter(m -> m.getName().equals(methodName) && m.isAnnotationPresent(GetMapping.class))
                .findFirst().orElseThrow();
        Type response = method.getGenericReturnType();
        assertTrue(response instanceof ParameterizedType);
        Type list = ((ParameterizedType) response).getActualTypeArguments()[0];
        assertTrue(list instanceof ParameterizedType);
        return ((ParameterizedType) list).getActualTypeArguments()[0];
    }
}
