import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';

/** The error block every Site Assistant tab shows when its data does not load. */
export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-6 text-center"
    >
        <WarningCircle className="size-6 text-danger-600" />
        <p className="text-body text-danger-700">{message}</p>
        {onRetry && (
            <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                Try again
            </MyButton>
        )}
    </div>
);

/** A friendly "nothing here yet" block. */
export const EmptyState = ({
    icon,
    title,
    children,
}: {
    icon?: React.ReactNode;
    title: string;
    children?: React.ReactNode;
}) => (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-8 text-center">
        {icon}
        <p className="text-subtitle font-medium text-neutral-700">{title}</p>
        {children && <div className="max-w-md text-body text-neutral-500">{children}</div>}
    </div>
);
