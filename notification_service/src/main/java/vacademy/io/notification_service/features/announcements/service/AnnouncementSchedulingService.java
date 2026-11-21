package vacademy.io.notification_service.features.announcements.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.quartz.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.entity.ScheduledMessage;
import vacademy.io.notification_service.features.announcements.enums.ScheduleType;
import vacademy.io.notification_service.features.announcements.repository.ScheduledMessageRepository;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.Date;
import java.util.List;
import java.util.TimeZone;

@Service
@RequiredArgsConstructor
@Slf4j
public class AnnouncementSchedulingService {

    private final ScheduledMessageRepository scheduledMessageRepository;
    private final Scheduler quartzScheduler;
    private final AnnouncementProcessingService processingService;

    /**
     * Schedule an announcement based on the scheduling request
     */
    @Transactional
    public void scheduleAnnouncement(String announcementId, CreateAnnouncementRequest.SchedulingRequest scheduling) {
        log.info("Scheduling announcement: {} with type: {}", announcementId, scheduling.getScheduleType());
        
        try {
            // Create scheduled message entity
            ScheduledMessage scheduledMessage = createScheduledMessage(announcementId, scheduling);
            scheduledMessageRepository.save(scheduledMessage);
            
            // Create Quartz job if needed
            if (scheduling.getScheduleType() != ScheduleType.IMMEDIATE) {
                createQuartzJob(scheduledMessage);
            }
            
            log.info("Successfully scheduled announcement: {}", announcementId);
            
        } catch (Exception e) {
            log.error("Error scheduling announcement: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to schedule announcement: " + e.getMessage(), e);
        }
    }

    /**
     * Process scheduled announcements - called by Quartz job
     */
    @Transactional
    public void processScheduledAnnouncements() {
        LocalDateTime currentTime = LocalDateTime.now();
        List<ScheduledMessage> scheduledMessages = scheduledMessageRepository
                .findScheduledMessagesToProcess(currentTime);
        
        log.debug("Processing {} scheduled messages", scheduledMessages.size());
        
        for (ScheduledMessage scheduledMessage : scheduledMessages) {
            try {
                processScheduledMessage(scheduledMessage);
            } catch (Exception e) {
                log.error("Error processing scheduled message: {}", scheduledMessage.getId(), e);
            }
        }
    }

    /**
     * Cancel a scheduled announcement
     */
    @Transactional
    public void cancelScheduledAnnouncement(String announcementId) {
        List<ScheduledMessage> scheduledMessages = scheduledMessageRepository.findByAnnouncementId(announcementId);
        
        for (ScheduledMessage scheduledMessage : scheduledMessages) {
            try {
                // Remove from Quartz scheduler
                removeQuartzJob(scheduledMessage.getId());
                
                // Mark as inactive
                scheduledMessage.setIsActive(false);
                scheduledMessageRepository.save(scheduledMessage);
                
                log.info("Cancelled scheduled message: {}", scheduledMessage.getId());
                
            } catch (Exception e) {
                log.error("Error cancelling scheduled message: {}", scheduledMessage.getId(), e);
            }
        }
    }

    /**
     * Reschedule an announcement
     */
    @Transactional
    public void rescheduleAnnouncement(String announcementId, CreateAnnouncementRequest.SchedulingRequest newScheduling) {
        // Cancel existing schedule
        cancelScheduledAnnouncement(announcementId);
        
        // Create new schedule
        scheduleAnnouncement(announcementId, newScheduling);
        
        log.info("Rescheduled announcement: {}", announcementId);
    }

