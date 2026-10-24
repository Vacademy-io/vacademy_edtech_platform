package vacademy.io.admin_core_service.features.course_knowledge;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexMarker;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexQueueWriter;
import vacademy.io.admin_core_service.features.course_knowledge.service.ContentIndexQueueWriter.Mark;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Course knowledge lesson hooks: marks are written once, after commit, never on
 * rollback, never when the property is off, and never at the cost of a save.
 */
class ContentIndexMarkerTest {

    private ContentIndexQueueWriter writer;
    private ContentIndexMarker marker;

    @BeforeEach
    void setUp() {
        writer = mock(ContentIndexQueueWriter.class);
        when(writer.mightBeEnabled()).thenReturn(true);
        marker = new ContentIndexMarker(writer, true);
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
        for (Object key : new ArrayList<>(TransactionSynchronizationManager.getResourceMap().keySet())) {
            TransactionSynchronizationManager.unbindResource(key);
        }
    }

    private static void complete(boolean commit) {
        List<TransactionSynchronization> syncs = TransactionSynchronizationManager.getSynchronizations();
        if (commit) {
            syncs.forEach(TransactionSynchronization::afterCommit);
        }
        int status = commit ? TransactionSynchronization.STATUS_COMMITTED
                : TransactionSynchronization.STATUS_ROLLED_BACK;
        syncs.forEach(s -> s.afterCompletion(status));
        TransactionSynchronizationManager.clearSynchronization();
    }

    @SuppressWarnings("unchecked")
    private static ArgumentCaptor<Collection<Mark>> marksCaptor() {
        return ArgumentCaptor.forClass(Collection.class);
    }

    // ── marker ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("inside a transaction marks are batched and written once, after commit")
    void batchedAndWrittenOnceAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();

        marker.mark("s1", "c1", "SLIDE_UPDATED");
        marker.mark("s2", null, "SLIDE_UPDATED");
        marker.mark("s1", "c1", "SLIDE_UPDATED");
        marker.markAll(List.of(new Mark("s3", "c2"), new Mark("s2", null)), "SLIDE_MOVED");

        verify(writer, never()).enqueue(any(), anyString());
        assertEquals(1, TransactionSynchronizationManager.getSynchronizations().size(),
                "one synchronization per transaction");

        complete(true);

