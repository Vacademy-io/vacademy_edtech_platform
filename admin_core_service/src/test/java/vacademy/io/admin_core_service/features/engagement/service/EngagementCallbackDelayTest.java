package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The delay a lead's callback request turns into (EngagementCrmActionService.callbackDelayHours). */
class EngagementCallbackDelayTest {

    @Test
    void readsWhenTheLeadAskedToBeCalled() {
        assertEquals(3, EngagementCrmActionService.callbackDelayHours("please call me back in 3 hours"));
        assertEquals(24, EngagementCrmActionService.callbackDelayHours("call me tomorrow"));
        assertEquals(24, EngagementCrmActionService.callbackDelayHours("kal call karo"));
        assertEquals(2, EngagementCrmActionService.callbackDelayHours("call me later"));
    }

    @Test
    void noTimeMeansTheNextCallingSlot() {
        assertEquals(0, EngagementCrmActionService.callbackDelayHours("call me back"));
        assertEquals(0, EngagementCrmActionService.callbackDelayHours(null));
    }

    @Test
    void capsAFarOffRequest() {
        assertEquals(72, EngagementCrmActionService.callbackDelayHours("call me back in 99 hours"));
    }
}