    // Helper methods
    private ScheduledMessage createScheduledMessage(String announcementId, 
                                                   CreateAnnouncementRequest.SchedulingRequest scheduling) {
        ScheduledMessage scheduledMessage = new ScheduledMessage();
        scheduledMessage.setAnnouncementId(announcementId);
        scheduledMessage.setScheduleType(scheduling.getScheduleType());
        scheduledMessage.setCronExpression(scheduling.getCronExpression());
        scheduledMessage.setTimezone(scheduling.getTimezone() != null ? scheduling.getTimezone() : "UTC");
        scheduledMessage.setStartDate(scheduling.getStartDate());
        scheduledMessage.setEndDate(scheduling.getEndDate());
        
        // Calculate next run time. start_date/end_date stay in the schedule's timezone (what the
        // user picked); next_run_time is stored in UTC because the poller compares it against
        // LocalDateTime.now() on a TZ=UTC JVM.
        if (scheduling.getScheduleType() == ScheduleType.ONE_TIME) {
            scheduledMessage.setNextRunTime(toUtc(scheduling.getStartDate(), scheduledMessage.getTimezone()));
        } else if (scheduling.getScheduleType() == ScheduleType.RECURRING && scheduling.getCronExpression() != null) {
            LocalDateTime nextRun = calculateNextRunTime(scheduling.getCronExpression(), scheduledMessage.getTimezone());
            scheduledMessage.setNextRunTime(nextRun);
        }
        
        return scheduledMessage;
    }

    private void createQuartzJob(ScheduledMessage scheduledMessage) throws SchedulerException {
        String jobKey = "announcement-" + scheduledMessage.getId();
        String triggerKey = "trigger-" + scheduledMessage.getId();
        
        // Create job detail
        JobDetail jobDetail = JobBuilder.newJob(AnnouncementDeliveryJob.class)
                .withIdentity(jobKey)
                .usingJobData("scheduledMessageId", scheduledMessage.getId())
                .usingJobData("announcementId", scheduledMessage.getAnnouncementId())
                .build();
        
        // Create trigger based on schedule type
        Trigger trigger = createTrigger(scheduledMessage, triggerKey);
        
        // Schedule the job
        quartzScheduler.scheduleJob(jobDetail, trigger);
        
        log.debug("Created Quartz job: {} for scheduled message: {}", jobKey, scheduledMessage.getId());
    }

    private Trigger createTrigger(ScheduledMessage scheduledMessage, String triggerKey) {
        TriggerBuilder<Trigger> triggerBuilder = TriggerBuilder.newTrigger()
                .withIdentity(triggerKey);
        
        // Set timezone
        TimeZone timeZone = TimeZone.getTimeZone(scheduledMessage.getTimezone());
        
        if (scheduledMessage.getScheduleType() == ScheduleType.ONE_TIME) {
            // One-time trigger (next_run_time is UTC)
            Date startTime = convertToDate(scheduledMessage.getNextRunTime(), "UTC");
            triggerBuilder.startAt(startTime);
            
        } else if (scheduledMessage.getScheduleType() == ScheduleType.RECURRING) {
            // Recurring trigger with cron expression
            CronScheduleBuilder cronSchedule = CronScheduleBuilder
                    .cronSchedule(scheduledMessage.getCronExpression())
                    .inTimeZone(timeZone);
            
            triggerBuilder.withSchedule(cronSchedule);
            
            if (scheduledMessage.getStartDate() != null) {
                Date startTime = convertToDate(scheduledMessage.getStartDate(), scheduledMessage.getTimezone());
                triggerBuilder.startAt(startTime);
            }
            
            if (scheduledMessage.getEndDate() != null) {
                Date endTime = convertToDate(scheduledMessage.getEndDate(), scheduledMessage.getTimezone());
                triggerBuilder.endAt(endTime);
            }
        }
        
        return triggerBuilder.build();
    }

