package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** What counts as a lead asking for a call (EngagementReplyResponder.isCallRequest). */
class EngagementCallRequestTest {

    @Test
    void recognisesWaysOfAskingForACall() {
        for (String t : new String[] {
                "I am waiting for a call", "Please call me", "Can I talk on call", "call me back",
                "This number only, call me as soon as possible", "can you call me tomorrow",
                "give me a call", "I want a call", "please call karo", "kal call karo" }) {
            assertTrue(EngagementReplyResponder.isCallRequest(t), t);
        }
    }

    @Test
    void aRefusalOrAnOrdinaryMessageIsNotACallRequest() {
        for (String t : new String[] {
                "don't call me", "please do not call me again", "stop calling me", "call mat karo",
                "never phone this number", "what is the price?", "send me the brochure" }) {
            assertFalse(EngagementReplyResponder.isCallRequest(t), t);
        }
    }
}
