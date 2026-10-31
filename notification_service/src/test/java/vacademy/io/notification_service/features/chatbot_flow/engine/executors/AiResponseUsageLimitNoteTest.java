package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** A usage-limit pause must not read as "no AI credits" in the Inbox. */
class AiResponseUsageLimitNoteTest {

    @Test
    void theNoteCarriesTheLimitsOwnSentence() {
        assertEquals("AI usage limit reached: You've reached today's limit for WhatsApp AI reply.",
                AiResponseNodeExecutor.usageLimitNote(" You've reached today's limit for WhatsApp AI reply. "));
    }

    @Test
    void withoutASentenceItStillSaysUsageLimitNotCredits() {
        String note = AiResponseNodeExecutor.usageLimitNote(null);
        assertTrue(note.startsWith("AI usage limit reached"));
        assertTrue(note.contains("not a credits problem"));
        assertEquals(note, AiResponseNodeExecutor.usageLimitNote("  "));
    }
}
