package vacademy.io.media_service.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.exceptions.DatabaseException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.media_service.dto.PreSignedUrlRequest;
import vacademy.io.media_service.dto.PreSignedUrlResponse;
import vacademy.io.media_service.service.FileService;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** User-facing and anonymous media endpoints never mint or expose AI Evaluation API files. */
class EvalApiReservedSourceGuardTest {

    private FileService fileService;
    private PublicFileController publicController;
    private FileController userController;

    @BeforeEach
    void setUp() {
        fileService = mock(FileService.class);
        publicController = new PublicFileController();
        ReflectionTestUtils.setField(publicController, "fileService", fileService);
        userController = new FileController();
        ReflectionTestUtils.setField(userController, "fileService", fileService);
    }

    private static FileDetailsDTO details(String id, String source) {
        return FileDetailsDTO.builder().id(id).source(source).url("https://signed/" + id).build();
    }

    @Test
    void presignEndpointsRefuseReservedSources() {
        for (String source : new String[]{"AI_EVAL_API", "AI_EVAL_API_CHECKED_COPY", "eval-api"}) {
            PreSignedUrlRequest req = new PreSignedUrlRequest("a.pdf", "application/pdf", source, "inst");
            VacademyException anon = assertThrows(VacademyException.class, () -> publicController.uploadFile(req));
            assertEquals(HttpStatus.BAD_REQUEST, anon.getStatus());
            VacademyException user = assertThrows(VacademyException.class, () -> userController.uploadFile(null, req));
            assertEquals(HttpStatus.BAD_REQUEST, user.getStatus());
        }
        verifyNoInteractions(fileService);
    }

    @Test
    void presignEndpointsUnchangedForOrdinarySources() {
        PreSignedUrlResponse ok = new PreSignedUrlResponse("f1", "https://s3/put");
        when(fileService.getPublicPreSignedUrl("a.pdf", "application/pdf", "STUDENT", "inst")).thenReturn(ok);
        when(fileService.getPreSignedUrl("a.pdf", "application/pdf", "STUDENT", "inst")).thenReturn(ok);
        PreSignedUrlRequest req = new PreSignedUrlRequest("a.pdf", "application/pdf", "STUDENT", "inst");
        assertSame(ok, publicController.uploadFile(req).getBody());
        assertSame(ok, userController.uploadFile(null, req).getBody());
    }

    @Test
    void anonymousDetailsTreatsEvalApiFileAsNotFound() throws Exception {
        when(fileService.getFileDetailsWithExpiryAndId("f1", 7)).thenReturn(details("f1", "AI_EVAL_API"));
        assertThrows(DatabaseException.class, () -> publicController.getFileDetailsById("f1", 7));

        when(fileService.getFileDetailsWithExpiryAndId("f2", 7)).thenReturn(details("f2", "PRIVATE_UPLOAD"));
        assertEquals("f2", publicController.getFileDetailsById("f2", 7).getBody().getId());
    }

    @Test
    void userDetailsListDropsEvalApiFiles() throws Exception {
        List<FileDetailsDTO> all = new ArrayList<>(List.of(details("a", "STUDENT"),
                details("b", "AI_EVAL_API_CHECKED_COPY"), details("c", "PRIVATE_UPLOAD")));
        when(fileService.getMultipleFileDetailsWithExpiryAndId(anyString(), anyInt())).thenReturn(all);

        List<FileDetailsDTO> out = userController.getFileDetailsByIds(null, "a,b,c", 1).getBody();
        assertNotNull(out);
        assertEquals(List.of("a", "c"), out.stream().map(FileDetailsDTO::getId).toList());
    }
}
