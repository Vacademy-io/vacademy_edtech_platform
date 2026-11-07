import { getIcon } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/slides-sidebar/slides-sidebar-slides';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { Badge } from '@/components/ui/badge';

export const TypeCell = ({ doubt }: { doubt: Doubt }) => {
    // General queries (Technical/Payment issues) aren't anchored to content, so there's no format.
    if (!doubt.content_type) {
        return <span className="text-xs text-neutral-400">—</span>;
    }

    const iconName =
        doubt.content_type === 'PDF' ||
        doubt.content_type === 'DOC' ||
        doubt.content_type === 'HTML'
            ? 'DOCUMENT'
            : doubt.content_type;

    return (
        <Badge
            variant="outline"
            className="gap-1.5 border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption font-semibold uppercase tracking-wide text-neutral-700"
        >
            <span className="flex size-4 items-center justify-center text-primary-500">
                {getIcon(iconName, doubt.content_type, '4')}
            </span>
            {doubt.content_type}
        </Badge>
    );
};
