import type { ModeType, MediumType } from '@/services/announcement';

export type HistoryView = 'all' | 'planned' | 'past';

export type ScheduleType = 'IMMEDIATE' | 'ONE_TIME' | 'RECURRING';

export type AnnouncementRecipient = {
    id?: string;
    recipientType?: string;
    recipientId?: string;
    recipientName?: string;
};

// One row of the history table. The /institute list returns a full AnnouncementResponse while
// /planned and /past return a flatter AnnouncementCalendarItem (announcementId, modeTypes, …);
// both are normalised into this shape so the table, dialogs and actions read one thing.
export type Announcement = {
    id: string;
    title: string;
    content?: { id?: string; type?: string; content?: string };
    instituteId?: string;
    createdBy?: string;
    createdByName?: string;
    createdByRole?: string;
    status?: string;
    timezone?: string;
    createdAt?: string;
    updatedAt?: string;
    recipients?: AnnouncementRecipient[];
    modes?: Array<{ modeType: ModeType | string }>;
    mediums?: Array<{ mediumType: MediumType | string }>;
    scheduling?: {
        scheduleType?: ScheduleType;
        cronExpression?: string;
        timezone?: string;
        startDate?: string;
        endDate?: string;
        nextRunTime?: string;
        lastRunTime?: string;
    };
};

export type AnnouncementStats = {
    // Recipient-level rollup (all mediums)
    totalRecipients: number;
    deliveredCount: number;
    readCount: number;
    failedCount: number;
    deliveryRate: number;
    readRate: number;
    // APP_OVERLAY dismiss tracking (also covers other dismissible modes)
    dismissedCount?: number;
    dismissRate?: number;
    // Email-specific (driven by SES events)
    emailsSent: number;
    emailsDelivered: number;
    emailsOpened: number;
    emailsClicked: number;
    emailsBounced: number;
    emailsRejected: number;
    emailsComplained: number;
    emailsPending: number;
    emailDeliveryRate: number;
    emailOpenRate: number;
    emailClickRate: number;
    emailBounceRate: number;
    emailRejectRate: number;
    emailComplaintRate: number;
};

export type HistoryPage = {
    content: Announcement[];
    totalPages: number;
    totalElements: number;
};

type CalendarItem = {
    announcementId: string;
    title: string;
    status?: string;
    instituteId?: string;
    createdByRole?: string;
    modeTypes?: string[];
    mediumTypes?: string[];
    scheduleType?: ScheduleType;
    timezone?: string;
    startDate?: string;
    endDate?: string;
    nextRunTime?: string;
    lastRunTime?: string;
    createdAt?: string;
    updatedAt?: string;
};

export function fromCalendarItem(item: CalendarItem): Announcement {
    return {
        id: item.announcementId,
        title: item.title,
        status: item.status,
        instituteId: item.instituteId,
        createdByRole: item.createdByRole,
        timezone: item.timezone,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        modes: (item.modeTypes ?? []).map((modeType) => ({ modeType })),
        mediums: (item.mediumTypes ?? []).map((mediumType) => ({ mediumType })),
        scheduling: item.scheduleType
            ? {
                  scheduleType: item.scheduleType,
                  timezone: item.timezone,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  nextRunTime: item.nextRunTime,
                  lastRunTime: item.lastRunTime,
              }
            : undefined,
    };
}

type SpringPage<T> = { content?: T[]; totalPages?: number; totalElements?: number };

export function toHistoryPage<T>(
    data: SpringPage<T> | T[] | undefined,
    map: (item: T) => Announcement
): HistoryPage {
    if (Array.isArray(data)) {
        return { content: data.map(map), totalPages: 1, totalElements: data.length };
    }
    const content = (data?.content ?? []).map(map);
    return {
        content,
        totalPages: data?.totalPages ?? 1,
        totalElements: data?.totalElements ?? content.length,
    };
}
