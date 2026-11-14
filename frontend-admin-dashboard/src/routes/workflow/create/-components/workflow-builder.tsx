import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    ArrowLeft, FloppyDisk, CheckCircle, Play, MagicWand,
    CalendarBlank, Lightning, CaretDown, CaretUp, PencilSimple, GearSix,
} from '@phosphor-icons/react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { createWorkflow, updateWorkflow, testRunWorkflow, validateWorkflow, getTriggerEventsCatalogQuery } from '@/services/workflow-service';
import { WorkflowBuilderDTO } from '@/types/workflow/workflow-types';
import { getUserId } from '@/utils/userDetails';
import { cn } from '@/lib/utils';
import { useWorkflowBuilderStore } from '../-stores/workflow-builder-store';
import { WorkflowCustomNode } from './workflow-custom-node';
import { NodePalette } from './node-palette';
import { NodeConfigPanel } from './node-config-panel';
import { TemplateGallery } from './template-gallery';
import { NodeSuggestions } from './node-suggestions';
import { WorkflowWizard } from './workflow-wizard';
import { AiDraftPanel } from './ai-draft-panel';
import { EventEntityPicker, useEntityLabels } from './event-entity-picker';
import { UseCaseWizardStep } from './use-case-wizard-step';

const nodeTypes = { workflowNode: WorkflowCustomNode };

/** Convert datetime-local value (2026-04-24T16:24) to Instant-compatible string (2026-04-24T16:24:00Z) */
function normalizeToInstant(val: string): string {
    if (!val) return val;
    // datetime-local gives "2026-04-24T16:24", add seconds if missing
    let normalized = val;
    if (normalized.length === 16) normalized += ':00';        // add :00 seconds
    if (!normalized.endsWith('Z') && !normalized.includes('+')) normalized += 'Z'; // add UTC marker
    return normalized;
}

// ─── Grouped trigger events for cleaner display ───
function groupCatalogByCategory(
    items: Array<{ key: string; label: string; category: string; event_applied_type?: string }>,
    t: TFunction
) {
    const groups: Record<string, typeof items> = {};
    items.forEach((item) => {
        const cat = item.category || t('setup.step3.generalCategory');
        if (!groups[cat]) groups[cat] = [];
        groups[cat]!.push(item);
    });
    return groups;
}

// ═══════════════════════════════════════════════════
// SCHEDULE PICKER — Human-readable frequency picker
// ═══════════════════════════════════════════════════

type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'INTERVAL' | 'CUSTOM';

function buildWeekdays(t: TFunction): { value: string; label: string; short: string }[] {
    return [
        { value: '1', label: t('weekdays.mon'), short: t('weekdays.monShort') },
        { value: '2', label: t('weekdays.tue'), short: t('weekdays.tueShort') },
        { value: '3', label: t('weekdays.wed'), short: t('weekdays.wedShort') },
        { value: '4', label: t('weekdays.thu'), short: t('weekdays.thuShort') },
        { value: '5', label: t('weekdays.fri'), short: t('weekdays.friShort') },
        { value: '6', label: t('weekdays.sat'), short: t('weekdays.satShort') },
        { value: '0', label: t('weekdays.sun'), short: t('weekdays.sunShort') },
    ];
}

function parseCronToFrequency(cron: string): { frequency: ScheduleFrequency; hour: number; minute: number; weekdays: string[]; dayOfMonth: number } {
    const defaults = { frequency: 'DAILY' as ScheduleFrequency, hour: 9, minute: 0, weekdays: [] as string[], dayOfMonth: 1 };
    if (!cron) return defaults;

    const parts = cron.trim().split(/\s+/);
    if (parts.length < 6) return { ...defaults, frequency: 'CUSTOM' };

    const [sec, min, hr, dom, , dow] = parts;
    const hour = parseInt(hr!) || 0;
    const minute = parseInt(min!) || 0;

    // Daily: 0 0 9 * * ?
    if (dom === '*' && dow === '?') {
        return { frequency: 'DAILY', hour, minute, weekdays: [], dayOfMonth: 1 };
    }
    // Weekly: 0 0 9 ? * 1,3,5
    if (dom === '?' && dow !== '*' && dow !== '?') {
        const weekdays = dow!.split(',');
        return { frequency: 'WEEKLY', hour, minute, weekdays, dayOfMonth: 1 };
    }
    // Monthly: 0 0 9 15 * ?
    if (dom !== '*' && dom !== '?' && dow === '?') {
        return { frequency: 'MONTHLY', hour, minute, weekdays: [], dayOfMonth: parseInt(dom!) || 1 };
    }

    return { ...defaults, frequency: 'CUSTOM', hour, minute };
}

function buildCron(frequency: ScheduleFrequency, hour: number, minute: number, weekdays: string[], dayOfMonth: number): string {
    switch (frequency) {
        case 'DAILY':
            return `0 ${minute} ${hour} * * ?`;
        case 'WEEKLY':
            return `0 ${minute} ${hour} ? * ${weekdays.length > 0 ? weekdays.join(',') : '1'}`;
        case 'MONTHLY':
            return `0 ${minute} ${hour} ${dayOfMonth} * ?`;
        default:
            return `0 ${minute} ${hour} * * ?`;
    }
}

