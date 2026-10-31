package vacademy.io.assessment_service.features.open_evaluation.support;

/**
 * The v1 language rule (spec 7.6, 13 #7): answers more than 20% Devanagari are refused with
 * {@code language_not_supported}, never graded as English.
 *
 * <p>The share is over letters: every code point that is a letter or sits in a Devanagari
 * block (vowel signs and the virama are combining marks, not letters, but they are still
 * Devanagari writing). Digits, spaces and punctuation do not count either way.
 */
public final class Devanagari {

    public static final double MAX_SHARE = 0.20;

    private Devanagari() {
    }

    /** Share of Devanagari among the letters of {@code text}; 0 for text without letters. */
    public static double share(String text) {
        if (text == null || text.isEmpty()) {
            return 0.0;
        }
        int letters = 0;
        int devanagari = 0;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            boolean deva = isDevanagari(cp);
            if (deva || Character.isLetter(cp)) {
                letters++;
                if (deva) {
                    devanagari++;
                }
            }
        }
        return letters == 0 ? 0.0 : (double) devanagari / letters;
    }

    /** True when more than 20% of the letters are Devanagari. */
    public static boolean exceedsLimit(String text) {
        return share(text) > MAX_SHARE;
    }

    static boolean isDevanagari(int cp) {
        return (cp >= 0x0900 && cp <= 0x097F) || (cp >= 0xA8E0 && cp <= 0xA8FF) || (cp >= 0x11B00 && cp <= 0x11B5F);
    }
}
