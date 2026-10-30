package vacademy.io.media_service.service;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.CopyObjectRequest;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.s3.model.ObjectMetadata;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.media_service.entity.FileMetadata;
import vacademy.io.media_service.repository.FileMetadataRepository;
import vacademy.io.media_service.repository.UserToFileRepository;

import java.net.URL;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * The CDN serves the public bucket only (no failover to the main bucket), so a permanent
 * URL must point at an object that is in the public bucket, and a signed CDN URL is only
 * issued for keys the distribution routes to the main bucket.
 */
class FileServiceImplCdnPublishTest {

    private static final String KEY = "inst/PDF_DOCUMENTS/abc-notes.pdf";

    private AmazonS3 s3;
    private CdnUrlService cdn;
    private CloudFrontSignerService signer;
    private FileMetadataRepository repo;
    private FileServiceImpl service;

    @BeforeEach
    void setUp() throws Exception {
        s3 = mock(AmazonS3.class);
        cdn = mock(CdnUrlService.class);
        signer = mock(CloudFrontSignerService.class);
        repo = mock(FileMetadataRepository.class);
        service = new FileServiceImpl(s3, mock(UserToFileRepository.class), cdn, signer);
        ReflectionTestUtils.setField(service, "fileMetadataRepository", repo);
        ReflectionTestUtils.setField(service, "bucketName", "main");
        ReflectionTestUtils.setField(service, "publicBucket", "public");
        when(cdn.isCdnEnabled()).thenReturn(true);
        when(cdn.publicUrl(anyString())).thenReturn("https://cdn/" + KEY);
        when(cdn.publicUrl(anyString(), anyString())).thenReturn("https://cdn/" + KEY);
        when(s3.getObjectMetadata("main", KEY)).thenReturn(new ObjectMetadata());
        when(s3.generatePresignedUrl(any(GeneratePresignedUrlRequest.class)))
                .thenReturn(new URL("https://main.s3.amazonaws.com/presigned"));
    }

    private void file(String key, String source) {
        FileMetadata fm = new FileMetadata("notes.pdf", "application/pdf", key, source, "inst");
        fm.setId("f1");
        when(repo.findById("f1")).thenReturn(Optional.of(fm));
    }

    @Test
    void publishesAPrivateOnlyObjectOnceBeforeHandingOutItsCdnUrl() throws Exception {
        file(KEY, "PDF_DOCUMENTS");
        when(s3.doesObjectExist("public", KEY)).thenReturn(false);
        when(s3.doesObjectExist("main", KEY)).thenReturn(true);

        assertEquals("https://cdn/" + KEY, service.getPublicUrlWithExpiryAndId("f1"));
        assertEquals("https://cdn/" + KEY, service.getPublicUrl("f1"));
        assertEquals("https://cdn/" + KEY, service.getPublicBucketUrl("f1", 1));

        ArgumentCaptor<CopyObjectRequest> copy = ArgumentCaptor.forClass(CopyObjectRequest.class);
        verify(s3, times(1)).copyObject(copy.capture());
        assertEquals("main", copy.getValue().getSourceBucketName());
        assertEquals("public", copy.getValue().getDestinationBucketName());
        assertEquals(KEY, copy.getValue().getDestinationKey());
        verify(s3, times(1)).doesObjectExist("public", KEY); // remembered after the first call
    }

    @Test
    void leavesObjectsAlreadyInThePublicBucketAlone() {
        file(KEY, "PDF_DOCUMENTS");
        when(s3.doesObjectExist("public", KEY)).thenReturn(true);

        service.getPublicUrl("f1");
        verify(s3, never()).copyObject(any(CopyObjectRequest.class));
    }

    @Test
    void neverPublishesKeysTheCdnRoutesToTheMainBucket() {
        file("BBB_RECORDING/x.mp4", "BBB_RECORDING");
        when(cdn.isRoutedToPrivateOrigin("BBB_RECORDING/x.mp4")).thenReturn(true);

        service.getPublicUrl("f1");
        verify(s3, never()).doesObjectExist(anyString(), anyString());
        verify(s3, never()).copyObject(any(CopyObjectRequest.class));
    }

