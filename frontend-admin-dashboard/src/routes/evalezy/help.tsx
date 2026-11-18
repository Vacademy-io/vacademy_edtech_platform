import { useEffect } from 'react';
import { createFileRoute, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Clock } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { TutorialVideo } from './-components/Tutorials';
import { FULL_TUTORIAL, TUTORIALS, formatSeconds } from './-lib/tutorials';

export const Route = createFileRoute('/evalezy/help')({
    component: EvalezyHelp,
});

/** How to use Evalezy: the full tutorial, then one short video and its written steps per step. */
function EvalezyHelp() {
    const { t } = useTranslation('evalezy');
    // Opened from a tutorial on the home screen (/evalezy/help#<slug>): go straight to that video.
    const { hash } = useLocation();
    useEffect(() => {
        if (!hash) return;
        // After the router's own scroll on navigation, which would otherwise win.
        const frame = requestAnimationFrame(() =>
            document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        );
        return () => cancelAnimationFrame(frame);
    }, [hash]);
    // The tutorial asked for, outlined so it is found at a glance.
    const target = (slug: string) => hash === slug && 'border-primary-400 ring-2 ring-primary-200';
    // A missing or non-list entry (e.g. a half-translated locale) shows no steps rather than crashing.
    const steps = (slug: string): string[] => {
        const list: unknown = t(`tutorials.items.${slug}.steps`, {
            returnObjects: true,
            defaultValue: [],
        });
        return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
    };
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div>
                <h1 className="text-h3 font-semibold text-neutral-800">{t('tutorials.title')}</h1>
                <p className="text-body text-neutral-500">{t('tutorials.subtitle')}</p>
            </div>

            <section
                id={FULL_TUTORIAL.slug}
                className={cn(
                    'flex scroll-mt-20 flex-col gap-3 rounded-lg border border-primary-200 bg-white p-4 sm:flex-row',
                    target(FULL_TUTORIAL.slug)
                )}
            >
                <TutorialVideo
                    slug={FULL_TUTORIAL.slug}
                    title={t('tutorials.full.title')}
                    className="mx-auto w-full max-w-64 sm:mx-0 sm:w-56"
                />
                <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-caption font-semibold uppercase tracking-wide text-primary-500">
                        {t('tutorials.startHere')}
                    </p>
                    <h2 className="text-subtitle font-semibold text-neutral-800">
                        {t('tutorials.full.title')}
                    </h2>
                    <p className="flex items-center gap-1 text-caption text-neutral-500">
                        <Clock size={14} /> {formatSeconds(FULL_TUTORIAL.seconds)} ·{' '}
                        {t('tutorials.full.summary')}
                    </p>
                    <ol className="list-decimal space-y-1 pl-5 text-body text-neutral-700">
                        {steps('full-tutorial').map((s) => (
                            <li key={s}>{s}</li>
                        ))}
                    </ol>
                </div>
            </section>

            <h2 className="mt-2 text-subtitle font-semibold text-neutral-800">
                {t('tutorials.stepByStep')}
            </h2>
            <ul className="flex flex-col gap-3">
                {TUTORIALS.map((v, i) => (
                    <li
                        key={v.slug}
                        id={v.slug}
                        className={cn(
                            'flex scroll-mt-20 gap-3 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4',
                            target(v.slug)
                        )}
                    >
                        <TutorialVideo
                            slug={v.slug}
                            title={t(`tutorials.items.${v.slug}.title`)}
                            className="w-28 shrink-0 self-start sm:w-44"
                        />
                        <div className="flex min-w-0 flex-col gap-2">
                            <p className="text-caption font-semibold text-primary-500">
                                {t('tutorials.step', { number: i + 1 })}
                            </p>
                            <h3 className="text-subtitle font-semibold text-neutral-800">
                                {t(`tutorials.items.${v.slug}.title`)}
                            </h3>
                            <p className="flex items-center gap-1 text-caption text-neutral-500">
                                <Clock size={14} /> {formatSeconds(v.seconds)} ·{' '}
                                {t(`tutorials.items.${v.slug}.summary`)}
                            </p>
                            <ol className="list-decimal space-y-1 pl-4 text-caption text-neutral-700 sm:pl-5 sm:text-body">
                                {steps(v.slug).map((s) => (
                                    <li key={s}>{s}</li>
                                ))}
                            </ol>
                        </div>
                    </li>
                ))}
            </ul>
            <p className="pb-4 text-center text-caption text-neutral-500">
                {t('tutorials.stuck')}{' '}
                <a
                    href="https://evalezy.com/faq/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary-500 underline"
                >
                    {t('tutorials.faq')}
                </a>
            </p>
        </div>
    );
}
