package vacademy.io.media_service.service;

import com.amazonaws.SdkClientException;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.s3.model.ObjectMetadata;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import vacademy.io.media_service.dto.eval_api.EvalApiFileHeadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadRequest;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiSignedUrlResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiStoredFileResponse;
import vacademy.io.media_service.entity.FileMetadata;
import vacademy.io.media_service.repository.FileMetadataRepository;

import java.io.InputStream;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class EvalApiFileServiceTest {

    private static final String INSTITUTE = "6b600940-1111-2222-3333-444455556666";
    private static final String MAIN_BUCKET = "vacademy-media-private";
    private static final Instant NOW = Instant.parse("2026-10-01T09:12:44.731Z");

    private AmazonS3 s3;
    private FileMetadataRepository repo;
    private CloudFrontSignerService signer;
    private EvalApiFileService service;

    @BeforeEach
    void setUp() throws Exception {
        s3 = mock(AmazonS3.class);
        repo = mock(FileMetadataRepository.class);
        signer = mock(CloudFrontSignerService.class);
        when(s3.generatePresignedUrl(any(GeneratePresignedUrlRequest.class)))
                .thenReturn(new URL("https://" + MAIN_BUCKET + ".s3.amazonaws.com/signed"));
        when(repo.save(any(FileMetadata.class))).thenAnswer(inv -> {
            FileMetadata fm = inv.getArgument(0);
            fm.setId("file-1");
            return fm;
        });
        service = newService(s3, "");
    }

    private EvalApiFileService newService(AmazonS3 client, String evalBucketOverride) {
        EvalApiFileService s = new EvalApiFileService(client, repo, signer, MAIN_BUCKET, evalBucketOverride);
        s.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
        return s;
    }

    private static EvalApiPresignUploadRequest pdf(long size) {
        return new EvalApiPresignUploadRequest(INSTITUTE, "10A07 science.pdf", "application/pdf", size);
    }

    private static FileMetadata evalRow(String source, String key) {
        FileMetadata fm = new FileMetadata("a.pdf", "application/pdf", key, source, INSTITUTE);
        fm.setId("file-1");
        return fm;
    }

    // ------------------------------------------------------------- presign

    @Test
    void presignUsesPrivateBucketPrefixAndBindsTypeAndLength() {
        EvalApiPresignUploadResponse res = service.presignUpload(pdf(8_421_337L));

        ArgumentCaptor<GeneratePresignedUrlRequest> req = ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(s3).generatePresignedUrl(req.capture());
        GeneratePresignedUrlRequest r = req.getValue();
        assertEquals(MAIN_BUCKET, r.getBucketName());
        assertTrue(r.getKey().startsWith("eval-api/" + INSTITUTE + "/"), r.getKey());
        assertTrue(r.getKey().endsWith("-10A07_science.pdf"), r.getKey());
        assertEquals(com.amazonaws.HttpMethod.PUT, r.getMethod());
        assertEquals("application/pdf", r.getContentType());
        assertEquals("8421337", r.getCustomRequestHeaders().get("Content-Length"));
        assertEquals(Date.from(Instant.parse("2026-10-01T10:12:44Z")), r.getExpiration());

        ArgumentCaptor<FileMetadata> saved = ArgumentCaptor.forClass(FileMetadata.class);
        verify(repo).save(saved.capture());
        FileMetadata fm = saved.getValue();
        assertEquals("AI_EVAL_API", fm.getSource());
        assertEquals(INSTITUTE, fm.getSourceId());
        assertEquals(r.getKey(), fm.getKey());
        assertEquals("10A07 science.pdf", fm.getFileName());
        assertEquals("application/pdf", fm.getFileType());
        assertEquals(8_421_337L, fm.getFileSize());

        assertEquals("file-1", res.getFileId());
        assertEquals("PUT", res.getMethod());
        assertEquals(Map.of("Content-Type", "application/pdf"), res.getHeaders());
        assertEquals("2026-10-01T10:12:44Z", res.getExpiresAt());
        assertNotNull(res.getUploadUrl());
    }

    @Test
    void presignUsesDedicatedBucketWhenConfigured() {
        EvalApiFileService dedicated = newService(s3, " eval-private ");
        dedicated.presignUpload(pdf(10));
        ArgumentCaptor<GeneratePresignedUrlRequest> req = ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(s3).generatePresignedUrl(req.capture());
        assertEquals("eval-private", req.getValue().getBucketName());
    }

    @Test
    void presignNormalizesContentType() {
        EvalApiPresignUploadResponse res = service.presignUpload(
                new EvalApiPresignUploadRequest(INSTITUTE, "p.png", " Image/PNG; foo=bar", 100L));
        assertEquals(Map.of("Content-Type", "image/png"), res.getHeaders());
    }

    /**
     * Real SDK signer (presigning is local, no network): Content-Type and
     * Content-Length must be in X-Amz-SignedHeaders, which is what makes S3
     * reject a PUT with any other type or size.
     */
    @ParameterizedTest
    @ValueSource(strings = {"ap-south-1", "us-east-1"})
    void realPresignedUrlSignsContentTypeAndLength(String region) {
        AmazonS3 real = AmazonS3ClientBuilder.standard()
                .withRegion(region)
                .withCredentials(new AWSStaticCredentialsProvider(new BasicAWSCredentials("AKIDEXAMPLE", "secret")))
                .build();
        EvalApiPresignUploadResponse res = newService(real, "").presignUpload(pdf(8_421_337L));
        String query = URLDecoder.decode(res.getUploadUrl(), StandardCharsets.UTF_8);
        assertTrue(query.contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"), query);
        String signedHeaders = query.replaceAll("(?s).*X-Amz-SignedHeaders=([^&]*).*", "$1");
        assertTrue(signedHeaders.contains("content-length"), signedHeaders);
        assertTrue(signedHeaders.contains("content-type"), signedHeaders);
        assertTrue(query.contains("/eval-api/" + INSTITUTE + "/"), query);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "../other", "a/b", "inst id", "..", "x/../y",
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"})
    void presignRejectsBadInstituteIds(String institute) {
        EvalApiFileException e = assertThrows(EvalApiFileException.class, () -> service.presignUpload(
                new EvalApiPresignUploadRequest(institute, "a.pdf", "application/pdf", 10L)));
        assertEquals("invalid_institute_id", e.getCode());
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verifyNoInteractions(repo);
    }

    @Test
    void presignRejectsUnsupportedTypeBadSizeAndMissingName() {
        assertEquals("unsupported_content_type", assertThrows(EvalApiFileException.class, () -> service.presignUpload(
                new EvalApiPresignUploadRequest(INSTITUTE, "a.zip", "application/zip", 10L))).getCode());
        assertEquals("unsupported_content_type", assertThrows(EvalApiFileException.class, () -> service.presignUpload(
                new EvalApiPresignUploadRequest(INSTITUTE, "a.pdf", null, 10L))).getCode());
        assertEquals("invalid_size", assertThrows(EvalApiFileException.class,
                () -> service.presignUpload(pdf(0))).getCode());
        assertEquals("invalid_size", assertThrows(EvalApiFileException.class, () -> service.presignUpload(
                new EvalApiPresignUploadRequest(INSTITUTE, "a.pdf", "application/pdf", null))).getCode());
        assertEquals("invalid_file_name", assertThrows(EvalApiFileException.class, () -> service.presignUpload(
                new EvalApiPresignUploadRequest(INSTITUTE, "  ", "application/pdf", 10L))).getCode());
        assertEquals("invalid_request", assertThrows(EvalApiFileException.class,
                () -> service.presignUpload(null)).getCode());
        verifyNoInteractions(repo);
    }

    @Test
    void presignEnforcesPerTypeLimits() {
        assertDoesNotThrow(() -> service.presignUpload(pdf(50L * 1024 * 1024)));
        EvalApiFileException e = assertThrows(EvalApiFileException.class,
                () -> service.presignUpload(pdf(50L * 1024 * 1024 + 1)));
        assertEquals("file_too_large", e.getCode());
        assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, e.getStatus());
        assertEquals("file_too_large", assertThrows(EvalApiFileException.class, () -> service.presignUpload(
                new EvalApiPresignUploadRequest(INSTITUTE, "p.jpg", "image/jpeg", 10L * 1024 * 1024 + 1))).getCode());
    }

    @Test
    void keySafeFileNameStripsPathsAndOddCharacters() {
        assertEquals("passwd", EvalApiFileService.keySafeFileName("../../etc/passwd"));
        assertEquals("b.pdf", EvalApiFileService.keySafeFileName("a\\b.pdf"));
        assertTrue(EvalApiFileService.keySafeFileName("उत्तर.pdf").matches("_+\\.pdf"));
        assertEquals("file", EvalApiFileService.keySafeFileName("..."));
        assertEquals(100, EvalApiFileService.keySafeFileName("x".repeat(300) + ".pdf").length());
        assertTrue(EvalApiFileService.keySafeFileName("x".repeat(300) + ".pdf").endsWith(".pdf"));
    }

    // ---------------------------------------------------------- reserved

    @Test
    void reservedSources() {
        assertTrue(EvalApiFileService.isReservedSource("AI_EVAL_API"));
        assertTrue(EvalApiFileService.isReservedSource(" ai_eval_api "));
        assertTrue(EvalApiFileService.isReservedSource("AI_EVAL_API_CHECKED_COPY"));
        assertTrue(EvalApiFileService.isReservedSource("eval-api"));
        assertTrue(EvalApiFileService.isReservedSource("EVAL-API/x"));
        assertFalse(EvalApiFileService.isReservedSource(null));
        assertFalse(EvalApiFileService.isReservedSource("PRIVATE_UPLOAD"));
        assertFalse(EvalApiFileService.isReservedSource("EVALUATION"));
        assertFalse(EvalApiFileService.isReservedSource("BBB_RECORDING"));
    }

    // -------------------------------------------------------------- head

    @Test
    void headReportsStoredObject() {
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API", "eval-api/" + INSTITUTE + "/u-a.pdf")));
        ObjectMetadata om = new ObjectMetadata();
        om.setContentLength(8_421_337L);
        om.setContentType("application/pdf");
        when(s3.getObjectMetadata(MAIN_BUCKET, "eval-api/" + INSTITUTE + "/u-a.pdf")).thenReturn(om);

        EvalApiFileHeadResponse res = service.head("file-1");
        assertEquals("file-1", res.getFileId());
        assertTrue(res.isExists());
        assertEquals(8_421_337L, res.getSizeBytes());
        assertEquals("application/pdf", res.getContentType());
        assertEquals("AI_EVAL_API", res.getSource());
        assertEquals(INSTITUTE, res.getSourceId());
    }

    @Test
    void headReportsMissingObjectAsNotExists() {
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API", "eval-api/" + INSTITUTE + "/u-a.pdf")));
        AmazonS3Exception notFound = new AmazonS3Exception("Not Found");
        notFound.setStatusCode(404);
        when(s3.getObjectMetadata(anyString(), anyString())).thenThrow(notFound);

        EvalApiFileHeadResponse res = service.head("file-1");
        assertFalse(res.isExists());
        assertNull(res.getSizeBytes());
        assertNull(res.getContentType());
        assertEquals(INSTITUTE, res.getSourceId());
    }

    @Test
    void headMapsOtherStorageErrorsTo502() {
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API", "eval-api/" + INSTITUTE + "/u-a.pdf")));
        AmazonS3Exception denied = new AmazonS3Exception("Forbidden");
        denied.setStatusCode(403);
        when(s3.getObjectMetadata(anyString(), anyString())).thenThrow(denied);
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(EvalApiFileException.class, () -> service.head("file-1")).getStatus());

        reset(s3);
        when(s3.getObjectMetadata(anyString(), anyString())).thenThrow(new SdkClientException("timeout"));
        assertEquals("storage_error", assertThrows(EvalApiFileException.class, () -> service.head("file-1")).getCode());
    }

    @Test
    void headAndSignedUrlRefuseNonEvalFiles() {
        when(repo.findById("missing")).thenReturn(Optional.empty());
        // ordinary private upload
        when(repo.findById("private")).thenReturn(Optional.of(evalRow("PRIVATE_UPLOAD", "PRIVATE_UPLOAD/x.pdf")));
        // reserved source but key outside its institute's prefix (forged row)
        when(repo.findById("forged")).thenReturn(Optional.of(evalRow("AI_EVAL_API", "eval-api/other-inst/x.pdf")));
        when(repo.findById("public-key")).thenReturn(Optional.of(evalRow("AI_EVAL_API", "AI_EVAL_API/" + INSTITUTE + "/x.pdf")));

        for (String id : new String[]{"missing", "private", "forged", "public-key", " "}) {
            EvalApiFileException e = assertThrows(EvalApiFileException.class, () -> service.head(id), id);
            assertEquals(HttpStatus.NOT_FOUND, e.getStatus(), id);
            assertEquals("file_not_found", e.getCode(), id);
            assertThrows(EvalApiFileException.class, () -> service.signedUrl(id, 900), id);
        }
        verify(s3, never()).getObjectMetadata(anyString(), anyString());
        verify(s3, never()).generatePresignedUrl(any(GeneratePresignedUrlRequest.class));
    }

    // -------------------------------------------------------- signed URL

    @Test
    void signedUrlUsesS3PresignWithSecondExpiryWhenCdnOff() {
        String key = "eval-api/" + INSTITUTE + "/checked/u-a.pdf";
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API_CHECKED_COPY", key)));
        when(signer.isEnabled()).thenReturn(false);

        EvalApiSignedUrlResponse res = service.signedUrl("file-1", 120);

        ArgumentCaptor<GeneratePresignedUrlRequest> req = ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(s3).generatePresignedUrl(req.capture());
        assertEquals(com.amazonaws.HttpMethod.GET, req.getValue().getMethod());
        assertEquals(key, req.getValue().getKey());
        assertEquals(MAIN_BUCKET, req.getValue().getBucketName());
        assertEquals(Date.from(Instant.parse("2026-10-01T09:14:44Z")), req.getValue().getExpiration());
        assertEquals("2026-10-01T09:14:44Z", res.getExpiresAt());
        assertEquals("https://" + MAIN_BUCKET + ".s3.amazonaws.com/signed", res.getUrl());
    }

    @Test
    void signedUrlPrefersPrivateCdnForMainBucket() {
        String key = "eval-api/" + INSTITUTE + "/u-a.pdf";
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API", key)));
        when(signer.isEnabled()).thenReturn(true);
        when(signer.signedUrl(eq(key), any(Date.class))).thenReturn("https://private.cdn/eval-api/x?Signature=s");

        EvalApiSignedUrlResponse res = service.signedUrl("file-1", null);
        assertEquals("https://private.cdn/eval-api/x?Signature=s", res.getUrl());
        assertEquals("2026-10-01T09:27:44Z", res.getExpiresAt()); // default 900 s
        verify(signer).signedUrl(key, Date.from(Instant.parse("2026-10-01T09:27:44Z")));
        verify(s3, never()).generatePresignedUrl(any(GeneratePresignedUrlRequest.class));
    }

    @Test
    void signedUrlFallsBackToPresignWhenCdnSigningFails() {
        String key = "eval-api/" + INSTITUTE + "/u-a.pdf";
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API", key)));
        when(signer.isEnabled()).thenReturn(true);
        when(signer.signedUrl(anyString(), any(Date.class))).thenThrow(new IllegalStateException("bad key"));

        assertEquals("https://" + MAIN_BUCKET + ".s3.amazonaws.com/signed", service.signedUrl("file-1", 60).getUrl());
    }

    @Test
    void signedUrlSkipsPrivateCdnForDedicatedBucket() {
        String key = "eval-api/" + INSTITUTE + "/u-a.pdf";
        when(repo.findById("file-1")).thenReturn(Optional.of(evalRow("AI_EVAL_API", key)));
        when(signer.isEnabled()).thenReturn(true);

        newService(s3, "eval-private").signedUrl("file-1", 3600);
        verify(signer, never()).signedUrl(anyString(), any(Date.class));
        ArgumentCaptor<GeneratePresignedUrlRequest> req = ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(s3).generatePresignedUrl(req.capture());
        assertEquals("eval-private", req.getValue().getBucketName());
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 59, 3601, -5, 86400})
    void signedUrlRejectsOutOfRangeExpiry(int seconds) {
        EvalApiFileException e = assertThrows(EvalApiFileException.class, () -> service.signedUrl("file-1", seconds));
        assertEquals("invalid_expiry", e.getCode());
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verifyNoInteractions(repo);
    }

    // ---------------------------------------------------- server upload

    @Test
    void serverUploadStoresCheckedCopyUnderPrivatePrefix() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "checked.pdf", "application/pdf", new byte[]{1, 2, 3});

        EvalApiStoredFileResponse res = service.storeServerFile(file, INSTITUTE, null);

        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<ObjectMetadata> om = ArgumentCaptor.forClass(ObjectMetadata.class);
        verify(s3).putObject(eq(MAIN_BUCKET), key.capture(), any(InputStream.class), om.capture());
        assertTrue(key.getValue().startsWith("eval-api/" + INSTITUTE + "/checked/"), key.getValue());
        assertEquals("application/pdf", om.getValue().getContentType());
        assertEquals(3L, om.getValue().getContentLength());
        assertEquals(ObjectMetadata.AES_256_SERVER_SIDE_ENCRYPTION, om.getValue().getSSEAlgorithm());

        assertEquals("file-1", res.getFileId());
        assertEquals("AI_EVAL_API_CHECKED_COPY", res.getSource());
        assertEquals(INSTITUTE, res.getSourceId());
        assertEquals(3L, res.getSizeBytes());
    }

    @Test
    void serverUploadAnswerSheetKindAndRefusals() throws Exception {
        MockMultipartFile pdf = new MockMultipartFile("file", "s.pdf", "application/pdf", new byte[]{1});
        assertEquals("AI_EVAL_API", service.storeServerFile(pdf, INSTITUTE, "answer_sheet").getSource());

        assertEquals("invalid_kind", assertThrows(EvalApiFileException.class,
                () -> service.storeServerFile(pdf, INSTITUTE, "other")).getCode());
        assertEquals("invalid_institute_id", assertThrows(EvalApiFileException.class,
                () -> service.storeServerFile(pdf, "../x", null)).getCode());
        MockMultipartFile png = new MockMultipartFile("file", "s.png", "image/png", new byte[]{1});
        assertEquals("unsupported_content_type", assertThrows(EvalApiFileException.class,
                () -> service.storeServerFile(png, INSTITUTE, null)).getCode());
        MockMultipartFile empty = new MockMultipartFile("file", "s.pdf", "application/pdf", new byte[0]);
        assertEquals("invalid_size", assertThrows(EvalApiFileException.class,
                () -> service.storeServerFile(empty, INSTITUTE, null)).getCode());
    }
}
