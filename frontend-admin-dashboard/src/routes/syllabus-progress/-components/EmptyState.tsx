import type { ReactNode } from 'react';

/** Centred "nothing here" panel: icon, what it means, and an optional next step. */
export function EmptyState({
    icon,
    title,
    body,
    action,
}: {
    icon: ReactNode;
    title: string;
    body: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-card px-4 py-10 text-center sm:px-8">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                {icon}
            </span>
            <h2 className="text-subtitle font-semibold text-neutral-800">{title}</h2>
            <p className="max-w-md text-body text-neutral-600">{body}</p>
            {action}
        </div>
    );
}
