import { useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretRight, Clock, PlayCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import {
    FULL_TUTORIAL,
    HOME_TUTORIALS,
    TUTORIALS,
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

/** A tutorial's poster with a play mark: a still image, so the home screen downloads no video. */
const TutorialThumb = ({ slug, className }: { slug: string; className?: string }) => (
    <span
        className={cn(
            'relative block aspect-[9/16] shrink-0 overflow-hidden rounded-md bg-neutral-100',
            className
        )}
    >
        <img
            src={tutorialPoster(slug)}
            alt=""
            loading="lazy"
            className="block size-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <PlayCircle size={20} weight="fill" className="text-white" />
        </span>
    </span>
);

/** One tutorial on the home screen: opens its own video on the help page. */
const TutorialLink = ({
    slug,
    label,
    title,
    seconds,
    featured,
}: {
    slug: string;
    label: string;
    title: string;
    seconds: number;
    featured?: boolean;
}) => (
    <Link
        to="/evalezy/help"
        hash={slug}
        className="flex h-full items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2 transition-colors hover:border-primary-300 hover:bg-primary-50"
    >
        <TutorialThumb slug={slug} className={featured ? 'w-12 sm:w-14' : 'w-10'} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-caption font-semibold text-primary-500">{label}</span>
            <span
                className={cn(
                    'line-clamp-2 font-semibold text-neutral-800',
                    featured ? 'text-subtitle' : 'text-body'
                )}
            >
                {title}
            </span>
            <span className="flex items-center gap-1 text-caption text-neutral-500">
                <Clock size={12} />
                {formatSeconds(seconds)}
            </span>
        </span>
        <CaretRight size={16} className="shrink-0 text-neutral-400" />
    </Link>
);

/**
 * "New to Evalezy?" under the tests on the home screen: the start-to-finish video and the next
 * steps, each opening its own video on the help page. Closing it hides it for this launch only.
 */
export const TutorialCard = () => {
    const { t } = useTranslation('evalezy');
    const [hidden, setHidden] = useState(isTutorialCardHidden);
    if (hidden) return null;
    return (
        <section
            aria-labelledby="evalezy-tutorials-heading"
            className="flex flex-col gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3 sm:p-4"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h2
                        id="evalezy-tutorials-heading"
                        className="text-subtitle font-semibold text-neutral-800"
                    >
                        {t('tutorials.cardTitle')}
                    </h2>
                    <p className="text-caption text-neutral-600">
                        {t('tutorials.cardBody', { time: formatSeconds(FULL_TUTORIAL.seconds) })}
                    </p>
                </div>
                <button
                    type="button"
                    aria-label={t('tutorials.hideCard')}
                    title={t('tutorials.hideCard')}
                    className="-mr-1 -mt-1 shrink-0 rounded-md p-2 text-neutral-500 hover:bg-white hover:text-neutral-700"
                    onClick={() => {
                        hideTutorialCard();
                        setHidden(true);
                    }}
                >
                    <X size={16} />
                </button>
            </div>

            <TutorialLink
                slug={FULL_TUTORIAL.slug}
                label={t('tutorials.startHere')}
                title={t('tutorials.full.title')}
                seconds={FULL_TUTORIAL.seconds}
                featured
            />
            <ul className="grid gap-2 sm:grid-cols-2">
                {HOME_TUTORIALS.map((v) => (
                    <li key={v.slug}>
                        <TutorialLink
                            slug={v.slug}
                            label={t('tutorials.step', {
                                number: TUTORIALS.findIndex((x) => x.slug === v.slug) + 1,
                            })}
                            title={t(`tutorials.items.${v.slug}.title`)}
                            seconds={v.seconds}
                        />
                    </li>
                ))}
            </ul>
            <Link
                to="/evalezy/help"
                className="self-center rounded-md px-2 py-1 text-body font-medium text-primary-500 hover:underline"
            >
                {t('tutorials.seeAll')} ({TUTORIALS.length + 1})
            </Link>
        </section>
    );
};
