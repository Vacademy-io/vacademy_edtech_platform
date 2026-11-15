package vacademy.io.admin_core_service.features.telephony.demo;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Languages the "Try the AI call" demo speaks: the voice-bot language key, the engine and
 * voice, and the first line in that language. The visitor's choice arrives as the lead's
 * Language field (label or key, either case).
 *
 * Navana (Bodhi) voices each speak all ten languages; each language uses a regional
 * female voice for a native accent. All are female because the persona is Vaani and the
 * bot conjugates Hindi verbs from the voice gender. Audition each on a test call.
 */
public final class AiDemoCallLanguages {

    private AiDemoCallLanguages() { }

    /** code = a voice-bot language key (_STT_LANGS in voice_bot_service/app/bot.py). */
    public record Language(String code, String label, String ttsModel, String voice, String openingLine) { }

    static final List<Language> ALL = List.of(
            new Language("english", "English", "navana", "ipsita",
                    "Hello {{name}}, welcome to {{institute_name}}! I am Vaani from the admissions team. "
                            + "Are you enquiring for yourself or for your child?"),
            new Language("hinglish", "Hinglish", "navana", "ipsita",
                    "नमस्ते {{name}} जी, {{institute_name}} में आपका स्वागत है! मैं Vaani, admissions team से "
                            + "बात कर रही हूँ। आप अपने लिए enquiry कर रहे हैं या अपने बच्चे के लिए?"),
            new Language("hindi", "Hindi", "navana", "ipsita",
                    "नमस्ते {{name}} जी, {{institute_name}} में आपका स्वागत है! मैं वाणी, प्रवेश टीम से बात "
                            + "कर रही हूँ। आप अपने लिए जानकारी ले रहे हैं या अपने बच्चे के लिए?"),
            new Language("tamil", "Tamil", "navana", "kayal",
                    "வணக்கம் {{name}}, {{institute_name}}-க்கு உங்களை வரவேற்கிறோம்! நான் வாணி, admissions "
                            + "team-இலிருந்து பேசுகிறேன். நீங்கள் உங்களுக்காக விசாரிக்கிறீர்களா, அல்லது உங்கள் "
                            + "குழந்தைக்காகவா?"),
            new Language("malayalam", "Malayalam", "navana", "ammu",
                    "നമസ്കാരം {{name}}, {{institute_name}}-ലേക്ക് സ്വാഗതം! ഞാൻ വാണി, admissions team-ൽ "
                            + "നിന്നാണ് സംസാരിക്കുന്നത്. നിങ്ങൾക്കു വേണ്ടിയാണോ അതോ കുട്ടിക്കു വേണ്ടിയാണോ "
                            + "അന്വേഷിക്കുന്നത്?"),
            new Language("kannada", "Kannada", "navana", "netra",
                    "ನಮಸ್ಕಾರ {{name}}, {{institute_name}}-ಗೆ ಸ್ವಾಗತ! ನಾನು ವಾಣಿ, admissions team-ನಿಂದ "
                            + "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನೀವು ನಿಮಗಾಗಿ ವಿಚಾರಿಸುತ್ತಿದ್ದೀರಾ ಅಥವಾ ನಿಮ್ಮ ಮಗುವಿಗಾಗಿಯೇ?"),
            new Language("telugu", "Telugu", "navana", "vanaja",
                    "నమస్కారం {{name}}, {{institute_name}}-కి స్వాగతం! నేను వాణి, admissions team నుండి "
                            + "మాట్లాడుతున్నాను. మీరు మీ కోసం అడుగుతున్నారా, లేక మీ పిల్లల కోసమా?"),
            new Language("marathi", "Marathi", "navana", "mukta",
                    "नमस्कार {{name}}, {{institute_name}} मध्ये आपले स्वागत आहे! मी वाणी, admissions team "
                            + "मधून बोलत आहे. तुम्ही स्वतःसाठी चौकशी करत आहात की तुमच्या मुलासाठी?"),
            new Language("bengali", "Bengali", "navana", "jayita",
                    "নমস্কার {{name}}, {{institute_name}}-এ আপনাকে স্বাগত! আমি বাণী, admissions team থেকে "
                            + "বলছি। আপনি নিজের জন্য জানতে চাইছেন, নাকি আপনার সন্তানের জন্য?"),
            new Language("gujarati", "Gujarati", "navana", "falguni",
                    "નમસ્તે {{name}}, {{institute_name}} માં આપનું સ્વાગત છે! હું વાણી, admissions team "
                            + "માંથી વાત કરું છું. તમે તમારા માટે પૂછપરછ કરો છો કે તમારા બાળક માટે?")
    );

    /** The language for a lead field value ("Tamil", "tamil", " TAMIL "), or empty. */
    public static Optional<Language> find(String value) {
        if (value == null || value.isBlank()) return Optional.empty();
        String v = value.trim().toLowerCase(Locale.ROOT);
        return ALL.stream()
                .filter(l -> l.code().equals(v) || l.label().toLowerCase(Locale.ROOT).equals(v))
                .findFirst();
    }
}
