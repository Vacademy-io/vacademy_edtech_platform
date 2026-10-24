package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Wire shape for the AI-agent registry (settings UI + CALL_AI picker). */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiAgentDTO {
    private String id;
    private String instituteId;
    private String name;
    private Boolean enabled;
    /** OUTBOUND | INBOUND | BOTH. */
    private String direction;
    private String language;
    private String voice;
    private String openingLine;
    private String systemPrompt;
    private List<String> extractionQuestions;
    /** Blank = classifier defaults from AI_CALLING_SETTING. */
    private List<String> dispositions;
    /** Blank = telephony voicemail/fallback number. */
    private List<String> handoffNumbers;
    private Integer maxCallMinutes;
    /** Speaking rate 0.5–2.0; null = global default (bot TTS_PACE). */
    private Double pace;
    /** Expressiveness 0.01–2.0; null = Sarvam model default (~0.6). */
    private Double temperature;
    /** Voice modulation 1.0–2.5 (pitch-range expansion on the audio, any engine);
     *  null = bot's global default (off). */
    private Double voiceModulation;
    /** {@code rumik} | {@code sarvam}. Null on create = rumik; null on update keeps
     *  the stored engine, so an old client that does not send the field cannot
     *  silently reprice an agent. */
    private String ttsModel;

    /** OFF | FIXED | FULL — TTS speech cache tier (V466). Null/absent = OFF. */
    private String speechCacheMode;
    private String bookingPageId;
    /**
     * Post-call and mid-call action rules. Absent on update = keep what is stored, so an
     * older client that does not know about rules cannot wipe them.
     */
    private List<AiCallActionRule> sendRules;
}