function SchedulePickerSection({ scheduleConfig, setScheduleConfig }: {
    scheduleConfig: { scheduleType: string; cronExpression: string; intervalMinutes: number; timezone: string; startDate: string; endDate: string };
    setScheduleConfig: (config: Record<string, unknown>) => void;
}) {
    const { t } = useTranslation('workflowBuilder');
    const WEEKDAYS = buildWeekdays(t);
    const parsed = parseCronToFrequency(scheduleConfig.cronExpression);
    const [frequency, setFrequency] = useState<ScheduleFrequency>(
        scheduleConfig.scheduleType === 'INTERVAL' ? 'INTERVAL' : parsed.frequency
    );
    const [hour, setHour] = useState(parsed.hour);
    const [minute, setMinute] = useState(parsed.minute);
    const [weekdays, setWeekdays] = useState<string[]>(parsed.weekdays);
    const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth);

    const updateCron = (freq: ScheduleFrequency, h: number, m: number, wd: string[], dom: number) => {
        if (freq === 'INTERVAL') {
            setScheduleConfig({ scheduleType: 'INTERVAL' });
        } else if (freq === 'CUSTOM') {
            setScheduleConfig({ scheduleType: 'CRON' });
        } else {
            const cron = buildCron(freq, h, m, wd, dom);
            setScheduleConfig({ scheduleType: 'CRON', cronExpression: cron });
        }
    };

    const handleFrequency = (f: ScheduleFrequency) => {
        setFrequency(f);
        // Set sensible defaults per frequency
        if (f === 'WEEKLY' && weekdays.length === 0) {
            const defaultDays = ['1', '3', '5']; // Mon, Wed, Fri
            setWeekdays(defaultDays);
            updateCron(f, hour, minute, defaultDays, dayOfMonth);
        } else {
            updateCron(f, hour, minute, weekdays, dayOfMonth);
        }
    };

    const handleTime = (h: number, m: number) => {
        setHour(h);
        setMinute(m);
        updateCron(frequency, h, m, weekdays, dayOfMonth);
    };

    const toggleWeekday = (day: string) => {
        const updated = weekdays.includes(day)
            ? weekdays.filter((d) => d !== day)
            : [...weekdays, day];
        setWeekdays(updated);
        updateCron(frequency, hour, minute, updated, dayOfMonth);
    };

    const handleDayOfMonth = (d: number) => {
        setDayOfMonth(d);
        updateCron(frequency, hour, minute, weekdays, d);
    };

    // Quick presets for weekday selection
    const applyWeekdayPreset = (preset: string[]) => {
        setWeekdays(preset);
        updateCron(frequency, hour, minute, preset, dayOfMonth);
    };

    // Human-readable summary
    const getSummary = () => {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        switch (frequency) {
            case 'DAILY': return t('schedulePicker.summary.daily', { time: timeStr });
            case 'WEEKLY': {
                const dayNames = weekdays
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map((d) => WEEKDAYS.find((w) => w.value === d)?.label)
                    .filter(Boolean);
                if (dayNames.length === 0) return t('schedulePicker.summary.selectAtLeastOneDay');
                if (dayNames.length === 5 && !weekdays.includes('6') && !weekdays.includes('0')) return t('schedulePicker.summary.weekdaysOnly', { time: timeStr });
                if (dayNames.length === 7) return t('schedulePicker.summary.daily', { time: timeStr });
                return t('schedulePicker.summary.customDays', { days: dayNames.join(', '), time: timeStr });
            }
            case 'MONTHLY': {
                return t('schedulePicker.summary.monthly', { day: dayOfMonth, time: timeStr });
            }
            case 'INTERVAL': return t('schedulePicker.summary.interval', { count: scheduleConfig.intervalMinutes });
            case 'CUSTOM': return scheduleConfig.cronExpression || t('schedulePicker.summary.customPlaceholder');
        }
    };

    const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string; desc: string }[] = [
        { value: 'DAILY', label: t('schedulePicker.frequency.daily.label'), desc: t('schedulePicker.frequency.daily.desc') },
        { value: 'WEEKLY', label: t('schedulePicker.frequency.weekly.label'), desc: t('schedulePicker.frequency.weekly.desc') },
        { value: 'MONTHLY', label: t('schedulePicker.frequency.monthly.label'), desc: t('schedulePicker.frequency.monthly.desc') },
        { value: 'INTERVAL', label: t('schedulePicker.frequency.interval.label'), desc: t('schedulePicker.frequency.interval.desc') },
        { value: 'CUSTOM', label: t('schedulePicker.frequency.custom.label'), desc: t('schedulePicker.frequency.custom.desc') },
    ];

    return (
        <div className="space-y-5 rounded-xl border bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{t('schedulePicker.heading')}</h2>

            {/* Frequency selector — highlighted cards */}
            <div>
                <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.howOften')}</Label>
                <div className="mt-2 grid grid-cols-5 gap-2">
                    {FREQUENCY_OPTIONS.map(({ value, label, desc }) => (
                        <button
                            key={value}
                            className={`rounded-xl border-2 px-2 py-3 text-center transition-all ${
                                frequency === value
                                    ? 'border-primary-600 bg-primary-600 shadow-md'
                                    : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm'
                            }`}
                            onClick={() => handleFrequency(value)}
                        >
                            <div className={`text-xs font-semibold ${frequency === value ? 'text-white' : 'text-gray-700'}`}>
                                {label}
                            </div>
                            <div className={`mt-0.5 text-[10px] ${frequency === value ? 'text-primary-100' : 'text-gray-400'}`}>{desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Configuration area — highlighted container */}
            {frequency !== 'CUSTOM' && frequency !== 'INTERVAL' && (
                <div className={`space-y-4 rounded-xl border-2 p-4 transition-all ${
                    frequency === 'DAILY' ? 'border-primary-200 bg-primary-50/30' :
                    frequency === 'WEEKLY' ? 'border-violet-200 bg-violet-50/30' :
                    'border-amber-200 bg-amber-50/30'
                }`}>
                    {/* Time picker */}
                    <div>
                        <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.atWhatTime')}</Label>
                        <div className="mt-1.5 flex items-center gap-2">
                            <Input
                                type="time"
                                value={`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`}
                                onChange={(e) => {
                                    const [h, m] = e.target.value.split(':').map(Number);
                                    handleTime(h ?? 9, m ?? 0);
                                }}
                                className="w-36"
                            />
                        </div>
                    </div>

                    {/* Weekday selector — for WEEKLY */}
                    {frequency === 'WEEKLY' && (
                        <div>
                            <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.onWhichDays')}</Label>
                            <div className="mt-2 flex gap-2">
                                {WEEKDAYS.map((day) => (
                                    <button
                                        key={day.value}
                                        className={`h-10 w-10 rounded-full border-2 text-xs font-bold transition-all ${
                                            weekdays.includes(day.value)
                                                ? 'border-primary-600 bg-primary-600 text-white shadow-md'
                                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-100'
                                        }`}
                                        onClick={() => toggleWeekday(day.value)}
                                        title={day.label}
                                    >
                                        {day.short}
                                    </button>
                                ))}
                            </div>
                            {/* Quick presets */}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <button
                                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                                    onClick={() => applyWeekdayPreset(['1', '2', '3', '4', '5'])}
                                >
                                    {t('schedulePicker.presets.weekdays')}
                                </button>
                                <button
                                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                                    onClick={() => applyWeekdayPreset(['6', '0'])}
                                >
                                    {t('schedulePicker.presets.weekends')}
                                </button>
                                <button
                                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                                    onClick={() => applyWeekdayPreset(['1', '3', '5'])}
                                >
                                    {t('schedulePicker.presets.monWedFri')}
                                </button>
                                <button
                                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                                    onClick={() => applyWeekdayPreset(['2', '4'])}
                                >
                                    {t('schedulePicker.presets.tueThu')}
                                </button>
                                <button
                                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                                    onClick={() => applyWeekdayPreset(['0', '1', '2', '3', '4', '5', '6'])}
                                >
                                    {t('schedulePicker.presets.everyDay')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Day of month — for MONTHLY */}
                    {frequency === 'MONTHLY' && (
                        <div>
                            <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.onWhichDayOfMonth')}</Label>
                            <div className="mt-2 grid grid-cols-7 gap-1.5">
                                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                                    <button
                                        key={d}
                                        className={`h-9 rounded-lg border-2 text-xs font-semibold transition-all ${
                                            dayOfMonth === d
                                                ? 'border-primary-600 bg-primary-600 text-white shadow-md'
                                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-100'
                                        }`}
                                        onClick={() => handleDayOfMonth(d)}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Interval config */}
            {frequency === 'INTERVAL' && (
                <div className="rounded-xl border-2 border-green-200 bg-green-50/30 p-4">
                    <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.runEvery')}</Label>
                    <div className="mt-1.5 flex items-center gap-2">
                        <Input
                            type="number"
                            value={scheduleConfig.intervalMinutes}
                            onChange={(e) => setScheduleConfig({ intervalMinutes: parseInt(e.target.value) || 60 })}
                            className="w-24"
                            min={1}
                        />
                        <span className="text-sm text-gray-600">{t('schedulePicker.minutes')}</span>
                    </div>
                    {/* Quick presets */}
                    <div className="mt-2 flex gap-1.5">
                        {[
                            { label: t('schedulePicker.intervalPresets.min15'), value: 15 },
                            { label: t('schedulePicker.intervalPresets.min30'), value: 30 },
                            { label: t('schedulePicker.intervalPresets.hour1'), value: 60 },
                            { label: t('schedulePicker.intervalPresets.hours2'), value: 120 },
                            { label: t('schedulePicker.intervalPresets.hours6'), value: 360 },
                            { label: t('schedulePicker.intervalPresets.hours12'), value: 720 },
                        ].map(({ label, value }) => (
                            <button
                                key={value}
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                                    scheduleConfig.intervalMinutes === value
                                        ? 'border-primary-600 bg-primary-600 text-white'
                                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
                                }`}
                                onClick={() => setScheduleConfig({ intervalMinutes: value })}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Custom cron */}
            {frequency === 'CUSTOM' && (
                <div className="rounded-xl border-2 border-gray-200 bg-gray-50/50 p-4">
                    <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.cronLabel')}</Label>
                    <Input
                        value={scheduleConfig.cronExpression}
                        onChange={(e) => setScheduleConfig({ cronExpression: e.target.value })}
                        className="mt-1.5 font-mono"
                        placeholder={t('schedulePicker.cronPlaceholder') as string}
                    />
                    <p className="mt-1 text-[10px] text-gray-400">
                        {t('schedulePicker.cronHint')}
                    </p>
                </div>
            )}

            {/* Summary banner */}
            <div className="rounded-lg bg-primary-50 border border-primary-100 px-4 py-2.5 flex items-center gap-2">
                <CalendarBlank size={16} weight="fill" className="text-primary-500 shrink-0" />
                <span className="text-sm text-primary-600 font-medium">{getSummary()}</span>
            </div>

            {/* Timezone + dates */}
            <div className="grid grid-cols-2 gap-3 border-t pt-4">
                <div>
                    <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.timezone')}</Label>
                    <select
                        className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={scheduleConfig.timezone}
                        onChange={(e) => setScheduleConfig({ timezone: e.target.value })}
                    >
                        <option value="Asia/Kolkata">{t('schedulePicker.timezones.kolkata')}</option>
                        <option value="UTC">{t('schedulePicker.timezones.utc')}</option>
                        <option value="America/New_York">{t('schedulePicker.timezones.newYork')}</option>
                        <option value="Europe/London">{t('schedulePicker.timezones.london')}</option>
                        <option value="Asia/Dubai">{t('schedulePicker.timezones.dubai')}</option>
                    </select>
                </div>
                <div>
                    <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.startDate')}</Label>
                    <Input
                        type="datetime-local"
                        value={scheduleConfig.startDate}
                        onChange={(e) => setScheduleConfig({ startDate: e.target.value })}
                        className="mt-1.5 text-xs"
                    />
                </div>
            </div>
            <div>
                <Label className="text-xs font-medium text-gray-600">{t('schedulePicker.endDate')}</Label>
                <Input
                    type="datetime-local"
                    value={scheduleConfig.endDate}
                    onChange={(e) => setScheduleConfig({ endDate: e.target.value })}
                    className="mt-1.5 text-xs"
                />
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════
// SETUP STEP — Shown before the canvas
// ═══════════════════════════════════════════════════
function WorkflowSetupStep({ onComplete, triggerEventsCatalog, instituteId }: {
    onComplete: () => void;
    triggerEventsCatalog: Array<{ key: string; label: string; description: string; category: string; event_applied_type?: string }>;
    instituteId: string;
}) {
    const navigate = useNavigate();
    const { t } = useTranslation('workflowBuilder');
    const {
        workflowName, workflowDescription, workflowType,
        scheduleConfig, triggerConfig,
        setWorkflowName, setWorkflowDescription, setWorkflowType,
        setScheduleConfig, setTriggerConfig,
    } = useWorkflowBuilderStore();

    const [currentStep, setCurrentStep] = useState(1);

    /** Called when user picks "Build from scratch" (advanced) on Step 4 */
    const handleAdvancedMode = () => {
        if (workflowType === 'EVENT_DRIVEN' && triggerConfig.eventName) {
            const store = useWorkflowBuilderStore.getState();
            const existingTrigger = store.nodes.find((n) => n.data.nodeType === 'TRIGGER');
            if (!existingTrigger) {
                store.addNode('TRIGGER', t('setup.step2.triggerNodeName', { event: triggerConfig.eventName.replace(/_/g, ' ').toLowerCase() }), { x: 250, y: 50 });
                const newTrigger = useWorkflowBuilderStore.getState().nodes.find((n) => n.data.nodeType === 'TRIGGER');
                if (newTrigger) {
                    store.updateNodeConfig(newTrigger.id, { triggerEvent: triggerConfig.eventName });
                }
            }
        }
        onComplete();
    };

    /** Called when use-case wizard generates nodes */
    const handleTemplateComplete = () => {
        onComplete();
    };

    const groupedEvents = groupCatalogByCategory(triggerEventsCatalog, t);

    // Step validation
    const canGoToStep2 = workflowName.trim().length > 0;
    const canGoToStep3 = canGoToStep2;
    const canGoToStep4 =
        canGoToStep2 &&
        (workflowType === 'SCHEDULED'
            ? (scheduleConfig.scheduleType === 'CRON' ? scheduleConfig.cronExpression.trim().length > 0 : scheduleConfig.intervalMinutes > 0)
            : triggerConfig.eventName.length > 0);

    const STEPS = [
        { num: 1, label: t('setup.steps.name') },
        { num: 2, label: t('setup.steps.triggerType') },
        { num: 3, label: workflowType === 'EVENT_DRIVEN' ? t('setup.steps.eventSetup') : t('setup.steps.schedule') },
        { num: 4, label: t('setup.steps.buildWorkflow') },
    ];

    return (
        <div className="flex h-[calc(100vh-64px)] flex-col bg-gray-50">
            {/* Header */}
            <div className="flex items-center gap-3 border-b bg-white px-6 py-3">
                <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/workflow/list' })}>
                    <ArrowLeft size={16} />
                </Button>
                <h1 className="text-lg font-semibold text-gray-800">{t('setup.title')}</h1>
            </div>

            {/* Progress bar */}
            <div className="border-b bg-white px-6 py-4">
                <div className="mx-auto max-w-2xl">
                    <div className="flex items-center justify-between">
                        {STEPS.map((step, i) => (
                            <div key={step.num} className="flex items-center gap-2 flex-1">
                                <button
                                    onClick={() => {
                                        if (step.num === 1 || (step.num === 2 && canGoToStep2) || (step.num === 3 && canGoToStep3) || (step.num === 4 && canGoToStep4)) {
                                            setCurrentStep(step.num);
                                        }
                                    }}
                                    className={`flex items-center gap-2 ${step.num <= currentStep ? 'cursor-pointer' : 'cursor-default'}`}
                                >
                                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                                        currentStep === step.num
                                            ? 'bg-primary-600 text-white shadow-md'
                                            : currentStep > step.num
                                                ? 'bg-green-500 text-white'
                                                : 'bg-gray-200 text-gray-500'
                                    }`}>
                                        {currentStep > step.num ? <CheckCircle size={16} weight="bold" /> : step.num}
                                    </div>
                                    <span className={`text-xs font-medium hidden sm:block ${
                                        currentStep === step.num ? 'text-primary-600' : currentStep > step.num ? 'text-green-600' : 'text-gray-400'
                                    }`}>
                                        {step.label}
                                    </span>
                                </button>
                                {i < STEPS.length - 1 && (
                                    <div className={`flex-1 h-0.5 mx-2 ${currentStep > step.num ? 'bg-green-400' : 'bg-gray-200'}`} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Step content */}
            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-2xl py-8 px-4">

                    {/* ─── STEP 1: Name ─── */}
                    {currentStep === 1 && (
                        <div className="space-y-6">
                            <AiDraftPanel instituteId={instituteId} onComplete={onComplete} />
                            <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-gray-200" />
                                <span className="text-xs uppercase tracking-wide text-gray-400">{t('setup.orManual')}</span>
                                <div className="h-px flex-1 bg-gray-200" />
                            </div>
                            <div>
                                <h2 className="text-xl font-semibold text-gray-800">{t('setup.step1.heading')}</h2>
                                <p className="mt-1 text-sm text-gray-500">{t('setup.step1.subheading')}</p>
                            </div>
                            <div className="rounded-xl border bg-white p-6 space-y-4">
                                <div>
                                    <Label className="text-sm font-medium text-gray-700">{t('setup.step1.nameLabel')} <span className="text-red-400">*</span></Label>
                                    <Input
                                        value={workflowName}
                                        onChange={(e) => setWorkflowName(e.target.value)}
                                        placeholder={t('setup.step1.namePlaceholder') as string}
                                        className="mt-2 h-12 text-base"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <Label className="text-sm font-medium text-gray-700">{t('setup.step1.descriptionLabel')} <span className="text-gray-300 text-xs">{t('setup.optional')}</span></Label>
                                    <textarea
                                        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                                        rows={2}
                                        value={workflowDescription}
                                        onChange={(e) => setWorkflowDescription(e.target.value)}
                                        placeholder={t('setup.step1.descriptionPlaceholder') as string}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <Button size="lg" onClick={() => setCurrentStep(2)} disabled={!canGoToStep2} className="gap-2 px-8">
                                    {t('setup.step1.next')}
                                    <ArrowLeft size={16} className="rotate-180" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ─── STEP 2: Type selection ─── */}
                    {currentStep === 2 && (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-xl font-semibold text-gray-800">{t('setup.step2.heading')}</h2>
                                <p className="mt-1 text-sm text-gray-500">{t('setup.step2.subheading')}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    className={`group relative rounded-xl border-2 p-6 text-left transition-all ${
                                        workflowType === 'EVENT_DRIVEN'
                                            ? 'border-primary-600 bg-primary-50 shadow-md ring-1 ring-primary-200'
                                            : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm'
                                    }`}
                                    onClick={() => setWorkflowType('EVENT_DRIVEN')}
                                >
                                    <div className={`mb-3 inline-flex rounded-lg p-3 ${workflowType === 'EVENT_DRIVEN' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                        <Lightning size={28} weight="fill" />
                                    </div>
                                    <h3 className={`text-base font-semibold ${workflowType === 'EVENT_DRIVEN' ? 'text-primary-600' : 'text-gray-800'}`}>{t('setup.step2.eventDriven.title')}</h3>
                                    <p className={`mt-1.5 text-sm ${workflowType === 'EVENT_DRIVEN' ? 'text-primary-500' : 'text-gray-500'}`}>
                                        {t('setup.step2.eventDriven.desc')}
                                    </p>
                                    {workflowType === 'EVENT_DRIVEN' && (
                                        <div className="absolute top-3 right-3"><CheckCircle size={22} weight="fill" className="text-primary-600" /></div>
                                    )}
                                </button>

                                <button
                                    className={`group relative rounded-xl border-2 p-6 text-left transition-all ${
                                        workflowType === 'SCHEDULED'
                                            ? 'border-primary-600 bg-primary-50 shadow-md ring-1 ring-primary-200'
                                            : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm'
                                    }`}
                                    onClick={() => setWorkflowType('SCHEDULED')}
                                >
                                    <div className={`mb-3 inline-flex rounded-lg p-3 ${workflowType === 'SCHEDULED' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                        <CalendarBlank size={28} weight="fill" />
                                    </div>
                                    <h3 className={`text-base font-semibold ${workflowType === 'SCHEDULED' ? 'text-primary-600' : 'text-gray-800'}`}>{t('setup.step2.scheduled.title')}</h3>
                                    <p className={`mt-1.5 text-sm ${workflowType === 'SCHEDULED' ? 'text-primary-500' : 'text-gray-500'}`}>
                                        {t('setup.step2.scheduled.desc')}
                                    </p>
                                    {workflowType === 'SCHEDULED' && (
                                        <div className="absolute top-3 right-3"><CheckCircle size={22} weight="fill" className="text-primary-600" /></div>
                                    )}
                                </button>
                            </div>
                            <div className="flex justify-between">
                                <Button variant="outline" size="lg" onClick={() => setCurrentStep(1)} className="gap-2">
                                    <ArrowLeft size={16} /> {t('setup.back')}
                                </Button>
                                <Button size="lg" onClick={() => setCurrentStep(3)} className="gap-2 px-8">
                                    {workflowType === 'EVENT_DRIVEN' ? t('setup.step2.nextEvent') : t('setup.step2.nextSchedule')}
                                    <ArrowLeft size={16} className="rotate-180" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ─── STEP 3: Configuration ─── */}
                    {currentStep === 3 && (
                        <div className="space-y-6">
                            {workflowType === 'EVENT_DRIVEN' ? (
                                <>
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-800">{t('setup.step3.eventHeading')}</h2>
                                        <p className="mt-1 text-sm text-gray-500">{t('setup.step3.eventSubheading')}</p>
                                    </div>
                                    <div className="rounded-xl border bg-white p-6 space-y-5">
                                        {/* Event selector */}
                                        <div>
                                            <Label className="text-sm font-medium text-gray-700">{t('setup.step3.selectEventLabel')} <span className="text-red-400">*</span></Label>
                                            <select
                                                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                                value={triggerConfig.eventName}
                                                onChange={(e) => {
                                                    const eventName = e.target.value;
                                                    const catalogItem = triggerEventsCatalog.find((c) => c.key === eventName);
                                                    const appliedType = catalogItem?.event_applied_type ?? '';
                                                    setTriggerConfig({ eventName, eventAppliedType: appliedType, eventId: undefined });
                                                }}
                                            >
                                                <option value="">{t('setup.step3.selectEventPlaceholder')}</option>
                                                {Object.entries(groupedEvents).map(([category, items]) => (
                                                    <optgroup key={category} label={category}>
                                                        {items.map((item) => (
                                                            <option key={item.key} value={item.key}>{item.label}</option>
                                                        ))}
                                                    </optgroup>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Event description */}
                                        {triggerConfig.eventName && (() => {
                                            const selected = triggerEventsCatalog.find((c) => c.key === triggerConfig.eventName);
                                            return selected ? (
                                                <div className="rounded-lg bg-primary-50 border border-primary-100 px-4 py-3 text-sm text-primary-600">
                                                    {selected.description}
                                                </div>
                                            ) : null;
                                        })()}

                                        {/* Entity picker — clearly separated */}
                                        {triggerConfig.eventAppliedType && (
                                            <div className="border-t pt-5 space-y-3">
                                                <div>
                                                    <h3 className="text-sm font-semibold text-gray-700">{t('setup.step3.scopeHeading')}</h3>
                                                    <p className="mt-0.5 text-xs text-gray-400">
                                                        {t('setup.step3.scopeHint', { type: triggerConfig.eventAppliedType.replace(/_/g, ' ').toLowerCase() })}
                                                    </p>
                                                </div>
                                                <EventEntityPicker
                                                    eventAppliedType={triggerConfig.eventAppliedType}
                                                    multiValue={triggerConfig.eventIds ?? (triggerConfig.eventId ? [triggerConfig.eventId] : [])}
                                                    onMultiChange={(ids) => setTriggerConfig({ eventIds: ids, eventId: ids.length === 1 ? ids[0] : undefined })}
                                                    instituteId={instituteId}
                                                />
                                            </div>
                                        )}

                                        {/* Description */}
                                        <div className="border-t pt-5">
                                            <Label className="text-sm font-medium text-gray-700">{t('setup.step3.triggerDescriptionLabel')} <span className="text-gray-300 text-xs">{t('setup.optional')}</span></Label>
                                            <Input
                                                value={triggerConfig.description}
                                                onChange={(e) => setTriggerConfig({ description: e.target.value })}
                                                className="mt-2"
                                                placeholder={t('setup.step3.triggerDescriptionPlaceholder') as string}
                                            />
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-800">{t('setup.step3.scheduleHeading')}</h2>
                                        <p className="mt-1 text-sm text-gray-500">{t('setup.step3.scheduleSubheading')}</p>
                                    </div>
                                    <SchedulePickerSection
                                        scheduleConfig={scheduleConfig}
                                        setScheduleConfig={setScheduleConfig}
                                    />
                                </>
                            )}

                            <div className="flex justify-between">
                                <Button variant="outline" size="lg" onClick={() => setCurrentStep(2)} className="gap-2">
                                    <ArrowLeft size={16} /> {t('setup.back')}
                                </Button>
                                <Button size="lg" onClick={() => setCurrentStep(4)} disabled={!canGoToStep4} className="gap-2 px-8">
                                    {t('setup.step3.next')}
                                    <ArrowLeft size={16} className="rotate-180" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ─── STEP 4: Use-case template or advanced ─── */}
                    {currentStep === 4 && (
                        <UseCaseWizardStep
                            onComplete={handleTemplateComplete}
                            onAdvanced={handleAdvancedMode}
                            onBack={() => setCurrentStep(3)}
                            instituteId={instituteId}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════
// TRIGGER SCOPE — which entities the workflow actually fires for
// ═══════════════════════════════════════════════════
/**
 * Names, not counts. "1 selected" told an admin nothing about WHICH audience a workflow was
 * wired to -- the only way to find out was to reopen the setup wizard, and the ids the
 * summary fell back to are not something anyone can recognise. Labels come from the same
 * hook that populates EventEntityPicker, so what's shown here is exactly what was picked.
 */
function TriggerEntitySummary({ eventAppliedType, eventIds, eventId, instituteId }: {
    eventAppliedType?: string;
    eventIds?: string[];
    eventId?: string;
    instituteId: string;
}) {
    const { t } = useTranslation('workflowBuilder');
    const ids = eventIds?.length ? eventIds : eventId ? [eventId] : [];
    const { labels, isLoading } = useEntityLabels(eventAppliedType, ids, instituteId);

    // An empty selection is the deliberate "fires for everything" choice, not missing data.
    if (ids.length === 0) {
        return <span className="text-gray-400">{t('triggerSummary.allOf', { type: (eventAppliedType ?? 'record').replace(/_/g, ' ').toLowerCase() })}</span>;
    }
    if (isLoading) {
        return <span className="text-gray-400">{t('triggerSummary.selectedCount', { count: ids.length })}</span>;
    }
    return (
        <span className="flex flex-wrap items-center gap-1">
            {labels.map((l) => (
                <span
                    key={l.id}
                    title={l.resolved ? l.id : t('triggerSummary.noLongerExists', { id: l.id }) as string}
                    className={cn(
                        'rounded-full px-1.5 py-0.5 text-caption font-medium',
                        l.resolved ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-red-700 line-through'
                    )}
                >
                    {l.label}
                </span>
            ))}
        </span>
    );
}

// ═══════════════════════════════════════════════════
// COMPACT CONFIG SUMMARY — Always visible at top of right panel
// ═══════════════════════════════════════════════════
function WorkflowConfigSummary({ triggerEventsCatalog, onEdit, instituteId }: {
    triggerEventsCatalog: Array<{ key: string; label: string; event_applied_type?: string }>;
    onEdit: () => void;
    instituteId: string;
}) {
    const { t } = useTranslation('workflowBuilder');
    const { workflowType, scheduleConfig, triggerConfig } = useWorkflowBuilderStore();
    const [expanded, setExpanded] = useState(false);

    const selectedEvent = triggerEventsCatalog.find((c) => c.key === triggerConfig.eventName);

    return (
        <div className="border-b bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {workflowType === 'EVENT_DRIVEN' ? (
                        <Lightning size={14} weight="fill" className="text-amber-500" />
                    ) : (
                        <CalendarBlank size={14} weight="fill" className="text-primary-500" />
                    )}
                    <span className="text-xs font-semibold text-gray-700 uppercase">
                        {workflowType === 'EVENT_DRIVEN' ? t('configSummary.eventTrigger') : t('configSummary.schedule')}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={onEdit} className="rounded p-1 hover:bg-gray-200 text-gray-400 hover:text-gray-600" title={t('configSummary.editSetup') as string}>
                        <PencilSimple size={12} />
                    </button>
                    <button onClick={() => setExpanded(!expanded)} className="rounded p-1 hover:bg-gray-200 text-gray-400 hover:text-gray-600">
                        {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
                    </button>
                </div>
            </div>

            {/* Compact summary (always visible) */}
            <div className="mt-1.5 text-xs text-gray-600">
                {workflowType === 'EVENT_DRIVEN' ? (
                    <div className="flex flex-wrap items-center gap-1">
                        <span className="font-medium">{selectedEvent?.label ?? triggerConfig.eventName}</span>
                        {triggerConfig.eventAppliedType && (
                            <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                                {triggerConfig.eventAppliedType.replace(/_/g, ' ')}
                            </span>
                        )}
                        <TriggerEntitySummary
                            eventAppliedType={triggerConfig.eventAppliedType}
                            eventIds={triggerConfig.eventIds}
                            eventId={triggerConfig.eventId}
                            instituteId={instituteId}
                        />
                    </div>
                ) : (
                    <div>
                        {scheduleConfig.scheduleType === 'CRON'
                            ? <span className="font-mono">{scheduleConfig.cronExpression}</span>
                            : <span>{t('configSummary.everyMinutes', { count: scheduleConfig.intervalMinutes })}</span>
                        }
                        <span className="ml-1.5 text-gray-400">({scheduleConfig.timezone})</span>
                    </div>
                )}
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="mt-3 space-y-2 border-t pt-2 text-xs text-gray-500">
                    {workflowType === 'EVENT_DRIVEN' && triggerConfig.description && (
                        <div>{triggerConfig.description}</div>
                    )}
                    {workflowType === 'SCHEDULED' && (
                        <>
                            {scheduleConfig.startDate && <div>{t('configSummary.starts', { date: scheduleConfig.startDate })}</div>}
                            {scheduleConfig.endDate && <div>{t('configSummary.ends', { date: scheduleConfig.endDate })}</div>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════
// BUILDER CANVAS — Main workflow building interface
// ═══════════════════════════════════════════════════
function WorkflowBuilderCanvas({ triggerEventsCatalog, instituteId }: {
    triggerEventsCatalog: Array<{ key: string; label: string; description: string; category: string; event_applied_type?: string }>;
    instituteId: string;
}) {
    const navigate = useNavigate();
    const { t } = useTranslation('workflowBuilder');
    const {
        nodes, edges, workflowName, workflowDescription, workflowType,
        scheduleConfig, triggerConfig, isSaving, selectedNodeId, editingWorkflowId, editingWorkflowStatus,
        onNodesChange, onEdgesChange, onConnect, selectNode,
        setWorkflowName, setWorkflowDescription, setIsSaving, setSetupComplete,
    } = useWorkflowBuilderStore();

    const [testRunResult, setTestRunResult] = useState<Record<string, unknown> | null>(null);
    const [isTestRunning, setIsTestRunning] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const queryClient = useQueryClient();
    const addNode = useWorkflowBuilderStore((s) => s.addNode);

    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: { id: string }) => selectNode(node.id),
        [selectNode]
    );

    const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

    const buildDTO = (status: string): WorkflowBuilderDTO => ({
        // Carry the id when editing so the backend updates in place instead of cloning.
        ...(editingWorkflowId ? { id: editingWorkflowId } : {}),
        name: workflowName,
        description: workflowDescription,
        status,
        workflow_type: workflowType,
        institute_id: instituteId,
        nodes: nodes.map((n, i) => {
            // Auto-detect end nodes: nodes with no outgoing edges
            const hasOutgoingEdge = edges.some((e) => e.source === n.id);
            // Fall back to "first node is the start" only when nothing is marked —
            // when editing a loaded workflow the real start node is already flagged,
            // and forcing index 0 would corrupt workflows whose start isn't first in
            // the array (dual-start execution or a wrong entry point on save).
            const hasExplicitStart = nodes.some((m) => m.data.isStartNode === true);
            return {
                id: n.id,
                name: n.data.name,
                node_type: n.data.nodeType,
                config: n.data.config ?? {},
                position_x: n.position.x,
                position_y: n.position.y,
                is_start_node: n.data.isStartNode === true || (!hasExplicitStart && i === 0),
                is_end_node: n.data.isEndNode ?? !hasOutgoingEdge,
            };
        }),
        edges: edges.map((e) => {
            // A CONDITION node's TRUE edge must carry the node's condition expression,
            // otherwise WorkflowBuilderService.applyEdgesAsRouting finds no conditioned
            // edge and fans out to BOTH branches (running true AND false). Propagate the
            // source CONDITION node's config.condition onto its non-"false" edge.
            const src = nodes.find((n) => n.id === e.source);
            const label = (e.label as string) ?? '';
            const condition =
                src?.data?.nodeType === 'CONDITION' && label.toLowerCase() !== 'false' && src.data.config
                    ? ((src.data.config as Record<string, unknown>).condition as string | undefined)
                    : undefined;
            return {
                id: e.id,
                source_node_id: e.source,
                target_node_id: e.target,
                label,
                ...(condition ? { condition } : {}),
            };
        }),
        ...(workflowType === 'SCHEDULED' && {
            schedule: {
                schedule_type: scheduleConfig.scheduleType,
                cron_expression: scheduleConfig.scheduleType === 'CRON' ? scheduleConfig.cronExpression : undefined,
                interval_minutes: scheduleConfig.scheduleType === 'INTERVAL' ? scheduleConfig.intervalMinutes : undefined,
                timezone: scheduleConfig.timezone,
                start_date: scheduleConfig.startDate ? normalizeToInstant(scheduleConfig.startDate) : undefined,
                end_date: scheduleConfig.endDate ? normalizeToInstant(scheduleConfig.endDate) : undefined,
            },
        }),
        ...(workflowType === 'EVENT_DRIVEN' && triggerConfig.eventName && {
            trigger: {
                trigger_event_name: triggerConfig.eventName,
                description: triggerConfig.description || undefined,
                event_applied_type: triggerConfig.eventAppliedType || undefined,
                // Send event_ids array for multi-select, event_id for backward compat
                event_ids: triggerConfig.eventIds?.length ? triggerConfig.eventIds : undefined,
                event_id: !triggerConfig.eventIds?.length ? triggerConfig.eventId : undefined,
                idempotency_generation_setting: triggerConfig.idempotencyGenerationSetting ?? undefined,
            },
        }),
    });

    const runClientValidation = (): string[] => {
        const errors: string[] = [];
        if (!workflowName.trim()) errors.push(t('validation.nameRequired'));
        if (nodes.length === 0) errors.push(t('validation.addNode'));
        if (workflowType === 'EVENT_DRIVEN' && !triggerConfig.eventName) {
            errors.push(t('validation.selectTriggerEvent'));
        }
        if (workflowType === 'SCHEDULED' && !scheduleConfig.cronExpression && scheduleConfig.scheduleType === 'CRON') {
            errors.push(t('validation.enterCron'));
        }
        if (nodes.length > 1) {
            const connectedIds = new Set<string>();
            edges.forEach((e) => { connectedIds.add(e.source); connectedIds.add(e.target); });
            const disconnected = nodes.filter((n) => !connectedIds.has(n.id));
            if (disconnected.length > 0) {
                errors.push(t('validation.nodesNotConnected', { count: disconnected.length, names: disconnected.map((n) => n.data.name).join(', ') }));
            }
        }
        return errors;
    };

    const handleSave = async (status: string) => {
        const errors = runClientValidation();
        if (errors.length > 0) {
            setValidationErrors(errors);
            return;
        }
        setValidationErrors([]);
        setIsSaving(true);
        try {
            const dto = buildDTO(status);
            if (status === 'ACTIVE') {
                try {
                    const serverErrors = await validateWorkflow(dto);
                    if (serverErrors && serverErrors.length > 0) {
                        setValidationErrors(serverErrors.map((e: { message?: string; field?: string }) =>
                            `${e.field ? e.field + ': ' : ''}${e.message ?? t('validation.genericValidationError')}`
                        ));
                        setIsSaving(false);
                        return;
                    }
                } catch { /* proceed */ }
            }
            if (editingWorkflowId) {
                await updateWorkflow(editingWorkflowId, dto, getUserId());
            } else {
                await createWorkflow(dto, getUserId());
            }
            // Invalidate caches so the new/edited workflow appears immediately.
            // refetchType: 'all' forces refetch even for inactive (suspended) queries on the
            // list page — without it, navigating back may render stale 5-min cached data.
            await queryClient.invalidateQueries({
                queryKey: ['GET_ACTIVE_WORKFLOWS_WITH_SCHEDULES'],
                refetchType: 'all',
            });
            if (editingWorkflowId) {
                // Detail-page surfaces (diagram, raw config editor, edit loader) must refetch.
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['GET_WORKFLOW_DIAGRAM', editingWorkflowId] }),
                    queryClient.invalidateQueries({ queryKey: ['WORKFLOW_RAW', editingWorkflowId] }),
                    queryClient.invalidateQueries({ queryKey: ['WORKFLOW_EDIT', editingWorkflowId] }),
                ]);
            }
            navigate({ to: '/workflow/list' });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('validation.unknownError');
            setValidationErrors([t('validation.saveFailed', { message: msg })]);
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestRun = async () => {
        if (nodes.length === 0) {
            setValidationErrors([t('validation.addNodeBeforeTest')]);
            return;
        }
        setIsTestRunning(true);
        setTestRunResult(null);
        setValidationErrors([]);
        try {
            if (editingWorkflowId) {
                // Persist current edits in place (keeping the live status — never downgrade to
                // DRAFT), then dry-run the saved workflow.
                const dto = buildDTO(editingWorkflowStatus || 'DRAFT');
                await updateWorkflow(editingWorkflowId, dto, getUserId());
                const result = await testRunWorkflow(editingWorkflowId);
                setTestRunResult(result);
            } else {
                // New workflow: persist a DRAFT to get an id, then dry-run it.
                const dto = buildDTO('DRAFT');
                const saved = await createWorkflow(dto, getUserId());
                if (saved.id) {
                    const result = await testRunWorkflow(saved.id);
                    setTestRunResult(result);
                }
            }
        } catch (err) {
            console.error('Test run failed:', err);
            alert(t('canvas.testRunFailedAlert'));
        } finally {
            setIsTestRunning(false);
        }
    };

    return (
        <div className="flex h-[calc(100vh-64px)] flex-col">
            {/* Toolbar — clean and minimal */}
            <div className="flex items-center gap-3 border-b bg-white px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/workflow/list' })}>
                    <ArrowLeft size={16} />
                </Button>

                <Input
                    value={workflowName}
                    onChange={(e) => setWorkflowName(e.target.value)}
                    placeholder={t('canvas.namePlaceholder') as string}
                    className="h-8 w-64 text-sm font-medium"
                />

                {/* Type badge (non-interactive — edit via setup) */}
                <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-gray-600">
                    {workflowType === 'EVENT_DRIVEN' ? (
                        <><Lightning size={12} weight="fill" className="text-amber-500" /> {t('canvas.eventDriven')}</>
                    ) : (
                        <><CalendarBlank size={12} weight="fill" className="text-primary-500" /> {t('canvas.scheduled')}</>
                    )}
                </div>

                <div className="ms-auto flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)} className="gap-1.5">
                        <MagicWand size={14} /> {t('canvas.wizard')}
                    </Button>
                    <TemplateGallery instituteId={instituteId} />
                    <Button variant="outline" size="sm" onClick={handleTestRun} disabled={isTestRunning || nodes.length === 0} className="gap-1.5">
                        <Play size={14} /> {isTestRunning ? t('canvas.testRunning') : t('canvas.testRun')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleSave('DRAFT')} disabled={isSaving} className="gap-1.5">
                        <FloppyDisk size={14} /> {t('canvas.saveDraft')}
                    </Button>
                    <Button size="sm" onClick={() => handleSave('ACTIVE')} disabled={isSaving} className="gap-1.5">
                        <CheckCircle size={14} /> {t('canvas.publish')}
                    </Button>
                </div>
            </div>

            {/* Validation errors */}
            {validationErrors.length > 0 && (
                <div className="bg-red-50 border-b border-red-200 px-4 py-2">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-red-700">
                            {validationErrors.map((err, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                    <span className="text-red-500">&#x2022;</span> {err}
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setValidationErrors([])} className="text-red-400 hover:text-red-600 text-xs">{t('canvas.dismiss')}</button>
                    </div>
                </div>
            )}

            {/* Main layout */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left: Node palette */}
                <div className="w-56 border-r bg-gray-50">
                    <NodePalette />
                </div>

                {/* Center: ReactFlow canvas */}
                <div className="flex-1">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onPaneClick={onPaneClick}
                        nodeTypes={nodeTypes}
                        deleteKeyCode="Backspace"
                        fitView
                        className="bg-gray-100"
                    >
                        <Background gap={20} size={1} />
                        <Controls />
                        <MiniMap nodeStrokeWidth={3} zoomable pannable className="!bg-white !border !border-gray-200 !rounded-lg" />
                    </ReactFlow>
                </div>

                {/* Right: Config summary + Node config */}
                <div className="w-72 border-l bg-white flex flex-col">
                    {/* Always-visible workflow config summary */}
                    <WorkflowConfigSummary
                        triggerEventsCatalog={triggerEventsCatalog}
                        onEdit={() => setSetupComplete(false)}
                        instituteId={instituteId}
                    />

                    {/* Node config or workflow info */}
                    <div className="flex-1 overflow-y-auto">
                        {selectedNodeId ? (
                            <NodeConfigPanel />
                        ) : (
                            <div className="flex flex-col gap-4 p-4">
                                <div>
                                    <Label className="text-xs">{t('canvas.descriptionLabel')}</Label>
                                    <textarea
                                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        rows={2}
                                        value={workflowDescription}
                                        onChange={(e) => setWorkflowDescription(e.target.value)}
                                        placeholder={t('canvas.descriptionPlaceholder') as string}
                                    />
                                </div>
                                <div className="rounded-lg border bg-gray-50 p-3">
                                    <p className="text-xs text-gray-500">
                                        <strong>{nodes.length}</strong> {t('canvas.nodesUnit', { count: nodes.length })}, <strong>{edges.length}</strong> {t('canvas.connectionsUnit', { count: edges.length })}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
                                    <GearSix size={24} className="mx-auto text-gray-300 mb-2" />
                                    <p className="text-xs text-gray-400">
                                        {t('canvas.emptyHint')}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Node suggestions */}
            {selectedNodeId && (() => {
                const selectedNode = nodes.find((n) => n.id === selectedNodeId);
                return selectedNode ? (
                    <div className="border-t px-4 py-2">
                        <NodeSuggestions
                            currentNodeType={selectedNode.data.nodeType}
                            onAddNode={(type) => {
                                const meta = nodes.find((n) => n.id === selectedNodeId);
                                const pos = meta ? { x: meta.position.x, y: meta.position.y + 180 } : undefined;
                                addNode(type, type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), pos);
                            }}
                        />
                    </div>
                ) : null;
            })()}

            {/* Wizard dialog */}
            <WorkflowWizard
                open={wizardOpen}
                onOpenChange={setWizardOpen}
                instituteId={instituteId}
                onApplyTemplate={(templateJson, name) => {
                    try {
                        const parsed = JSON.parse(templateJson);
                        if (parsed.nodes) {
                            const { setNodes, setEdges, setWorkflowName, setEditingWorkflowId, setEditingWorkflowStatus } = useWorkflowBuilderStore.getState();
                            // Applying a template starts a fresh workflow — drop any edit context so
                            // Save creates a new workflow instead of overwriting the one being edited.
                            setEditingWorkflowId(null);
                            setEditingWorkflowStatus(null);
                            setWorkflowName(name);
                            const rfNodes = parsed.nodes.map((n: Record<string, unknown>) => ({
                                id: n.id ?? `node-${Math.random().toString(36).slice(2)}`,
                                type: 'workflowNode',
                                position: { x: (n.position_x as number) ?? 0, y: (n.position_y as number) ?? 0 },
                                data: { name: n.name ?? n.node_type, nodeType: n.node_type, config: n.config ?? {}, isStartNode: n.is_start_node ?? false },
                            }));
                            const rfEdges = (parsed.edges ?? []).map((e: Record<string, unknown>) => ({
                                id: e.id ?? `edge-${Math.random().toString(36).slice(2)}`,
                                source: e.source_node_id, target: e.target_node_id,
                                label: e.label ?? '', type: 'smoothstep', animated: true,
                            }));
                            setNodes(rfNodes);
                            setEdges(rfEdges);
                        }
                    } catch (err) {
                        console.error('Failed to parse template:', err);
                    }
                }}
            />

            {testRunResult && (
                <div className="border-t bg-gray-50 p-4 max-h-48 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold">{t('canvas.testRunResultsHeading')}</h4>
                        <Button variant="ghost" size="sm" onClick={() => setTestRunResult(null)}>{t('canvas.dismiss')}</Button>
                    </div>
                    <pre className="text-xs bg-white rounded border p-3 overflow-x-auto">
                        {JSON.stringify(testRunResult, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════
// MAIN COMPONENT — Routes between setup and builder
// ═══════════════════════════════════════════════════
function WorkflowBuilderInner() {
    const { t } = useTranslation('workflowBuilder');
    const { setNavHeading } = useNavHeadingStore();
    const { data: instituteData } = useSuspenseQuery(useInstituteQuery());
    const instituteId = instituteData?.id ?? '';
    const { data: triggerEventsCatalog = [] } = useSuspenseQuery(getTriggerEventsCatalogQuery());

    const setupComplete = useWorkflowBuilderStore((s) => s.setupComplete);
    const setSetupComplete = useWorkflowBuilderStore((s) => s.setSetupComplete);
    const reset = useWorkflowBuilderStore((s) => s.reset);
    const isDirty = useWorkflowBuilderStore((s) => s.isDirty);

    useEffect(() => {
        setNavHeading(t('setup.title'));
        return () => reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirty) { e.preventDefault(); e.returnValue = ''; }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    if (!setupComplete) {
        return (
            <WorkflowSetupStep
                onComplete={() => setSetupComplete(true)}
                triggerEventsCatalog={triggerEventsCatalog}
                instituteId={instituteId}
            />
        );
    }

    return (
        <WorkflowBuilderCanvas
            triggerEventsCatalog={triggerEventsCatalog}
            instituteId={instituteId}
        />
    );
}

export function WorkflowBuilder() {
    return (
        <ReactFlowProvider>
            <WorkflowBuilderInner />
        </ReactFlowProvider>
    );
}
