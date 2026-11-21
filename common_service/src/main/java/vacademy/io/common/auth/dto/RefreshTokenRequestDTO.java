package vacademy.io.common.auth.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class RefreshTokenRequestDTO {
    // The learner app posts {"refreshToken": ...}; without the alias the token binds as null
    // and every refresh is rejected as expired, logging the learner out.
    @JsonAlias("refreshToken")
    private String token;
}
