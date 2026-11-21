import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import type { CheckIssue, EventConfig, EventSource } from '../../-types/learner-home-types';
import { LIMITS } from '../../-utils/publish-checks';
import { useLiveSessionOptions } from '../../-hooks/usePickerOptions';
import { FieldIssues } from '../shared/FieldIssues';
import { ImageRefField } from '../shared/ImageRefField';
import { exact } from '../shared/issues';
import { ScheduleEditor } from '../shared/ScheduleEditor';
import { CtaEditor, NumberField, SwitchField, TextField } from '../shared/fields';

export function EventEditor({
    blockKey,
    config,
    onChange,
    issues,
}: {
    blockKey: string;
    config: EventConfig;
    onChange: (next: EventConfig) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    const live = config.source === 'LIVE_SESSION';
    const sessions = useLiveSessionOptions(live);
    const sessionOptions = (sessions.data ?? []).map((o) => ({
        value: o.value,
        label: o.hint ? `${o.label} · ${o.hint}` : o.label,
    }));
    if (config.live_session_id && !sessionOptions.some((o) => o.value === config.live_session_id)) {
        sessionOptions.unshift({
            value: config.live_session_id,
            label: t('link.unknownOption', { id: config.live_session_id }),
        });
    }
    const defaultLink =
        live && config.live_session_id
            ? ({ kind: 'LIVE_CLASS', session_id: config.live_session_id } as const)
            : undefined;

    return (
        <div className="space-y-4">
            <TextField
                id={`${blockKey}-title`}
                label={t('event.title')}
                value={config.title}
                onChange={(title) => onChange({ ...config, title })}
                max={LIMITS.event.title}
                issues={issues}
                path="config.title"
            />
            <TextField
                id={`${blockKey}-subtitle`}
                label={t('event.subtitle')}
                value={config.subtitle}
                onChange={(subtitle) => onChange({ ...config, subtitle })}
                max={LIMITS.event.subtitle}
                issues={issues}
                path="config.subtitle"
            />
            <ImageRefField
                id={`${blockKey}-img`}
                label={t('event.image')}
                slot="card"
                value={config.image}
                onChange={(image) => onChange({ ...config, image })}
                issues={issues}
                path="config.image"
            />
            <fieldset className="space-y-2">
                <legend className="text-body font-semibold text-neutral-700">
                    {t('event.source')}
                </legend>
                <RadioGroup
                    value={config.source}
                    onValueChange={(source) =>
                        onChange({ ...config, source: source as EventSource })
                    }
                    className="flex flex-wrap gap-4"
                >
                    {(['CUSTOM', 'LIVE_SESSION'] as const).map((s) => (
                        <div key={s} className="flex items-center gap-2">
                            <RadioGroupItem id={`${blockKey}-src-${s}`} value={s} />
                            <Label htmlFor={`${blockKey}-src-${s}`} className="font-normal">
                                {t(`event.sources.${s}`)}
                            </Label>
                        </div>
                    ))}
                </RadioGroup>
            </fieldset>
            {live ? (
                <div className="space-y-1">
                    <Label>{t('event.session')}</Label>
                    <SearchableSelect
                        options={sessionOptions}
                        value={config.live_session_id ?? ''}
                        onChange={(id) => onChange({ ...config, live_session_id: id || null })}
                        placeholder={
                            sessions.isLoading ? t('link.loading') : t('event.sessionPlaceholder')
                        }
                        emptyText={t('event.noSessions')}
                    />
                    <p className="text-caption text-neutral-500">{t('event.liveDefaultsNote')}</p>
                    <FieldIssues issues={exact(issues, 'config.live_session_id')} />
                </div>
            ) : (
                <div className="space-y-1">
                    <ScheduleEditor
                        id={`${blockKey}-times`}
                        startsAt={config.starts_at}
                        endsAt={config.ends_at}
                        onChange={(w) => onChange({ ...config, ...w })}
                        issues={issues}
                        pathPrefix="config."
                        startLabel={t('event.starts')}
                        endLabel={t('event.ends')}
                        compact
                    />
                    <p className="text-caption text-neutral-500">{t('event.hidesAfterEnd')}</p>
                </div>
            )}
            <CtaEditor
                id={`${blockKey}-register`}
                label={t('event.registerCta')}
                value={config.register_cta}
                onChange={(register_cta) => onChange({ ...config, register_cta })}
                issues={issues}
                path="config.register_cta"
                addLabel={t('event.addCta')}
                removeLabel={t('event.removeCta')}
                defaultLink={defaultLink}
            />
            <CtaEditor
                id={`${blockKey}-join`}
                label={t('event.joinCta')}
                value={config.join_cta}
                onChange={(join_cta) => onChange({ ...config, join_cta })}
                issues={issues}
                path="config.join_cta"
                addLabel={t('event.addCta')}
                removeLabel={t('event.removeCta')}
                defaultLink={defaultLink}
            />
            <NumberField
                id={`${blockKey}-opens`}
                label={t('event.joinOpens')}
                hint={t('event.joinOpensHint')}
                value={config.join_opens_minutes}
                min={0}
                max={LIMITS.event.joinOpensMax}
                onChange={(join_opens_minutes) => onChange({ ...config, join_opens_minutes })}
                issues={issues}
                path="config.join_opens_minutes"
            />
            <SwitchField
                id={`${blockKey}-countdown`}
                label={t('event.showCountdown')}
                checked={config.show_countdown}
                onChange={(show_countdown) => onChange({ ...config, show_countdown })}
            />
        </div>
    );
}