    private void processScheduledMessage(ScheduledMessage scheduledMessage) {
        log.info("Processing scheduled message: {} for announcement: {}", 
                scheduledMessage.getId(), scheduledMessage.getAnnouncementId());
        
        try {
            // Process the announcement delivery
            processingService.processScheduledAnnouncement(scheduledMessage.getAnnouncementId());
            
            // Update last run time
            scheduledMessage.setLastRunTime(LocalDateTime.now());
            
            // Calculate next run time for recurring messages
            if (scheduledMessage.getScheduleType() == ScheduleType.RECURRING) {
                LocalDateTime nextRun = calculateNextRunTime(
                        scheduledMessage.getCronExpression(), 
                        scheduledMessage.getTimezone()
                );
                scheduledMessage.setNextRunTime(nextRun);
                
                // Check if we've passed the end date
                if (scheduledMessage.getEndDate() != null
                        && nextRun.isAfter(toUtc(scheduledMessage.getEndDate(), scheduledMessage.getTimezone()))) {
                    scheduledMessage.setIsActive(false);
                    removeQuartzJob(scheduledMessage.getId());
                }
            } else {
                // One-time message - mark as inactive
                scheduledMessage.setIsActive(false);
                removeQuartzJob(scheduledMessage.getId());
            }
            
            scheduledMessageRepository.save(scheduledMessage);
            
        } catch (Exception e) {
            log.error("Error processing scheduled message: {}", scheduledMessage.getId(), e);
            throw e;
        }
    }

    private void removeQuartzJob(String scheduledMessageId) {
        try {
            String jobKey = "announcement-" + scheduledMessageId;
            quartzScheduler.deleteJob(JobKey.jobKey(jobKey));
            log.debug("Removed Quartz job: {}", jobKey);
        } catch (SchedulerException e) {
            log.error("Error removing Quartz job for scheduled message: {}", scheduledMessageId, e);
        }
    }

    private LocalDateTime calculateNextRunTime(String cronExpression, String timezone) {
        try {
            CronExpression cron = new CronExpression(cronExpression);
            cron.setTimeZone(TimeZone.getTimeZone(timezone));
            
            Date nextRunDate = cron.getNextValidTimeAfter(new Date());
            // Returned in UTC, same as next_run_time is stored
            return nextRunDate.toInstant()
                    .atZone(ZoneOffset.UTC)
                    .toLocalDateTime();

        } catch (Exception e) {
            log.error("Error calculating next run time for cron: {}", cronExpression, e);
            return LocalDateTime.now().plusHours(1); // Fallback
        }
    }

    private Date convertToDate(LocalDateTime localDateTime, String timezone) {
        ZonedDateTime zonedDateTime = localDateTime.atZone(ZoneId.of(timezone));
        return Date.from(zonedDateTime.toInstant());
    }

    /** Converts a wall-clock time in the schedule's timezone to a UTC wall-clock time. */
    private LocalDateTime toUtc(LocalDateTime localDateTime, String timezone) {
        if (localDateTime == null) return null;
        return localDateTime.atZone(ZoneId.of(timezone))
                .withZoneSameInstant(ZoneOffset.UTC)
                .toLocalDateTime();
    }

    /**
     * next_run_time is stored in UTC; API responses keep returning it in the schedule's
     * timezone, alongside start_date/end_date.
     */
    public LocalDateTime nextRunTimeInScheduleZone(ScheduledMessage scheduledMessage) {
        LocalDateTime nextRun = scheduledMessage.getNextRunTime();
        if (nextRun == null) return null;
        try {
            return nextRun.atZone(ZoneOffset.UTC)
                    .withZoneSameInstant(ZoneId.of(scheduledMessage.getTimezone()))
                    .toLocalDateTime();
        } catch (Exception e) {
            return nextRun;
        }
    }

    // Quartz Job class
    public static class AnnouncementDeliveryJob implements Job {
        @Override
        public void execute(JobExecutionContext context) throws JobExecutionException {
            JobDataMap dataMap = context.getJobDetail().getJobDataMap();
            String scheduledMessageId = dataMap.getString("scheduledMessageId");
            String announcementId = dataMap.getString("announcementId");
            
            log.info("Executing scheduled announcement delivery job for: {}", announcementId);
            
            try {
                // This will be handled by the main scheduler job that processes all scheduled messages
                // The actual processing happens in processScheduledAnnouncements()
                log.debug("Scheduled job executed for message: {}", scheduledMessageId);
                
            } catch (Exception e) {
                log.error("Error in scheduled announcement delivery job", e);
                throw new JobExecutionException(e);
            }
        }
    }
}