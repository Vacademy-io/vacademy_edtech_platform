package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SiteRedirectAdminServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final byte[] FILE = ("from_path,to_path,status_code\n"
            + "/product/red-saree/,/p/red-saree?lang=en,301\n"
            + "/hi/dummy/,,410\n").getBytes(StandardCharsets.UTF_8);

    private SiteRedirectStore store;
    private CommerceAuditService audit;
    private SiteRedirectAdminService service;
    private final List<SiteRedirectPlanner.Existing> stored = new ArrayList<>();

    @BeforeEach
    void setUp() {
        store = mock(SiteRedirectStore.class);
        audit = mock(CommerceAuditService.class);
        service = new SiteRedirectAdminService(store, audit, mock(PlatformTransactionManager.class));
        when(store.all(INSTITUTE)).thenAnswer(inv -> List.copyOf(stored));
        when(store.activeProductSlugs(INSTITUTE)).thenReturn(Set.of("red-saree"));
        when(store.activeCollectionSlugs(INSTITUTE)).thenReturn(Set.of());
        when(store.insert(eq(INSTITUTE), anyList())).thenAnswer(inv -> {
            List<SiteRedirectPlanner.Change> creates = inv.getArgument(1);
            List<String> ids = new ArrayList<>();
            for (SiteRedirectPlanner.Change c : creates) {
                String id = "id-" + stored.size();
                ids.add(id);
                stored.add(new SiteRedirectPlanner.Existing(id, c.matchType(), c.fromPath(), c.toPath(), c.statusCode()));
            }
            return ids;
        });
    }

    @Test
    void validateWritesNothingAndHandsOutATokenOnlyForAFileWithoutErrors() {
        SiteRedirectDtos.RedirectImportResult result = service.validate(INSTITUTE, "C:\\files\\old-site.csv", FILE);
        assertEquals("validate", result.getMode());
        assertFalse(result.isCommitted());
        assertEquals("old-site.csv", result.getFileName());
        assertEquals(2, result.getRowsTotal());
        assertEquals(2, result.getToCreate());
        assertEquals(0, result.getErrorCount());
        assertNotNull(result.getCommitToken());
        assertTrue(result.getCommitToken().startsWith("rv1."));
        assertNull(result.getCreated());
        verify(store, never()).insert(anyString(), anyList());
        verify(store, never()).update(anyString(), anyList());
        verify(store, never()).lock(anyString());
        verify(audit, never()).record(any(), any(), any(), any(), any(), any());

        byte[] bad = "from_path,to_path,status_code\n/a,https://evil.example/,301\n".getBytes(StandardCharsets.UTF_8);
        SiteRedirectDtos.RedirectImportResult refused = service.validate(INSTITUTE, "bad.csv", bad);
        assertEquals(1, refused.getErrorCount());
        assertNull(refused.getCommitToken());
        assertEquals("error", refused.getIssues().get(0).getSeverity());
        assertEquals("OFF_SITE_TARGET", refused.getIssues().get(0).getCode());
        assertEquals(2, refused.getIssues().get(0).getRow());
    }

    @Test
    void commitWritesUnderTheLockAndAuditsCountsOnly() {
        String token = service.validate(INSTITUTE, "old.csv", FILE).getCommitToken();
        SiteRedirectDtos.RedirectImportResult result = service.commit(INSTITUTE, "user-1", "old.csv", FILE, token);

        assertTrue(result.isCommitted());
        assertEquals(2, result.getCreated().size());
        assertEquals("/product/red-saree", result.getCreated().get(0).getFromPath());
        assertEquals("id-0", result.getCreated().get(0).getId());
        assertEquals(List.of(), result.getUpdated());
        var order = inOrder(store);
        order.verify(store).lock(INSTITUTE);
        order.verify(store).all(INSTITUTE);
        order.verify(store).insert(eq(INSTITUTE), anyList());

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INSTITUTE), eq("user-1"), eq("REDIRECTS_IMPORTED"), eq("SITE_REDIRECT"), isNull(),
                detail.capture());
        assertTrue(detail.getValue().contains("\"created\":2"), detail.getValue());
        assertTrue(detail.getValue().contains("\"file_sha256\":\""), detail.getValue());
        assertFalse(detail.getValue().contains("red-saree"), "no row contents in the audit");
        assertFalse(detail.getValue().contains("dummy"), "no row contents in the audit");
    }

    @Test
    void theSameFileCommittedAgainWritesNothingNew() {
        service.commit(INSTITUTE, "user-1", "old.csv", FILE, service.validate(INSTITUTE, "old.csv", FILE).getCommitToken());
        SiteRedirectDtos.RedirectImportResult again = service.commit(INSTITUTE, "user-1", "old.csv", FILE,
                service.validate(INSTITUTE, "old.csv", FILE).getCommitToken());
        assertEquals(0, again.getToCreate());
        assertEquals(0, again.getToUpdate());
        assertEquals(2, again.getUnchanged());
        assertEquals(List.of(), again.getCreated());
    }

    @Test
    void anUpdateReturnsTheOldValuesForTheUndoFile() {
        stored.add(new SiteRedirectPlanner.Existing("id-9", "EXACT", "/hi/dummy", "/p/red-saree", 301));
        String token = service.validate(INSTITUTE, "old.csv", FILE).getCommitToken();
        SiteRedirectDtos.RedirectImportResult result = service.commit(INSTITUTE, "user-1", "old.csv", FILE, token);
        assertEquals(1, result.getUpdated().size());
        SiteRedirectDtos.WrittenRow updated = result.getUpdated().get(0);
        assertEquals("id-9", updated.getId());
        assertEquals("/p/red-saree", updated.getOldToPath());
        assertEquals(301, updated.getOldStatusCode());
        assertEquals(410, updated.getStatusCode());
        assertNull(updated.getToPath());
        verify(store).update(eq(INSTITUTE), anyList());
    }

    @Test
    void commitIsRefusedWithoutAToken() {
        assertThrows(InvalidRequestException.class, () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, null));
        assertThrows(InvalidRequestException.class, () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, " "));
        verify(store, never()).lock(anyString());
    }

    @Test
    void commitIsRefusedWhenTheStoredRowsOrTheFileChangedSinceValidation() {
        String token = service.validate(INSTITUTE, "old.csv", FILE).getCommitToken();
        // Someone else stored a row for one of the file's addresses in between.
        stored.add(new SiteRedirectPlanner.Existing("id-9", "EXACT", "/hi/dummy", "/p/red-saree", 301));
        assertThrows(ConflictException.class, () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, token));
        stored.clear();

        byte[] other = "from_path,to_path,status_code\n/product/red-saree/,/p/red-saree,301\n".getBytes(StandardCharsets.UTF_8);
        assertThrows(ConflictException.class, () -> service.commit(INSTITUTE, "user-1", "old.csv", other, token));
        // A token of another institute does not fit either.
        assertThrows(ConflictException.class, () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE,
                SiteRedirectAdminService.TOKEN_PREFIX + "0".repeat(64)));
        verify(store, never()).insert(anyString(), anyList());
        verify(audit, never()).record(any(), any(), any(), any(), any(), any());
    }

    @Test
    void commitIsRefusedForAFileWithErrorsWhateverTheToken() {
        byte[] bad = "from_path,to_path,status_code\n/a,/a,301\n".getBytes(StandardCharsets.UTF_8);
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.commit(INSTITUTE, "user-1", "bad.csv", bad, "rv1.x"));
        assertTrue(e.getMessage().contains("1 errors"));
        verify(store, never()).insert(anyString(), anyList());
    }

    @Test
    void deleteRemovesTheInstitutesRowAndAuditsItsOldValue() {
        SiteRedirectStore.Row row = new SiteRedirectStore.Row("id-1", "/old", "/p/x", 301, "EXACT",
                new Timestamp(0), new Timestamp(0));
        when(store.find(INSTITUTE, "id-1")).thenReturn(Optional.of(row));
        SiteRedirectDtos.RedirectRow removed = service.delete(INSTITUTE, "user-1", "id-1");
        assertEquals("/old", removed.getFromPath());
        verify(store).delete(INSTITUTE, "id-1");
        ArgumentCaptor<String> old = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INSTITUTE), eq("user-1"), isNull(), eq("REDIRECT_DELETED"), eq("SITE_REDIRECT"),
                eq("id-1"), old.capture(), isNull(), isNull());
        assertTrue(old.getValue().contains("\"to_path\":\"/p/x\""));

        when(store.find(INSTITUTE, "id-2")).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> service.delete(INSTITUTE, "user-1", "id-2"));
        assertThrows(ResourceNotFoundException.class, () -> service.delete(INSTITUTE, "user-1", "x".repeat(37)));
        verify(store, never()).delete(INSTITUTE, "id-2");
    }

    @Test
    void theListIsBoundedAndSearchesEverySpellingOfAPath() {
        when(store.count(eq(INSTITUTE), any(), any(), any())).thenReturn(3L);
        when(store.page(eq(INSTITUTE), any(), any(), any(), anyInt(), anyInt())).thenReturn(List.of());
        SiteRedirectDtos.RedirectPage page = service.list(INSTITUTE, " %E0%A4%B2 ", "exact", 301, 0, 200);
        assertEquals(3L, page.getTotal());
        assertEquals(200, page.getPageSize());
        verify(store).page(INSTITUTE, Set.of("%E0%A4%B2", "ल"), "EXACT", 301, 0, 200);

        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, null, null, null, 0, 201));
        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, null, null, null, 0, 0));
        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, null, null, null, -1, 10));
        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, null, "REGEX", null, 0, 10));
        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, null, null, 302, 0, 10));
        assertThrows(InvalidRequestException.class, () -> service.list(INSTITUTE, "x".repeat(201), null, null, 0, 10));
        // A page past the end asks for no rows.
        assertEquals(List.of(), service.list(INSTITUTE, null, null, null, 5, 10).getRedirects());
        verify(store, never()).page(eq(INSTITUTE), any(), any(), any(), eq(50), anyInt());
    }

    @Test
    void theSearchFindsADevanagariPathTypedEitherWay() {
        assertEquals(Set.of("ल", "%E0%A4%B2"), SiteRedirectAdminService.needles("ल"));
        assertEquals(Set.of(), SiteRedirectAdminService.needles("  "));
        assertEquals(Set.of("50%", "50%25"), SiteRedirectAdminService.needles("50%"));
    }

    @Test
    void theExportIsTheImportsCsvAndIsAudited() throws Exception {
        doAnswer(inv -> {
            Consumer<SiteRedirectStore.Row> sink = inv.getArgument(1);
            sink.accept(new SiteRedirectStore.Row("id-1", "/old", "/p/x", 301, "EXACT", null, null));
            sink.accept(new SiteRedirectStore.Row("id-2", "/gone", null, 410, "EXACT", null, null));
            return null;
        }).when(store).each(eq(INSTITUTE), any());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        service.export(INSTITUTE, out);
        assertEquals("\uFEFFfrom_path,to_path,status_code,match_type\r\n/old,/p/x,301,EXACT\r\n/gone,,410,EXACT\r\n",
                out.toString(StandardCharsets.UTF_8));

        when(store.count(INSTITUTE, Set.of(), null, null)).thenReturn(2L);
        service.auditExport(INSTITUTE, "user-1");
        verify(audit).record(INSTITUTE, "user-1", "REDIRECTS_EXPORTED", "SITE_REDIRECT", null, "{\"rows\":2}");
    }
}
