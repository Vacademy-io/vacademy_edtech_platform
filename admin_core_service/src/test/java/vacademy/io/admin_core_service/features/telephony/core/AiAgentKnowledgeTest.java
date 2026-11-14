package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentKnowledgeDocument;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Reference documents of an agent (V615): stored, kept on omission, rendered into the prompt. */
class AiAgentKnowledgeTest {

    private AiAgentService service;
    private AiAgent stored;

    @BeforeEach
    void setUp() {
        AiAgentRepository repo = mock(AiAgentRepository.class);
        service = new AiAgentService(repo, mock(AiAgentSpeechWarmer.class),
                mock(AiCallQueueItemRepository.class), mock(AiCallingSettingsMutator.class));
        stored = AiAgent.builder().id("a-1").instituteId("inst-1").name("Riya").enabled(true)
                .direction("OUTBOUND").ttsModel("google").voice("hi-IN-Chirp3-HD-Achird")
                .knowledgeDocuments("[{\"id\":\"d1\",\"name\":\"Fees.pdf\",\"kind\":\"PDF\",\"text\":\"Fee is 50000.\",\"chars\":13}]")
                .build();
        when(repo.findByIdAndInstituteId("a-1", "inst-1")).thenReturn(Optional.of(stored));
        when(repo.save(any(AiAgent.class))).thenAnswer(i -> i.getArgument(0));
    }

    private static AiAgentDTO.AiAgentDTOBuilder dto() {
        return AiAgentDTO.builder().id("a-1").instituteId("inst-1").name("Riya").enabled(false)
                .systemPrompt("You are Riya.");
    }

    @Test
    void aClientThatOmitsTheFieldKeepsTheDocuments() {
        // The public API (Telleo) and older admin clients never send knowledgeDocuments.
        service.saveWithResult(dto().build());
        assertTrue(stored.getKnowledgeDocuments().contains("Fees.pdf"));
    }

    @Test
    void anEmptyListRemovesThem() {
        service.saveWithResult(dto().knowledgeDocuments(List.of()).build());
        assertNull(stored.getKnowledgeDocuments());
        assertEquals("", service.knowledgePromptSection(stored));
    }

    @Test
    void documentsAreCleanedAndRenderedAfterThePrompt() {
        service.saveWithResult(dto().knowledgeDocuments(List.of(AiAgentKnowledgeDocument.builder()
                .name("FAQ.txt").text("  Timings:   9 to 6 \r\n\r\n\r\n\r\nUse {{name}} ").build())).build());
        List<AiAgentKnowledgeDocument> docs = service.readKnowledge(stored.getKnowledgeDocuments());
        assertEquals(1, docs.size());
        assertNotNull(docs.get(0).getId());
        assertEquals("Timings: 9 to 6\n\nUse { {name} }", docs.get(0).getText());
        String section = service.knowledgePromptSection(stored);
        assertTrue(section.startsWith("\n\n## Reference documents\n"));
        assertTrue(section.contains("### FAQ.txt\nTimings: 9 to 6"));
        assertFalse(section.contains("{{"));
    }

    @Test
    void tooMuchTextIsRefused() {
        String big = "x".repeat(AiAgentService.MAX_KNOWLEDGE_CHARS + 1);
        AiAgentDTO d = dto().knowledgeDocuments(List.of(AiAgentKnowledgeDocument.builder()
                .name("Big.pdf").text(big).build())).build();
        assertThrows(VacademyException.class, () -> service.saveWithResult(d));
    }

    @Test
    void aCorruptBlobReadsAsNoDocuments() {
        stored.setKnowledgeDocuments("not json");
        assertTrue(service.readKnowledge(stored.getKnowledgeDocuments()).isEmpty());
        assertEquals("", service.knowledgePromptSection(stored));
    }
}
