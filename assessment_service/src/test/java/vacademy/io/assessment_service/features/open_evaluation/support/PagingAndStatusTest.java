package vacademy.io.assessment_service.features.open_evaluation.support;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PagingAndStatusTest {

    @Test
    void limit_defaults_and_bounds() {
        assertThat(Paging.limit(null)).isEqualTo(50);
        assertThat(Paging.limit(200)).isEqualTo(200);
        assertThatThrownBy(() -> Paging.limit(0)).isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> Paging.limit(201)).isInstanceOf(OpenApiException.class);
    }

    @Test
    void cursor_round_trips_and_garbage_is_invalid_cursor() {
        Paging.Cursor c = new Paging.Cursor(Instant.parse("2026-10-01T09:12:44.123Z"), "5a7e-uuid");
        assertThat(Paging.decode(Paging.encode(c))).isEqualTo(c);
        assertThat(Paging.decode(null)).isNull();
        assertThatThrownBy(() -> Paging.decode("!!!"))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getStatus().value()).isEqualTo(400);
                    assertThat(e.getCode()).isEqualTo("invalid_cursor");
                });
        assertThatThrownBy(() -> Paging.decode(java.util.Base64.getUrlEncoder().encodeToString("nobar".getBytes())))
                .isInstanceOf(OpenApiException.class);
    }

    @Test
    void cursor_keeps_microseconds_and_nanoseconds() {
        Paging.Cursor micro = new Paging.Cursor(Instant.parse("2026-10-01T10:00:00.123456Z"), "row-1");
        assertThat(Paging.decode(Paging.encode(micro))).isEqualTo(micro);
        Paging.Cursor nano = new Paging.Cursor(Instant.parse("2026-10-01T10:00:00.123456789Z"), "row-1");
        assertThat(Paging.decode(Paging.encode(nano))).isEqualTo(nano);
        Paging.Cursor beforeEpoch = new Paging.Cursor(Instant.parse("1969-12-31T23:59:59.500Z"), "row-0");
        assertThat(Paging.decode(Paging.encode(beforeEpoch))).isEqualTo(beforeEpoch);
        assertThat(Paging.timestamp(micro).toInstant()).isEqualTo(micro.updatedAt());
        assertThat(Paging.timestamp(null)).isNull();
        // the old millisecond form is not a cursor this API ever issued
        assertThatThrownBy(() -> Paging.decode(java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString("1790000000123|row-1".getBytes())))
                .isInstanceOf(OpenApiException.class);
    }

    @Test
    void more_rows_than_limit_sharing_one_microsecond_page_through_without_repeats() {
        record Row(String id, Instant at) {
        }
        // One transaction's now(): every row has the same microsecond timestamp.
        Instant txNow = Instant.parse("2026-10-01T10:00:00.123456Z");
        List<Row> table = new java.util.ArrayList<>();
        for (int i = 0; i < 7; i++) {
            table.add(new Row(String.format("id-%02d", i), txNow));
        }
        table.add(new Row("id-99", txNow.plusNanos(1_000)));
        java.util.Comparator<Row> order = java.util.Comparator.comparing(Row::at).thenComparing(Row::id);

        List<String> seen = new java.util.ArrayList<>();
        String cursor = null;
        for (int guard = 0; guard < 20; guard++) {
            Paging.Cursor after = Paging.decode(cursor);
            // WHERE (updated_at, id) > (:after_ts, :after_id) ORDER BY updated_at, id LIMIT limit + 1
            List<Row> fetched = table.stream()
                    .filter(r -> after == null || order.compare(r, new Row(after.id(), Paging.timestamp(after).toInstant())) > 0)
                    .sorted(order).limit(3).toList();
            Paging.Page<Row> page = Paging.page(fetched, 2, r -> new Paging.Cursor(r.at(), r.id()));
            page.data().forEach(r -> seen.add(r.id()));
            if (!page.hasMore()) {
                break;
            }
            cursor = page.nextCursor();
        }
        assertThat(seen).containsExactly("id-00", "id-01", "id-02", "id-03", "id-04", "id-05", "id-06", "id-99");
    }

    @Test
    void page_uses_the_extra_row_only_to_say_there_is_more() {
        record Row(String id, Instant at) {
        }
        List<Row> fetched = List.of(new Row("a", Instant.EPOCH), new Row("b", Instant.EPOCH.plusSeconds(1)),
                new Row("c", Instant.EPOCH.plusSeconds(2)));
        Paging.Page<Row> page = Paging.page(fetched, 2, r -> new Paging.Cursor(r.at(), r.id()));
        assertThat(page.data()).extracting(Row::id).containsExactly("a", "b");
        assertThat(page.hasMore()).isTrue();
        assertThat(Paging.decode(page.nextCursor()).id()).isEqualTo("b");

        Paging.Page<Row> last = Paging.page(fetched.subList(0, 2), 2, r -> new Paging.Cursor(r.at(), r.id()));
        assertThat(last.hasMore()).isFalse();
        assertThat(last.nextCursor()).isNull();
    }

    @Test
    void updated_since_must_be_an_instant() {
        assertThat(Paging.updatedSince("2026-10-01T09:00:00Z")).isEqualTo(Instant.parse("2026-10-01T09:00:00Z"));
        assertThat(Paging.updatedSince(null)).isNull();
        assertThatThrownBy(() -> Paging.updatedSince("yesterday")).isInstanceOf(OpenApiException.class);
    }

    @Test
    void submission_status_mapping_follows_spec_8_1() {
        assertThat(PublicStatus.submission("PENDING", false)).isEqualTo("queued");
        assertThat(PublicStatus.submission("STARTED", false)).isEqualTo("queued");
        assertThat(PublicStatus.submission("DISPATCHED", false)).isEqualTo("queued");
        assertThat(PublicStatus.submission("PROCESSING", false)).isEqualTo("processing");
        assertThat(PublicStatus.submission("EXTRACTING", false)).isEqualTo("reading");
        assertThat(PublicStatus.submission("EVALUATING", false)).isEqualTo("grading");
        assertThat(PublicStatus.submission("GRADING", false)).isEqualTo("grading");
        assertThat(PublicStatus.submission("IN_PROGRESS", false)).isEqualTo("grading");
        assertThat(PublicStatus.submission("COMPLETED", false)).isEqualTo("graded");
        assertThat(PublicStatus.submission("COMPLETED", true)).isEqualTo("partially_graded");
        assertThat(PublicStatus.submission("FAILED", false)).isEqualTo("failed");
        assertThat(PublicStatus.submission("CANCELLED", false)).isEqualTo("cancelled");
        assertThat(PublicStatus.submission(null, false)).isEqualTo("graded");
    }

    @Test
    void exam_status_mapping_follows_spec_8_2() {
        assertThat(PublicStatus.exam("DRAFT", false)).isEqualTo("draft");
        assertThat(PublicStatus.exam("PUBLISHED", false)).isEqualTo("open");
        assertThat(PublicStatus.exam("PUBLISHED", true)).isEqualTo("finalized");
        assertThat(PublicStatus.exam("DELETED", false)).isEqualTo("deleted");
    }
}
