package vacademy.io.admin_core_service.features.telephony.demo;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The demo institute's {@code AI_DEMO_CALL_SETTING} (institutes.setting_json). Absent or
 * {@code enabled=false} means the public page shows the demo as paused and every inbound
 * call behaves exactly as before.
 *
 * <pre>
 * {"enabled": true, "agentId": "...", "dialNumber": "+918035614126",
 *  "displayNumber": "+91 80356 14126", "ttlMinutes": 20,
 *  "languages": [{"code": "tamil", "label": "Tamil", "nativeLabel": "...",
 *                 "ttsModel": "navana", "voice": "kayal", "openingLine": "..."}]}
 * </pre>
 *
 * {@code languages} is optional: without it the built-in table below is used. A language
 * entry that leaves out voice, engine or opening line takes the built-in values for its code.
 */
@Data
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiDemoCallSettings {

    private boolean enabled;
    /** The admission-counsellor agent every demo call is answered by. */
    private String agentId;
    private String dialNumber;
    private String displayNumber;
    private Integer ttlMinutes;
    private List<Language> languages;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Language {
        /** A voice-bot language key (_STT_LANGS in voice_bot_service/app/bot.py). */
        private String code;
        private String label;
        private String nativeLabel;
        private String ttsModel;
        private String voice;
        /** Spoken first. May use the bot placeholders name and institute_name in double braces. */
        private String openingLine;
    }

    public int ttlMinutesOrDefault() {
        return ttlMinutes == null || ttlMinutes < 5 || ttlMinutes > 120 ? 20 : ttlMinutes;
    }

    /** The configured languages merged over the built-in table, in the configured order. */
    public List<Language> effectiveLanguages() {
        if (languages == null || languages.isEmpty()) return BUILT_IN;
        List<Language> out = new ArrayList<>();
        for (Language l : languages) {
            if (l == null || l.getCode() == null || l.getCode().isBlank()) continue;
            String code = l.getCode().trim().toLowerCase(Locale.ROOT);
            Language base = builtIn(code).orElse(new Language(code, code, code, null, null, null));
            out.add(new Language(code,
                    firstNonBlank(l.getLabel(), base.getLabel()),
                    firstNonBlank(l.getNativeLabel(), base.getNativeLabel()),
                    firstNonBlank(l.getTtsModel(), base.getTtsModel()),
                    firstNonBlank(l.getVoice(), base.getVoice()),
                    firstNonBlank(l.getOpeningLine(), base.getOpeningLine())));
        }
        return out.isEmpty() ? BUILT_IN : out;
    }

    public Optional<Language> language(String code) {
        if (code == null) return Optional.empty();
        String c = code.trim().toLowerCase(Locale.ROOT);
        return effectiveLanguages().stream().filter(l -> l.getCode().equals(c)).findFirst();
    }

    static Optional<Language> builtIn(String code) {
        return BUILT_IN.stream().filter(l -> l.getCode().equals(code)).findFirst();
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a.trim() : b;
    }

    /*
     * Navana (Bodhi) voices each speak all ten languages; the voice per language is a
     * regional female name for a native accent. Every voice is female because the persona
     * is Vaani and the bot conjugates Hindi verbs from the voice gender. Audition each one
     * on a test call before the event; any entry can be overridden in the setting without
     * a deploy (Edge per-locale voices such as ta-IN-PallaviNeural with ttsModel edge also work).
     */
    static final List<Language> BUILT_IN = List.of(
            new Language("english", "English", "English", "navana", "ipsita",
                    "Hello {{name}}, welcome to {{institute_name}}! I am Vaani from the admissions team. "
                            + "Are you enquiring for yourself or for your child?"),
            new Language("hinglish", "Hinglish", "Hinglish", "navana", "ipsita",
                    "नमस्ते {{name}} जी, {{institute_name}} में आपका स्वागत है! मैं Vaani, admissions team से "
                            + "बात कर रही हूँ। आप अपने लिए enquiry कर रहे हैं या अपने बच्चे के लिए?"),
            new Language("hindi", "Hindi", "हिन्दी", "navana", "ipsita",
                    "नमस्ते {{name}} जी, {{institute_name}} में आपका स्वागत है! मैं वाणी, प्रवेश टीम से बात "
                            + "कर रही हूँ। आप अपने लिए जानकारी ले रहे हैं या अपने बच्चे के लिए?"),
            new Language("tamil", "Tamil", "தமிழ்", "navana", "kayal",
                    "வணக்கம் {{name}}, {{institute_name}}-க்கு உங்களை வரவேற்கிறோம்! நான் வாணி, admissions "
                            + "team-இலிருந்து பேசுகிறேன். நீங்கள் உங்களுக்காக விசாரிக்கிறீர்களா, அல்லது உங்கள் "
                            + "குழந்தைக்காகவா?"),
            new Language("malayalam", "Malayalam", "മലയാളം", "navana", "ammu",
                    "നമസ്കാരം {{name}}, {{institute_name}}-ലേക്ക് സ്വാഗതം! ഞാൻ വാണി, admissions team-ൽ "
                            + "നിന്നാണ് സംസാരിക്കുന്നത്. നിങ്ങൾക്കു വേണ്ടിയാണോ അതോ കുട്ടിക്കു വേണ്ടിയാണോ "
                            + "അന്വേഷിക്കുന്നത്?"),
            new Language("kannada", "Kannada", "ಕನ್ನಡ", "navana", "netra",
                    "ನಮಸ್ಕಾರ {{name}}, {{institute_name}}-ಗೆ ಸ್ವಾಗತ! ನಾನು ವಾಣಿ, admissions team-ನಿಂದ "
                            + "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನೀವು ನಿಮಗಾಗಿ ವಿಚಾರಿಸುತ್ತಿದ್ದೀರಾ ಅಥವಾ ನಿಮ್ಮ ಮಗುವಿಗಾಗಿಯೇ?"),
            new Language("telugu", "Telugu", "తెలుగు", "navana", "vanaja",
                    "నమస్కారం {{name}}, {{institute_name}}-కి స్వాగతం! నేను వాణి, admissions team నుండి "
                            + "మాట్లాడుతున్నాను. మీరు మీ కోసం అడుగుతున్నారా, లేక మీ పిల్లల కోసమా?"),
            new Language("marathi", "Marathi", "मराठी", "navana", "mukta",
                    "नमस्कार {{name}}, {{institute_name}} मध्ये आपले स्वागत आहे! मी वाणी, admissions team "
                            + "मधून बोलत आहे. तुम्ही स्वतःसाठी चौकशी करत आहात की तुमच्या मुलासाठी?"),
            new Language("bengali", "Bengali", "বাংলা", "navana", "jayita",
                    "নমস্কার {{name}}, {{institute_name}}-এ আপনাকে স্বাগত! আমি বাণী, admissions team থেকে "
                            + "বলছি। আপনি নিজের জন্য জানতে চাইছেন, নাকি আপনার সন্তানের জন্য?"),
            new Language("gujarati", "Gujarati", "ગુજરાતી", "navana", "falguni",
                    "નમસ્તે {{name}}, {{institute_name}} માં આપનું સ્વાગત છે! હું વાણી, admissions team "
                            + "માંથી વાત કરું છું. તમે તમારા માટે પૂછપરછ કરો છો કે તમારા બાળક માટે?")
    );
}