        ArgumentCaptor<Collection<Mark>> marks = marksCaptor();
        verify(writer, times(1)).enqueue(marks.capture(), eq("SLIDE_UPDATED,SLIDE_MOVED"));
        assertEquals(List.of(new Mark("s1", "c1"), new Mark("s2", null), new Mark("s3", "c2")),
                new ArrayList<>(marks.getValue()));
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty(), "batch unbound after completion");
    }

    @Test
    @DisplayName("markChapter is resolved by the writer after commit, in the same single write")
    void chapterMarksJoinTheBatch() {
        TransactionSynchronizationManager.initSynchronization();

        marker.markChapter("c9", "CHAPTER_COPIED");
        marker.mark("s1", "c1", "SLIDE_ADDED");

        complete(true);

        ArgumentCaptor<Collection<Mark>> marks = marksCaptor();
        verify(writer, times(1)).enqueue(marks.capture(), eq(List.of("c9")), eq("CHAPTER_COPIED,SLIDE_ADDED"));
        assertEquals(List.of(new Mark("s1", "c1")), new ArrayList<>(marks.getValue()));
        verify(writer, never()).enqueue(any(), anyString());
    }

    @Test
    @DisplayName("nothing is written when the transaction rolls back")
    void nothingOnRollback() {
        TransactionSynchronizationManager.initSynchronization();

        marker.mark("s1", "c1", "SLIDE_UPDATED");
        marker.markChapter("c2", "CHAPTER_COPIED");

        complete(false);

        verifyNoWrites();
        assertTrue(TransactionSynchronizationManager.getResourceMap().isEmpty(), "batch unbound after rollback");

        // The next transaction on the same thread starts a fresh batch.
        TransactionSynchronizationManager.initSynchronization();
        marker.mark("s5", null, "SLIDE_UPDATED");
        complete(true);
        verify(writer, times(1)).enqueue(eq(List.of(new Mark("s5", null))), eq("SLIDE_UPDATED"));
    }

    @Test
    @DisplayName("outside a transaction the write happens immediately")
    void immediateOutsideTransaction() {
        marker.mark("s1", "c1", "SLIDE_RENAMED");
        verify(writer, times(1)).enqueue(eq(List.of(new Mark("s1", "c1"))), eq("SLIDE_RENAMED"));

        marker.markChapter("c3", "CHAPTER_COPIED");
        verify(writer, times(1)).enqueue(eq(List.of()), eq(List.of("c3")), eq("CHAPTER_COPIED"));
    }

    @Test
    @DisplayName("exceptions thrown by the writer are swallowed, in and outside a transaction")
    void writerExceptionsSwallowed() {
        doThrow(new IllegalStateException("db down")).when(writer).enqueue(any(), anyString());
        doThrow(new IllegalStateException("db down")).when(writer).enqueue(any(), any(), anyString());

        assertDoesNotThrow(() -> marker.mark("s1", "c1", "SLIDE_UPDATED"));
        assertDoesNotThrow(() -> marker.markChapter("c1", "CHAPTER_COPIED"));

        TransactionSynchronizationManager.initSynchronization();
        marker.mark("s2", "c1", "SLIDE_UPDATED");
        assertDoesNotThrow(() -> complete(true));
        verify(writer, times(2)).enqueue(any(), anyString());
    }

    @Test
    @DisplayName("with course.knowledge.index-marker.enabled=false the writer is never called")
    void propertyOffIsNoOp() {
        ContentIndexMarker off = new ContentIndexMarker(writer, false);

        off.mark("s1", "c1", "SLIDE_UPDATED");
        off.markAll(List.of(new Mark("s2", null)), "SLIDE_UPDATED");
        off.markChapter("c1", "CHAPTER_COPIED");

        TransactionSynchronizationManager.initSynchronization();
        off.mark("s3", "c1", "SLIDE_UPDATED");
        assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty());
        complete(true);

        verifyNoInteractions(writer);
    }

    @Test
    @DisplayName("a cached 'nobody enabled it' skips the REQUIRES_NEW call entirely")
    void cachedDisabledSkipsWriterTransaction() {
        when(writer.mightBeEnabled()).thenReturn(false);

        marker.mark("s1", "c1", "SLIDE_UPDATED");

        verifyNoWrites();
    }

    @Test
    @DisplayName("blank slide ids and chapter ids are ignored")
    void blanksIgnored() {
        marker.mark(" ", "c1", "SLIDE_UPDATED");
        marker.mark(null, "c1", "SLIDE_UPDATED");
        marker.markChapter("", "CHAPTER_COPIED");
        marker.markAll(List.of(), "SLIDE_UPDATED");

        verifyNoInteractions(writer);
    }

    private void verifyNoWrites() {
        verify(writer, never()).enqueue(any(), anyString());
        verify(writer, never()).enqueue(any(), any(), anyString());
    }

    // ── writer ────────────────────────────────────────────────────────────

    private static final class WriterFixture {
        final ContentIndexQueueWriter writer = new ContentIndexQueueWriter();
        final EntityManager em = mock(EntityManager.class);
        final Query existsQuery = mock(Query.class);
        final List<String> executed = new ArrayList<>();
        final List<Object> boundSlideIds = new ArrayList<>();

        WriterFixture(boolean anyEnabled) {
            ReflectionTestUtils.setField(writer, "entityManager", em);
            when(existsQuery.getSingleResult()).thenReturn(anyEnabled);
            when(em.createNativeQuery(anyString())).thenAnswer(inv -> {
                String sql = inv.getArgument(0);
                if (sql.startsWith("SELECT EXISTS")) {
                    return existsQuery;
                }
                Query q = mock(Query.class);
                when(q.setParameter(anyString(), any())).thenAnswer(p -> {
                    if ("slideIds".equals(p.getArgument(0))) {
                        boundSlideIds.add(p.getArgument(1));
                    }
                    return q;
                });
                when(q.executeUpdate()).thenAnswer(e -> {
                    executed.add(sql);
                    return 1;
                });
                return q;
            });
        }
    }

    @Test
    @DisplayName("writer: no enabled institute means no upsert, and the answer is cached")
    void writerFastPath() {
        WriterFixture f = new WriterFixture(false);

        f.writer.enqueue(List.of(new Mark("s1", "c1")), "SLIDE_UPDATED");
        f.writer.enqueue(List.of(new Mark("s2", null)), "SLIDE_UPDATED");

        assertTrue(f.executed.isEmpty());
        verify(f.existsQuery, times(1)).getSingleResult();
        assertFalse(f.writer.mightBeEnabled(), "fresh 'false' lets the marker skip the transaction");
    }

    @Test
    @DisplayName("writer: slide ids go in batches of 500; hinted marks add Statement B per chapter")
    void writerBatchesAndHints() {
        WriterFixture f = new WriterFixture(true);
        List<Mark> marks = new ArrayList<>(IntStream.range(0, 1200).mapToObj(i -> new Mark("s" + i, null)).toList());
        marks.add(new Mark("s0", "old-chapter"));

        f.writer.enqueue(marks, "SLIDE_MOVED");

        long bySlide = f.executed.stream().filter(s -> s.contains("WHERE cts.slide_id IN")).count();
        long byHint = f.executed.stream().filter(s -> s.contains("CROSS JOIN (VALUES")).count();
        assertEquals(3, bySlide);
        assertEquals(1, byHint);
        assertEquals(List.of(500, 500, 200),
                f.boundSlideIds.stream().map(o -> ((Collection<?>) o).size()).toList());
        assertTrue(f.writer.mightBeEnabled());
    }

    @Test
    @DisplayName("writer: a failing statement is caught and never rethrown")
    void writerSwallowsStatementFailures() {
        ContentIndexQueueWriter w = new ContentIndexQueueWriter();
        EntityManager em = mock(EntityManager.class);
        ReflectionTestUtils.setField(w, "entityManager", em);
        when(em.createNativeQuery(anyString())).thenThrow(new RuntimeException("relation does not exist"));

        assertDoesNotThrow(() -> w.enqueue(List.of(new Mark("s1", "c1")), List.of("c1"), "SLIDE_UPDATED"));
    }

    // ── SQL text ──────────────────────────────────────────────────────────

    private static final Set<String> KEYWORDS = Set.of(
            "SELECT", "DISTINCT", "FROM", "JOIN", "CROSS", "ON", "AND", "OR", "NOT", "WHERE", "IN", "INSERT",
            "INTO", "CONFLICT", "DO", "UPDATE", "SET", "CASE", "WHEN", "THEN", "ELSE", "END", "NULL", "EXISTS",
            "AS", "VALUES", "INTERVAL", "TRUE", "FALSE", "CAST", "VARCHAR", "NOW", "EXCLUDED");

    private static final Pattern WORD_SPLIT = Pattern.compile("[^A-Za-z]+");

    /** True when the token is two or more keywords run together, e.g. SELECTCASE. */
    private static boolean gluedKeywords(String token, boolean first) {
        if (!first && KEYWORDS.contains(token)) {
            return true;
        }
        for (int i = 1; i < token.length(); i++) {
            if (KEYWORDS.contains(token.substring(0, i)) && gluedKeywords(token.substring(i), false)) {
                return true;
            }
        }
        return false;
    }

    private static List<String> renderedSql() throws Exception {
        List<String> out = new ArrayList<>();
        for (String field : List.of("ANY_ENABLED_SQL", "UPSERT_BY_SLIDE_SQL", "UPSERT_BY_CHAPTER_SQL")) {
            out.add((String) ReflectionTestUtils.getField(ContentIndexQueueWriter.class, field));
        }
        Method hintSql = ContentIndexQueueWriter.class.getDeclaredMethod("hintSql", int.class);
        hintSql.setAccessible(true);
        out.add((String) hintSql.invoke(null, 1));
        out.add((String) hintSql.invoke(null, 3));
        return out;
    }

    @Test
    @DisplayName("SQL: whitespace between every pair of adjacent keywords, no casts after binds, no comments")
    void sqlKeywordsNeverGlued() throws Exception {
        List<String> sqls = renderedSql();
        assertEquals(5, sqls.size());
        for (String sql : sqls) {
            assertNotNull(sql);
            for (String word : WORD_SPLIT.split(sql)) {
                String token = word.toUpperCase();
                assertFalse(gluedKeywords(token, true), () -> "glued keywords '" + word + "' in:\n" + sql);
            }
            assertFalse(sql.contains("::"), "no :: casts (they clash with named parameters)");
            assertFalse(sql.contains("--"), "no SQL comments");
            assertFalse(sql.contains("\\"), "no backslashes");
        }
        assertTrue(gluedKeywords("SELECTCASE", true), "the checker itself catches a glued pair");
        assertTrue(gluedKeywords("ELSEEND", true));
        assertFalse(gluedKeywords("SETTING", true));
    }

    @Test
    @DisplayName("SQL: Statement B binds one literal per slide and keeps paid-run columns untouched")
    void hintStatementShape() throws Exception {
        String sql = renderedSql().get(4);
        assertTrue(sql.contains("(CAST(:s0 AS VARCHAR)),\n    (CAST(:s1 AS VARCHAR)),\n    (CAST(:s2 AS VARCHAR))"));
        assertTrue(sql.contains(") AS v (slide_id)"));
        assertTrue(sql.contains("WHERE cpsm.chapter_id = :chapterId AND cpsm.status <> 'DELETED'"));
        for (String s : renderedSql().subList(1, 5)) {
            assertTrue(s.contains("ON CONFLICT (institute_id, slide_id) DO UPDATE SET"));
            assertTrue(s.contains("JOIN course_knowledge_setting cks ON cks.institute_id = pi.institute_id"
                    + " AND cks.enabled = TRUE"));
            String update = s.substring(s.indexOf("DO UPDATE SET"));
            assertFalse(update.contains("allow_paid") || update.contains("run_id") || update.contains("budget_id"),
                    "a pending paid run keeps its authorisation");
        }
    }
}
