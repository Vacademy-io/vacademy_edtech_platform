package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportJobResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportValidationResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CommerceImportControllerTest {

    private static final String INSTITUTE = "inst-1";

    private CommerceImportService importService;
    private CommerceCatalogueExportService exportService;
    private CommerceAccessGuard guard;
    private CommerceImportController controller;
    private CustomUserDetails user;
    private MockMultipartFile file;

    @BeforeEach
    void setUp() {
        importService = mock(CommerceImportService.class);
        exportService = mock(CommerceCatalogueExportService.class);
        guard = mock(CommerceAccessGuard.class);
        controller = new CommerceImportController(importService, exportService, guard);
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("user-1");
        file = new MockMultipartFile("file", "products.csv", "text/csv", "handle,sku\nk,s\n".getBytes());
    }

    @Test
    void everyEndpointAsksTheGuardForTheCatalogueFeatureAndTheStoreManagerRole() throws Exception {
        when(importService.validate(any(), any(), any())).thenReturn(new ImportValidationResponse());
        when(importService.start(any(), any(), any(), any())).thenReturn(new ImportJobResponse());
        when(importService.validationErrorRows(any(), any(), any())).thenReturn(new byte[0]);
        when(importService.jobErrorRows(any(), any())).thenReturn(new byte[0]);
        when(importService.template(any())).thenReturn(new byte[0]);
        when(exportService.select(any(), any(), any())).thenReturn(
                new CommerceCatalogueExportService.Selection(INSTITUTE, new ImportReferenceData(), List.of(), 0));

        controller.importProducts(INSTITUTE, "validate", file, user);
        controller.importProducts(INSTITUTE, "commit", file, user);
        controller.validationErrorRows(INSTITUTE, file, user);
        controller.listJobs(INSTITUTE, 0, 20, user);
        controller.columns(INSTITUTE, user);
        controller.template(INSTITUTE, "csv", user);
        controller.job("job-1", INSTITUTE, user);
        controller.jobErrorRows("job-1", INSTITUTE, user);
        controller.export(INSTITUTE, null, null, user, new MockHttpServletResponse());

        verify(guard, times(9)).require(user, INSTITUTE, CommerceFeature.CATALOGUE, Set.of(CommerceRole.STORE_MANAGER));
    }

    @Test
    void aRefusedCallerReachesNoService() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(guard).require(any(), any(), any(), any());

        assertThrows(CommerceAccessDeniedException.class, () -> controller.importProducts(INSTITUTE, "commit", file, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.importProducts(INSTITUTE, "validate", file, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.validationErrorRows(INSTITUTE, file, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.listJobs(INSTITUTE, 0, 20, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.columns(INSTITUTE, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.template(INSTITUTE, "csv", user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.job("job-1", INSTITUTE, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.jobErrorRows("job-1", INSTITUTE, user));
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.export(INSTITUTE, null, null, user, response));
        assertEquals(0, response.getContentAsByteArray().length);
        verifyNoInteractions(importService, exportService);
    }

    @Test
    void validateAnswers200AndCommitAnswers202WithTheActor() {
        when(importService.validate(any(), any(), any())).thenReturn(new ImportValidationResponse());
        when(importService.start(any(), any(), any(), any())).thenReturn(new ImportJobResponse());

        ResponseEntity<?> validated = controller.importProducts(INSTITUTE, "VALIDATE", file, user);
        assertEquals(HttpStatus.OK, validated.getStatusCode());
        verify(importService).validate(eq(INSTITUTE), eq("products.csv"), any());

        ResponseEntity<?> committed = controller.importProducts(INSTITUTE, "commit", file, user);
        assertEquals(HttpStatus.ACCEPTED, committed.getStatusCode());
        verify(importService).start(eq(INSTITUTE), eq("user-1"), eq("products.csv"), any());

        assertThrows(InvalidRequestException.class, () -> controller.importProducts(INSTITUTE, "delete", file, user));
    }

    @Test
    void anOversizedOrEmptyUploadIsRefusedBeforeItIsRead() {
        MockMultipartFile big = new MockMultipartFile("file", "big.csv", "text/csv",
                new byte[ImportLimits.MAX_FILE_BYTES + 1]);
        assertThrows(InvalidRequestException.class, () -> controller.importProducts(INSTITUTE, "validate", big, user));
        assertThrows(InvalidRequestException.class, () -> controller.importProducts(INSTITUTE, "commit", big, user));
        MockMultipartFile empty = new MockMultipartFile("file", "none.csv", "text/csv", new byte[0]);
        assertThrows(InvalidRequestException.class, () -> controller.importProducts(INSTITUTE, "validate", empty, user));
        verifyNoInteractions(importService);
    }

    @Test
    void theExportIsADownloadThatIsAuditedBeforeItIsWritten() throws Exception {
        CommerceCatalogueExportService.Selection selection =
                new CommerceCatalogueExportService.Selection(INSTITUTE, new ImportReferenceData(), List.of(), 0);
        when(exportService.select(INSTITUTE, "ACTIVE", null)).thenReturn(selection);
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.export(INSTITUTE, "ACTIVE", null, user, response);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(exportService);
        order.verify(exportService).audit(selection, "user-1", "ACTIVE");
        order.verify(exportService).write(eq(selection), any());
        assertTrue(response.getContentType().startsWith("text/csv"));
        assertTrue(response.getHeader("Content-Disposition").startsWith("attachment; filename=\"products-"));
        assertEquals("no-store", response.getHeader("Cache-Control"));
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
    }

    @Test
    void downloadsAreAttachmentsThatAreNotSniffed() {
        when(importService.template("xlsx")).thenReturn(new byte[] {1});
        ResponseEntity<byte[]> template = controller.template(INSTITUTE, "xlsx", user);
        assertEquals("attachment; filename=\"product-import-template.xlsx\"",
                template.getHeaders().getFirst("Content-Disposition"));
        assertEquals("nosniff", template.getHeaders().getFirst("X-Content-Type-Options"));
    }
}
