import type { Icon } from '@phosphor-icons/react';

/**
 * The title block every mentorship screen opens with.
 *
 * Navigation lives in the sidebar group (Overview / Mentors / Sessions / Requests /
 * My Mentorship), so each screen only has to say what it is and offer its own
 * actions — no second navigation strip repeating what the sidebar already shows.
 */
export function MentorshipPageHeader({
    title,
    subtitle,
    icon: IconCmp,
    children,
}: {
    title: string;
    subtitle: string;
    /** Optional tile in front of the title, the same icon the screen uses elsewhere. */
    icon?: Icon;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
                {IconCmp ? (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                        <IconCmp size={20} weight="duotone" />
                    </span>
                ) : null}
                <div className="flex min-w-0 flex-col">
                    <h2 className="text-h3 font-semibold text-neutral-900">{title}</h2>
                    <p className="text-body text-neutral-500">{subtitle}</p>
                </div>
            </div>
            {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
        </div>
    );
}
