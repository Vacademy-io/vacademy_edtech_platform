package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import static org.mockito.Mockito.doThrow;
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
    /** Audit rows as the store reads them back: kind + reference id to the old value. */
    private final Map<String, String> auditRows = new HashMap<>();

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
        doAnswer(inv -> {
            List<SiteRedirectPlanner.Change> updates = inv.getArgument(1);
            for (SiteRedirectPlanner.Change u : updates) {
                stored.replaceAll(e -> e.id().equals(u.id())
                        ? new SiteRedirectPlanner.Existing(e.id(), e.matchType(), e.fromPath(), u.toPath(), u.statusCode()) : e);
            }
            return null;
        }).when(store).update(eq(INSTITUTE), anyList());
        doAnswer(inv -> {
            List<String> ids = inv.getArgument(1);
            stored.removeIf(e -> ids.contains(e.id()));
            return null;
        }).when(store).deleteAll(eq(INSTITUTE), anyList());
        doAnswer(inv -> {
            auditRows.put(inv.getArgument(3) + " " + inv.getArgument(5), String.valueOf((Object) inv.getArgument(6)));
            return null;
        }).when(audit).record(any(), any(), any(), anyString(), any(), any(), any(), any(), any());
        when(store.commitRecord(eq(INSTITUTE), anyString()))
                .thenAnswer(inv -> Optional.ofNullable(auditRows.get("REDIRECTS_IMPORTED " + inv.getArgument(1))));
        when(store.commitUndone(eq(INSTITUTE), anyString()))
                .thenAnswer(inv -> auditRows.containsKey("REDIRECTS_UNDONE " + inv.getArgument(1)));
    }

    private SiteRedirectDtos.RedirectImportResult load(byte[] file) {
        return service.commit(INSTITUTE, "user-1", "old.csv", file, service.validate(INSTITUTE, "old.csv", file).getCommitToken());
    }

    private static byte[] csv(String rows) {
        return ("from_path,to_path,status_code,match_type\n" + rows).getBytes(StandardCharsets.UTF_8);
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
        assertTrue(result.getCommitToken().startsWith("rv2." + SiteRedirectAdminService.sha256(FILE).substring(0, 16) + "."),
                result.getCommitToken());
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

        ArgumentCaptor<String> undo = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INSTITUTE), eq("user-1"), isNull(), eq("REDIRECTS_IMPORTED"), eq("SITE_REDIRECT"),
                eq(result.getCommitId()), undo.capture(), detail.capture(), isNull());
        assertNotNull(result.getCommitId());
        assertTrue(detail.getValue().contains("\"created\":2"), detail.getValue());
        assertTrue(detail.getValue().contains("\"file_sha256\":\""), detail.getValue());
        assertTrue(detail.getValue().contains("\"commit_id\":\"" + result.getCommitId() + "\""), detail.getValue());
        assertFalse(detail.getValue().contains("red-saree"), "no row contents in the audit");
        assertFalse(detail.getValue().contains("dummy"), "no row contents in the audit");
        // The undo record names the created rows by id; it holds no address of a created row.
        assertTrue(undo.getValue().contains("\"created_ids\":[\"id-0\",\"id-1\"]"), undo.getValue());
        assertFalse(undo.getValue().contains("red-saree") || undo.getValue().contains("dummy"), undo.getValue());
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
        String foreign = service.validate("inst-2", "old.csv", FILE).getCommitToken();
        assertNotNull(foreign);
        assertThrows(ConflictException.class, () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, foreign));
        verify(store, never()).insert(anyString(), anyList());
        verify(audit, never()).record(any(), any(), any(), any(), any(), any());
    }

    @Test
    void commitIsRefusedForAFileWithErrorsWhateverTheToken() {
        byte[] bad = "from_path,to_path,status_code\n/a,/%2F%2Fevil.example,301\n".getBytes(StandardCharsets.UTF_8);
        String madeUp = "rv2." + SiteRedirectAdminService.sha256(bad).substring(0, 16) + "." + "0".repeat(64);
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.commit(INSTITUTE, "user-1", "bad.csv", bad, madeUp));
        assertTrue(e.getMessage().contains("1 errors"));
        verify(store, never()).insert(anyString(), anyList());
    }

    @Test
    void deleteRemovesTheInstitutesRowAndAuditsItsOldValue() {
        SiteRedirectStore.Row row = new SiteRedirectStore.Row("id-1", "/old", "/p/x", 301, "EXACT",
                new Timestamp(0), new Timestamp(0));
        when(store.find(INSTITUTE, "id-1")).thenReturn(Optional.of(row));
        when(store.delete(INSTITUTE, "id-1")).thenReturn(1);
        SiteRedirectDtos.RedirectRow removed = service.delete(INSTITUTE, "user-1", "id-1");
        assertEquals("/old", removed.getFromPath());
        // Under the same lock as a commit, taken before the row is read.
        var order = inOrder(store);
        order.verify(store).lock(INSTITUTE);
        order.verify(store).find(INSTITUTE, "id-1");
        order.verify(store).delete(INSTITUTE, "id-1");
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
        SiteRedirectCsv.write(out, service.exportRows(INSTITUTE));
        assertEquals("\uFEFFfrom_path,to_path,status_code,match_type\r\n/old,/p/x,301,EXACT\r\n/gone,,410,EXACT\r\n",
                out.toString(StandardCharsets.UTF_8));

        service.auditExport(INSTITUTE, "user-1", 2);
        verify(audit).record(INSTITUTE, "user-1", "REDIRECTS_EXPORTED", "SITE_REDIRECT", null, "{\"rows\":2}");
        verify(store, never()).count(any(), any(), any(), any());
    }

    // ------------------------------------------------- review follow-ups

    @Test
    void anAddressWithALiteralPercentSignExportsAsAFileThatImportsBackToTheSameRow() throws Exception {
        // "/%2541" typed in a file is stored decoded once: "/%41", a percent sign and "41".
        load(csv("/%2541,/p/x,301,\n/a?q=%E0%A4%96,/p/y,301,\n"));
        assertEquals("/%41", stored.get(0).fromPath());
        doAnswer(inv -> {
            Consumer<SiteRedirectStore.Row> sink = inv.getArgument(1);
            for (SiteRedirectPlanner.Existing e : stored) {
                sink.accept(new SiteRedirectStore.Row(e.id(), e.fromPath(), e.toPath(), e.statusCode(), e.matchType(), null, null));
            }
            return null;
        }).when(store).each(eq(INSTITUTE), any());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SiteRedirectCsv.write(out, service.exportRows(INSTITUTE));
        String text = out.toString(StandardCharsets.UTF_8);
        assertTrue(text.contains("/%2541,/p/x,301,EXACT"), text);
        // The query part is stored as a browser sends it and written as it is.
        assertTrue(text.contains("/a?q=%E0%A4%96,/p/y,301,EXACT"), text);
        SiteRedirectDtos.RedirectImportResult again = service.validate(INSTITUTE, "export.csv", out.toByteArray());
        assertEquals(0, again.getToCreate());
        assertEquals(0, again.getToUpdate());
        assertEquals(2, again.getUnchanged());
    }

    @Test
    void aDatabaseFailureIsAnsweredWithAPlainMessageAndNoSql() {
        String sql = "INSERT INTO site_redirect (id, institute_id, from_path) VALUES ($1, $2, $3)";
        String token = service.validate(INSTITUTE, "old.csv", FILE).getCommitToken();
        doThrow(new DataIntegrityViolationException(sql)).when(store).insert(eq(INSTITUTE), anyList());
        ConflictException clash = assertThrows(ConflictException.class,
                () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, token));
        assertTrue(clash.getMessage().startsWith("REDIRECT_CONFLICT"), clash.getMessage());
        assertFalse(clash.getMessage().contains("INSERT") || clash.getMessage().contains("site_redirect"));

        doThrow(new DataAccessResourceFailureException("ERROR: invalid byte sequence for encoding \"UTF8\": 0x00; " + sql))
                .when(store).insert(eq(INSTITUTE), anyList());
        VacademyException failed = assertThrows(VacademyException.class,
                () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, token));
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, failed.getStatus());
        assertTrue(failed.getMessage().startsWith("REDIRECT_WRITE_FAILED"), failed.getMessage());
        assertFalse(failed.getMessage().contains("INSERT") || failed.getMessage().contains("0x00"));

        doThrow(new DataAccessResourceFailureException("SELECT id FROM site_redirect")).when(store).all(INSTITUTE);
        VacademyException read = assertThrows(VacademyException.class, () -> service.validate(INSTITUTE, "old.csv", FILE));
        assertTrue(read.getMessage().startsWith("REDIRECT_READ_FAILED"), read.getMessage());
        assertFalse(read.getMessage().contains("SELECT"));
    }

    @Test
    void aDeleteThatRemovesNothingUnderTheLockIsAConflict() {
        when(store.find(INSTITUTE, "id-1")).thenReturn(Optional.of(new SiteRedirectStore.Row("id-1", "/old", "/p/x", 301,
                "EXACT", null, null)));
        when(store.delete(INSTITUTE, "id-1")).thenReturn(0);
        assertThrows(ConflictException.class, () -> service.delete(INSTITUTE, "user-1", "id-1"));
        verify(audit, never()).record(any(), any(), any(), eq("REDIRECT_DELETED"), any(), any(), any(), any(), any());
    }

    @Test
    void anUndoTakesTheWholeCommitBackOnceAndIsAudited() {
        stored.add(new SiteRedirectPlanner.Existing("id-9", "EXACT", "/hi/dummy", "/p/red-saree", 301));
        stored.add(new SiteRedirectPlanner.Existing("id-8", "EXACT", "/untouched", "/p/red-saree", 301));
        List<SiteRedirectPlanner.Existing> before = List.copyOf(stored);
        SiteRedirectDtos.RedirectImportResult commit = load(FILE);
        assertEquals(1, commit.getCreated().size());
        assertEquals(1, commit.getUpdated().size());

        SiteRedirectDtos.RedirectUndoResult undo = service.undo(INSTITUTE, "user-2", commit.getCommitId());
        assertEquals(commit.getCommitId(), undo.getCommitId());
        assertEquals(1, undo.getRemoved());
        assertEquals(1, undo.getRestored());
        assertEquals(Set.copyOf(before), Set.copyOf(stored));
        var order = inOrder(store);
        order.verify(store).lock(INSTITUTE);
        order.verify(store).commitRecord(INSTITUTE, commit.getCommitId());
        order.verify(store).deleteAll(INSTITUTE, List.of(commit.getCreated().get(0).getId()));
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INSTITUTE), eq("user-2"), isNull(), eq("REDIRECTS_UNDONE"), eq("SITE_REDIRECT"),
                eq(commit.getCommitId()), isNull(), detail.capture(), isNull());
        assertTrue(detail.getValue().contains("\"removed\":1"), detail.getValue());

        // Once only.
        assertThrows(ConflictException.class, () -> service.undo(INSTITUTE, "user-2", commit.getCommitId()));
        // A commit id this institute does not have, or no id at all.
        assertThrows(ResourceNotFoundException.class, () -> service.undo(INSTITUTE, "user-2", "no-such-commit"));
        assertThrows(ResourceNotFoundException.class, () -> service.undo(INSTITUTE, "user-2", " "));
        assertThrows(ResourceNotFoundException.class, () -> service.undo(INSTITUTE, "user-2", "x".repeat(65)));
    }

    @Test
    void anUndoIsRefusedWhenARowItWroteHasChangedSinceAndWritesNothing() {
        SiteRedirectDtos.RedirectImportResult commit = load(FILE);
        // A later file points one of the commit's rows elsewhere.
        load(csv("/product/red-saree/,/p/red-saree,301,\n"));
        List<SiteRedirectPlanner.Existing> now = List.copyOf(stored);
        ConflictException e = assertThrows(ConflictException.class,
                () -> service.undo(INSTITUTE, "user-1", commit.getCommitId()));
        assertTrue(e.getMessage().contains("changed or removed since"), e.getMessage());
        assertEquals(now, stored);
        verify(store, never()).deleteAll(anyString(), anyList());
    }

    @Test
    void anUndoIsRefusedWhenPuttingARowBackWouldMakeASecondHop() {
        stored.add(new SiteRedirectPlanner.Existing("id-9", "EXACT", "/x", "/old-target", 301));
        SiteRedirectDtos.RedirectImportResult commit = load(csv("/x,/p/red-saree,301,\n"));
        assertEquals(1, commit.getUpdated().size());
        // Since then /old-target became an address that is redirected itself.
        load(csv("/old-target,/p/red-saree,301,\n"));
        ConflictException e = assertThrows(ConflictException.class,
                () -> service.undo(INSTITUTE, "user-1", commit.getCommitId()));
        assertTrue(e.getMessage().contains("which another row now redirects"), e.getMessage());
        verify(store, never()).deleteAll(anyString(), anyList());
    }

    // ------------------------------------------------- verify follow-ups

    @Test
    void aJunkTokenOrATokenForAnotherFileIsRefusedBeforeTheLockAndThePlan() {
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        SiteRedirectAdminService guarded = new SiteRedirectAdminService(store, audit, transactions);
        String other = guarded.validate(INSTITUTE, "other.csv", csv("/elsewhere,/p/red-saree,301,\n")).getCommitToken();
        org.mockito.Mockito.clearInvocations(store, transactions);

        for (String junk : new String[] {"x", "rv1.any", "rv2.", "rv2." + "0".repeat(64),
                "rv2.0123456789abcdef." + "0".repeat(63), "rv2.0123456789ABCDEF." + "0".repeat(64),
                "rv2.0123456789abcdef." + "0".repeat(64) + ".x", "x".repeat(100_000)}) {
            assertThrows(InvalidRequestException.class,
                    () -> guarded.commit(INSTITUTE, "user-1", "old.csv", FILE, junk), junk);
        }
        // Well formed, but handed out for another file: the file changed since validation.
        ConflictException changed = assertThrows(ConflictException.class,
                () -> guarded.commit(INSTITUTE, "user-1", "old.csv", FILE, other));
        assertTrue(changed.getMessage().contains("another file"), changed.getMessage());
        // A file the parser refuses is not even read when the token is junk.
        assertThrows(InvalidRequestException.class,
                () -> guarded.commit(INSTITUTE, "user-1", "old.csv", new byte[] {(byte) 0xFF}, "junk"));

        verify(store, never()).lock(anyString());
        verify(store, never()).all(anyString());
        verify(store, never()).activeProductSlugs(anyString());
        verify(store, never()).activeCollectionSlugs(anyString());
        verify(transactions, never()).getTransaction(any());
        verify(audit, never()).record(any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void theUndoRecordKeepsEachChangedRowAsIdAndOldValuesOnly() {
        stored.add(new SiteRedirectPlanner.Existing("id-9", "EXACT", "/hi/dummy", "/p/red-saree", 301));
        SiteRedirectDtos.RedirectImportResult commit = load(FILE);
        String record = auditRows.get("REDIRECTS_IMPORTED " + commit.getCommitId());
        assertTrue(record.contains("\"updated\":[[\"id-9\",\"/p/red-saree\",301]]"), record);
        assertFalse(record.contains("old_to_path"), record);
        // The record of an older commit, with field names on every row, is still read.
        assertEquals(List.of(new SiteRedirectAdminService.UndoRow("id-9", "/p/red-saree", 301)),
                SiteRedirectAdminService.UndoRecord.read("{\"created_ids\":[],\"created_digest\":\"d\",\"updated\":"
                        + "[{\"id\":\"id-9\",\"old_to_path\":\"/p/red-saree\",\"old_status_code\":301}],"
                        + "\"updated_digest\":\"e\"}").updated());
        assertEquals(List.of(new SiteRedirectAdminService.UndoRow("id-9", null, 410)),
                SiteRedirectAdminService.UndoRecord.read("{\"created_ids\":[],\"updated\":[[\"id-9\",null,410]]}")
                        .updated());
        // And the undo takes it back.
        assertEquals(1, service.undo(INSTITUTE, "user-1", commit.getCommitId()).getRestored());
        assertEquals("/p/red-saree", stored.stream().filter(e -> e.id().equals("id-9")).findFirst().orElseThrow().toPath());
    }

    @Test
    void aPlanPastItsTimeLimitIsAPlainRefusalAndWritesNothing() {
        assertThrows(SiteRedirectPlanner.PlanTooSlowException.class, () -> SiteRedirectPlanner.plan(
                SiteRedirectCsv.parse(FILE).rows(), List.of(), Set.of(), Set.of(), new SiteRedirectPlanner.Budget(-1, 10)));
        String token = service.validate(INSTITUTE, "old.csv", FILE).getCommitToken();
        SiteRedirectDtos.RedirectImportResult first = load(csv("/x,/p/red-saree,301,\n"));

        service.planBudget = () -> new SiteRedirectPlanner.Budget(-1, SiteRedirectPlanner.MAX_PREFIX_WALK_STEPS);
        InvalidRequestException validate = assertThrows(InvalidRequestException.class,
                () -> service.validate(INSTITUTE, "old.csv", FILE));
        assertTrue(validate.getMessage().startsWith("REDIRECT_PLAN_TOO_SLOW"), validate.getMessage());
        InvalidRequestException commit = assertThrows(InvalidRequestException.class,
                () -> service.commit(INSTITUTE, "user-1", "old.csv", FILE, token));
        assertTrue(commit.getMessage().startsWith("REDIRECT_PLAN_TOO_SLOW"), commit.getMessage());
        InvalidRequestException undo = assertThrows(InvalidRequestException.class,
                () -> service.undo(INSTITUTE, "user-1", first.getCommitId()));
        assertTrue(undo.getMessage().startsWith("REDIRECT_PLAN_TOO_SLOW"), undo.getMessage());
        assertEquals(1, stored.size());
        verify(store).insert(eq(INSTITUTE), anyList());
        verify(store, never()).deleteAll(anyString(), anyList());
    }
}
