package vacademy.io.common.auth.service;

import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.common.auth.constants.AuthConstant;
import vacademy.io.common.auth.entity.RefreshToken;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.RefreshTokenRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.ExpiredTokenException;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Service
public class RefreshTokenService {

    @Autowired
    RefreshTokenRepository refreshTokenRepository;

    @Autowired
    UserRepository userRepository;

    @Autowired
    JwtService jwtService;

    public RefreshToken createRefreshToken(String username, String clientName) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found with username: " + username));

        Map<String, Object> moreDetails = new HashMap<>();
        moreDetails.put("user", user.getId());

        Optional<RefreshToken> existingTokenOpt = refreshTokenRepository.findByUserInfo(user);

        RefreshToken refreshToken;
        if (existingTokenOpt.isPresent()) {
            // Update existing refresh token
            refreshToken = existingTokenOpt.get();
            refreshToken.setToken(jwtService.generateRefreshToken(moreDetails, user));
            refreshToken.setExpiryDate(Instant.now().plusSeconds(AuthConstant.refreshTokenExpiryInSecs));
            refreshToken.setClientName(clientName);
        } else {
            // Create a new refresh token
            refreshToken = RefreshToken.builder()
                    .userInfo(user)
                    .token(jwtService.generateRefreshToken(moreDetails, user))
                    .expiryDate(Instant.now().plusSeconds(AuthConstant.refreshTokenExpiryInSecs))
                    .clientName(clientName)
                    .build();
        }
        RefreshToken saved = refreshTokenRepository.save(refreshToken);
        stampSignIn(user);
        return saved;
    }

    /**
     * Every sign-in (password, email / WhatsApp OTP, Google, trusted login, sign-up) mints its
     * refresh token here, and a token refresh does not — so this is the one place that sees
     * each login exactly once. users.last_login_time is also bumped by JwtAuthFilter on
     * authenticated auth-service requests; stamping it here as well means a member counts as
     * "signed in" the moment they log in, whatever the client calls next. The Teams page reads
     * it as "has this member ever signed in". Best effort: it must never fail a login.
     */
    private void stampSignIn(User user) {
        try {
            userRepository.updateLastLoginTime(user.getId());
        } catch (Exception ignored) {
            // The JwtAuthFilter stamp still lands on the next authenticated request.
        }
    }



    public Optional<RefreshToken> findByToken(String token) {
        return refreshTokenRepository.findByToken(token);
    }

    @Transactional
    public void deleteRefreshToken(RefreshToken token) {
        refreshTokenRepository.delete(token);
    }

    @Transactional
    public void deleteAllRefreshToken(User user) {
        refreshTokenRepository.deleteAllByUserInfo(user);
    }

    public RefreshToken verifyExpiration(RefreshToken token) {
        if (token.getExpiryDate().compareTo(Instant.now()) < 0) {
            throw new ExpiredTokenException(token.getToken() + " Refresh token is expired. Please make a new login..!");
        }
        return token;
    }

}