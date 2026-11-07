package vacademy.io.notification_service.features.engagement_ledger.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.naming.Context;
import javax.naming.NamingEnumeration;
import javax.naming.NamingException;
import javax.naming.directory.Attribute;
import javax.naming.directory.Attributes;
import javax.naming.directory.DirContext;
import javax.naming.directory.InitialDirContext;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Hashtable;
import java.util.List;
import java.util.TreeSet;

/**
 * Which email senders' replies cannot reach us. inboundEmailEnabled is global, so without this a
 * sender on any other domain reads as "tracked, 0 replies". Answers come from DNS and are cached per
 * domain: a day for a real answer, minutes for a failed lookup, so a DNS blip neither pins the answer
 * for a day nor costs every report a timeout. A failed lookup counts as reachable (today's behaviour).
 */
@Slf4j
@Service
public class EngagementReplyReachabilityService {

    static final Duration ANSWER_TTL = Duration.ofHours(24);
    static final Duration FAILURE_TTL = Duration.ofMinutes(5);

    /** The lookup runs inside the signals read, so it must not hold it for long. */
    private static final String DNS_TIMEOUT_MS = "500";
    private static final String DNS_RETRIES = "1";

    @FunctionalInterface
    interface MxLookup {
        /** The domain's MX records; empty when it has none; throws when DNS gave no answer. */
        List<String> records(String domain) throws Exception;
    }

    private final MxLookup lookup;
    private final Cache<String, Boolean> answers = Caffeine.newBuilder()
            .expireAfterWrite(ANSWER_TTL)
            .maximumSize(10_000)
            .build();
    private final Cache<String, Boolean> failures = Caffeine.newBuilder()
            .expireAfterWrite(FAILURE_TTL)
            .maximumSize(10_000)
            .build();

    public EngagementReplyReachabilityService() {
        this(EngagementReplyReachabilityService::dnsRecords);
    }

    EngagementReplyReachabilityService(MxLookup lookup) {
        this.lookup = lookup;
    }

    /** These senders' addresses whose replies cannot reach us, sorted; an address with no domain is left out. */
    public List<String> unreachable(Collection<String> senders) {
        TreeSet<String> out = new TreeSet<>();
        for (String sender : senders) {
            String domain = EmailReplyMx.domainOf(sender);
            if (domain != null && !reachesUs(domain)) {
                out.add(sender);
            }
        }
        return new ArrayList<>(out);
    }

    private boolean reachesUs(String domain) {
        Boolean known = answers.getIfPresent(domain);
        if (known != null) {
            return known;
        }
        if (failures.getIfPresent(domain) != null) {
            return true;
        }
        try {
            boolean reaches = EmailReplyMx.reachesUs(lookup.records(domain));
            answers.put(domain, reaches);
            return reaches;
        } catch (Exception e) {
            log.warn("MX lookup failed for {}: {}", domain, e.getMessage());
            failures.put(domain, Boolean.TRUE);
            return true;
        }
    }

    private static List<String> dnsRecords(String domain) throws NamingException {
        Hashtable<String, String> env = new Hashtable<>();
        env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.dns.DnsContextFactory");
        env.put("com.sun.jndi.dns.timeout.initial", DNS_TIMEOUT_MS);
        env.put("com.sun.jndi.dns.timeout.retries", DNS_RETRIES);
        DirContext dns = new InitialDirContext(env);
        try {
            // The trailing dot makes the name absolute, so no search domain is appended to it.
            Attributes attributes = dns.getAttributes(domain + ".", new String[]{"MX"});
            Attribute mx = attributes.get("MX");
            List<String> records = new ArrayList<>();
            if (mx != null) {
                NamingEnumeration<?> values = mx.getAll();
                while (values.hasMore()) {
                    records.add(String.valueOf(values.next()));
                }
            }
            return records;
        } finally {
            dns.close();
        }
    }
}
