package vacademy.io.admin_core_service.features.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

class TemplateConditionalsTest {

    /** Mirrors how the invoice and confirmation renderers use it: prepare, literal replace, finish. */
    private static String render(String template, Map<String, String> values) {
        String filled = TemplateConditionals.prepare(template);
        for (Map.Entry<String, String> e : values.entrySet()) {
            filled = filled.replace("{{" + e.getKey() + "}}", e.getValue());
        }
        return TemplateConditionals.finish(filled);
    }

    @Test
    @DisplayName("a block whose key fills to text is kept, its markers gone")
    void keepsBlockWhenValuePresent() {
        assertEquals("Item <span>Annual Fee</span> end",
                render("Item {{#if tag}}<span>{{tag}}</span>{{/if}} end", Map.of("tag", "Annual Fee")));
    }

    @Test
    @DisplayName("a block whose key fills to blank is dropped")
    void dropsBlockWhenValueBlank() {
        assertEquals("Item  end", render("Item {{#if tag}}<span>{{tag}}</span>{{/if}} end", Map.of("tag", "")));
        assertEquals("Item  end", render("Item {{#if tag}}x{{/if}} end", Map.of("tag", "<span> </span>")));
    }

    @Test
    @DisplayName("a key the renderer does not know hides its block instead of printing syntax")
    void dropsBlockWhenKeyUnknown() {
        assertEquals("a  b", render("a {{#if nope}}secret {{nope}}{{/if}} b", Map.of()));
    }

    @Test
    @DisplayName("several blocks resolve independently, across lines")
    void multipleBlocks() {
        String t = "{{#if a}}A={{a}}{{/if}}|{{#if b}}\nB={{b}}\n{{/if}}|{{#if c}}C{{/if}}";
        assertEquals("A=1|\nB=2\n|", render(t, Map.of("a", "1", "b", "2", "c", "")));
    }

    @Test
    @DisplayName("templates without conditionals pass through untouched")
    void noConditionals() {
        String t = "Hello {{name}}";
        assertSame(t, TemplateConditionals.prepare(t));
        assertEquals("Hello Sam", render(t, Map.of("name", "Sam")));
        assertEquals(null, TemplateConditionals.prepare(null));
        assertEquals(null, TemplateConditionals.finish(null));
    }

    @Test
    @DisplayName("a dollar sign or backslash in a value is not treated as a regex group")
    void specialCharactersSurvive() {
        assertEquals("A$431.00 \\ ok", render("{{#if p}}{{p}} \\ ok{{/if}}", Map.of("p", "A$431.00")));
    }
}
