import type { ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretLeft } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { EvalezyHeader } from './EvalezyHeader';

/**
 * A portal page opened from the Evalezy app - one checked copy, from "Open" or
 * "View progress" in the copies list - shown in the Evalezy shell: the Evalezy
 * top bar and a way back to the test, never the portal's sidebar and navbar
 * (which read as being sent to the admin dashboard).
 */
export const EvalezyPageShell = ({ children }: { children?: ReactNode }) => {
    const { t } = useTranslation('evalezy');
    const router = useRouter();
    return (
        <div className="min-h-screen-safe flex w-full min-w-0 flex-col bg-neutral-50">
            <EvalezyHeader />
            <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-3 p-3 text-neutral-600 sm:p-4">
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    className="w-fit"
                    onClick={() => router.history.back()}
                >
                    <CaretLeft size={16} />
                    {t('copyView.back')}
                </MyButton>
                {children}
            </main>
        </div>
    );
};
