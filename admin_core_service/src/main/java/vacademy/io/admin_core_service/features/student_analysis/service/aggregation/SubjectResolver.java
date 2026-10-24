package vacademy.io.admin_core_service.features.student_analysis.service.aggregation;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Shared, deterministic subject resolver used by the v2 report collectors
 * ({@code AcademicsCollector}, {@code SubjectMarksCollector}) so subject labels are
 * consistent across the whole report.
 *
 * <p><strong>Why this exists.</strong> Subject used to be read from the DB hint only, so an
 * assessment named "Science Part Test - 2" with a null DB subject rendered as a jarring
 * "Unknown" (subject-performance) / "Other" (marks-by-subject). This resolver adds a cheap
 * keyword-inference pass over the item NAME, and — crucially — returns {@code null} when it
 * genuinely cannot infer a subject, so callers can OMIT the subject rather than inventing a
 * bad label.
 *
 * <p><strong>Precedence:</strong>
 * <ol>
 *   <li>DB subject hint — trusted when present, non-blank, and not itself a placeholder
 *       ("unknown"/"other"/"n/a"/"general").</li>
 *   <li>Keyword inference from the item name (title of the assessment/assignment/quiz/question).</li>
 *   <li>{@code null} — the caller MUST omit the subject, never show "Unknown"/"Other".</li>
 * </ol>
 *
 * <p>Pure/stateless — no I/O, safe to call from collector worker threads.
 */
@Slf4j
@Component
public class SubjectResolver {

    /**
     * Ordered keyword → canonical-subject map. First matching keyword wins, so more specific
     * tokens (e.g. "optics") are listed alongside their subject. Keys are lowercase; matched as
     * whole-word-ish substrings against the normalized name.
     */
    private static final Map<String, String> KEYWORD_TO_SUBJECT = buildKeywordMap();

    private static Map<String, String> buildKeywordMap() {
        Map<String, String> m = new LinkedHashMap<>();

        // Physics (list specific topics before the generic subject word)
        m.put("physics", "Physics");
        m.put("optics", "Physics");
        m.put("magnetism", "Physics");
        m.put("magnet", "Physics");
        m.put("electricity", "Physics");
        m.put("electrostatic", "Physics");
        m.put("kinematics", "Physics");
        m.put("thermodynamics", "Physics");
        m.put("newton", "Physics");
        m.put("mechanics", "Physics");

        // Chemistry
        m.put("chemistry", "Chemistry");
        m.put("organic", "Chemistry");
        m.put("inorganic", "Chemistry");
        m.put("p-block", "Chemistry");
        m.put("p block", "Chemistry");
        m.put("periodic", "Chemistry");
        m.put("mole concept", "Chemistry");

        // Biology
        m.put("biology", "Biology");
        m.put("botany", "Biology");
        m.put("zoology", "Biology");
        m.put("genetics", "Biology");
        m.put("photosynthesis", "Biology");

        // Mathematics
        m.put("mathematics", "Mathematics");
        m.put("maths", "Mathematics");
        m.put("math", "Mathematics");
        m.put("algebra", "Mathematics");
        m.put("geometry", "Mathematics");
        m.put("trigonometry", "Mathematics");
        m.put("calculus", "Mathematics");
        m.put("polynomial", "Mathematics");
        m.put("arithmetic", "Mathematics");

        // Science (generic — placed AFTER the specific science subjects so "physics quiz"
        // resolves to Physics, but a bare "Science Part Test" still resolves to Science)
        m.put("science", "Science");
        m.put("evs", "Science");

        // English / languages
        m.put("english", "English");
        m.put("grammar", "English");
        m.put("literature", "English");
        m.put("comprehension", "English");

        // Commerce stream (Class 11/12). Economics is its own subject here, not Social Studies —
        // folding it in mislabelled every Economics test of a commerce batch.
        m.put("accountancy", "Accountancy");
        m.put("accounts", "Accountancy");
        m.put("accounting", "Accountancy");
        m.put("business studies", "Business Studies");
        m.put("business", "Business Studies");
        m.put("economics", "Economics");
        m.put("entrepreneurship", "Entrepreneurship");

        // Social studies
        m.put("social", "Social Studies");
        m.put("history", "Social Studies");
        m.put("geography", "Social Studies");
        m.put("civics", "Social Studies");
        m.put("political", "Social Studies");

        // Computers
        m.put("computer", "Computer Science");
        m.put("coding", "Computer Science");
        m.put("programming", "Computer Science");

        // General knowledge / reasoning
        m.put("reasoning", "Reasoning");
        m.put("aptitude", "Aptitude");

        return m;
    }

