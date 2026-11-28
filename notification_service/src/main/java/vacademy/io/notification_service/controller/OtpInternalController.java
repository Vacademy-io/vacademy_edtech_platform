package vacademy.io.notification_service.controller;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.notification.dto.EmailOTPRequest;
import vacademy.io.notification_service.features.email_otp.service.OTPService;

@RestController
@RequestMapping("notification-service/internal/v1")
public class OtpInternalController {

    @Autowired
    private OTPService otpService;


    @PostMapping("/send-email-otp")
    public ResponseEntity<String> sendEmailOtp(@RequestBody EmailOTPRequest request, @RequestParam(name = "instituteId",required = false)String instituteId) {
        otpService.sendEmailOtp(request.getTo(), request.getSubject(), request.getService(), request.getName(),instituteId, request.getProduct());
        return ResponseEntity.ok("Email OTP sent successfully");
    }

    @PostMapping("/verify-email-otp")
    public ResponseEntity<Boolean> verifyEmailOtp(@RequestBody EmailOTPRequest request) {
        if (otpService.verifyEmailOtp(request.getOtp(), request.getTo()))
            return ResponseEntity.ok(true);
        return ResponseEntity.ok(false);
    }

}