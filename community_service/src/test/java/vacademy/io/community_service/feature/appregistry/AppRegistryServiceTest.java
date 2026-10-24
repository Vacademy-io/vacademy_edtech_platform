package vacademy.io.community_service.feature.appregistry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.community_service.feature.appregistry.entity.AppRegistration;
import vacademy.io.community_service.feature.appregistry.repository.AppRegistrationRepository;
import vacademy.io.community_service.feature.appregistry.service.AppRegistryService;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Storage rules for the app registry — the parts that are not "write the JSON back out".
 *
 * <p>The dashboard owns the document shape, so what this service actually decides is narrow and
 * load-bearing: which id wins, whose clock wins, and which columns get denormalised out of the
 * payload for the two lookups that matter. The institute id is the sharp one — it is what an
 * institute's own dashboard filters on, so getting "not set" wrong hands one client's app to
 * another.
 */
@ExtendWith(MockitoExtension.class)
class AppRegistryServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock
    private AppRegistrationRepository repository;

    @InjectMocks
    private AppRegistryService service;

    @Captor
    private ArgumentCaptor<AppRegistration> saved;

    private static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException("bad test fixture", e);
        }
    }

    /** A minimal record with whatever basics the case is about. */
    private static JsonNode recordWithBasics(String basics) {
        return json("{\"id\":\"app-1\",\"basics\":" + basics + "}");
    }

    private void echoSaves() {
        when(repository.save(any(AppRegistration.class))).thenAnswer(i -> i.getArgument(0));
    }

    private AppRegistration captureSave() {
        verify(repository).save(saved.capture());
        return saved.getValue();
    }

    @Nested
    @DisplayName("the owning institute")
    class InstituteOwnership {

        @ParameterizedTest(name = "an instituteId of [{0}] is stored as not-set")
        @ValueSource(strings = {"", " ", "   "})
        @DisplayName("blank means nobody owns this app, which is not the same as everybody")
        void blankInstituteIdBecomesNull(String blank) {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            service.upsert("app-1", recordWithBasics("{\"instituteId\":\"" + blank + "\"}"));

            assertNull(captureSave().getInstituteId());
        }

        @Test
        @DisplayName("an absent instituteId is stored as not-set too")
        void missingInstituteIdBecomesNull() {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            service.upsert("app-1", recordWithBasics("{\"name\":\"App\"}"));

            assertNull(captureSave().getInstituteId());
        }

        @Test
        @DisplayName("a real id is stored trimmed — a pasted UUID often brings whitespace along")
        void realInstituteIdIsTrimmed() {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            service.upsert("app-1", recordWithBasics("{\"instituteId\":\"  inst-7  \"}"));

            assertEquals("inst-7", captureSave().getInstituteId());
        }

        @ParameterizedTest(name = "a lookup for [{0}] returns nothing")
        @ValueSource(strings = {"", "  "})
        @DisplayName("a blank lookup is a caller that lost the institute, not a request for the unowned")
        void blankLookupReturnsNothing(String blank) {
            assertTrue(service.listByInstitute(blank).isEmpty());
            verifyNoInteractions(repository);
        }

        @Test
        @DisplayName("a null lookup is refused the same way")
        void nullLookupReturnsNothing() {
            assertTrue(service.listByInstitute(null).isEmpty());
            verifyNoInteractions(repository);
        }

        @Test
        @DisplayName("a real lookup returns the stored documents")
        void realLookupReturnsRecords() {
            when(repository.findAllByInstituteIdAndArchivedFalseOrderByNameAsc("inst-7"))
                    .thenReturn(List.of(AppRegistration.builder()
                            .id("app-1")
                            .payload("{\"id\":\"app-1\",\"basics\":{\"name\":\"SN\"}}")
                            .build()));

            List<JsonNode> found = service.listByInstitute("inst-7");

            assertEquals(1, found.size());
            assertEquals("SN", found.get(0).path("basics").path("name").asText());
        }
    }

    @Nested
    @DisplayName("what the server decides, not the client")
    class ServerAuthority {

        @Test
        @DisplayName("the id in the path wins, so a stale body cannot write over another app")
        void pathIdWinsOverBodyId() {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            JsonNode result = service.upsert("app-1", json("{\"id\":\"SOMEONE-ELSE\",\"basics\":{}}"));

            assertEquals("app-1", result.path("id").asText());
            assertEquals("app-1", captureSave().getId());
        }

        @Test
        @DisplayName("the server stamps updatedAt, so a skewed client clock cannot win a race")
        void serverOwnsUpdatedAt() {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            JsonNode result = service.upsert("app-1",
                    json("{\"id\":\"app-1\",\"updatedAt\":\"2999-01-01T00:00:00Z\",\"basics\":{}}"));

            assertNotEquals("2999-01-01T00:00:00Z", result.path("updatedAt").asText());
            assertTrue(result.path("updatedAt").asText().length() > 0);
        }

        @Test
        @DisplayName("the searchable columns are denormalised out of the payload on every write")
        void indexColumnsTrackThePayload() {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            service.upsert("app-1", json("{\"id\":\"app-1\",\"archived\":true,\"basics\":{"
                    + "\"name\":\"Shiksha Nation\",\"client\":\"SN\","
                    + "\"packageName\":\"com.vacademy.sn\",\"instituteId\":\"inst-7\"}}"));

            AppRegistration row = captureSave();
            assertEquals("Shiksha Nation", row.getName());
            assertEquals("SN", row.getClientName());
            assertEquals("com.vacademy.sn", row.getPackageName());
            assertEquals("inst-7", row.getInstituteId());
            assertTrue(row.getArchived());
        }

        @Test
        @DisplayName("an app that never said it was archived is not archived")
        void archivedDefaultsToFalse() {
            echoSaves();
            when(repository.findById("app-1")).thenReturn(Optional.empty());

            service.upsert("app-1", recordWithBasics("{\"name\":\"App\"}"));

            assertEquals(Boolean.FALSE, captureSave().getArchived());
        }

        @Test
        @DisplayName("an existing row is updated in place rather than duplicated")
        void existingRowIsReused() {
            echoSaves();
            AppRegistration existing = AppRegistration.builder()
                    .id("app-1").name("Old name").payload("{}").build();
            when(repository.findById("app-1")).thenReturn(Optional.of(existing));

            service.upsert("app-1", recordWithBasics("{\"name\":\"New name\"}"));

            assertEquals("New name", captureSave().getName());
        }
    }

    @Nested
    @DisplayName("payloads that should be refused")
    class BadInput {

        @ParameterizedTest(name = "a body of {0} is not an app record")
        @ValueSource(strings = {"[]", "\"text\"", "42", "null"})
        void nonObjectBodyIsRejected(String body) {
            VacademyException thrown = assertThrows(VacademyException.class,
                    () -> service.upsert("app-1", json(body)));

            assertEquals(HttpStatus.BAD_REQUEST, thrown.getStatus());
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("a Java null body is refused rather than NPEing")
        void nullBodyIsRejected() {
            assertThrows(VacademyException.class, () -> service.upsert("app-1", null));
        }

        @Test
        @DisplayName("reading an app that isn't there is a 404, not an empty document")
        void getMissingIs404() {
            when(repository.findById("nope")).thenReturn(Optional.empty());

            assertEquals(HttpStatus.NOT_FOUND,
                    assertThrows(VacademyException.class, () -> service.get("nope")).getStatus());
        }

        @Test
        @DisplayName("deleting an app that isn't there is a 404, not a silent success")
        void deleteMissingIs404() {
            when(repository.existsById("nope")).thenReturn(false);

            assertEquals(HttpStatus.NOT_FOUND,
                    assertThrows(VacademyException.class, () -> service.delete("nope")).getStatus());
            verify(repository, never()).deleteById(anyString());
        }

        @Test
        @DisplayName("a row whose stored payload is not JSON is a server fault, and says which row")
        void corruptStoredPayload() {
            when(repository.findById("app-1")).thenReturn(Optional.of(
                    AppRegistration.builder().id("app-1").payload("not json").build()));

            VacademyException thrown = assertThrows(VacademyException.class, () -> service.get("app-1"));

            assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, thrown.getStatus());
            assertTrue(thrown.getMessage().contains("app-1"));
        }
    }

    @Nested
    @DisplayName("import — destructive by contract, so all-or-nothing in practice")
    class ImportAll {

        @Test
        @DisplayName("a null upload is refused before anything is deleted")
        void nullUploadIsRejected() {
            assertEquals(HttpStatus.BAD_REQUEST,
                    assertThrows(VacademyException.class, () -> service.replaceAll(null)).getStatus());
            verify(repository, never()).deleteAllInBatch();
        }

        @Test
        @DisplayName("a record with no id stops the import — the transaction rolls the wipe back")
        void recordWithoutIdIsRejected() {
            VacademyException thrown = assertThrows(VacademyException.class,
                    () -> service.replaceAll(List.of(json("{\"basics\":{\"name\":\"App\"}}"))));

            assertEquals(HttpStatus.BAD_REQUEST, thrown.getStatus());
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("a record with a blank id is refused too")
        void recordWithBlankIdIsRejected() {
            assertThrows(VacademyException.class,
                    () -> service.replaceAll(List.of(json("{\"id\":\"  \",\"basics\":{}}"))));
        }

        @Test
        @DisplayName("a good upload replaces the registry wholesale")
        void goodUploadReplacesEverything() {
            echoSaves();
            when(repository.findById(anyString())).thenReturn(Optional.empty());

            List<JsonNode> result = service.replaceAll(List.of(
                    json("{\"id\":\"a\",\"basics\":{\"name\":\"A\"}}"),
                    json("{\"id\":\"b\",\"basics\":{\"name\":\"B\"}}")));

            verify(repository).deleteAllInBatch();
            assertEquals(2, result.size());
            assertEquals("a", result.get(0).path("id").asText());
            assertEquals("b", result.get(1).path("id").asText());
        }
    }
}
