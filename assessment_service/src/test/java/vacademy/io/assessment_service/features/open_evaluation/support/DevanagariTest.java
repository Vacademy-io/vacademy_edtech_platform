package vacademy.io.assessment_service.features.open_evaluation.support;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DevanagariTest {

    @Test
    void english_text_is_allowed() {
        assertThat(Devanagari.exceedsLimit("Article 356 empowers the President to impose rule.")).isFalse();
        assertThat(Devanagari.share("")).isZero();
        assertThat(Devanagari.share("12345 !!")).isZero();
    }

    @Test
    void hindi_text_is_refused() {
        assertThat(Devanagari.exceedsLimit("अनुच्छेद 356 राष्ट्रपति को शक्ति देता है")).isTrue();
    }

    @Test
    void a_few_hindi_words_in_english_stay_under_twenty_percent() {
        // 2 Devanagari letters among ~40 Latin letters
        assertThat(Devanagari.exceedsLimit("The word धन means wealth in the answer given here")).isFalse();
    }

    @Test
    void mostly_hindi_with_some_english_is_refused() {
        assertThat(Devanagari.exceedsLimit("GDP का मतलब सकल घरेलू उत्पाद है")).isTrue();
    }
}
