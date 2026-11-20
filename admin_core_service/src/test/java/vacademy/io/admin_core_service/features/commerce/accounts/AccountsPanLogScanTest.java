package vacademy.io.admin_core_service.features.commerce.accounts;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.invocation.Invocation;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierSecret;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceAccountHeadRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SensitiveRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierSensitiveService;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierService;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The PAN stays out of logs, exception messages and printed objects in the accounts work.
 *
 * <p>Static half: every {@code log.*} call and every {@code new ...Exception(...)} under
 * {@code features/commerce/accounts} is read from the source; outside string literals none of them
 * names a PAN, a stored value, a request body, a secret row or a PIN. Dynamic half: the real cipher
 * (a test-only key) behind the real supplier and reveal services, with every log event of the JVM
 * captured at DEBUG and every argument handed to a collaborator recorded (the tracing aspect prints
 * the start of each service and repository argument when a call is slow or fails): the PAN appears
 * in none of them, in no exception message and in no {@code toString}.
 */
class AccountsPanLogScanTest {

    private static final Path ACCOUNTS_SOURCE =
            Path.of("src/main/java/vacademy/io/admin_core_service/features/commerce/accounts");
    private static final String INST = "inst-pan";
    /** A PAN-shaped value built by the test. */
    private static final String PAN = "TSTPA" + "1234" + "F";
    private static final String PAN_TWO = "TSTPB" + "5678" + "G";
    private static final String PIN = "905172";