    /**
     * Resolve a subject for an item, or {@code null} when no reliable subject can be determined.
     *
     * @param dbSubjectHint the subject as stored in the DB (may be null/blank/placeholder)
     * @param itemName      the human name/title of the item (assessment/assignment/quiz/question)
     * @return canonical subject name, or {@code null} to signal "omit — do not label".
     */
    public String resolve(String dbSubjectHint, String itemName) {
        // 1. Trust a real DB hint.
        String hint = clean(dbSubjectHint);
        if (hint != null && !isPlaceholder(hint)) {
            return hint;
        }

        // 2. Infer from the name.
        String inferred = inferFromName(itemName);
        if (inferred != null) {
            return inferred;
        }

        // 3. Give up — caller must omit.
        return null;
    }

    /**
     * Like {@link #resolve(String, String)}, but when neither the hint nor the name gives a
     * subject, falls back to the assessment's section name — offline/imported papers usually
     * carry a single section named after the subject ("IED - 21 Jul 2026" / section "IED").
     * The section name is only trusted when the assessment's own name contains it, and generic
     * labels ("Section A", "Part 1", "MCQ", "Theory") are never used as a subject.
     */
    public String resolve(String dbSubjectHint, String itemName, List<String> sectionNames) {
        String resolved = resolve(dbSubjectHint, itemName);
        if (resolved != null || sectionNames == null) return resolved;
        Set<String> distinct = new LinkedHashSet<>();
        for (String name : sectionNames) {
            String c = clean(name);
            if (c != null) distinct.add(c);
        }
        if (distinct.size() != 1) return null;
        String section = distinct.iterator().next();
        String inferred = inferFromName(section);
        if (inferred != null) return inferred;
        String name = normalize(itemName);
        // Whole-word match, so section "IED" does not match inside "Applied …".
        boolean namedAfterSection = name != null && Pattern
                .compile("(^|\\W)" + Pattern.quote(section.toLowerCase(Locale.ROOT)) + "($|\\W)")
                .matcher(name).find();
        return namedAfterSection && !isGenericSectionLabel(section) ? section : null;
    }

    private boolean isGenericSectionLabel(String label) {
        if (isPlaceholder(label)) return true;
        String lower = label.toLowerCase(Locale.ROOT);
        return lower.matches("^(section|part|paper|set|sec|default|question|questions|q)\\b.*")
                || lower.matches("^[a-z0-9]$")
                || lower.matches(".*\\b(mcq|mcqs|objective|subjective|theory|practical|descriptive|"
                        + "short answer|long answer|very short|case study|assertion|reasoning based)\\b.*");
    }

    /** Keyword inference from a free-text name. Returns null if nothing matches. */
    public String inferFromName(String itemName) {
        String norm = normalize(itemName);
        if (norm == null) return null;
        for (Map.Entry<String, String> e : KEYWORD_TO_SUBJECT.entrySet()) {
            if (norm.contains(e.getKey())) {
                return e.getValue();
            }
        }
        return null;
    }

    /**
     * True when the given label is a placeholder we must never surface to a parent
     * (so historical/hint values of "Unknown"/"Other"/etc. also get re-inferred or dropped).
     */
    public boolean isPlaceholder(String label) {
        String c = clean(label);
        if (c == null) return true;
        String lower = c.toLowerCase(Locale.ROOT);
        return lower.equals("unknown") || lower.equals("other") || lower.equals("others")
                || lower.equals("n/a") || lower.equals("na") || lower.equals("general")
                || lower.equals("misc") || lower.equals("miscellaneous") || lower.equals("-")
                || lower.equals("default");   // placeholder subject of a course without subjects
    }

    private String clean(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private String normalize(String s) {
        String c = clean(s);
        if (c == null) return null;
        return c.toLowerCase(Locale.ROOT);
    }
}
