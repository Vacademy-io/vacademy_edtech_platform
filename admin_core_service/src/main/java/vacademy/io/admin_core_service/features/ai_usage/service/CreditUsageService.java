package vacademy.io.admin_core_service.features.ai_usage.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.FlatLogRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.FlatMessageRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.FlatSessionRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.FlowAiUsageLogRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.FlowAiUsageRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.FlowAiUsageSummary;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.RoleSummaryRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.UsageLogRow;
import vacademy.io.admin_core_service.features.ai_usage.dto.CreditUsageDtos.UserUsageRow;
import vacademy.io.admin_core_service.features.ai_usage.repository.ConversationRepository;
import vacademy.io.admin_core_service.features.ai_usage.repository.CreditUsageRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Per-user AI credit usage. Aggregates from credit_transactions (admin_core DB)
 * and enriches names + roles from the auth-service (different DB) via AuthService,
 * since the user directory can't be SQL-joined here. The user-with-usage set is
 * bounded, so role-filter + sort + pagination happen in memory after enrichment.
 */
@Service
@Slf4j
public class CreditUsageService {

    @Autowired
    private CreditUsageRepository repository;

    @Autowired
    private ConversationRepository conversationRepository;

    @Autowired
    private AuthService authService;

    /** Only for the live balance shown next to the Automations chatbot usage figures. */
    @Autowired
    private CreditClient creditClient;

