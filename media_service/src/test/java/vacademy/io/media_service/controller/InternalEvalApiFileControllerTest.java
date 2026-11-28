package vacademy.io.media_service.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.media_service.dto.eval_api.EvalApiFileHeadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadRequest;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiSignedUrlResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiStoredFileResponse;
import vacademy.io.media_service.service.EvalApiFileException;
import vacademy.io.media_service.service.EvalApiFileService;

import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class InternalEvalApiFileControllerTest {

    private static final String BASE = "/media-service/internal/eval-api/v1";

    private EvalApiFileService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(EvalApiFileService.class);
        InternalEvalApiFileController controller = new InternalEvalApiFileController();
        ReflectionTestUtils.setField(controller, "evalApiFileService", service);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void presignUploadReadsAndWritesTheC3Contract() throws Exception {
        when(service.presignUpload(any(EvalApiPresignUploadRequest.class))).thenReturn(
                EvalApiPresignUploadResponse.builder()
                        .fileId("f1").uploadUrl("https://s3/x?X-Amz-Signature=s").method("PUT")
                        .headers(Map.of("Content-Type", "application/pdf"))
                        .expiresAt("2026-10-01T10:12:44Z").build());

        mvc.perform(post(BASE + "/presign-upload").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"institute_id\":\"inst-1\",\"file_name\":\"a.pdf\","
                                + "\"content_type\":\"application/pdf\",\"size_bytes\":8421337}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.file_id").value("f1"))
                .andExpect(jsonPath("$.upload_url").value("https://s3/x?X-Amz-Signature=s"))
                .andExpect(jsonPath("$.method").value("PUT"))
                .andExpect(jsonPath("$.headers['Content-Type']").value("application/pdf"))
                .andExpect(jsonPath("$.expires_at").value("2026-10-01T10:12:44Z"));

        verify(service).presignUpload(new EvalApiPresignUploadRequest("inst-1", "a.pdf", "application/pdf", 8421337L));
    }

    @Test
    void headReturnsContractFieldsIncludingNulls() throws Exception {
        when(service.head("f1")).thenReturn(EvalApiFileHeadResponse.builder()
                .fileId("f1").exists(false).source("AI_EVAL_API").sourceId("inst-1").build());

        mvc.perform(get(BASE + "/files/f1/head"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.file_id").value("f1"))
                .andExpect(jsonPath("$.exists").value(false))
                .andExpect(jsonPath("$.size_bytes").isEmpty())
                .andExpect(jsonPath("$.content_type").isEmpty())
                .andExpect(jsonPath("$.source").value("AI_EVAL_API"))
                .andExpect(jsonPath("$.source_id").value("inst-1"));
    }

    @Test
    void signedUrlPassesExpirySeconds() throws Exception {
        when(service.signedUrl("f1", 600)).thenReturn(new EvalApiSignedUrlResponse("https://cdn/x", "2026-10-01T09:22:44Z"));

        mvc.perform(get(BASE + "/files/f1/signed-url").param("expirySeconds", "600"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.url").value("https://cdn/x"))
                .andExpect(jsonPath("$.expires_at").value("2026-10-01T09:22:44Z"));
    }

    @Test
    void refusalsBecomeErrorEnvelopes() throws Exception {
        when(service.signedUrl(eq("f1"), eq(7200))).thenThrow(
                new EvalApiFileException(HttpStatus.BAD_REQUEST, "invalid_expiry", "expirySeconds must be between 60 and 3600."));
        when(service.head("nope")).thenThrow(
                new EvalApiFileException(HttpStatus.NOT_FOUND, "file_not_found", "File not found."));

        mvc.perform(get(BASE + "/files/f1/signed-url").param("expirySeconds", "7200"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_expiry"));
        mvc.perform(get(BASE + "/files/nope/head"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("file_not_found"))
                .andExpect(jsonPath("$.message").value("File not found."));
    }

    @Test
    void serverUploadDefaultsKind() throws Exception {
        when(service.storeServerFile(any(), eq("inst-1"), isNull())).thenReturn(EvalApiStoredFileResponse.builder()
                .fileId("f2").sizeBytes(3L).contentType("application/pdf")
                .source("AI_EVAL_API_CHECKED_COPY").sourceId("inst-1").build());

        mvc.perform(multipart(BASE + "/upload")
                        .file(new MockMultipartFile("file", "c.pdf", "application/pdf", new byte[]{1, 2, 3}))
                        .param("institute_id", "inst-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.file_id").value("f2"))
                .andExpect(jsonPath("$.source").value("AI_EVAL_API_CHECKED_COPY"));
    }
}
