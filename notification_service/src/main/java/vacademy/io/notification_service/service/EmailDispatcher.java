package vacademy.io.notification_service.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailException;

import java.util.concurrent.*;

/**
 * Email dispatcher with rate limiting to respect AWS SES limits
 * Defaults to 50 emails per second (AWS SES standard limit)
 * Configurable via application properties: email.rate.limit.per.second
 */
@Component
@Slf4j
public class EmailDispatcher {

    @Value("${email.rate.limit.per.second:50}")
    private int maxEmailsPerSecond;

    @Value("${email.retry.max.attempts:3}")
    private int maxRetryAttempts;

    @Value("${email.retry.initial.delay.ms:1000}")
    private long initialRetryDelayMs;

    @Value("${email.retry.max.delay.ms:10000}")
    private long maxRetryDelayMs;

    private ScheduledExecutorService scheduler;
    private ExecutorService asyncExecutor;
    private Semaphore semaphore;
    private volatile boolean initialized = false;

    @PostConstruct
    public void init() {
        // Use 95% of limit as safety margin to avoid hitting exact limit
        int effectiveLimit = (int) (maxEmailsPerSecond * 0.95);
        log.info("Initializing EmailDispatcher with rate limit: {} emails/second (effective: {} with safety margin)",
                maxEmailsPerSecond, effectiveLimit);
        log.info("Retry configuration: maxAttempts={}, initialDelay={}ms, maxDelay={}ms",
                maxRetryAttempts, initialRetryDelayMs, maxRetryDelayMs);

        this.semaphore = new Semaphore(effectiveLimit);
        this.scheduler = Executors.newScheduledThreadPool(1);
        this.asyncExecutor = Executors.newCachedThreadPool();

        // Replenish permits every second to maintain rate limit
        this.scheduler.scheduleAtFixedRate(() -> {
            int available = semaphore.availablePermits();
            int needed = effectiveLimit - available;
            if (needed > 0) {
                semaphore.release(needed);
                log.debug("Replenished {} email permits. Available: {}", needed, semaphore.availablePermits());
            }
        }, 0, 1, TimeUnit.SECONDS);

        initialized = true;
        log.info("EmailDispatcher initialized successfully with rate limit of {} emails/second", effectiveLimit);
    }

    /**
     * Send email with rate limiting and automatic retry on transient failures
     * Blocks if rate limit is reached to prevent exceeding AWS SES limits
     * Retries with exponential backoff on authentication and connection errors
     * 
     * @param emailTask The email sending task
     * @throws InterruptedException if interrupted while waiting for permit
     */
    public void sendEmail(Runnable emailTask) throws InterruptedException {
        if (!initialized) {
            log.warn("EmailDispatcher not initialized, initializing now");
            init();
        }

        // Acquire a permit (blocks if the limit is reached)
        // This ensures we never exceed AWS SES rate limits
        semaphore.acquire();

        // Execute email sending asynchronously with retry logic
        CompletableFuture.runAsync(() -> sendWithRetry(emailTask), asyncExecutor)
                .exceptionally(throwable -> {
                    log.error("Email sending failed after all retry attempts", throwable);
                    semaphore.release();
                    return null;
                });
    }

    /**
     * Execute email task with exponential backoff retry for transient failures
     */
    private void sendWithRetry(Runnable emailTask) {
        int attempt = 0;
        Throwable lastException = null;

        while (attempt < maxRetryAttempts) {
            try {
                attempt++;
                if (attempt > 1) {
                    log.info("Retry attempt {}/{} for email send", attempt, maxRetryAttempts);
                }

                emailTask.run();

                // Success! Release the permit and return
                semaphore.release();
                if (attempt > 1) {
                    log.info("Email sent successfully on retry attempt {}", attempt);
                }
                return;

            } catch (Exception e) {
                lastException = e;

                // Check if this is a retryable error
                boolean isRetryable = isRetryableException(e);

                if (!isRetryable) {
                    log.error("Non-retryable error encountered, failing immediately: {}", e.getMessage());
                    throw new RuntimeException("Non-retryable email error", e);
                }

                // If we have more attempts, sleep before retrying
                if (attempt < maxRetryAttempts) {
                    long delay = calculateBackoffDelay(attempt);
                    log.warn("Retryable error on attempt {}/{}: {} - Retrying in {}ms",
                            attempt, maxRetryAttempts, e.getMessage(), delay);

                    try {
                        Thread.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException("Interrupted during retry backoff", ie);
                    }
                } else {
                    log.error("All {} retry attempts exhausted for email send", maxRetryAttempts);
                }
            }
        }

        // All retries exhausted, throw the last exception
        throw new RuntimeException("Failed to send email after " + maxRetryAttempts + " attempts", lastException);
    }

    /**
     * Determine if an exception is retryable (transient errors)
     */
    private boolean isRetryableException(Throwable throwable) {
        if (throwable == null) {
            return false;
        }

        // Check exception type
        if (throwable instanceof MailAuthenticationException) {
            // Authentication errors are often transient (EOF, connection issues)
            String message = throwable.getMessage();
            if (message != null && (message.contains("EOF") || message.contains("Connection reset")
                    || message.contains("Connection timed out"))) {
                return true;
            }
        }

        if (throwable instanceof MailException) {
            // Other mail exceptions might be transient
            String message = throwable.getMessage();
            if (message != null && (message.contains("timeout") || message.contains("connection")
                    || message.contains("network"))) {
                return true;
            }
        }

        // Check for common transient exceptions in the cause chain
        Throwable cause = throwable.getCause();
        if (cause != null && cause != throwable) {
            return isRetryableException(cause);
        }

        return false;
    }

    /**
     * Calculate exponential backoff delay with jitter
     */
    private long calculateBackoffDelay(int attempt) {
        // Exponential backoff: initialDelay * 2^(attempt-1)
        long delay = initialRetryDelayMs * (long) Math.pow(2, attempt - 1);

        // Cap at maximum delay
        delay = Math.min(delay, maxRetryDelayMs);

        // Add jitter (±20%) to prevent thundering herd
        double jitter = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
        delay = (long) (delay * jitter);

        return delay;
    }

    /**
     * Try to send email with rate limiting, returns false if rate limit exceeded
     * Non-blocking version for better control
     */
    public boolean trySendEmail(Runnable emailTask) {
        if (!initialized) {
            log.warn("EmailDispatcher not initialized, initializing now");
            init();
        }

        // Try to acquire permit without blocking
        if (semaphore.tryAcquire()) {
            CompletableFuture.runAsync(emailTask).exceptionally(throwable -> {
                log.error("Error sending email asynchronously", throwable);
                semaphore.release();
                return null;
            });
            return true;
        } else {
            log.warn("Rate limit reached. Email queued for retry. Available permits: {}", semaphore.availablePermits());
            return false;
        }
    }

    /**
     * Get current available email sending capacity
     */
    public int getAvailablePermits() {
        return initialized ? semaphore.availablePermits() : 0;
    }

    /**
     * Get configured rate limit
     */
    public int getRateLimit() {
        return maxEmailsPerSecond;
    }

    @PreDestroy
    public void shutdown() {
        log.info("Shutting down EmailDispatcher");
        if (scheduler != null) {
            scheduler.shutdown();
            try {
                if (!scheduler.awaitTermination(10, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow();
                }
            } catch (InterruptedException e) {
                scheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        if (asyncExecutor != null) {
            asyncExecutor.shutdown();
            try {
                if (!asyncExecutor.awaitTermination(10, TimeUnit.SECONDS)) {
                    asyncExecutor.shutdownNow();
                }
            } catch (InterruptedException e) {
                asyncExecutor.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }
}