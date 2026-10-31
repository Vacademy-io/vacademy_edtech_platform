package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One field of AI_CALLING_SETTING changes under a row lock; everything else is kept as stored. */
class AiCallingSettingsMutatorTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void onlyTheChangedFieldMovesAndTheInstituteIsLocked() throws Exception {
        InstituteRepository institutes = mock(InstituteRepository.class);
        InstituteSettingWriter writer = mock(InstituteSettingWriter.class);
        Institute inst = new Institute();
        inst.setId("inst-1");
        inst.setSetting("{\"setting\":{\"AI_CALLING_SETTING\":{\"key\":\"AI_CALLING_SETTING\",\"name\":\"AI\","
                + "\"data\":{\"provider\":\"VACADEMY_AI\",\"uiOnlyField\":{\"x\":1},\"defaultCampaignId\":\"old\"}},"
                + "\"OTHER\":{\"data\":1}}}");
        when(institutes.findByIdForUpdate("inst-1")).thenReturn(Optional.of(inst));
        AiCallingSettingsMutator m = new AiCallingSettingsMutator(institutes, writer);

        m.update("inst-1", d -> d.put("defaultCampaignId", "a-1"), InstituteSettingWriter.Actor.tenant("api:k"));

        verify(institutes).findByIdForUpdate("inst-1");
        ArgumentCaptor<JsonNode> entry = ArgumentCaptor.forClass(JsonNode.class);
        verify(writer).putSettingKey(same(inst), eq("AI_CALLING_SETTING"), entry.capture(), any());
        JsonNode data = entry.getValue().get("data");
        assertEquals("a-1", data.get("defaultCampaignId").asText());
        assertEquals("VACADEMY_AI", data.get("provider").asText());
        assertEquals(1, data.get("uiOnlyField").get("x").asInt());
        assertEquals("AI", entry.getValue().get("name").asText());
    }

    @Test
    void aMissingSettingIsCreatedAndBrokenJsonIsNeverOverwritten() {
        JsonNode fresh = AiCallingSettingsMutator.currentEntry(null);
        assertEquals("AI_CALLING_SETTING", fresh.get("key").asText());
        assertTrue(fresh.get("data").isObject());
        assertThrows(VacademyException.class, () -> AiCallingSettingsMutator.currentEntry("{not json"));
    }
}
