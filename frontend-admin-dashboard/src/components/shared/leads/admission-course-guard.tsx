/**
 * The confirmation shown before a lead is moved to the institute's admission status
 * (CONVERTED, e.g. "Admission Taken") while the person has no course or fee plan yet.
 *
 * The institute picks the rule in Settings → Lead Settings → Lead Statuses:
 *  - OFF (default): nothing is checked and nothing is shown;
 *  - WARN: "This person has no course or fee plan yet …" — the user can go ahead;
 *  - BLOCK: the change is refused; the user is told to add the course or plan first.
 *
 * The server applies BLOCK on its own as well, so a failed check here never lets a
 * refused change through — it only skips the early explanation.
 */
import { useCallback, useRef, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    CONVERTED_STATUS_KEY,
    checkAdmission,
    type AdmissionCourseMode,
} from './services/admission-check';

export interface AdmissionTarget {
    status_key: string;
    label: string;
}

interface PendingPrompt {
    mode: Exclude<AdmissionCourseMode, 'OFF'>;
    label: string;
    total: number;
    without: number;
}

function describe(p: PendingPrompt): { heading: string; body: string } {
    const single = p.total === 1;
    if (p.mode === 'BLOCK') {
        return {
            heading: 'Add a course or fee plan first',
            body: single
                ? `This person has no course or fee plan yet. Your institute asks for one before a lead is moved to ${p.label}. Add the course or fee plan, then try again.`
                : p.without === p.total
                  ? `None of these ${p.total} people has a course or fee plan yet. Your institute asks for one before a lead is moved to ${p.label}. Add the course or fee plan, then try again.`
                  : `${p.without} of these ${p.total} people have no course or fee plan yet, so they can’t be moved to ${p.label}. Add the course or fee plan for them first. The other ${p.total - p.without} can be moved now.`,
        };
    }
    return {
        heading: `Move to ${p.label} without a course?`,
        body: single
            ? `This person has no course or fee plan yet. If you go ahead, the admission won’t show a course or fees in your reports until one is added.`
            : `${p.without} of these ${p.total} people have no course or fee plan yet. If you go ahead, their admissions won’t show a course or fees in your reports until one is added.`,
    };
}

/**
 * `confirmAdmission(responseIds, target)` resolves to true when the caller should go ahead
 * with the change. It asks nothing unless the target is CONVERTED, the institute's rule is
 * WARN or BLOCK, and at least one of the leads' people has no course or fee plan yet.
 * Under BLOCK a bulk change may still go ahead for the others: the server leaves the
 * people without a course alone and reports them as `blocked`. Render `admissionDialog`
 * once in the calling component.
 */
export function useAdmissionCourseGuard() {
    const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
    const resolver = useRef<((proceed: boolean) => void) | null>(null);

    const finish = useCallback((proceed: boolean) => {
        resolver.current?.(proceed);
        resolver.current = null;
        setPrompt(null);
    }, []);

    const confirmAdmission = useCallback(
        async (
            responseIds: (string | null | undefined)[],
            target: AdmissionTarget | null | undefined
        ): Promise<boolean> => {
            const ids = responseIds.filter((id): id is string => !!id);
            const instituteId = getCurrentInstituteId();
            if (target?.status_key !== CONVERTED_STATUS_KEY || ids.length === 0 || !instituteId) {
                return true;
            }
            let result;
            try {
                result = await checkAdmission(instituteId, ids);
            } catch {
                // The server still applies the institute's rule when the change is saved.
                return true;
            }
            if (result.mode === 'OFF' || result.without_course_count === 0) return true;
            return new Promise<boolean>((resolve) => {
                resolver.current = resolve;
                setPrompt({
                    mode: result.mode === 'BLOCK' ? 'BLOCK' : 'WARN',
                    label: target.label || 'Converted',
                    total: ids.length,
                    without: Math.min(result.without_course_count, ids.length),
                });
            });
        },
        []
    );

    const text = prompt ? describe(prompt) : null;
    const someCanMove = !!prompt && prompt.mode === 'BLOCK' && prompt.without < prompt.total;

    const admissionDialog = (
        <MyDialog
            heading={text?.heading ?? ''}
            open={!!prompt}
            onOpenChange={(open) => {
                if (!open) finish(false);
            }}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={() => finish(false)}>
                        {prompt?.mode === 'BLOCK' && !someCanMove ? 'OK' : 'Cancel'}
                    </MyButton>
                    {prompt?.mode === 'WARN' && (
                        <MyButton buttonType="primary" scale="medium" onClick={() => finish(true)}>
                            Go ahead anyway
                        </MyButton>
                    )}
                    {someCanMove && (
                        <MyButton buttonType="primary" scale="medium" onClick={() => finish(true)}>
                            {`Move the other ${prompt.total - prompt.without}`}
                        </MyButton>
                    )}
                </div>
            }
        >
            {text && (
                <div className="flex items-start gap-3 p-4">
                    <WarningCircle
                        weight="fill"
                        className={
                            prompt?.mode === 'BLOCK'
                                ? 'mt-0.5 size-5 shrink-0 text-danger-600'
                                : 'mt-0.5 size-5 shrink-0 text-warning-600'
                        }
                    />
                    <p className="text-body text-neutral-700">{text.body}</p>
                </div>
            )}
        </MyDialog>
    );

    return { confirmAdmission, admissionDialog };
}
