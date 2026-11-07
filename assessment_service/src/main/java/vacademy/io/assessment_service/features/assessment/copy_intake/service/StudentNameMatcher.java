package vacademy.io.assessment_service.features.assessment.copy_intake.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Which student wrote the name on this copy?
 *
 * <p>Pure function of a handwritten reading and the assessment's students, so it
 * can be tested without a database. Names on copies are short, misspelt,
 * abbreviated ("A. Sharma"), reordered ("Sharma Aman") and sometimes just a
 * first name. Scoring therefore works on name TOKENS: exact token overlap first,
 * then a fuzzy token match (edit distance) for misspellings, with initials
 * matching a token's first letter. A roll number, when the reader found one,
 * outranks all of it.
 *
 * <p>The verdict is deliberately three-way. A second student within
 * {@link #AMBIGUITY_MARGIN} of the best score means two "Aman Sharma"s in the
 * batch, and picking one silently would put a copy on the wrong student's
 * record - the one thing this must never do. That copy waits for a person.
 */
public final class StudentNameMatcher {

    /** Below this the best guess is not offered as a match at all. */
    public static final double MATCH_THRESHOLD = 0.80;
    /** Above this, and alone, the match is taken without asking. */
    public static final double AUTO_ACCEPT_THRESHOLD = 0.88;
    /** A runner-up this close to the best is a tie. */
    public static final double AMBIGUITY_MARGIN = 0.08;
    /** Candidates offered to the admin on an ambiguous / unmatched copy. */
    public static final int MAX_CANDIDATES = 6;

    private StudentNameMatcher() {
    }

    @Data
    @Builder
    @AllArgsConstructor
    public static class Candidate {
        private String userId;
        private String registrationId;
        private String name;
        private String rollNumber;
        private String email;
        private String batchId;
        private String batchName;
    }

    @Data
    @Builder
    @AllArgsConstructor
    public static class Scored {
        private Candidate candidate;
        private double score;
    }

    public enum Verdict { MATCHED, AMBIGUOUS, UNMATCHED }

    @Data
    @Builder
    @AllArgsConstructor
    public static class Result {
        private Verdict verdict;
        /** The chosen student when MATCHED, else the best guess (may be null). */
        private Scored best;
        /** Ranked shortlist for the admin, best first. */
        private List<Scored> shortlist;
        private String reason;
    }

    public static Result match(String extractedName, String extractedRoll, List<Candidate> candidates) {
        List<Candidate> pool = candidates == null ? List.of() : candidates;
        if (pool.isEmpty()) {
            return Result.builder().verdict(Verdict.UNMATCHED).shortlist(List.of())
                    .reason("no students on this assessment's batches").build();
        }

        // A roll number is written to be unique; an exact hit ends the search.
        String roll = normalizeRoll(extractedRoll);
        if (!roll.isEmpty()) {
            List<Scored> byRoll = new ArrayList<>();
            for (Candidate c : pool) {
                if (!normalizeRoll(c.getRollNumber()).isEmpty() && normalizeRoll(c.getRollNumber()).equals(roll)) {
                    byRoll.add(new Scored(c, 1.0));
                }
            }
            if (byRoll.size() == 1) {
                return Result.builder().verdict(Verdict.MATCHED).best(byRoll.get(0)).shortlist(byRoll)
                        .reason("roll number " + extractedRoll + " matched").build();
            }
            if (byRoll.size() > 1) {
                return Result.builder().verdict(Verdict.AMBIGUOUS).best(byRoll.get(0)).shortlist(byRoll)
                        .reason(byRoll.size() + " students share roll number " + extractedRoll).build();
            }
        }

        List<String> read = tokens(extractedName);
        if (read.isEmpty()) {
            return Result.builder().verdict(Verdict.UNMATCHED).shortlist(List.of())
                    .reason("no name could be read on the copy").build();
        }

        List<Scored> scored = new ArrayList<>();
        for (Candidate c : pool) {
            double s = score(read, tokens(c.getName()));
            if (s > 0) scored.add(new Scored(c, s));
        }
        scored.sort((a, b) -> Double.compare(b.getScore(), a.getScore()));
        List<Scored> shortlist = scored.subList(0, Math.min(MAX_CANDIDATES, scored.size()));

        if (scored.isEmpty() || scored.get(0).getScore() < MATCH_THRESHOLD) {
            return Result.builder().verdict(Verdict.UNMATCHED)
                    .best(scored.isEmpty() ? null : scored.get(0)).shortlist(shortlist)
                    .reason("\"" + extractedName + "\" is not close enough to any student").build();
        }
        Scored best = scored.get(0);
        if (scored.size() > 1 && scored.get(1).getScore() >= best.getScore() - AMBIGUITY_MARGIN) {
            return Result.builder().verdict(Verdict.AMBIGUOUS).best(best).shortlist(shortlist)
                    .reason("\"" + extractedName + "\" fits " + best.getCandidate().getName()
                            + " and " + scored.get(1).getCandidate().getName() + " equally").build();
        }
        if (best.getScore() < AUTO_ACCEPT_THRESHOLD) {
            return Result.builder().verdict(Verdict.AMBIGUOUS).best(best).shortlist(shortlist)
                    .reason("\"" + extractedName + "\" probably is " + best.getCandidate().getName()
                            + " but the spelling differs; please confirm").build();
        }
        return Result.builder().verdict(Verdict.MATCHED).best(best).shortlist(shortlist)
                .reason("\"" + extractedName + "\" matched " + best.getCandidate().getName()).build();
    }

    // ---- scoring -----------------------------------------------------------

    private static final Set<String> HONORIFICS = new HashSet<>(Arrays.asList(
            "mr", "mrs", "ms", "miss", "master", "shri", "smt", "kumari", "km", "dr", "s/o", "d/o", "w/o"));

    /** Lower-case ASCII letter tokens of a name, honorifics dropped, initials kept. */
    static List<String> tokens(String name) {
        if (name == null) return List.of();
        String s = Normalizer.normalize(name, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z\\s.]", " ")
                .replace('.', ' ');
        List<String> out = new ArrayList<>();
        for (String t : s.trim().split("\\s+")) {
            if (t.isEmpty() || HONORIFICS.contains(t)) continue;
            out.add(t);
        }
        return out;
    }

    static String normalizeRoll(String roll) {
        if (roll == null) return "";
        String s = roll.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        // "007" and "7" are the same roll number.
        return s.replaceFirst("^0+(?=\\d)", "");
    }

    /**
     * 0..1. Each token read off the copy looks for its best counterpart in the
     * student's name; the score is the average over the READ tokens (so a single
     * first name that fits still scores high) with a small bonus when the whole
     * name is covered, and a penalty when the read name has more tokens than
     * the student's (it is probably someone else with a longer name).
     */
    static double score(List<String> read, List<String> candidate) {
        if (read.isEmpty() || candidate.isEmpty()) return 0.0;
        Set<String> unused = new LinkedHashSet<>(candidate);
        double total = 0.0;
        for (String r : read) {
            double best = 0.0;
            String bestTok = null;
            for (String c : unused) {
                double s = tokenSimilarity(r, c);
                if (s > best) {
                    best = s;
                    bestTok = c;
                }
            }
            if (bestTok != null && best >= 0.6) unused.remove(bestTok);
            total += best;
        }
        double avg = total / read.size();
        double coverage = 1.0 - (double) unused.size() / candidate.size();
        double score = 0.85 * avg + 0.15 * coverage;
        if (read.size() > candidate.size() + 1) score -= 0.15;
        return Math.max(0.0, Math.min(1.0, score));
    }

    /** 1.0 exact; initials match a token's first letter; else edit-distance similarity. */
    static double tokenSimilarity(String a, String b) {
        if (a.equals(b)) return 1.0;
        if (a.length() == 1 && b.startsWith(a)) return 0.75;
        if (b.length() == 1 && a.startsWith(b)) return 0.75;
        if (a.length() >= 3 && b.startsWith(a) || b.length() >= 3 && a.startsWith(b)) return 0.85;
        int d = levenshtein(a, b);
        int len = Math.max(a.length(), b.length());
        double sim = 1.0 - (double) d / len;
        return sim >= 0.6 ? sim : 0.0;
    }

    static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[b.length()];
    }

    static List<Scored> none() {
        return Collections.emptyList();
    }
}
