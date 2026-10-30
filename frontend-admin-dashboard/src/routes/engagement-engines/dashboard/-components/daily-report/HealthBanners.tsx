import type { Icon } from '@phosphor-icons/react';
import { Info, Warning, WarningOctagon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DailyReportHealthSeverity } from '@/services/engagement-daily-report';
import type { HealthBanner } from '../../-utils/report-health';

const TONE: Record<DailyReportHealthSeverity, { box: string; icon: string; Glyph: Icon }> = {
    critical: {
        box: 'border-danger-200 bg-danger-50',
        icon: 'text-danger-600',
        Glyph: WarningOctagon,
    },
    warning: { box: 'border-warning-200 bg-warning-50', icon: 'text-warning-600', Glyph: Warning },
    info: { box: 'border-info-200 bg-info-50', icon: 'text-info-600', Glyph: Info },
};

/** Things to act on before the next run, critical first. Renders nothing when all is well. */
export function HealthBanners({ banners }: { banners: HealthBanner[] }) {
    const { t } = useTranslation('engagementDailyReport');
    if (banners.length === 0) return null;
    return (
        <section aria-label={t('health.ariaLabel')} className="flex flex-col gap-3">
            {banners.map((b) => {
                const tone = TONE[b.severity] ?? TONE.info;
                return (
                    <div
                        key={b.key}
                        role={b.severity === 'critical' ? 'alert' : 'status'}
                        className={cn(
                            'flex items-start gap-3 rounded-lg border p-3 sm:p-4',
                            tone.box
                        )}
                    >
                        <tone.Glyph
                            size={20}
                            weight="fill"
                            className={cn('mt-0.5 shrink-0', tone.icon)}
                        />
                        <div className="min-w-0">
                            <p className="font-semibold text-neutral-900">
                                <span className="text-body">{b.title}</span>
                            </p>
                            <p className="mt-0.5 text-neutral-700">
                                <span className="text-caption">{b.text}</span>
                            </p>
                        </div>
                    </div>
                );
            })}
        </section>
    );
}
