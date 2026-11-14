package vacademy.io.admin_core_service.features.packages.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.course.dto.CourseDTO;
import vacademy.io.admin_core_service.features.packages.entity.PackagePageContent;
import vacademy.io.admin_core_service.features.packages.repository.PackagePageContentRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class PackagePageContentServiceTest {

    private static final String CONTENT =
            "{\"v\":1,\"mode\":\"SELF_PACED\",\"faqs\":[{\"q\":\"How long?\",\"a\":\"<p>6 weeks</p>\"}]}";

    private PackagePageContentRepository repository;
    private PackagePageContentService service;

    @BeforeEach
    void setUp() {
        repository = mock(PackagePageContentRepository.class);
        service = new PackagePageContentService(repository);
    }

    private static HttpStatus statusOf(Runnable r) {
        VacademyException e = assertThrows(VacademyException.class, r::run);
        return e.getStatus();
    }

    // ---------------- validation ----------------

    @Test
    @DisplayName("A JSON object passes; null and blank are no-ops")
    void validObjectPasses() {
        assertDoesNotThrow(() -> PackagePageContentService.validate(CONTENT));
        assertDoesNotThrow(() -> PackagePageContentService.validate("{}"));
        assertDoesNotThrow(() -> PackagePageContentService.validate(null));
        assertDoesNotThrow(() -> PackagePageContentService.validate(""));
        assertDoesNotThrow(() -> PackagePageContentService.validate("   "));
    }

    @Test
    @DisplayName("Arrays, scalars, the null literal and broken JSON are rejected with 400")
    void nonObjectRejected() {
        for (String bad : new String[] {"[1,2]", "\"text\"", "42", "true", "null", "{\"v\":1", "not json",
                "{\"v\":1} trailing"}) {
            assertEquals(HttpStatus.BAD_REQUEST, statusOf(() -> PackagePageContentService.validate(bad)), bad);
        }
    }

    @Test
    @DisplayName("Content over 100,000 characters is rejected with 400 and a clear message")
    void oversizeRejected() {
        String big = "{\"a\":\"" + "x".repeat(PackagePageContentService.MAX_LENGTH) + "\"}";
        VacademyException e = assertThrows(VacademyException.class, () -> PackagePageContentService.validate(big));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertTrue(e.getMessage().contains("too large"), e.getMessage());

        String exactlyAtCap = "{\"a\":\"" + "x".repeat(PackagePageContentService.MAX_LENGTH - 8) + "\"}";
        assertEquals(PackagePageContentService.MAX_LENGTH, exactlyAtCap.length());
        assertDoesNotThrow(() -> PackagePageContentService.validate(exactlyAtCap));
    }

    // ---------------- create ----------------

    @Test
    @DisplayName("Create stores the string verbatim for the new package")
    void createStores() {
        when(repository.findById("p1")).thenReturn(Optional.empty());

        service.applyOnCreate("p1", CONTENT);

        ArgumentCaptor<PackagePageContent> saved = ArgumentCaptor.forClass(PackagePageContent.class);
        verify(repository).save(saved.capture());
        assertEquals("p1", saved.getValue().getPackageId());
        assertEquals(CONTENT, saved.getValue().getContentJson());
    }

    @Test
    @DisplayName("Create with null or blank stores nothing")
    void createNullOrBlankIsNoop() {
        service.applyOnCreate("p1", null);
        service.applyOnCreate("p1", "");
        verifyNoInteractions(repository);
    }

    @Test
    @DisplayName("Create with a non-object is rejected and nothing is written")
    void createRejectsNonObject() {
        assertEquals(HttpStatus.BAD_REQUEST, statusOf(() -> service.applyOnCreate("p1", "[]")));
        verify(repository, never()).save(any());
    }

    // ---------------- update ----------------

    @Test
    @DisplayName("Update with null (field absent, older admin builds) leaves the content untouched")
    void updateNullLeavesUntouched() {
        service.applyOnUpdate("p1", null);
        verifyNoInteractions(repository);
    }

    @Test
    @DisplayName("Update with an empty string clears the content")
    void updateEmptyClears() {
        PackagePageContent row = new PackagePageContent("p1", CONTENT);
        when(repository.findById("p1")).thenReturn(Optional.of(row));

        service.applyOnUpdate("p1", "");

        verify(repository).delete(row);
        verify(repository, never()).save(any());
    }

    @Test
    @DisplayName("Update with content replaces the existing row in place")
    void updateReplaces() {
        PackagePageContent row = new PackagePageContent("p1", "{\"v\":1}");
        when(repository.findById("p1")).thenReturn(Optional.of(row));

        service.applyOnUpdate("p1", CONTENT);

        verify(repository).save(row);
        assertEquals(CONTENT, row.getContentJson());
    }

    @Test
    @DisplayName("Update with a non-object or oversize value is rejected and nothing is written")
    void updateRejectsBadValues() {
        assertEquals(HttpStatus.BAD_REQUEST, statusOf(() -> service.applyOnUpdate("p1", "\"faqs\"")));
        String big = "{\"a\":\"" + "x".repeat(PackagePageContentService.MAX_LENGTH) + "\"}";
        assertEquals(HttpStatus.BAD_REQUEST, statusOf(() -> service.applyOnUpdate("p1", big)));
        verify(repository, never()).save(any());
        verify(repository, never()).delete(any());
    }

    // ---------------- read + copy ----------------

    @Test
    @DisplayName("Read returns the stored string, or null when the package has no row")
    void readReturnsStoredString() {
        when(repository.findById("p1")).thenReturn(Optional.of(new PackagePageContent("p1", CONTENT)));
        when(repository.findById("p2")).thenReturn(Optional.empty());

        assertEquals(CONTENT, service.getContentJson("p1"));
        assertNull(service.getContentJson("p2"));
        assertNull(service.getContentJson(null));
    }

    @Test
    @DisplayName("Copy mirrors the source: content is copied, no content clears the target")
    void copyMirrorsSource() {
        when(repository.findById("orig")).thenReturn(Optional.of(new PackagePageContent("orig", CONTENT)));
        when(repository.findById("temp")).thenReturn(Optional.empty());

        service.copy("orig", "temp");

        ArgumentCaptor<PackagePageContent> saved = ArgumentCaptor.forClass(PackagePageContent.class);
        verify(repository).save(saved.capture());
        assertEquals("temp", saved.getValue().getPackageId());
        assertEquals(CONTENT, saved.getValue().getContentJson());

        PackagePageContent stale = new PackagePageContent("orig2", CONTENT);
        when(repository.findById("temp2")).thenReturn(Optional.empty());
        when(repository.findById("orig2")).thenReturn(Optional.of(stale));
        service.copy("temp2", "orig2");
        verify(repository).delete(stale);
    }

    // ---------------- JSON field names (the contract) ----------------

    @Test
    @DisplayName("The JSON field is course_page_json on both the write DTO and the course read DTO")
    void jsonFieldNames() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        AddCourseDTO in = mapper.readValue(
                "{\"course_name\":\"C\",\"course_page_json\":" + mapper.writeValueAsString(CONTENT) + "}",
                AddCourseDTO.class);
        assertEquals(CONTENT, in.getCoursePageJson());

        AddCourseDTO cleared = mapper.readValue("{\"course_page_json\":\"\"}", AddCourseDTO.class);
        assertEquals("", cleared.getCoursePageJson());

        PackageEntity pkg = new PackageEntity();
        pkg.setId("p1");
        CourseDTO course = new CourseDTO(pkg);
        course.setCoursePageJson(CONTENT);
        JsonNode out = mapper.readTree(mapper.writeValueAsString(course));
        assertTrue(out.has("course_page_json"));
        assertEquals(CONTENT, out.get("course_page_json").asText());
    }
}
