package vacademy.io.media_service.service;

import com.amazonaws.services.s3.AmazonS3;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.exceptions.DatabaseException;
import vacademy.io.media_service.dto.AcknowledgeRequest;
import vacademy.io.media_service.entity.FileMetadata;
import vacademy.io.media_service.repository.FileMetadataRepository;
import vacademy.io.media_service.repository.UserToFileRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** AI Evaluation API files never get a permanent URL and are never published by acknowledge. */
class FileServiceImplEvalApiGuardTest {

    private AmazonS3 s3;
    private UserToFileRepository userToFileRepository;
    private CdnUrlService cdnUrlService;
    private FileMetadataRepository repo;
    private FileServiceImpl service;

    @BeforeEach
    void setUp() {
        s3 = mock(AmazonS3.class);
        userToFileRepository = mock(UserToFileRepository.class);
        cdnUrlService = mock(CdnUrlService.class);
        repo = mock(FileMetadataRepository.class);
        service = new FileServiceImpl(s3, userToFileRepository, cdnUrlService, mock(CloudFrontSignerService.class));
        ReflectionTestUtils.setField(service, "fileMetadataRepository", repo);
        ReflectionTestUtils.setField(service, "bucketName", "main");
        ReflectionTestUtils.setField(service, "publicBucket", "public");
        when(cdnUrlService.publicUrl(anyString(), anyString())).thenReturn("https://cdn/permanent");
    }

    private static FileMetadata row(String source) {
        FileMetadata fm = new FileMetadata("a.pdf", "application/pdf", "k/a.pdf", source, "inst");
        fm.setId("f1");
        return fm;
    }

    @Test
    void getPublicUrlTreatsEvalApiFilesAsNotFound() {
        when(repo.findById("f1")).thenReturn(Optional.of(row("AI_EVAL_API")));
        assertThrows(DatabaseException.class, () -> service.getPublicUrl("f1"));
        when(repo.findById("f1")).thenReturn(Optional.of(row("AI_EVAL_API_CHECKED_COPY")));
        assertThrows(DatabaseException.class, () -> service.getPublicUrl("f1"));
        verifyNoInteractions(cdnUrlService);
    }

    @Test
    void getPublicUrlUnchangedForOtherSources() {
        when(repo.findById("f1")).thenReturn(Optional.of(row("PRIVATE_UPLOAD")));
        assertEquals("https://cdn/permanent", service.getPublicUrl("f1"));
        verify(cdnUrlService).publicUrl("k/a.pdf", "main");
    }

    @Test
    void acknowledgeRefusesEvalApiFilesAndNeverCopiesThemPublic() {
        when(repo.findById("f1")).thenReturn(Optional.of(row("AI_EVAL_API")));
        AcknowledgeRequest req = new AcknowledgeRequest();
        req.setFileId("f1");
        req.setUserId("u1");

        assertFalse(service.acknowledgeClientUpload(req));
        assertNull(service.acknowledgeClientUploadAndGetPublicUrl(req));
        verifyNoInteractions(userToFileRepository);
        verify(s3, never()).copyObject(any());
    }

    @Test
    void acknowledgeUnchangedForOtherSources() {
        when(repo.findById("f1")).thenReturn(Optional.of(row("USER_UPLOAD")));
        AcknowledgeRequest req = new AcknowledgeRequest();
        req.setFileId("f1");
        req.setUserId("u1");
        assertTrue(service.acknowledgeClientUpload(req));
        verify(userToFileRepository).save(any());
    }
}
