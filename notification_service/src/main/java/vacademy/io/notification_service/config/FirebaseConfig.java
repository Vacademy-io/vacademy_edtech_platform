package vacademy.io.notification_service.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import javax.annotation.PostConstruct;
import java.io.IOException;

// vendor-call-log: initializes Firebase app; FCM sends are recorded in PushNotificationService
@Configuration
public class FirebaseConfig {

    private boolean isFirebaseInitialized = false;

    @PostConstruct
    public void initialize() {
        try {
            if (FirebaseApp.getApps().isEmpty()) {
                // Check if service account file exists
                ClassPathResource serviceAccount = new ClassPathResource("firebase-service-account.json");
                
                if (!serviceAccount.exists()) {
                    System.out.println("WARNING: firebase-service-account.json not found. Firebase push notifications will be disabled.");
                    return;
                }
                
                FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(serviceAccount.getInputStream()))
                    .setProjectId("vacademy-app")
                    .build();

                FirebaseApp.initializeApp(options);
                isFirebaseInitialized = true;
                System.out.println("Firebase initialized successfully");
            }
        } catch (IOException e) {
            System.err.println("Failed to initialize Firebase: " + e.getMessage());
            System.out.println("Firebase push notifications will be disabled.");
        }
    }

    @Bean
    @ConditionalOnResource(resources = "classpath:firebase-service-account.json")
    public FirebaseMessaging firebaseMessaging() {
        if (!isFirebaseInitialized) {
            throw new RuntimeException("Firebase is not initialized. Cannot create FirebaseMessaging bean.");
        }
        return FirebaseMessaging.getInstance();
    }
}