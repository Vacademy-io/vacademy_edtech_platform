package vacademy.io.common.auth.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;
import vacademy.io.common.auth.service.ClientAuthentication;
import vacademy.io.common.auth.service.ClientAuthenticationService;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Component
public class InternalAuthFilter extends OncePerRequestFilter {

    private static final String INTERNAL_SEGMENT = "internal";

    @Autowired
    private ClientAuthenticationService clientAuthenticationService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {


        if (isInternalPath(request.getRequestURI())) {
            String clientName = request.getHeader("clientName");
            String clientToken = request.getHeader("Signature");
          

            boolean isValidClient = clientAuthenticationService.validateClient(clientName, clientToken);
            if (isValidClient) {
                SecurityContextHolder.getContext().setAuthentication(new ClientAuthentication(clientName, clientToken));
                filterChain.doFilter(request, response);
            } else {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.getWriter().write("Invalid client authentication");
            }
        } else {
            filterChain.doFilter(request, response);
            return;
        }
    }

    /**
     * True when any path segment is exactly "internal" (e.g. /auth-service/internal/user,
     * /auth-service/v1/user/internal/create-user). Matching a whole segment, not a substring,
     * so a path variable or route that merely contains the word is not forced through
     * client auth. Each segment is checked both raw and after dropping ";matrix" params and
     * percent-decoding, because Spring routes "/%69nternal/..." to the same "/internal/..."
     * handler and the raw URI must not be a way around this filter.
     */
    static boolean isInternalPath(String requestUri) {
        if (requestUri == null) {
            return false;
        }
        for (String segment : requestUri.split("/")) {
            int matrixStart = segment.indexOf(';');
            String withoutMatrix = matrixStart >= 0 ? segment.substring(0, matrixStart) : segment;
            if (INTERNAL_SEGMENT.equals(withoutMatrix)) {
                return true;
            }
            if (withoutMatrix.indexOf('%') >= 0) {
                try {
                    if (INTERNAL_SEGMENT.equals(UriUtils.decode(withoutMatrix, StandardCharsets.UTF_8))) {
                        return true;
                    }
                } catch (IllegalArgumentException malformedEscape) {
                    // Not decodable, so it cannot be routed as "internal" either.
                }
            }
        }
        return false;
    }

}
