import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CheckIssue, HomeBlock } from '../-types/learner-home-types';
import { LIMITS, errorsOf, warningsOf } from '../-utils/publish-checks';
import { BLOCK_TYPE_ICON, blockName } from './block-display';
import { BannerEditor } from './editors/BannerEditor';
import { BuiltinEditor } from './editors/BuiltinEditor';
import { CourseShelfEditor } from './editors/CourseShelfEditor';
import { EventEditor } from './editors/EventEditor';
import { NoticeEditor } from './editors/NoticeEditor';
import { ShortcutsEditor } from './editors/ShortcutsEditor';
import { AudienceEditor } from './shared/AudienceEditor';
import { DevicePlacementEditor } from './shared/DevicePlacementEditor';
import { FieldIssues } from './shared/FieldIssues';
import { ScheduleEditor } from './shared/ScheduleEditor';
import { EditorSection, TextField } from './shared/fields';

/** The right-hand panel: the block's own form, then who / when / where (spec 8.2). */
export function BlockEditorPanel({
    block,
    issues,
    onChange,
    focusHeadingToken = 0,
}: {
    block: HomeBlock | null;
    /** Issues of this block only. */
    issues: CheckIssue[];
    onChange: (update: (block: HomeBlock) => HomeBlock) => void;
    /** Each new value moves focus to the heading (the list it came from was hidden). */
    focusHeadingToken?: number;
}) {
    const { t } = useTranslation('learnerHome');
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        if (focusHeadingToken > 0) headingRef.current?.focus();
    }, [focusHeadingToken]);
    if (!block) {
        return (
            <p className="p-6 text-center text-body text-neutral-500">{t('editor.noSelection')}</p>
        );
    }
    const key = block.block_key;
    const Icon = BLOCK_TYPE_ICON[block.type];
    const errors = errorsOf(issues);
    const warnings = warningsOf(issues);
    const setConfig = <B extends HomeBlock>(config: B['config']) =>
        onChange((b) => ({ ...b, config }) as HomeBlock);

    const form = (() => {
        switch (block.type) {
            case 'BANNER_CAROUSEL':
                return (
                    <BannerEditor
                        blockKey={key}
                        config={block.config}
                        onChange={setConfig}
                        issues={issues}
                    />
                );
            case 'SHORTCUTS':
                return (
                    <ShortcutsEditor
                        blockKey={key}
                        config={block.config}
                        onChange={setConfig}
                        issues={issues}
                    />
                );
            case 'COURSE_SHELF':
                return (
                    <CourseShelfEditor
                        blockKey={key}
                        config={block.config}
                        onChange={setConfig}
                        issues={issues}
                    />
                );
            case 'NOTICE':
                return (
                    <NoticeEditor
                        blockKey={key}
                        config={block.config}
                        onChange={setConfig}
                        issues={issues}
                    />
                );
            case 'EVENT':
                return (
                    <EventEditor
                        blockKey={key}
                        config={block.config}
                        onChange={setConfig}
                        issues={issues}
                    />
                );
            case 'BUILTIN':
                return (
                    <BuiltinEditor
                        blockKey={key}
                        widget={block.builtin_widget}
                        config={block.config}
                        onChange={setConfig}
                        issues={issues}
                    />
                );
        }
    })();

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-2">
                <Icon className="size-5 text-primary-500" aria-hidden />
                <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-title font-semibold text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {blockName(block, t)}
                </h2>
            </div>

            {(errors.length > 0 || warnings.length > 0) && (
                <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    {errors.length > 0 && (
                        <>
                            <p className="text-caption font-semibold text-danger-600">
                                {t('editor.toFix')}
                            </p>
                            <FieldIssues issues={errors} />
                        </>
                    )}
                    {warnings.length > 0 && (
                        <>
                            <p className="text-caption font-semibold text-warning-700">
                                {t('editor.warnings')}
                            </p>
                            <FieldIssues issues={warnings} />
                        </>
                    )}
                </div>
            )}

            <TextField
                id={`${key}-admin-label`}
                label={t('editor.adminLabel')}
                hint={t('editor.adminLabelHint')}
                value={block.admin_label ?? ''}
                onChange={(admin_label) => onChange((b) => ({ ...b, admin_label }))}
                max={LIMITS.adminLabel}
                issues={issues}
                path="admin_label"
            />

            <EditorSection title={t('editor.content')}>{form}</EditorSection>

            <EditorSection title={t('editor.who')}>
                <AudienceEditor
                    id={`${key}-aud`}
                    value={block.audience}
                    onChange={(audience) => onChange((b) => ({ ...b, audience }))}
                    issues={issues}
                />
            </EditorSection>

            <EditorSection title={t('editor.when')}>
                <ScheduleEditor
                    id={`${key}-when`}
                    startsAt={block.starts_at}
                    endsAt={block.ends_at}
                    onChange={(w) => onChange((b) => ({ ...b, ...w }))}
                    issues={issues}
                />
            </EditorSection>

            <EditorSection title={t('editor.where')}>
                <DevicePlacementEditor
                    id={`${key}-where`}
                    devices={block.devices}
                    placement={block.desktop_placement}
                    onChange={(patch) => onChange((b) => ({ ...b, ...patch }))}
                />
            </EditorSection>
        </div>
    );
}