    private static String testKey() {
        byte[] bytes = new byte[32];
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] = (byte) (31 - i);
        }
        return "t1:" + Base64.getEncoder().encodeToString(bytes);
    }

    // ================================================================== static half

    /** Identifiers that would carry a PAN, a stored value, a request body, a secret row or a PIN. */
    private static final Set<String> FORBIDDEN = Set.of("pan", "plain", "stored", "panEncrypted", "panHash",
            "getPan", "getPanEncrypted", "getPanHash", "request", "secret", "draft", "pin", "getPin", "rawPin",
            "encrypted", "value", "keyBytes", "key");

    private static List<Path> accountsSources() throws IOException {
        assertTrue(Files.isDirectory(ACCOUNTS_SOURCE), "run from the admin_core_service module: " + ACCOUNTS_SOURCE);
        try (Stream<Path> files = Files.walk(ACCOUNTS_SOURCE)) {
            return files.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
    }

    /** The text of a call from {@code start} (at the opening parenthesis) to its matching close. */
    private static String callArguments(String source, int open) {
        int depth = 0;
        boolean inString = false;
        for (int i = open; i < source.length(); i++) {
            char c = source.charAt(i);
            if (inString) {
                if (c == '\\') {
                    i++;
                } else if (c == '"') {
                    inString = false;
                }
                continue;
            }
            if (c == '"') {
                inString = true;
            } else if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
                if (depth == 0) {
                    return source.substring(open + 1, i);
                }
            }
        }
        throw new IllegalStateException("unbalanced call at " + open);
    }

    private static Set<String> identifiersOutsideLiterals(String arguments) {
        String code = arguments.replaceAll("\"\"\"[\\s\\S]*?\"\"\"", " ").replaceAll("\"(\\\\.|[^\"\\\\])*\"", " ");
        Set<String> out = new java.util.TreeSet<>();
        Matcher m = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*").matcher(code);
        while (m.find()) {
            out.add(m.group());
        }
        return out;
    }

    @Test
    void noLogCallNamesAPanAStoredValueARequestOrAPin() throws IOException {
        Pattern logCall = Pattern.compile("\\blog\\.(trace|debug|info|warn|error)\\s*\\(");
        List<String> found = new ArrayList<>();
        List<String> wrong = new ArrayList<>();
        for (Path file : accountsSources()) {
            String source = Files.readString(file);
            assertFalse(source.contains("System.out") || source.contains("System.err")
                    || source.contains("printStackTrace"), file + " prints to the console");
            Matcher m = logCall.matcher(source);
            while (m.find()) {
                String args = callArguments(source, m.end() - 1);
                found.add(file.getFileName() + ": " + args.replaceAll("\\s+", " "));
                Set<String> names = identifiersOutsideLiterals(args);
                names.retainAll(FORBIDDEN);
                if (!names.isEmpty()) {
                    wrong.add(file.getFileName() + " logs " + names + ": " + args);
                }
            }
        }
        assertTrue(wrong.isEmpty(), String.join("\n", wrong));
        // Today the only log lines of the accounts work are the cipher's two start-up lines.
        assertEquals(2, found.size(), String.join("\n", found));
        assertTrue(found.stream().allMatch(line -> line.startsWith("CommerceFieldCipher.java")), found.toString());
    }

    @Test
    void noExceptionMessageIsBuiltFromAPanOrAStoredValue() throws IOException {
        Pattern newException = Pattern.compile("new\\s+[A-Za-z]*(Exception|Error)\\s*\\(");
        Set<String> carriers = Set.of("pan", "plain", "stored", "panEncrypted", "panHash", "getPan",
                "getPanEncrypted", "getPanHash", "pin", "getPin", "rawPin", "keyBytes");
        int checked = 0;
        List<String> wrong = new ArrayList<>();
        for (Path file : accountsSources()) {
            String source = Files.readString(file);
            Matcher m = newException.matcher(source);
            while (m.find()) {
                String args = callArguments(source, m.end() - 1);
                Set<String> names = identifiersOutsideLiterals(args);
                names.retainAll(carriers);
                if (!names.isEmpty()) {
                    wrong.add(file.getFileName() + ": " + args.replaceAll("\\s+", " "));
                }
                checked++;
            }
        }
        assertTrue(checked > 20, "exceptions found: " + checked);
        assertTrue(wrong.isEmpty(), String.join("\n", wrong));
    }

    @Test
    void printedObjectsHoldNoPanPinOrKey() {
        SupplierRequest request = new SupplierRequest();
        request.setName("Test Supplier One");
        request.setPan(PAN);
        assertFalse(request.toString().contains(PAN), request.toString());

        PeriodLockRequest lock = new PeriodLockRequest();
        lock.setApproval(new Approval("mgr-1", PIN));
        lock.setReason("Reopen");
        assertFalse(lock.toString().contains(PIN), lock.toString());
        assertFalse(new Approval("mgr-1", PIN).toString().contains(PIN));

        CommerceFieldCipher cipher = new CommerceFieldCipher(testKey(), "");
        String sealed = cipher.encrypt(PAN, CommerceFieldCipher.aad(INST, "sup-1", "pan"));
        CommerceSupplierSecret secret = new CommerceSupplierSecret();
        secret.setPanEncrypted(sealed);
        secret.setPanHash(cipher.keyedHash("pan", INST, PAN));
        secret.setPanLast4("234F");
        String printed = secret.toString();
        assertFalse(printed.contains(sealed) || printed.contains(secret.getPanHash()) || printed.contains("234F"),
                printed);
        String key = testKey().substring(3);
        assertFalse(cipher.toString().contains(key), cipher.toString());
        assertTrue(cipher.toString().contains("t1"), cipher.toString());
    }

    // ================================================================== dynamic half

    private ListAppender<ILoggingEvent> logs;
    private Level appLevel;
    private Level rootLevel;

    @BeforeEach
    void captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        Logger app = (Logger) LoggerFactory.getLogger("vacademy.io");
        rootLevel = root.getLevel();
        appLevel = app.getLevel();
        root.setLevel(Level.DEBUG);
        app.setLevel(Level.TRACE);
        logs = new ListAppender<>();
        logs.start();
        root.addAppender(logs);
    }

    @AfterEach
    void stopCapture() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.detachAppender(logs);
        root.setLevel(rootLevel);
        ((Logger) LoggerFactory.getLogger("vacademy.io")).setLevel(appLevel);
        RequestContextHolder.resetRequestAttributes();
    }

    private List<String> logTexts() {
        List<String> out = new ArrayList<>();
        for (ILoggingEvent event : logs.list) {
            out.add(event.getFormattedMessage());
            if (event.getThrowableProxy() != null) {
                out.add(ThrowableProxyUtil.asString(event.getThrowableProxy()));
            }
            if (event.getArgumentArray() != null) {
                for (Object arg : event.getArgumentArray()) {
                    out.add(String.valueOf(arg));
                }
            }
        }
        return out;
    }

    private static List<String> argumentsSeenBy(Object... mocks) {
        List<String> out = new ArrayList<>();
        for (Object m : mocks) {
            for (Invocation invocation : mockingDetails(m).getInvocations()) {
                for (Object arg : invocation.getArguments()) {
                    out.add(invocation.getMethod().getName() + "(" + arg + ")");
                }
            }
        }
        return out;
    }

    private static CustomUserDetails user(String id, String role) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setFullName("Test " + id);
        dto.setAuthorities(List.of(role));
        return new CustomUserDetails(dto);
    }

    @Test
    void createEditRevealAndEveryRefusalKeepThePanOutOfLogsMessagesAndArguments() {
        CommerceSupplierRepository suppliers = mock(CommerceSupplierRepository.class);
        CommerceSupplierSecretRepository secrets = mock(CommerceSupplierSecretRepository.class);
        CommerceSupplierLedgerRepository ledger = mock(CommerceSupplierLedgerRepository.class);
        CommerceAccountHeadRepository heads = mock(CommerceAccountHeadRepository.class);
        CommerceCustomerRepository customers = mock(CommerceCustomerRepository.class);
        CommerceCounterService counters = mock(CommerceCounterService.class);
        CommerceAuditService audit = mock(CommerceAuditService.class);
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        CommerceFieldCipher cipher = new CommerceFieldCipher(testKey(), "");
        assertTrue(cipher.isConfigured());
        SupplierService service = new SupplierService(suppliers, secrets, ledger, heads, customers, counters, audit,
                cipher, tx);
        when(counters.nextNumber(INST, "S")).thenReturn("S-000001", "S-000002", "S-000003");
        when(suppliers.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
        when(suppliers.saveAndFlush(any())).thenAnswer(inv -> {
            CommerceSupplier s = inv.getArgument(0);
            if (s.getVersion() == null) {
                s.setVersion(0L);
            }
            return s;
        });
        List<String> messages = new ArrayList<>();

        // Create with a PAN (unregistered party).
        SupplierRequest create = new SupplierRequest();
        create.setClientRequestId("create-key-0001");
        create.setName("Test Worker One");
        create.setStateCode("09");
        create.setPan(PAN);
        String supplierId = service.create(INST, "acc-1", create).getId();
        ArgumentCaptor<String> sealed = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> hash = ArgumentCaptor.forClass(String.class);
        verify(secrets).upsert(anyString(), eq(INST), eq(supplierId), sealed.capture(), eq("t1"), hash.capture(),
                eq("234F"), eq("acc-1"));
        assertTrue(sealed.getValue().startsWith("cfc1:t1:"));

        // Edit: set another PAN.
        CommerceSupplier stored = new CommerceSupplier();
        stored.setId(supplierId);
        stored.setInstituteId(INST);
        stored.setCode("S-000001");
        stored.setName("Test Worker One");
        stored.setStateCode("09");
        stored.setVersion(0L);
        when(suppliers.findByInstituteIdAndId(INST, supplierId)).thenReturn(Optional.of(stored));
        when(secrets.findLast4(INST, supplierId)).thenReturn(Optional.of("234F"));
        SupplierRequest edit = new SupplierRequest();
        edit.setVersion(0L);
        edit.setName("Test Worker One");
        edit.setStateCode("09");
        edit.setPan(PAN_TWO);
        assertEquals("******678G", service.update(INST, "acc-1", supplierId, edit).getPanMasked());

        // Invalid PAN: 422 without the value.
        SupplierRequest invalid = new SupplierRequest();
        invalid.setClientRequestId("create-key-0002");
        invalid.setName("Test Worker Two");
        invalid.setStateCode("09");
        String badPan = "TSTPQ12345";
        invalid.setPan(badPan);
        RuntimeException bad = assertThrows(RuntimeException.class, () -> service.create(INST, "acc-1", invalid));
        assertTrue(bad.getMessage().startsWith("INVALID_PAN"), bad.getMessage());
        assertFalse(bad.getMessage().contains(badPan));
        messages.add(bad.getMessage());

        // No key: 503 without the value.
        CommerceFieldCipher noKey = new CommerceFieldCipher("", "");
        SupplierService unkeyed = new SupplierService(suppliers, secrets, ledger, heads, customers, counters, audit,
                noKey, tx);
        SupplierRequest refused = new SupplierRequest();
        refused.setClientRequestId("create-key-0003");
        refused.setName("Test Worker Three");
        refused.setStateCode("09");
        refused.setPan(PAN);
        RuntimeException off = assertThrows(RuntimeException.class, () -> unkeyed.create(INST, "acc-1", refused));
        assertTrue(off.getMessage().startsWith(CommerceFieldCipher.ENCRYPTION_NOT_CONFIGURED), off.getMessage());
        messages.add(off.getMessage());

        // Reveal: the PAN comes back to the caller and nowhere else.
        CapabilityResolver resolver = mock(CapabilityResolver.class);
        when(resolver.isFeatureGranted(anyString(), anyString())).thenReturn(true);
        CommerceAccessGuard guard = new CommerceAccessGuard(resolver, mock(CommerceStaffLocationRepository.class));
        SupplierSensitiveService sensitive = new SupplierSensitiveService(guard, suppliers, secrets, cipher, audit, tx);
        CommerceSupplierSecret row = new CommerceSupplierSecret();
        row.setInstituteId(INST);
        row.setSupplierId(supplierId);
        row.setPanEncrypted(sealed.getValue());
        row.setKeyId("t1");
        row.setPanHash(hash.getValue());
        row.setPanLast4("234F");
        when(secrets.findByInstituteIdAndSupplierId(INST, supplierId)).thenReturn(Optional.of(row));
        MockHttpServletRequest header = new MockHttpServletRequest();
        header.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(header));
        SensitiveRequest field = new SensitiveRequest();
        field.setField("pan");
        Map<String, Object> revealed = sensitive.reveal(user("admin-1", "ADMIN"), INST, supplierId, field);
        assertEquals(PAN, revealed.get("pan"));

        // A tampered stored value: 500 without the value or the stored text.
        String tampered = sealed.getValue().substring(0, sealed.getValue().length() - 2)
                + (sealed.getValue().endsWith("AA") ? "BB" : "AA");
        row.setPanEncrypted(tampered);
        RuntimeException unreadable = assertThrows(RuntimeException.class,
                () -> sensitive.reveal(user("admin-1", "ADMIN"), INST, supplierId, field));
        assertTrue(unreadable.getMessage().startsWith("STORED_VALUE_UNREADABLE"), unreadable.getMessage());
        messages.add(unreadable.getMessage());
        // The stored value written under another supplier's AAD does not open either.
        row.setPanEncrypted(sealed.getValue());
        when(suppliers.findByInstituteIdAndId(INST, "sup-other")).thenReturn(Optional.of(stored));
        when(secrets.findByInstituteIdAndSupplierId(INST, "sup-other")).thenReturn(Optional.of(row));
        RuntimeException copied = assertThrows(RuntimeException.class,
                () -> sensitive.reveal(user("admin-1", "ADMIN"), INST, "sup-other", field));
        messages.add(copied.getMessage());

        // Nothing but the reveal answer ever held the PAN.
        List<String> logged = logTexts();
        List<String> arguments = argumentsSeenBy(suppliers, ledger, heads, customers, counters, audit);
        List<String> secretArguments = argumentsSeenBy(secrets);
        for (String value : List.of(PAN, PAN_TWO)) {
            for (String line : logged) {
                assertFalse(line.contains(value), "log: " + line);
            }
            for (String message : messages) {
                assertFalse(message.contains(value), "message: " + message);
            }
            for (String arg : arguments) {
                assertFalse(arg.contains(value), "argument: " + arg);
            }
            for (String arg : secretArguments) {
                assertFalse(arg.contains(value), "secret repository argument: " + arg);
            }
        }
        for (String storedText : List.of(sealed.getValue(), hash.getValue())) {
            for (String line : logged) {
                assertFalse(line.contains(storedText), "log holds a stored value: " + line);
            }
            for (String message : messages) {
                assertFalse(message.contains(storedText), "message holds a stored value: " + message);
            }
            for (String arg : arguments) {
                assertFalse(arg.contains(storedText), "a collaborator other than the secret row got a stored value: "
                        + arg);
            }
        }
        assertNotNull(logs.list);
    }
}
