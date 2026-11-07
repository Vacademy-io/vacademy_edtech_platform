package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * The learner's FIRST rating of one card in a flashcards session.
 *
 * The server checks that the outcomes cover exactly the current deck, once each, and
 * stores them; they never change the points (flashcards pay completion only).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FlashcardOutcome {

    public static final String KNOWN = "KNOWN";
    public static final String LEARNING = "LEARNING";

    /** The card id from the deck's payload ({@code ^[a-z0-9_-]{1,24}$}). */
    private String cardId;
    /** KNOWN ("Got it") or LEARNING ("Still learning"). */
    private String result;
}
