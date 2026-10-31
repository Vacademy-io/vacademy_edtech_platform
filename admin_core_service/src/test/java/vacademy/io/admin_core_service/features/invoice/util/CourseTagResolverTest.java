package vacademy.io.admin_core_service.features.invoice.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CourseTagResolverTest {

    @Test
    @DisplayName("comma-separated tags are trimmed, blanks and repeats dropped")
    void split() {
        assertEquals(List.of("Vet Course", "vet nurses"), CourseTagResolver.split(" Vet Course , ,vet nurses,VET COURSE"));
        assertEquals(List.of(), CourseTagResolver.split(null));
        assertEquals(List.of(), CourseTagResolver.split("  "));
    }

    @Test
    @DisplayName("an unresolvable payment yields no tags rather than an error")
    void nullSafe() {
        assertEquals("", new CourseTagResolver().tagsFor(null));
    }
}
