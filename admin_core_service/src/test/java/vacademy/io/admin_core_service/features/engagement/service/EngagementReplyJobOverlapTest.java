package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Sweep windows overlap, so a message is read twice. A message already handled (for example a
 * "not interested" that put its members on hold) must not pull those members due again.
 */
class EngagementReplyJobOverlapTest {

    private final ObjectMapper om = new ObjectMapper();

    private ArrayNode replies(String... phoneWamid) {
        ArrayNode arr = om.createArrayNode();
        for (int i = 0; i < phoneWamid.length; i += 2) {
            arr.addObject().put("phone", phoneWamid[i]).put("wamid", phoneWamid[i + 1]).put("text", "hi")
                    .put("receivedAt", "2026-10-28T10:00:00Z");
        }
        return arr;
    }

    @Test
    @DisplayName("an already handled message is not promoted again; a new one is")
    void handledRepliesAreNotPromotedAgain() {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        EngagementReplyResponder responder = mock(EngagementReplyResponder.class);
        EngagementReplyMemberQueries queries = mock(EngagementReplyMemberQueries.class);
        EngagementReplyJob job = new EngagementReplyJob(clients, members, responder);
        ReflectionTestUtils.setField(job, "replyQueries", queries);

        when(members.institutesWithLiveEngines()).thenReturn(List.of("i1"));
        when(clients.inboundSince(eq("i1"), anyLong())).thenReturn(replies("9000000001", "w.old", "9000000002", "w.new"));
        when(queries.handledWamids(eq("i1"), anyList())).thenReturn(List.of("w.old"));

        job.sweep();

        verify(members).promoteByPhones(eq("i1"), eq(List.of("9000000002")), any(), any());
        verify(responder, never()).handleReply(anyString(), eq("9000000001"), anyString(), anyString());
        verify(responder).handleReply(eq("i1"), eq("9000000002"), eq("hi"), eq("w.new"));
    }

    @Test
    @DisplayName("when every message was handled nothing is promoted")
    void allHandled() {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        EngagementReplyMemberQueries queries = mock(EngagementReplyMemberQueries.class);
        EngagementReplyJob job = new EngagementReplyJob(clients, members, mock(EngagementReplyResponder.class));
        ReflectionTestUtils.setField(job, "replyQueries", queries);
        when(members.institutesWithLiveEngines()).thenReturn(List.of("i1"));
        when(clients.inboundSince(eq("i1"), anyLong())).thenReturn(replies("9000000001", "w.old"));
        when(queries.handledWamids(eq("i1"), anyList())).thenReturn(List.of("w.old"));
        job.sweep();
        verify(members, never()).promoteByPhones(anyString(), anyList(), any(), any());
    }
}
