import { useTranslation } from 'react-i18next';
import { CheckCircle, HourglassMedium, UserMinus } from '@phosphor-icons/react';
import { EngagementStat, type EngagementStatTone } from '../shared/EngagementStat';
import { formatNumber, formatPercent } from '../../-utils/format';

/**
 * The three "who needs me" tiles of the plan overview: Not started · Behind · On track.
 *
 * Tone carries meaning only. A zero is always neutral (a green or amber "0" reads as
 * news when it isn't), and before any task has opened every learner is technically
 * "not started", so the warning tone waits until the plan has begun.
 */

export interface OverviewTileCounts {
    notStarted: number;
    behind: number;
    onTrack: number;
    /** Enrolled learners (the share denominator). */
    learners: number;
}

export interface OverviewTilesProps {
    counts: OverviewTileCounts;
    /** False while no task has opened yet: every tile stays neutral. */
    begun: boolean;
    loading?: boolean;
}

export function tileTone(
    kind: 'notStarted' | 'behind' | 'onTrack',
    value: number,
    begun: boolean
): EngagementStatTone {
    if (!begun || value <= 0) return 'neutral';
    return kind === 'onTrack' ? 'success' : 'warning';
}

export function OverviewTiles({ counts, begun, loading = false }: OverviewTilesProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const share = (value: number) =>
        counts.learners > 0 ? Math.min(1, value / counts.learners) : null;
    const shareHint = (value: number, hint: string) => {
        const ratio = share(value);
        return ratio == null
            ? hint
            : `${hint} · ${t('overview.tiles.share', { percent: formatPercent(ratio, lang) })}`;
    };

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <EngagementStat
                icon={UserMinus}
                label={t('overview.class.NOT_STARTED')}
                value={formatNumber(counts.notStarted, lang)}
                hint={shareHint(counts.notStarted, t('overview.tiles.notStartedHint'))}
                tone={tileTone('notStarted', counts.notStarted, begun)}
                progress={begun ? share(counts.notStarted) : null}
                progressLabel={t('overview.tiles.shareAria', {
                    label: t('overview.class.NOT_STARTED'),
                })}
                loading={loading}
            />
            <EngagementStat
                icon={HourglassMedium}
                label={t('overview.class.BEHIND')}
                value={formatNumber(counts.behind, lang)}
                hint={shareHint(counts.behind, t('overview.tiles.behindHint'))}
                tone={tileTone('behind', counts.behind, begun)}
                progress={begun ? share(counts.behind) : null}
                progressLabel={t('overview.tiles.shareAria', {
                    label: t('overview.class.BEHIND'),
                })}
                loading={loading}
            />
            <EngagementStat
                icon={CheckCircle}
                label={t('overview.class.ON_TRACK')}
                value={formatNumber(counts.onTrack, lang)}
                hint={shareHint(counts.onTrack, t('overview.tiles.onTrackHint'))}
                tone={tileTone('onTrack', counts.onTrack, begun)}
                progress={begun ? share(counts.onTrack) : null}
                progressLabel={t('overview.tiles.shareAria', {
                    label: t('overview.class.ON_TRACK'),
                })}
                loading={loading}
            />
        </div>
    );
}