    public Page<UserUsageRow> listUsers(String instituteId, Timestamp from, Timestamp to,
                                        String role, String name, Pageable pageable) {
        List<Object[]> agg = repository.findAllUserUsage(instituteId, from, to);
        Map<String, UserDTO> users = resolveUsers(agg);
        String nameNeedle = (name == null || name.isBlank()) ? null : name.toLowerCase().trim();

        List<UserUsageRow> rows = new ArrayList<>();
        for (Object[] r : agg) {
            String uid = str(r[0]);
            UserDTO u = users.get(uid);
            List<String> roles = (u != null && u.getRoles() != null) ? u.getRoles() : List.of();
            // Role filter (sub-tab): keep users who hold the selected role.
            if (role != null && !roles.contains(role)) {
                continue;
            }
            // Name filter (search box): match on resolved full name OR email.
            if (nameNeedle != null && !matchesName(u, nameNeedle)) {
                continue;
            }
            String rolesStr = roles.isEmpty() ? str(r[1]) : String.join(",", roles);
            rows.add(UserUsageRow.builder()
                    .userId(uid)
                    .name(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .roles(rolesStr)
                    .totalCredits(round(dbl(r[2])))
                    .requestCount(lng(r[3]))
                    .build());
        }
        // Already ordered by net_credits DESC from the DB; paginate in memory.
        int total = rows.size();
        int start = (int) pageable.getOffset();
        int end = Math.min(start + pageable.getPageSize(), total);
        List<UserUsageRow> pageContent = (start <= end && start < total) ? rows.subList(start, end) : List.of();
        return new PageImpl<>(pageContent, pageable, total);
    }

    public List<RoleSummaryRow> roleSummary(String instituteId, Timestamp from, Timestamp to) {
        List<Object[]> agg = repository.findAllUserUsage(instituteId, from, to);
        Map<String, UserDTO> users = resolveUsers(agg);

        // role -> [userCount, totalCredits]. A user with multiple roles counts in each.
        Map<String, double[]> byRole = new LinkedHashMap<>();
        for (Object[] r : agg) {
            String uid = str(r[0]);
            double credits = round(dbl(r[2]));
            UserDTO u = users.get(uid);
            List<String> roles;
            if (u != null && u.getRoles() != null && !u.getRoles().isEmpty()) {
                roles = u.getRoles();
            } else {
                String ledger = str(r[1]);
                roles = (ledger != null) ? List.of(ledger) : List.of("UNKNOWN");
            }
            for (String role : roles) {
                double[] v = byRole.computeIfAbsent(role, k -> new double[2]);
                v[0] += 1;
                v[1] += credits;
            }
        }
        return byRole.entrySet().stream()
                .map(e -> RoleSummaryRow.builder()
                        .role(e.getKey())
                        .userCount((long) e.getValue()[0])
                        .totalCredits(round(e.getValue()[1]))
                        .build())
                .sorted((a, b) -> Double.compare(b.getTotalCredits(), a.getTotalCredits()))
                .toList();
    }

    public Page<UsageLogRow> userLogs(String instituteId, String userId, Timestamp from,
                                      Timestamp to, Pageable pageable) {
        return repository.findUserLogs(instituteId, userId, from, to, pageable).map(this::toLogRow);
    }

    /**
     * Flat list of every deduction in the window, attributed to a member and
     * honouring the same role/name filters as the user list — for the export's
     * "Activity Log" sheet. Capped to keep a runaway export bounded.
     */
    public List<FlatLogRow> allLogs(String instituteId, Timestamp from, Timestamp to,
                                    String role, String name, int cap) {
        List<Object[]> logs = repository.findAllLogs(instituteId, from, to, PageRequest.of(0, cap)).getContent();
        List<String> ids = logs.stream().map(r -> str(r[1])).filter(Objects::nonNull).distinct().toList();
        Map<String, UserDTO> users = resolveUsersByIds(ids);
        String nameNeedle = (name == null || name.isBlank()) ? null : name.toLowerCase().trim();

        List<FlatLogRow> out = new ArrayList<>();
        for (Object[] r : logs) {
            String uid = str(r[1]);
            UserDTO u = users.get(uid);
            List<String> roles = (u != null && u.getRoles() != null) ? u.getRoles() : List.of();
            if (role != null && !roles.contains(role)) {
                continue;
            }
            if (nameNeedle != null && !matchesName(u, nameNeedle)) {
                continue;
            }
            out.add(FlatLogRow.builder()
                    .createdAt(millis(r[0]))
                    .userId(uid)
                    .name(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .roles(roles.isEmpty() ? null : String.join(",", roles))
                    .requestType(str(r[2]))
                    .model(str(r[3]))
                    .credits(round(dbl(r[4])))
                    .description(str(r[5]))
                    .build());
        }
        return out;
    }

    /**
     * Flat list of Student-AI chat sessions across the institute (role/name/date
     * filtered, user-attributed) — for the export's "Chat Sessions" sheet.
     */
    public List<FlatSessionRow> allSessions(String instituteId, Timestamp from, Timestamp to,
                                            String role, String name, int cap) {
        List<Object[]> sessions = conversationRepository
                .findAllSessions(instituteId, from, to, PageRequest.of(0, cap)).getContent();
        List<String> ids = sessions.stream().map(r -> str(r[2])).filter(Objects::nonNull).distinct().toList();
        Map<String, UserDTO> users = resolveUsersByIds(ids);
        String nameNeedle = (name == null || name.isBlank()) ? null : name.toLowerCase().trim();

        List<FlatSessionRow> out = new ArrayList<>();
        for (Object[] r : sessions) {
            String uid = str(r[2]);
            UserDTO u = users.get(uid);
            List<String> roles = (u != null && u.getRoles() != null) ? u.getRoles() : List.of();
            if (role != null && !roles.contains(role)) {
                continue;
            }
            if (nameNeedle != null && !matchesName(u, nameNeedle)) {
                continue;
            }
            out.add(FlatSessionRow.builder()
                    .createdAt(millis(r[0]))
                    .lastActive(millis(r[1]))
                    .userId(uid)
                    .name(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .roles(roles.isEmpty() ? null : String.join(",", roles))
                    .sessionId(str(r[3]))
                    .contextType(str(r[4]))
                    .contextTitle(str(r[5]))
                    .sessionMode(str(r[6]))
                    .status(str(r[7]))
                    .messageCount(lng(r[8]))
                    .preview(clip(str(r[9])))
                    .build());
        }
        return out;
    }

    /**
     * Flat list of chat messages (prompts + AI answers) across the institute
     * (role/name/date filtered, user-attributed) — for the "Chat Messages" sheet.
     */
    public List<FlatMessageRow> allMessages(String instituteId, Timestamp from, Timestamp to,
                                            String role, String name, int cap) {
        List<Object[]> messages = conversationRepository
                .findAllMessages(instituteId, from, to, PageRequest.of(0, cap)).getContent();
        List<String> ids = messages.stream().map(r -> str(r[1])).filter(Objects::nonNull).distinct().toList();
        Map<String, UserDTO> users = resolveUsersByIds(ids);
        String nameNeedle = (name == null || name.isBlank()) ? null : name.toLowerCase().trim();

        List<FlatMessageRow> out = new ArrayList<>();
        for (Object[] r : messages) {
            String uid = str(r[1]);
            UserDTO u = users.get(uid);
            List<String> roles = (u != null && u.getRoles() != null) ? u.getRoles() : List.of();
            if (role != null && !roles.contains(role)) {
                continue;
            }
            if (nameNeedle != null && !matchesName(u, nameNeedle)) {
                continue;
            }
            out.add(FlatMessageRow.builder()
                    .createdAt(millis(r[0]))
                    .userId(uid)
                    .name(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .sessionId(str(r[2]))
                    .contextType(str(r[3]))
                    .contextTitle(str(r[4]))
                    .sessionMode(str(r[5]))
                    .messageType(str(r[6]))
                    .content(str(r[7]))
                    .build());
        }
        return out;
    }

    // ── Automations chatbot AI usage (request_type='chatbot') ───────────────

    /**
     * Header figures + per-flow rollup for the Automations chatbot's AI spend, plus the
     * institute's live balance so the panel can render the "paused, out of credits" state
     * from the same call the numbers come from.
     */
    public FlowAiUsageSummary chatbotFlowUsage(String instituteId, Timestamp from, Timestamp to) {
        List<Object[]> totals = repository.findChatbotTotals(instituteId, from, to);
        Object[] t = totals.isEmpty() ? new Object[]{0, 0L, 0L} : totals.get(0);

        List<FlowAiUsageRow> byFlow = repository.findChatbotUsageByFlow(instituteId, from, to).stream()
                .map(r -> FlowAiUsageRow.builder()
                        .flowId(str(r[0]))
                        .flowName(flowNameFromDescription(str(r[5])))
                        .totalCredits(round(dbl(r[1])))
                        .turnCount(lng(r[2]))
                        .userCount(lng(r[3]))
                        .lastUsedAt(millis(r[4]))
                        .build())
                .toList();

        Double balance = null;
        boolean enabled = false;
        try {
            Map<String, Object> b = creditClient.getBalance(instituteId);
            if (b != null && b.get("current_balance") != null) {
                balance = dbl(b.get("current_balance"));
                enabled = balance > 0d;
            }
        } catch (Exception e) {
            // Unreadable balance reads as "cannot confirm funds" — the same fail-closed
            // answer ChatbotAiService gives, so the UI never promises a working bot the
            // engine would refuse to run.
            log.warn("Balance lookup failed for institute {}: {}", instituteId, e.getMessage());
        }

        return FlowAiUsageSummary.builder()
                .totalCredits(round(dbl(t[0])))
                .turnCount(lng(t[1]))
                .userCount(lng(t[2]))
                .flowCount(byFlow.size())
                .currentBalance(balance)
                .aiEnabled(enabled)
                .byFlow(byFlow)
                .build();
    }

    /** Paginated per-turn charge log, optionally narrowed to one flow. */
    public Page<FlowAiUsageLogRow> chatbotFlowLogs(String instituteId, String flowId, Timestamp from,
                                                   Timestamp to, Pageable pageable) {
        Page<Object[]> page = repository.findChatbotLogs(instituteId, flowId, from, to, pageable);
        List<String> ids = page.getContent().stream()
                .map(r -> str(r[3])).filter(Objects::nonNull).distinct().toList();
        Map<String, UserDTO> users = resolveUsersByIds(ids);
        return page.map(r -> {
            String uid = str(r[3]);
            UserDTO u = users.get(uid);
            return FlowAiUsageLogRow.builder()
                    .id(str(r[0]))
                    .createdAt(millis(r[1]))
                    .flowId(str(r[2]))
                    .userId(uid)
                    .name(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .model(str(r[4]))
                    .credits(round(dbl(r[5])))
                    .description(str(r[6]))
                    .build();
        });
    }

    /**
     * Pull the flow name back out of "Chatbot AI reply — {flow}". The name is snapshotted
     * into the description at charge time precisely because chatbot_flow lives in another
     * service's database and cannot be joined here.
     */
    private static String flowNameFromDescription(String description) {
        if (description == null) return null;
        int sep = description.indexOf('—');
        if (sep < 0 || sep + 1 >= description.length()) return null;
        String name = description.substring(sep + 1).trim();
        return name.isEmpty() ? null : name;
    }

    /** Excel cells cap at 32767 chars; keep the session preview short anyway. */
    private static String clip(String s) {
        if (s == null) return null;
        String flat = s.replaceAll("\\s+", " ").trim();
        return flat.length() <= 300 ? flat : flat.substring(0, 300) + "…";
    }

    /** True when the search needle is a substring of the user's full name or email. */
    private static boolean matchesName(UserDTO u, String needle) {
        if (u == null) return false;
        String fullName = u.getFullName();
        String email = u.getEmail();
        return (fullName != null && fullName.toLowerCase().contains(needle))
                || (email != null && email.toLowerCase().contains(needle));
    }

    /** Batch-resolve user_id -> UserDTO from auth-service for an aggregate (keyed on r[0]). */
    private Map<String, UserDTO> resolveUsers(List<Object[]> agg) {
        return resolveUsersByIds(agg.stream().map(r -> str(r[0])).filter(Objects::nonNull).distinct().toList());
    }

    /** Batch-resolve user_id -> UserDTO from auth-service. Degrades to an empty map
     * (names shown as user_id) if auth-service is unavailable — never 500s. */
    private Map<String, UserDTO> resolveUsersByIds(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        try {
            return authService.getUsersFromAuthServiceByUserIds(ids).stream()
                    .filter(u -> u != null && u.getId() != null)
                    .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));
        } catch (Exception e) {
            return Map.of();
        }
    }

    private UsageLogRow toLogRow(Object[] r) {
        return UsageLogRow.builder()
                .id(str(r[0]))
                .createdAt(millis(r[1]))
                .requestType(str(r[2]))
                .model(str(r[3]))
                .credits(round(dbl(r[4])))
                .description(str(r[5]))
                .build();
    }

    // ── coercion helpers (native query returns JDBC types) ──
    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    private static double dbl(Object o) {
        if (o == null) return 0d;
        if (o instanceof Number n) return n.doubleValue();
        try {
            return Double.parseDouble(o.toString());
        } catch (NumberFormatException e) {
            return 0d;
        }
    }

    private static long lng(Object o) {
        if (o == null) return 0L;
        if (o instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(o.toString());
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    private static Long millis(Object o) {
        if (o instanceof Timestamp ts) return ts.getTime();
        if (o instanceof Date d) return d.getTime();
        return null;
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
