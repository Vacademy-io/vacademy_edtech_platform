package vacademy.io.admin_core_service.features.catalog_api.website;

import java.util.List;

/**
 * Reads the website-verification TXT record of a host. Behind an interface so tests stub DNS.
 *
 * <p>Takes the website HOST, never a DNS name: implementations query only
 * {@code _vacademy-verification.<normalised host>} ({@link WebsiteHosts#verificationRecordName}),
 * so this can never be used to resolve an arbitrary name.
 */
public interface TxtLookup {

    /**
     * @param host a website host; implementations re-normalise it and refuse anything invalid
     * @return the TXT strings found (each record's quoted pieces joined), or an error when no
     *         resolver could answer
     */
    Result lookupVerificationRecord(String host);

    /**
     * {@code values} is empty when the name has no TXT record (or does not exist).
     * {@code error} is non-null only when the lookup itself failed.
     */
    record Result(List<String> values, String error) {

        public static Result found(List<String> values) {
            return new Result(values == null ? List.of() : List.copyOf(values), null);
        }

        public static Result failure(String error) {
            return new Result(List.of(), error);
        }

        public boolean failed() {
            return error != null;
        }
    }
}
