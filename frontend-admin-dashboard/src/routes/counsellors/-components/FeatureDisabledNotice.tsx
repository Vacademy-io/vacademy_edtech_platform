import { Trans, useTranslation } from 'react-i18next';
import { Lock } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';

interface Props {
    title: string;
    settingsLabel: string;
}

/**
 * Render this when a route is being visited but its display-settings flag
 * is off. The route file imports this and short-circuits its own render so
 * a direct URL hit (deep link, browser refresh, bookmark) cannot expose a
 * feature the institute hasn't opted into.
 */
export function FeatureDisabledNotice({ title, settingsLabel }: Props) {
    const { t } = useTranslation('counsellorsFeatureDisabledNotice');
    return (
        <LayoutContainer>
            <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-12 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-neutral-100">
                    <Lock size={24} className="text-neutral-500" />
                </div>
                <h2 className="text-h3 font-medium text-neutral-900">{title}</h2>
                <p className="text-subtitle text-neutral-500">
                    <Trans
                        t={t}
                        i18nKey="disabledMessage"
                        values={{ settingsLabel }}
                        components={{ bold: <span className="font-medium" /> }}
                    />
                </p>
            </div>
        </LayoutContainer>
    );
}
