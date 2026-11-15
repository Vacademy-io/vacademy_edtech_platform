import { useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlayCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import {
    FULL_TUTORIAL,
    finishWelcomeTutorial,
    formatSeconds,
    hideTutorialCard,
    isTutorialCardHidden,
    isWelcomeTutorialPending,
    tutorialPoster,
    tutorialVideo,
} from '../-lib/tutorials';

/** A portrait tutorial video. Nothing downloads until it is played. */
export const TutorialVideo = ({
    slug,
    title,
    className,
    autoPlay,
}: {
    slug: string;
    title: string;
    className?: string;
    autoPlay?: boolean;
}) => (
    <video
        className={cn(
            'block aspect-[9/16] w-full rounded-lg bg-neutral-100 object-cover',
            className
        )}
        src={tutorialVideo(slug)}
        poster={tutorialPoster(slug)}
        controls
        playsInline
        autoPlay={autoPlay}
        preload={autoPlay ? 'auto' : 'none'}
        controlsList="nodownload"
        aria-label={title}
    />
);

/**
 * Offered once, right after a sign-up (trial, demo or buy): the 2-minute full tutorial. Not over a
 * checkout, which comes first for a "Buy <plan>" sign-up; it shows on the next screen instead.
 */
export const WelcomeTutorialDialog = () => {
    const { t } = useTranslation('evalezy');
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(isWelcomeTutorialPending);
    const close = () => {
        finishWelcomeTutorial();
        setOpen(false);
    };
    if (!open || pathname.startsWith('/evalezy/credits')) return null;
    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && close()}
            heading={t('tutorials.welcomeTitle')}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={close}>
                        {t('tutorials.later')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => {
                            close();
                            void navigate({ to: '/evalezy/help' });
                        }}
                    >
                        {t('tutorials.seeAll')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-neutral-600">
                    {t('tutorials.welcomeBody', { time: formatSeconds(FULL_TUTORIAL.seconds) })}
                </p>
                <TutorialVideo
                    slug={FULL_TUTORIAL.slug}
                    title={t('tutorials.full.title')}
                    className="mx-auto w-56"
                />
            </div>
        </MyDialog>
    );
};

/** "New to Evalezy?" on the home screen until it is closed: the full tutorial and the rest. */
export const TutorialCard = () => {
    const { t } = useTranslation('evalezy');
    const navigate = useNavigate();
    const [hidden, setHidden] = useState(isTutorialCardHidden);
    const [playing, setPlaying] = useState(false);
    if (hidden) return null;
    return (
        <section className="relative flex gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
            <button
                type="button"
                aria-label={t('tutorials.hideCard')}
                className="absolute right-2 top-2 rounded-md p-1 text-neutral-500 hover:bg-white"
                onClick={() => {
                    hideTutorialCard();
                    setHidden(true);
                }}
            >
                <X size={16} />
            </button>
            {playing ? (
                <TutorialVideo
                    slug={FULL_TUTORIAL.slug}
                    title={t('tutorials.full.title')}
                    className="w-40 shrink-0"
                    autoPlay
                />
            ) : (
                <button
                    type="button"
                    onClick={() => setPlaying(true)}
                    className="relative w-24 shrink-0 overflow-hidden rounded-md"
                    aria-label={t('tutorials.watch')}
                >
                    <img
                        src={tutorialPoster(FULL_TUTORIAL.slug)}
                        alt=""
                        className="block aspect-[9/16] w-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <PlayCircle size={36} weight="fill" className="text-white" />
                    </span>
                </button>
            )}
            <div className="flex min-w-0 flex-col justify-center gap-1 pr-6">
                <p className="text-subtitle font-semibold text-neutral-800">
                    {t('tutorials.cardTitle')}
                </p>
                <p className="text-caption text-neutral-600">
                    {t('tutorials.cardBody', { time: formatSeconds(FULL_TUTORIAL.seconds) })}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                    {!playing && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            onClick={() => setPlaying(true)}
                        >
                            <PlayCircle size={16} weight="fill" />
                            {t('tutorials.watch')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => void navigate({ to: '/evalezy/help' })}
                    >
                        {t('tutorials.seeAll')}
                    </MyButton>
                </div>
            </div>
        </section>
    );
};
