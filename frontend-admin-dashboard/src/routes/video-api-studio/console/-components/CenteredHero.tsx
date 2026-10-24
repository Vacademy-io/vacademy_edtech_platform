import { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

interface CenteredHeroProps {
    headline?: string;
    /** Optional override; defaults to the Vimotion-branded tagline. */
    tagline?: ReactNode;
    composer: ReactNode;
    intentChips?: ReactNode;
}

export function CenteredHero({
    headline,
    tagline,
    composer,
    intentChips,
}: CenteredHeroProps) {
    const { t } = useTranslation('videoApiStudioCenteredHero');
    const resolvedHeadline = headline === undefined ? t('headline') : headline;
    const resolvedTagline =
        tagline === undefined ? (
            <Trans
                i18nKey="videoApiStudioCenteredHero:tagline"
                components={{
                    link: (
                        <a
                            href="https://vimotion.co"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-violet-600 hover:underline"
                        />
                    ),
                }}
            />
        ) : (
            tagline
        );

    return (
        <div className="flex size-full flex-col items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
                <div className="text-center">
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
                        {resolvedHeadline}
                    </h1>
                    {resolvedTagline && (
                        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                            {resolvedTagline}
                        </p>
                    )}
                </div>

                <div className="w-full">{composer}</div>

                {intentChips && <div className="w-full">{intentChips}</div>}
            </div>
        </div>
    );
}
