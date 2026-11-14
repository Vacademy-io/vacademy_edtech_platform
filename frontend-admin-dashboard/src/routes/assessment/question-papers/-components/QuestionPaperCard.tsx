import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Clock, DotsThree, FileText, Stack, Star, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { QuestionPaperInterface } from '@/types/assessments/question-paper-template';
import { daysAgo } from '../-utils/question-paper-list';

const relativeTime = (date: Date, locale: string) => {
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 365 * 24 * 3600],
        ['month', 30 * 24 * 3600],
        ['day', 24 * 3600],
        ['hour', 3600],
        ['minute', 60],
    ];
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return rtf.format(0, 'minute');
};

interface QuestionPaperCardProps {
    paper: QuestionPaperInterface;
    levelName: string | null;
    subjectName: string | null;
    isJustAdded: boolean;
    onToggleFavourite: () => void;
    onDelete: () => void;
    viewButton: ReactNode;
    exportButton: ReactNode;
}

/** One paper on the Question Papers page. */
export const QuestionPaperCard = ({
    paper,
    levelName,
    subjectName,
    isJustAdded,
    onToggleFavourite,
    onDelete,
    viewButton,
    exportButton,
}: QuestionPaperCardProps) => {
    const { t, i18n } = useTranslation('assessmentQuestionPapersPage');
    const created = new Date(paper.created_on);
    const validDate = !Number.isNaN(created.getTime());
    const time = validDate
        ? created.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })
        : '';
    const days = validDate ? daysAgo(created) : Infinity;
    const createdLabel = !validDate
        ? '—'
        : days <= 0
          ? t('list.createdToday', { time })
          : days === 1
            ? t('list.createdYesterday', { time })
            : `${created.toLocaleDateString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
              })}, ${time}`;
    const isFavourite = paper.status === 'FAVOURITE';

    return (
        <article
            className={cn(
                'flex flex-col gap-3 rounded-lg border bg-white p-4 transition-colors sm:flex-row sm:items-center',
                isJustAdded
                    ? 'border-success-400 bg-success-50'
                    : 'border-neutral-200 hover:border-primary-200 hover:shadow-sm'
            )}
        >
            <span className="hidden size-11 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 sm:flex">
                <FileText size={22} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-subtitle font-semibold text-neutral-700">
                        {paper.title}
                    </h3>
                    {isJustAdded && (
                        <Badge
                            variant="outline"
                            className="shrink-0 border-success-200 bg-white text-2xs uppercase text-success-600"
                        >
                            {t('list.justAdded')}
                        </Badge>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-neutral-500">
                    <span
                        className="inline-flex items-center gap-1"
                        title={validDate ? created.toLocaleString(i18n.language) : undefined}
                    >
                        <Clock size={14} />
                        {createdLabel}
                        {validDate && (
                            <span className="text-neutral-400">
                                · {relativeTime(created, i18n.language)}
                            </span>
                        )}
                    </span>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                            levelName
                                ? 'border-neutral-200 bg-neutral-50 text-neutral-600'
                                : 'border-dashed border-neutral-300 text-neutral-400'
                        )}
                    >
                        <Stack size={12} />
                        {levelName ?? t('list.noLevel')}
                    </span>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                            subjectName
                                ? 'border-neutral-200 bg-neutral-50 text-neutral-600'
                                : 'border-dashed border-neutral-300 text-neutral-400'
                        )}
                    >
                        <BookOpen size={12} />
                        {subjectName ?? t('list.noSubject')}
                    </span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    layoutVariant="icon"
                    aria-label={
                        isFavourite ? t('list.removeFromFavourites') : t('list.addToFavourites')
                    }
                    title={isFavourite ? t('list.removeFromFavourites') : t('list.addToFavourites')}
                    onClick={onToggleFavourite}
                >
                    <Star
                        size={20}
                        weight={isFavourite ? 'fill' : 'regular'}
                        className={isFavourite ? 'text-warning-500' : 'text-neutral-300'}
                    />
                </MyButton>
                {viewButton}
                {exportButton}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="icon"
                            className="size-8"
                            aria-label={t('list.moreActions')}
                        >
                            <DotsThree size={18} />
                        </MyButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            className="cursor-pointer gap-2 text-danger-600 focus:text-danger-600"
                            onClick={onDelete}
                        >
                            <Trash size={16} />
                            {t('list.deletePaper')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </article>
    );
};
