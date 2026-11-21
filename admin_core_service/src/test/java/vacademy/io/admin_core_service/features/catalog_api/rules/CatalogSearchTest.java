package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** Word search of GET /courses q, on titles and tags shaped like an exam-prep e-book store. */
class CatalogSearchTest {

    private static boolean finds(String q, String title, String... tags) {
        Set<String> words = new HashSet<>(CatalogSearch.words(title));
        for (String t : tags) words.addAll(CatalogSearch.words(t));
        return CatalogSearch.matchesAll(CatalogSearch.queryWords(q), words);
    }

    @Test
    void wordsInAnyOrderFindTheCourse() {
        assertTrue(finds("April 2026 current affairs", "Weekly Current Affairs 2026 | April 2026 Week 4"));
        assertTrue(finds("SSC CGL reasoning", "SSC CGL / SSC CHSL 2025 Reasoning Sessions Discussion - 3"));
        assertTrue(finds("UPSC EPFO history", "UPSC EPFO 2025 | Complete History in One Shot | Last Minute Revision"));
        assertFalse(finds("April 2026 current affairs", "Weekly Current Affairs 2026 | March 2026 Week 4"));
    }

    @Test
    void tagsCountAsCourseWords() {
        assertTrue(finds("current affairs May 2024 magazine", "Monthly CA Magazine May'24 PDF",
                "Current Affairs", "May 2024"));
        assertTrue(finds("geography Arun sir", "Industrial Regions of India", "State PCS",
                "Geography By Arun Sir"));
    }

    @Test
    void monthsYearsAndPluralsAreTheSameWord() {
        assertTrue(finds("Sawaal CA April 2025", "Sawaal CA Objective PDF April'25"));
        assertTrue(finds("monthly MCQ September 2026", "Monthly CA MCQs PDF September'26"));
        assertTrue(finds("current affairs yearbook", "CA Yearbook - Edition 2026 (Jan'25 - Dec'25) PDF",
                "Current Affairs", "2026"));
        assertFalse(finds("current affairs yearbook", "CA Yearbook - Edition 2026"));   // no synonyms: tags carry it
        assertEquals(List.of("may", "24"), CatalogSearch.words("May'24"));
        assertEquals(List.of("science", "by", "neha", "maam"), CatalogSearch.words("Science By Neha Ma'am"));
    }

    @Test
    void fillerWordsAreNotRequired() {
        assertTrue(finds("fundamental rights PYQs ebook", "Polity PYQs for State PSC | Fundamental Rights"));
        assertTrue(finds("economics notes pdf", "Indian Economics | Balance of Payments PYQs for SSC"));
        assertEquals(List.of(), CatalogSearch.queryWords("the pdf books"));
    }

    @Test
    void prefixesMatchButNumbersAndShortWordsAreWhole() {
        assertTrue(finds("geo", "Lapse Rate | Climatology - Geography"));
        assertFalse(finds("24", "Top 240 MCQs"));
        assertFalse(finds("ca", "Cabinet Committees Explained"));
        assertTrue(finds("English vocabulary stories", "Learn English Vocab Through Stories: Class 3"));
        assertFalse(finds("geography", "Geo Quiz"));                     // course short forms need 5+ letters
    }

    @Test
    void devanagariWordsKeepTheirMatras() {
        assertEquals(List.of("मासिक", "करंट", "अफेयर्स", "अक्टूबर", "24", "pdf"),
                CatalogSearch.words("मासिक करंट अफेयर्स अक्टूबर'24 PDF"));
        assertTrue(finds("मासिक करंट अफेयर्स", "मासिक करंट अफेयर्स जुलाई’24"));
        assertFalse(finds("मासिक करंट अफेयर्स", "Weekly Current Affairs 2026 | April 2026 Week 4"));
    }

    @Test
    void titleScoreRanksTheClosestTitleFirst() {
        String q = "the hindu analysis december";
        List<String> qw = CatalogSearch.queryWords(q);
        double exact = CatalogSearch.titleScore("The Hindu Analysis December week 1 PDF", q, qw);
        double words = CatalogSearch.titleScore("The Hindu Analysis I The Indian Express I December week 4", q, qw);
        double partial = CatalogSearch.titleScore("The Hindu Analysis | September week 1", q, qw);
        assertTrue(exact > words);
        assertTrue(words > partial);
        assertEquals(0, CatalogSearch.titleScore(null, q, qw));
    }
}
