package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SiteRedirectAdminControllerTest {

    private static final String INSTITUTE = "inst-1";

    private SiteRedirectAdminService service;
    private CommerceAccessGuard guard;
    private SiteRedirectAdminController controller;
    private CustomUserDetails user;
    private MockMultipartFile file;

    @BeforeEach
    void setUp() {
        service = mock(SiteRedirectAdminService.class);
        guard = mock(CommerceAccessGuard.class);
        controller = new SiteRedirectAdminController(service, guard);
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("user-1");
        file = new MockMultipartFile("file", "redirects.csv", "text/csv",
                "from_path,to_path,status_code\n/a,/p/x,301\n".getBytes());
    }

    @Test
    void everyEndpointAsksTheGuardForTheCatalogueFeatureAndTheStoreManagerRole() throws Exception {
        controller.list(INSTITUTE, null, null, null, 0, 50, user);
        controller.importRedirects(INSTITUTE, "validate", null, file, user);
        controller.importRedirects(INSTITUTE, "commit", "rv1.t", file, user);
        controller.delete("id-1", INSTITUTE, user);
        controller.export(INSTITUTE, user, new MockHttpServletResponse());
        verify(guard, times(5)).require(user, INSTITUTE, CommerceFeature.CATALOGUE, Set.of(CommerceRole.STORE_MANAGER));
        verify(service).commit(eq(INSTITUTE), eq("user-1"), eq("redirects.csv"), any(), eq("rv1.t"));
        verify(service).delete(INSTITUTE, "user-1", "id-1");
    }

    @Test
    void aRefusedCallerReachesNoServiceMethod() throws Exception {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(guard).require(any(), any(), any(), any());
        assertThrows(CommerceAccessDeniedException.class, () -> controller.list(INSTITUTE, null, null, null, 0, 50, user));
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.importRedirects(INSTITUTE, "validate", null, file, user));
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.importRedirects(INSTITUTE, "commit", "rv1.t", file, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.delete("id-1", INSTITUTE, user));
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertThrows(CommerceAccessDeniedException.class, () -> controller.export(INSTITUTE, user, response));
        assertEquals(0, response.getContentAsByteArray().length);
        verifyNoInteractions(service);
    }

    @Test
    void theExportIsACsvDownloadThatIsNeverCached() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.export(INSTITUTE, user, response);
        assertEquals("text/csv;charset=UTF-8", response.getContentType().replace(" ", ""));
        assertTrue(response.getHeader("Content-Disposition").startsWith("attachment; filename=\"redirects-"));
        assertEquals("no-store", response.getHeader("Cache-Control"));
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
        verify(service).auditExport(INSTITUTE, "user-1");
        verify(service).export(eq(INSTITUTE), any());
    }

    @Test
    void anUnknownModeAnEmptyOrOversizedFileAndAnotherFormatAreRefusedBeforeReading() throws IOException {
        assertThrows(InvalidRequestException.class, () -> controller.importRedirects(INSTITUTE, "apply", null, file, user));
        MockMultipartFile empty = new MockMultipartFile("file", "r.csv", "text/csv", new byte[0]);
        assertThrows(InvalidRequestException.class, () -> controller.importRedirects(INSTITUTE, "validate", null, empty, user));
        MockMultipartFile xlsx = new MockMultipartFile("file", "r.xlsx", "application/zip", new byte[]{1});
        assertThrows(InvalidRequestException.class, () -> controller.importRedirects(INSTITUTE, "validate", null, xlsx, user));

        MultipartFile huge = mock(MultipartFile.class);
        when(huge.isEmpty()).thenReturn(false);
        when(huge.getOriginalFilename()).thenReturn("r.csv");
        when(huge.getSize()).thenReturn((long) SiteRedirectCsv.MAX_FILE_BYTES + 1);
        InvalidRequestException tooBig = assertThrows(InvalidRequestException.class,
                () -> controller.importRedirects(INSTITUTE, "validate", null, huge, user));
        assertTrue(tooBig.getMessage().contains("2 MB"));
        verify(huge, never()).getBytes();
        verifyNoInteractions(service);
    }
}
