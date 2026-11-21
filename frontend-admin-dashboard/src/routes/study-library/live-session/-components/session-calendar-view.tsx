
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    isToday,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Timer, ArrowLeft, ArrowUpRight, Clock, ExternalLink, Calendar } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface Session {
    id: string;
    time: string;
    duration: number | string;
    link: string;
    status?: 'live' | 'upcoming' | 'past';
    startDate?: Date;
    default_class_link?: string | null;
    defaultClassName?: string | null;
    learner_button_config?: {
        text: string;
        url: string;
        background_color: string;
        text_color: string;
        visible: boolean;
    } | null;
    /** Per-schedule platform ('zoom', 'google meet', …) — decides the host entry point. */
    linkType?: string | null;
}

interface DaySchedule {
    date: string;
    sessions: Session[];
}

interface SessionCalendarViewProps {
    schedules: DaySchedule[];
    /**
     * Returns the "Start as Host" handler for a schedule, or null when that
     * platform has no host entry point. Without it the calendar would only
     * offer the participant Join link, which is how a recurring Zoom class
     * left its host with no way to start the meeting.
     */
    getHostAction?: (session: Session) => (() => void) | null;
}

export function SessionCalendarView({ schedules, getHostAction }: SessionCalendarViewProps) {
    const { t } = useTranslation('studyLibrarySessionCalendarView');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const onNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const onPrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
    const onToday = () => setCurrentMonth(new Date());

    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const calendarDays = eachDayOfInterval({
        start: startDate,
        end: endDate,
    });

    const getSessionsForDate = (date: Date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return schedules.find((s) => s.date === dateStr)?.sessions || [];
    };

    const handleDayClick = (date: Date, sessions: Session[]) => {
        if (sessions.length > 0) {
            setSelectedDate(date);
            setIsDialogOpen(true);
        }
    };

    const getStatusColor = (status?: string) => {
        switch (status) {
            case 'live':
                return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800';
            case 'upcoming':
                return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800';
            default:
                return 'bg-primary/10 text-primary border border-transparent';
        }
    };

    const weekDays = [
        t('weekday.sun'),
        t('weekday.mon'),
        t('weekday.tue'),
        t('weekday.wed'),
        t('weekday.thu'),
        t('weekday.fri'),
        t('weekday.sat'),
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-foreground">
                    {format(currentMonth, 'MMMM yyyy')}
                </h2>
                <div className="flex items-center gap-2">
                    <MyButton
                        onClick={onPrevMonth}
                        buttonType="secondary"
                        scale="small"
                        className="h-8 w-8 p-0"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </MyButton>
                    <MyButton
                        onClick={onToday}
                        buttonType="secondary"
                        scale="small"
                        className="h-8 px-3"
                    >
                        {t('today')}
                    </MyButton>
                    <MyButton
                        onClick={onNextMonth}
                        buttonType="secondary"
                        scale="small"
                        className="h-8 w-8 p-0"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </MyButton>
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
                <div className="min-w-[700px]">
                {/* Header */}
                <div className="grid grid-cols-7 border-b bg-muted/30">
                    {weekDays.map((day) => (
                        <div
                            key={day}
                            className="py-3 text-center text-sm font-semibold text-muted-foreground"
                        >
                            {day}
                        </div>
                    ))}
                </div>

                {/* Grid */}
                <div className="grid grid-cols-7 auto-rows-[minmax(120px,auto)]">
                    {calendarDays.map((day, dayIdx) => {
                        const sessions = getSessionsForDate(day);
                        const isCurrentMonth = isSameMonth(day, monthStart);
                        const isDayToday = isToday(day);
                        const hasLiveSession = sessions.some((s) => s.status === 'live');
                        const hasUpcomingSession = sessions.some((s) => s.status === 'upcoming');
                        const hasPastSession = sessions.some((s) => s.status === 'past');

                        let dayColorClass = '';
                        if (hasLiveSession) {
                            dayColorClass = 'bg-red-50 hover:bg-red-100/50 dark:bg-red-900/10 dark:hover:bg-red-900/20';
                        } else if (hasUpcomingSession) {
                            dayColorClass = 'bg-blue-50 hover:bg-blue-100/50 dark:bg-blue-900/10 dark:hover:bg-blue-900/20';
                        } else if (hasPastSession) {
                            dayColorClass = 'bg-gray-50 hover:bg-gray-100/50 dark:bg-gray-900/10 dark:hover:bg-gray-900/20';
                        }

                        return (
                            <div
                                key={day.toString()}
                                onClick={() => handleDayClick(day, sessions)}
                                className={cn(
                                    'group relative border-b border-r bg-background p-2 transition-colors hover:bg-muted/30 cursor-pointer',
                                    !isCurrentMonth && 'bg-muted/5 text-muted-foreground',
                                    dayIdx % 7 === 6 && 'border-r-0', // Remove right border for last column
                                    dayColorClass
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <span
                                        className={cn(
                                            'flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium',
                                            isDayToday && 'bg-primary text-primary-foreground',
                                            !isDayToday && 'text-foreground'
                                        )}
                                    >
                                        {format(day, 'd')}
                                    </span>
                                </div>
                                <div className="mt-2 space-y-1">
                                    {sessions.slice(0, 2).map((session, i) => (
                                        <div
                                            key={i}
                                            className={cn(
                                                "truncate rounded px-1.5 py-0.5 text-[10px] font-medium",
                                                getStatusColor(session.status)
                                            )}
                                        >
                                            {session.time}
                                            {session.duration ? ` (${session.duration}m)` : ''}
                                        </div>
                                    ))}
                                    {sessions.length > 2 && (
                                        <div className="text-[10px] font-medium text-muted-foreground pl-1">
                                            {t('moreSessions', { count: sessions.length - 2 })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                </div>
            </div>

            <div className="flex items-center justify-end gap-6 px-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800"></span>
                    <span>{t('legend.liveClass')}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"></span>
                    <span>{t('legend.upcomingClass')}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm bg-gray-50 border border-gray-200 dark:bg-gray-900/20 dark:border-gray-800"></span>
                    <span>{t('legend.pastClass')}</span>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {t('sessionsFor', {
                                date: selectedDate ? format(selectedDate, 'MMMM d, yyyy') : '',
                            })}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        {/* Day Level Info */}
                        {selectedDate && (() => {
                            const sessions = getSessionsForDate(selectedDate);
                            const defaultLink = sessions[0]?.default_class_link;
                            const defaultClassName = sessions[0]?.defaultClassName;
                            const learnerButton = sessions[0]?.learner_button_config;  

                            if (defaultLink || learnerButton) {
                                return (
                                    <div className="rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50/50 to-white p-4 shadow-sm mb-4">
                                        <div className="mb-2 flex items-center gap-2">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500 shadow-sm">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                </svg>
                                            </div>
                                            <h5 className="text-sm font-semibold text-gray-900">{t('defaultClassInformation')}</h5>
                                        </div>
                                        <div className="space-y-2.5 text-sm">
                                            {defaultClassName && (
                                                <div className="flex items-start gap-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                                    </svg>
                                                    <div className="flex-1">
                                                        <span className="font-medium text-gray-700">{t('classNameLabel')} </span>
                                                        <span className="font-semibold text-gray-900">{defaultClassName}</span>
                                                    </div>
                                                </div>
                                            )}
                                            {defaultLink && (
                                                <div className="flex items-start gap-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                    </svg>
                                                    <div className="flex-1">
                                                        <span className="font-medium text-gray-700">{t('linkLabel')} </span>
                                                        <a
                                                            href={defaultLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 hover:underline break-all"
                                                        >
                                                            {defaultLink}
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                            </svg>
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                            {learnerButton && learnerButton.visible && (
                                                <div className="flex items-start gap-2 pt-1">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                                                    </svg>
                                                    <div className="flex-1">
                                                        <span className="font-medium text-gray-700">{t('customButtonLabel')} </span>
                                                        <span
                                                            style={{
                                                                backgroundColor: learnerButton.background_color,
                                                                color: learnerButton.text_color,
                                                            }}
                                                            className="inline-block rounded-md px-2.5 py-1 text-xs font-semibold shadow-sm"
                                                        >
                                                            {learnerButton.text}
                                                        </span>
                                                        <span className="ml-2 text-xs text-gray-600 break-all">
                                                            → {learnerButton.url}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        })()}

                        {selectedDate && getSessionsForDate(selectedDate).map((session) => (
                            <div
                                key={session.id}
                                className={cn(
                                    "group relative flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md",
                                    session.status === 'live' ? "border-l-4 border-l-red-500" :
                                        session.status === 'upcoming' ? "border-l-4 border-l-blue-500" : "border-l-4 border-l-gray-300"
                                )}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xl font-bold text-foreground">
                                                {session.time}
                                            </span>
                                            {session.status === 'live' && (
                                                <span className="relative flex h-2.5 w-2.5">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Clock className="size-3.5" />
                                            <span>
                                                {t('durationMinutes', {
                                                    count:
                                                        typeof session.duration === 'number'
                                                            ? session.duration
                                                            : Number(session.duration) || 0,
                                                })}
                                            </span>
                                        </div>
                                    </div>

                                    <Badge
                                        variant={session.status === 'live' ? 'destructive' : session.status === 'upcoming' ? 'default' : 'secondary'}
                                        className={cn(
                                            "capitalize px-2.5 py-0.5 shadow-sm font-medium",
                                            session.status === 'upcoming' && "bg-blue-400 hover:bg-blue-700",
                                            session.status === 'past' && "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                        )}
                                    >
                                        {session.status === 'live'
                                            ? t('status.live')
                                            : session.status === 'upcoming'
                                              ? t('status.upcoming')
                                              : session.status === 'past'
                                                ? t('status.past')
                                                : t('status.scheduled')}
                                    </Badge>
                                </div>

                                <div className="mt-1 flex flex-col gap-2 border-t pt-3">
                                    {(() => {
                                        const startAsHost = getHostAction?.(session);
                                        if (!startAsHost) return null;
                                        return (
                                            <button
                                                type="button"
                                                onClick={startAsHost}
                                                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            >
                                                <span>{t('startAsHost')}</span>
                                                <ArrowUpRight className="size-3.5" />
                                            </button>
                                        );
                                    })()}
                                    <a
                                        href={session.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={cn(
                                            "flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                            session.status === 'live'
                                                ? "bg-red-600 text-white shadow hover:bg-red-700"
                                                : session.status === 'upcoming'
                                                    ? "bg-blue-600 text-white shadow hover:bg-blue-700"
                                                    : "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80"
                                        )}
                                    >
                                        <span>{t('joinSession')}</span>
                                        <ExternalLink className="size-3.5" />
                                    </a>
                                </div>
                            </div>
                        ))}
                        {selectedDate && getSessionsForDate(selectedDate).length === 0 && (
                            <div className="py-4 text-center text-muted-foreground">{t('noSessionsFound')}</div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
