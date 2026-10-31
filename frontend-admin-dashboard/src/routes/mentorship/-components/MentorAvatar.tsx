import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getPublicUrl } from '@/services/upload_file';

function initials(name?: string | null): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (
        (parts[0]?.[0] ?? '').concat(parts.length > 1 ? (parts[1]?.[0] ?? '') : '').toUpperCase() ||
        '?'
    );
}

/** Mentor avatar: profile photo when one is set, initials otherwise. */
export function MentorAvatar({
    fileId,
    name,
    className,
}: {
    fileId?: string | null;
    name?: string | null;
    className?: string;
}) {
    const { t } = useTranslation('mentorshipMentorAvatar');
    const { data: url } = useQuery({
        queryKey: ['file-public-url', fileId],
        queryFn: () => getPublicUrl(fileId),
        enabled: !!fileId,
        staleTime: 1000 * 60 * 60 * 6,
    });
    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-100 font-semibold text-primary-600',
                className
            )}
        >
            {url ? (
                <img src={url} alt={name || t('defaultAlt')} className="size-full object-cover" />
            ) : (
                initials(name)
            )}
        </div>
    );
}
