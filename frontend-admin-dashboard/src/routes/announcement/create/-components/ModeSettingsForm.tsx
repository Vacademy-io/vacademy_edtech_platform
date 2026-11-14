import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModeType } from '@/services/announcement';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { FieldError, FieldHint } from './primitives';
import type { FieldErrors, ModeSettings } from '../-types';

interface ModeSettingsFormProps {
    mode: ModeType;
    settings: ModeSettings;
    onChange: (settings: ModeSettings) => void;
    errors: FieldErrors;
    showErrors: boolean;
}

function Field({
    label,
    error,
    hint,
    children,
}: {
    label: string;
    error?: string;
    hint?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="space-y-1">
            <Label className="text-caption font-semibold">{label}</Label>
            {children}
            {hint && <FieldHint>{hint}</FieldHint>}
            <FieldError message={error} />
        </div>
    );
}

export function ModeSettingsForm({
    mode,
    settings,
    onChange,
    errors,
    showErrors,
}: ModeSettingsFormProps) {
    const { t } = useTranslation('announcementModeSettingsForm');
    const set = (key: string, value: unknown) => onChange({ ...settings, [key]: value });
    const err = (key: string) => (showErrors ? errors[`modes.${mode}.${key}`] : undefined);
    const str = (key: string) => (settings[key] as string) || '';
    const invalid = (key: string) => (err(key) ? 'border-danger-400' : undefined);

    switch (mode) {
        case 'SYSTEM_ALERT':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('field.priority')} error={err('priority')}>
                        <Select
                            value={str('priority') || 'HIGH'}
                            onValueChange={(value) => set('priority', value)}
                        >
                            <SelectTrigger className={cn(invalid('priority'))}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="HIGH">{t('option.priority.high')}</SelectItem>
                                <SelectItem value="MEDIUM">
                                    {t('option.priority.medium')}
                                </SelectItem>
                                <SelectItem value="LOW">{t('option.priority.low')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('field.expiresAt')} hint={t('hint.expiresAt')}>
                        <Input
                            type="datetime-local"
                            value={str('expiresAt')}
                            onChange={(e) => set('expiresAt', e.target.value)}
                        />
                    </Field>
                </div>
            );

        case 'DASHBOARD_PIN':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('field.position')} error={err('position')}>
                        <Select
                            value={str('position') || 'TOP'}
                            onValueChange={(value) => set('position', value)}
                        >
                            <SelectTrigger className={cn(invalid('position'))}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="TOP">{t('option.position.top')}</SelectItem>
                                <SelectItem value="MIDDLE">
                                    {t('option.position.middle')}
                                </SelectItem>
                                <SelectItem value="BOTTOM">
                                    {t('option.position.bottom')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('field.priority')} hint={t('hint.pinPriority')}>
                        <Input
                            type="number"
                            value={Number(settings.priority ?? 10)}
                            onChange={(e) => set('priority', Number(e.target.value))}
                        />
                    </Field>
                    <Field label={t('field.pinStartTime')} error={err('pinStartTime')}>
                        <Input
                            type="datetime-local"
                            value={str('pinStartTime')}
                            onChange={(e) => set('pinStartTime', e.target.value)}
                            className={cn(invalid('pinStartTime'))}
                        />
                    </Field>
                    <Field label={t('field.pinEndTime')} error={err('pinEndTime')}>
                        <Input
                            type="datetime-local"
                            value={str('pinEndTime')}
                            onChange={(e) => set('pinEndTime', e.target.value)}
                            className={cn(invalid('pinEndTime'))}
                        />
                    </Field>
                </div>
            );

        case 'APP_OVERLAY':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                        label={t('field.showUntil')}
                        error={err('showUntil')}
                        hint={t('hint.showUntil')}
                    >
                        <Input
                            type="datetime-local"
                            value={str('showUntil')}
                            onChange={(e) => set('showUntil', e.target.value)}
                            className={cn(invalid('showUntil'))}
                        />
                    </Field>
                    <Field
                        label={t('field.priority')}
                        error={err('priority')}
                        hint={t('hint.overlayPriority')}
                    >
                        <Input
                            type="number"
                            min={1}
                            max={10}
                            value={Number(settings.priority ?? 1)}
                            onChange={(e) => set('priority', Number(e.target.value))}
                            className={cn(invalid('priority'))}
                        />
                    </Field>
                    <label className="flex items-center gap-2 sm:col-span-2">
                        <Switch
                            checked={Boolean(settings.isDismissible)}
                            onCheckedChange={(value) => set('isDismissible', Boolean(value))}
                        />
                        <span className="text-caption">{t('field.isDismissible')}</span>
                    </label>
                </div>
            );

        case 'DM':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('field.messagePriority')}>
                        <Input
                            type="number"
                            value={Number(settings.messagePriority ?? 5)}
                            onChange={(e) => set('messagePriority', Number(e.target.value))}
                        />
                    </Field>
                    <label className="flex items-center gap-2 sm:self-end sm:pb-2">
                        <Switch
                            checked={Boolean(settings.allowReplies)}
                            onCheckedChange={(value) => set('allowReplies', Boolean(value))}
                        />
                        <span className="text-caption">{t('field.allowReplies')}</span>
                    </label>
                </div>
            );

        case 'STREAM':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('field.packageSessionId')}>
                        <Input
                            value={str('packageSessionId')}
                            onChange={(e) => set('packageSessionId', e.target.value)}
                            placeholder={t('field.packageSessionId')}
                        />
                    </Field>
                    <Field label={t('field.streamType')}>
                        <Select
                            value={str('streamType') || 'LIVE'}
                            onValueChange={(value) => set('streamType', value)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="LIVE">{t('option.streamType.live')}</SelectItem>
                                <SelectItem value="RECORDED">
                                    {t('option.streamType.recorded')}
                                </SelectItem>
                                <SelectItem value="UPCOMING">
                                    {t('option.streamType.upcoming')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
            );

        case 'RESOURCES':
            return (
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t('field.folderName')} error={err('folderName')}>
                        <Input
                            value={str('folderName')}
                            onChange={(e) => set('folderName', e.target.value)}
                            placeholder={t('placeholder.folderName')}
                            className={cn(invalid('folderName'))}
                        />
                    </Field>
                    <Field label={t('field.category')}>
                        <Input
                            value={str('category')}
                            onChange={(e) => set('category', e.target.value)}
                            placeholder={t('placeholder.optional')}
                        />
                    </Field>
                    <Field label={t('field.accessLevel')}>
                        <Select
                            value={str('accessLevel') || 'STUDENTS'}
                            onValueChange={(value) => set('accessLevel', value)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="STUDENTS">
                                    {t('option.accessLevel.students')}
                                </SelectItem>
                                <SelectItem value="TEACHERS">
                                    {t('option.accessLevel.teachers')}
                                </SelectItem>
                                <SelectItem value="ALL">
                                    {t('option.accessLevel.everyone')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
            );

        case 'COMMUNITY':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('field.communityType')} error={err('communityType')}>
                        <Select
                            value={str('communityType') || 'SCHOOL'}
                            onValueChange={(value) => set('communityType', value)}
                        >
                            <SelectTrigger className={cn(invalid('communityType'))}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="SCHOOL">
                                    {t('option.communityType.school')}
                                </SelectItem>
                                <SelectItem value="CLASS">
                                    {t('option.communityType.class')}
                                </SelectItem>
                                <SelectItem value="CLUB">
                                    {t('option.communityType.club')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('field.tags')} hint={t('hint.commaSeparated')}>
                        <Input
                            value={
                                Array.isArray(settings.tags)
                                    ? (settings.tags as string[]).join(', ')
                                    : ''
                            }
                            onChange={(e) =>
                                set(
                                    'tags',
                                    e.target.value
                                        .split(',')
                                        .map((t) => t.trim())
                                        .filter(Boolean)
                                )
                            }
                            placeholder={t('placeholder.tags')}
                        />
                    </Field>
                </div>
            );

        case 'TASKS':
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('field.taskTitle')} error={err('taskTitle')}>
                        <Input
                            value={str('taskTitle')}
                            onChange={(e) => set('taskTitle', e.target.value)}
                            className={cn(invalid('taskTitle'))}
                        />
                    </Field>
                    <Field label={t('field.estimatedMinutes')}>
                        <Input
                            type="number"
                            value={Number(settings.estimatedDurationMinutes ?? 0)}
                            onChange={(e) =>
                                set('estimatedDurationMinutes', Number(e.target.value))
                            }
                        />
                    </Field>
                    <div className="sm:col-span-2">
                        <Field label={t('field.taskDescription')}>
                            <Textarea
                                value={str('taskDescription')}
                                onChange={(e) => set('taskDescription', e.target.value)}
                                placeholder={t('placeholder.taskDescription')}
                            />
                        </Field>
                    </div>
                    <div className="sm:col-span-2">
                        <Field
                            label={t('field.slideIds')}
                            error={err('slideIds')}
                            hint={t('hint.commaSeparated')}
                        >
                            <Input
                                value={
                                    Array.isArray(settings.slideIds)
                                        ? (settings.slideIds as string[]).join(', ')
                                        : ''
                                }
                                onChange={(e) =>
                                    set(
                                        'slideIds',
                                        e.target.value
                                            .split(',')
                                            .map((t) => t.trim())
                                            // An empty box used to yield [''], which counted as one
                                            // slide and slipped past validation.
                                            .filter(Boolean)
                                    )
                                }
                                className={cn(invalid('slideIds'))}
                                placeholder={t('placeholder.slideIds')}
                            />
                        </Field>
                    </div>
                    <Field label={t('field.goLive')} error={err('goLiveDateTime')}>
                        <Input
                            type="datetime-local"
                            value={str('goLiveDateTime')}
                            onChange={(e) => set('goLiveDateTime', e.target.value)}
                            className={cn(invalid('goLiveDateTime'))}
                        />
                    </Field>
                    <Field label={t('field.deadline')} error={err('deadlineDateTime')}>
                        <Input
                            type="datetime-local"
                            value={str('deadlineDateTime')}
                            onChange={(e) => set('deadlineDateTime', e.target.value)}
                            className={cn(invalid('deadlineDateTime'))}
                        />
                    </Field>
                    <Field label={t('field.status')}>
                        <Select
                            value={str('status') || 'SCHEDULED'}
                            onValueChange={(value) => set('status', value)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DRAFT">{t('option.status.draft')}</SelectItem>
                                <SelectItem value="SCHEDULED">
                                    {t('option.status.scheduled')}
                                </SelectItem>
                                <SelectItem value="LIVE">{t('option.status.live')}</SelectItem>
                                <SelectItem value="COMPLETED">
                                    {t('option.status.completed')}
                                </SelectItem>
                                <SelectItem value="OVERDUE">
                                    {t('option.status.overdue')}
                                </SelectItem>
                                <SelectItem value="CANCELLED">
                                    {t('option.status.cancelled')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('field.reminderBeforeMinutes')}>
                        <Input
                            type="number"
                            value={Number(settings.reminderBeforeMinutes ?? 0)}
                            onChange={(e) => set('reminderBeforeMinutes', Number(e.target.value))}
                        />
                    </Field>
                    <label className="flex items-center gap-2">
                        <Switch
                            checked={Boolean(settings.isMandatory)}
                            onCheckedChange={(value) => set('isMandatory', Boolean(value))}
                        />
                        <span className="text-caption">{t('field.isMandatory')}</span>
                    </label>
                    <label className="flex items-center gap-2">
                        <Switch
                            checked={Boolean(settings.autoStatusUpdate)}
                            onCheckedChange={(value) => set('autoStatusUpdate', Boolean(value))}
                        />
                        <span className="text-caption">{t('field.autoStatusUpdate')}</span>
                    </label>
                </div>
            );

        default:
            return null;
    }
}