    @Test
    void neverPublishesAiEvaluationApiFiles() throws Exception {
        file("eval-api/inst/sheet.pdf", "AI_EVAL_API_CHECKED_COPY");

        service.getPublicUrlWithExpiryAndId("f1");
        verify(s3, never()).copyObject(any(CopyObjectRequest.class));
    }

    @Test
    void retriesAnUploadThatHasNotLandedYet() {
        file(KEY, "PDF_DOCUMENTS");
        when(s3.doesObjectExist(anyString(), anyString())).thenReturn(false);

        service.getPublicUrl("f1");
        service.getPublicUrl("f1");
        verify(s3, times(2)).doesObjectExist("public", KEY); // not remembered
        verify(s3, never()).copyObject(any(CopyObjectRequest.class));
    }

    @Test
    void stillReturnsTheUrlWhenPublishingFails() {
        file(KEY, "PDF_DOCUMENTS");
        when(s3.doesObjectExist("public", KEY)).thenThrow(new RuntimeException("S3 down"));

        assertEquals("https://cdn/" + KEY, service.getPublicUrl("f1"));
    }

    @Test
    void doesNothingExtraWithoutTheCdn() {
        file(KEY, "PDF_DOCUMENTS");
        when(cdn.isCdnEnabled()).thenReturn(false);

        service.getPublicUrl("f1");
        verify(s3, never()).doesObjectExist(anyString(), anyString());
    }

    @Test
    void privateUrlPresignsKeysTheCdnCannotSignAndCapsTheExpiryAtSevenDays() throws Exception {
        file(KEY, "EVALUATIONS");
        when(signer.canSign(KEY)).thenReturn(false);

        assertEquals("https://main.s3.amazonaws.com/presigned", service.getUrlWithExpiryAndId("f1", 30));

        ArgumentCaptor<GeneratePresignedUrlRequest> req = ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(s3).generatePresignedUrl(req.capture());
        long sevenDays = 7L * 24 * 60 * 60 * 1000;
        assertTrue(req.getValue().getExpiration().getTime() <= System.currentTimeMillis() + sevenDays);
        verify(signer, never()).signedUrl(anyString(), any());
    }

    @Test
    void privateUrlSignsKeysTheCdnRoutesToTheMainBucket() throws Exception {
        file("BBB_RECORDING/x.mp4", "BBB_RECORDING");
        when(signer.canSign("BBB_RECORDING/x.mp4")).thenReturn(true);
        when(signer.signedUrl(eq("BBB_RECORDING/x.mp4"), any())).thenReturn("https://cdn/BBB_RECORDING/x.mp4?Signature=s");

        assertEquals("https://cdn/BBB_RECORDING/x.mp4?Signature=s", service.getUrlWithExpiryAndId("f1", 30));
        verify(s3, never()).generatePresignedUrl(any(GeneratePresignedUrlRequest.class));
    }

    @Test
    void routedPrefixesMatchTheDistributionsBehaviors() {
        CdnUrlService real = new CdnUrlService();
        ReflectionTestUtils.setField(real, "privateRoutedPrefixes",
                List.of("PRIVATE_UPLOAD/", "ADMIN_UPLOAD/", "BBB_RECORDING/", "AI_CALL_RECORDING/"));
        assertTrue(real.isRoutedToPrivateOrigin("BBB_RECORDING/meeting/video.mp4"));
        assertTrue(real.isRoutedToPrivateOrigin(" PRIVATE_UPLOAD/a.mp3"));
        assertFalse(real.isRoutedToPrivateOrigin("BBB_RECORDINGS_OLD/x.mp4"));
        assertFalse(real.isRoutedToPrivateOrigin("inst/EVALUATIONS/BBB_RECORDING/x"));
        assertFalse(real.isRoutedToPrivateOrigin(null));
    }

    private static <T> T eq(T value) {
        return org.mockito.ArgumentMatchers.eq(value);
    }
}
