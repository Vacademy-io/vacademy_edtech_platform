import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { type CodingTestCase, effectiveAccepted } from '../utils/code-editor-types';

interface Props {
    testCases: CodingTestCase[];
    onChange: (next: CodingTestCase[]) => void;
    maxPoints?: number;
    disabled?: boolean;
}

function newCase(idx: number, visible: boolean, t: TFunction): CodingTestCase {
    return {
        id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `tc-${Date.now()}-${idx}`,
        label: visible
            ? t('sampleLabel', { number: idx + 1 })
            : t('hiddenLabel', { number: idx + 1 }),
        stdin: '',
        expectedStdout: '',
        visible,
    };
}

export function TestCaseList({ testCases, onChange, maxPoints, disabled }: Props) {
    const { t } = useTranslation('studyLibraryTestCaseList');
    const add = useCallback(
        (visible: boolean) => {
            const sameKind = testCases.filter((tc) => tc.visible === visible).length;
            onChange([...testCases, newCase(sameKind, visible, t)]);
        },
        [testCases, onChange, t]
    );

    const update = useCallback(
        (id: string, patch: Partial<CodingTestCase>) => {
            onChange(testCases.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        },
        [testCases, onChange]
    );

    const remove = useCallback(
        (id: string) => {
            onChange(testCases.filter((t) => t.id !== id));
        },
        [testCases, onChange]
    );

    const sampleCount = testCases.filter((tc) => tc.visible).length;
    const hiddenCount = testCases.length - sampleCount;
    const perHiddenMark =
        maxPoints && hiddenCount > 0 ? Number((maxPoints / hiddenCount).toFixed(2)) : null;
    const perSampleMark =
        maxPoints && sampleCount > 0 ? Number((maxPoints / sampleCount).toFixed(2)) : null;

    return (
        <div className="space-y-3">
            {testCases.length > 0 &&
                (hiddenCount > 0 ? (
                    <div className="rounded-md border border-primary-100 bg-primary-50 p-3 text-xs text-neutral-600">
                        <span className="font-semibold text-primary-600">
                            {t('howThisIsGraded')}{' '}
                        </span>
                        {t('gradingHintHidden', {
                            count: hiddenCount,
                            formula:
                                perHiddenMark !== null
                                    ? t('gradingFormulaHidden', {
                                          maxPoints,
                                          count: hiddenCount,
                                          perMark: perHiddenMark,
                                      })
                                    : t('gradingFormulaHiddenFallback'),
                        })}
                    </div>
                ) : (
                    <div className="rounded-md border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700">
                        <span className="font-semibold">{t('noHiddenTestCasesWarning')} </span>
                        {t('gradingHintNoHidden', {
                            count: sampleCount,
                            formula:
                                perSampleMark !== null
                                    ? t('gradingFormulaSample', {
                                          maxPoints,
                                          count: sampleCount,
                                          perMark: perSampleMark,
                                      })
                                    : '',
                        })}
                    </div>
                ))}
            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    {t('summaryCounts', {
                        sample: sampleCount,
                        hidden: hiddenCount,
                        total: testCases.length,
                    })}
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => add(true)}
                        disabled={disabled}
                    >
                        <Plus className="mr-1 size-3" />
                        {t('sample')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => add(false)}
                        disabled={disabled}
                    >
                        <Plus className="mr-1 size-3" />
                        {t('hidden')}
                    </Button>
                </div>
            </div>

            {testCases.length === 0 ? (
                <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t('noTestCasesYet')}
                </div>
            ) : (
                <div className="space-y-3">
                    {testCases.map((tc, i) => (
                        <div key={tc.id} className="rounded border bg-card p-3 shadow-sm">
                            <div className="mb-2 flex items-center gap-2">
                                <span className="text-xs font-semibold text-muted-foreground">
                                    #{i + 1}
                                </span>
                                <Input
                                    value={tc.label || ''}
                                    onChange={(e) => update(tc.id, { label: e.target.value })}
                                    placeholder={t('labelOptional')}
                                    className="h-7 max-w-[200px] text-sm"
                                    disabled={disabled}
                                />
                                <div className="ml-auto flex items-center gap-2">
                                    <Label className="flex items-center gap-1 text-xs">
                                        {tc.visible ? (
                                            <Eye className="size-3 text-green-600" />
                                        ) : (
                                            <EyeOff className="size-3 text-gray-500" />
                                        )}
                                        {tc.visible ? t('sample') : t('hidden')}
                                    </Label>
                                    <Switch
                                        checked={tc.visible}
                                        onCheckedChange={(v) => update(tc.id, { visible: v })}
                                        disabled={disabled}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => remove(tc.id)}
                                        disabled={disabled}
                                        className="text-red-600 hover:bg-red-50"
                                    >
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <div>
                                    <Label className="text-xs">{t('standardInput')}</Label>
                                    <Textarea
                                        value={tc.stdin}
                                        onChange={(e) => update(tc.id, { stdin: e.target.value })}
                                        placeholder={t('emptyPlaceholder')}
                                        rows={3}
                                        className="font-mono text-xs"
                                        disabled={disabled}
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">{t('acceptedOutputs')}</Label>
                                    <div className="space-y-1">
                                        {effectiveAccepted(tc).map((out, idx) => (
                                            <div key={idx} className="flex items-start gap-1">
                                                <Textarea
                                                    value={out}
                                                    onChange={(e) => {
                                                        const arr = [...effectiveAccepted(tc)];
                                                        arr[idx] = e.target.value;
                                                        update(tc.id, {
                                                            acceptedOutputs: arr,
                                                            expectedStdout: arr[0] ?? '',
                                                        });
                                                    }}
                                                    placeholder={
                                                        idx === 0
                                                            ? t('expectedProgramOutput')
                                                            : t('alternativeAcceptedOutput')
                                                    }
                                                    rows={3}
                                                    className="font-mono text-xs"
                                                    disabled={disabled}
                                                />
                                                {effectiveAccepted(tc).length > 1 && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            const arr = effectiveAccepted(tc).filter(
                                                                (_, i) => i !== idx
                                                            );
                                                            update(tc.id, {
                                                                acceptedOutputs: arr,
                                                                expectedStdout: arr[0] ?? '',
                                                            });
                                                        }}
                                                        disabled={disabled}
                                                        className="text-red-600 hover:bg-red-50"
                                                        title={t('removeThisAcceptedOutput')}
                                                    >
                                                        <Trash2 className="size-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const arr = [...effectiveAccepted(tc), ''];
                                            update(tc.id, {
                                                acceptedOutputs: arr,
                                                expectedStdout: arr[0] ?? '',
                                            });
                                        }}
                                        disabled={disabled}
                                        className="mt-1"
                                    >
                                        <Plus className="mr-1 size-3" />
                                        {t('addAcceptableOutput')}
                                    </Button>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {t('passesHint')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
