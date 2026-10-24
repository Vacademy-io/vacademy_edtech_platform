/**
 * StepDialog — add/edit an onboarding flow step (v1: FORM steps only).
 *
 * On edit, a step's field rows are rebuilt from the step's OWN `fields`
 * (fields_config — the authority for order / mandatory / hidden / role access),
 * joined against GET .../common/custom-fields/feature-fields?type=ONBOARDING_STEP
 * purely for each field's display name. The PUT always resends the FULL field +
 * role_access list, per the backend's "replace entirely" contract, so anything
 * not hydrated back into these rows would be destroyed on save.
 *
 * Role access isn't limited to ADMIN/STUDENT/PARENT: the grids take the institute's
 * roles (`fetchOnboardingAssignableRoles`) so a step — or a single field on it — can
 * be handed to a COUNSELLOR or any custom role, which is what lets a non-admin staff
 * member actually work the step.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { RoleAccessGrid } from './role-access-grid';
import { StepFieldConfigEditor, newFieldRowFromCatalog, type FieldRow } from './step-field-config-editor';
import { StepWorkflowTriggersCard } from './step-workflow-triggers-card';
import { MultiSelect } from '@/components/design-system/multi-select';
import type { Icon } from '@phosphor-icons/react';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { ClipboardText, GraduationCap, ListBullets, ShieldCheck } from '@phosphor-icons/react';
import {
    createOnboardingStep,
    updateOnboardingStep,
    fetchStepFields,
    fetchInstituteCustomFieldCatalog,
    defaultRoleAccess,
    fetchOnboardingAssignableRoles,
    onboardingAssignableRolesKey,
    onboardingStepFieldsKey,
    fetchPackageSessionPoolOptions,
    type OnboardingStepDTO,
    type OnboardingRoleAccess,
} from '../-services/onboarding-service';

const buildStepSchema = (t: TFunction) =>
    z.object({
        step_name: z
            .string()
            .min(1, t('schema.stepNameRequired'))
            .max(150, t('schema.stepNameMaxLength')),
        is_optional: z.boolean(),
        grants_student_role: z.boolean(),
        sends_login_credentials: z.boolean(),
        create_student: z.boolean(),
        skip_if_already_enrolled: z.boolean(),
    });

type StepForm = z.infer<ReturnType<typeof buildStepSchema>>;

interface StepDialogProps {
    instituteId: string;
    flowId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Present → editing this step. Absent → creating a new one. */
    editingStep?: OnboardingStepDTO | null;
    /** Where a newly-created step should land (end of list). */
    nextStepOrder: number;
    onSaved: () => void;
}

export function StepDialog({
    instituteId,
    flowId,
    open,
    onOpenChange,
    editingStep,
    nextStepOrder,
    onSaved,
}: StepDialogProps) {
    const { t } = useTranslation('audienceManagerStepDialog');
    // Bound to the field-config-editor's own namespace: newFieldRowFromCatalog
    // (imported from that module) needs its "Untitled field" fallback string,
    // which that namespace owns, not this one.
    const { t: tFieldConfigEditor } = useTranslation('audienceManagerStepFieldConfigEditor');
    const queryClient = useQueryClient();
    const isEditing = !!editingStep;

    const stepSchema = useMemo(() => buildStepSchema(t), [t]);

    const form = useForm<StepForm>({
        resolver: zodResolver(stepSchema),
        defaultValues: {
            step_name: '',
            is_optional: true,
            grants_student_role: false,
            sends_login_credentials: false,
            create_student: false,
            skip_if_already_enrolled: false,
        },
    });

    const [fieldRows, setFieldRows] = useState<FieldRow[]>([]);
    const [roleAccess, setRoleAccess] = useState<OnboardingRoleAccess[]>(defaultRoleAccess());
    // The course POOL for "create student from this step" — empty means the
    // completing admin picks ANY course at onboarding time; non-empty
    // restricts them to picking from exactly this set. Not a react-hook-form
    // field since it's a set, not a single scalar value.
    const [packageSessionIds, setPackageSessionIds] = useState<string[]>([]);
    // A field picked in the "attach existing field" picker but not yet
    // confirmed via "Attach" — saving now would silently drop that selection.
    const [hasPendingFieldSelection, setHasPendingFieldSelection] = useState(false);

    const poolOptionsQuery = useQuery({
        queryKey: ['onboarding-package-session-pool', instituteId],
        queryFn: fetchPackageSessionPoolOptions,
        enabled: open && form.watch('create_student'),
        staleTime: 60 * 1000,
    });
    const poolOptions = (poolOptionsQuery.data ?? []).map((o) => ({
        label: o.label,
        value: o.package_session_id,
    }));

    const catalogQuery = useQuery({
        queryKey: ['onboarding-custom-field-catalog', instituteId],
        queryFn: () => fetchInstituteCustomFieldCatalog(instituteId),
        enabled: open && !!instituteId,
        staleTime: 60 * 1000,
    });

    // Institute roles offered by the role-access grids' "Add role" picker, so a step can be
    // handed to a COUNSELLOR (or any custom role) rather than only ADMIN/STUDENT/PARENT.
    // A failure here just leaves the picker hidden -- the built-in three still work.
    const rolesQuery = useQuery({
        queryKey: onboardingAssignableRolesKey(instituteId),
        queryFn: () => fetchOnboardingAssignableRoles(instituteId),
        enabled: open && !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    const assignableRoles = rolesQuery.data ?? [];

    const existingFieldsQuery = useQuery({
        queryKey: editingStep ? onboardingStepFieldsKey(instituteId, editingStep.id) : ['onboarding-step-fields-noop'],
        queryFn: () => fetchStepFields(instituteId, editingStep!.id),
        enabled: open && isEditing && !!editingStep && !!instituteId,
        staleTime: 0,
    });

    useEffect(() => {
        if (!open) return;
        if (editingStep) {
            const config = (editingStep.step_type_config ?? {}) as Record<string, unknown>;
            const configuredPool = Array.isArray(config.package_session_ids)
                ? (config.package_session_ids as unknown[]).filter((v): v is string => typeof v === 'string')
                : [];
            form.reset({
                step_name: editingStep.step_name,
                is_optional: editingStep.is_optional,
                grants_student_role: editingStep.grants_student_role,
                sends_login_credentials: editingStep.sends_login_credentials,
                create_student: config.create_student === 'true' || config.create_student === true,
                skip_if_already_enrolled:
                    config.skip_if_already_enrolled === 'true' || config.skip_if_already_enrolled === true,
            });
            setPackageSessionIds(configuredPool);
            setRoleAccess(editingStep.role_access ?? defaultRoleAccess());
        } else {
            form.reset({
                step_name: '',
                is_optional: true,
                grants_student_role: false,
                sends_login_credentials: false,
                create_student: false,
                skip_if_already_enrolled: false,
            });
            setFieldRows([]);
            setPackageSessionIds([]);
            setRoleAccess(defaultRoleAccess());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editingStep?.id]);

    // Hydrate the field editor once the existing-fields fetch resolves.
    //
    // The step's OWN `fields` (fields_config) is the authority for order / mandatory / hidden /
    // role access -- the feature-fields lookup only supplies display NAMES. Hydrating from that
    // lookup instead, as this used to, silently reset a step's field config on every reopen:
    // its `is_mandatory` and `individual_order` are catalog columns this domain never writes (so
    // they always came back null -> every Mandatory toggle off, every field back in catalog
    // order), and `is_hidden`/`role_access` aren't in that payload at all. Saving then wrote the
    // reset values back over the real ones.
    useEffect(() => {
        if (!isEditing || !existingFieldsQuery.data) return;
        const nameById = new Map(existingFieldsQuery.data.map((f) => [f.id, f]));
        const configured = (editingStep?.fields ?? []).filter((f) => f.institute_custom_field_id);
        const configuredIds = new Set(configured.map((f) => f.institute_custom_field_id));
        // UNION, not either/or. fields_config is the authority for each field's settings, but a
        // field can exist as an ACTIVE ONBOARDING_STEP mapping while being absent from
        // fields_config — historic drift, from back when removing a field left its mapping
        // ACTIVE and some saves dropped a field from fields_config without touching the mapping
        // (this is how CustomInsti's "Book Tracking details" step showed TrackingId in the
        // builder while the form rendered only Status and Vendor). Showing fields_config ALONE
        // would quietly finish the job and delete such a field on the next save. Appending the
        // orphans instead surfaces them, and saving writes them back into fields_config —
        // repairing the step. A genuinely removed field can't come back this way: removal now
        // soft-deletes the mapping (OnboardingStepService.deactivateMappingsNotIn), so it is no
        // longer in this list at all.
        const rows = [
            ...configured
                .slice()
                .sort((a, b) => (a.field_order ?? 0) - (b.field_order ?? 0))
                .map((f) => ({ config: f, catalog: nameById.get(f.institute_custom_field_id!) })),
            ...existingFieldsQuery.data
                .filter((f) => !configuredIds.has(f.id))
                .map((f) => ({ config: undefined, catalog: f })),
        ].filter((r) => r.catalog);
        setFieldRows(
            rows.map(({ config, catalog }) => ({
                ...newFieldRowFromCatalog(catalog!, tFieldConfigEditor),
                is_mandatory: config?.is_mandatory ?? false,
                is_hidden: config?.is_hidden ?? false,
                // Left undefined when the step never set one, so the field keeps INHERITING the
                // step-level access rather than gaining an explicit override on next save.
                role_access: config?.role_access ?? undefined,
            }))
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingFieldsQuery.data, editingStep?.fields, isEditing]);

    const { mutate: save, isPending } = useMutation({
        mutationFn: (values: StepForm) => {
            const fields = fieldRows.map((row, index) => ({
                institute_custom_field_id: row.institute_custom_field_id,
                new_field: row.new_field,
                field_order: index,
                is_mandatory: row.is_mandatory,
                is_hidden: row.is_hidden,
                // Only ever send an explicit per-field override when the admin actually set one
                // (RoleAccessGrid touched, or one round-tripped from fields_config). Stamping
                // defaultRoleAccess() here -- which this used to do -- attached a STUDENT/PARENT
                // can_edit=false override to EVERY field, overriding whatever the step's own
                // Step Access grid said, so a step marked "Student: View + Edit" still blocked
                // the student on all of its fields. Same reasoning as StepFieldConfigEditor's
                // addNewField, which deliberately leaves role_access unset for the same reason.
                role_access: row.role_access,
            }));
            const payload = {
                step_order: editingStep?.step_order ?? nextStepOrder,
                step_name: values.step_name,
                step_type: 'FORM' as const,
                step_type_config: values.create_student
                    ? {
                          create_student: 'true',
                          package_session_ids: packageSessionIds,
                          skip_if_already_enrolled: values.skip_if_already_enrolled ? 'true' : 'false',
                      }
                    : { create_student: 'false' },
                is_optional: values.is_optional,
                grants_student_role: values.grants_student_role,
                sends_login_credentials: values.sends_login_credentials,
                fields,
                role_access: roleAccess,
            };
            return editingStep
                ? updateOnboardingStep(instituteId, flowId, editingStep.id, payload)
                : createOnboardingStep(instituteId, flowId, payload);
        },
        onSuccess: () => {
            toast.success(isEditing ? t('toasts.stepUpdated') : t('toasts.stepAdded'));
            if (editingStep) {
                queryClient.invalidateQueries({ queryKey: onboardingStepFieldsKey(instituteId, editingStep.id) });
            }
            onOpenChange(false);
            onSaved();
        },
        onError: () => {
            toast.error(t('toasts.saveError'));
        },
    });

    const onSubmit = (values: StepForm) => {
        if (hasPendingFieldSelection) {
            toast.warning(t('toasts.pendingFieldSelection'));
            return;
        }
        save(values);
    };

    const loadingFields = isEditing && existingFieldsQuery.isLoading;

    const footer = (
        <div className="flex w-full items-center justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)} disable={isPending}>
                {t('actions.cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="medium"
                onClick={form.handleSubmit(onSubmit)}
                disable={isPending || loadingFields}
            >
                {isPending ? t('actions.saving') : isEditing ? t('actions.saveStep') : t('actions.addStep')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={isEditing ? t('heading.edit') : t('heading.add')}
            footer={footer}
            dialogWidth="max-w-2xl"
        >
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 p-6">
                    <DialogSection icon={ClipboardText} title={t('sections.step')}>
                        <FormField
                            control={form.control}
                            name="step_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.stepName.label')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('fields.stepName.placeholder')}
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                            required
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex flex-col divide-y divide-neutral-100">
                            <SwitchRow
                                id="step-optional"
                                label={t('switches.optional')}
                                hint={t('switchHints.optional')}
                                checked={form.watch('is_optional')}
                                onCheckedChange={(v) => form.setValue('is_optional', v, { shouldDirty: true })}
                            />
                            <SwitchRow
                                id="step-grants-role"
                                label={t('switches.grantsStudentRole')}
                                checked={form.watch('grants_student_role')}
                                onCheckedChange={(v) =>
                                    form.setValue('grants_student_role', v, { shouldDirty: true })
                                }
                            />
                            <SwitchRow
                                id="step-sends-creds"
                                label={t('switches.sendsLoginCredentials')}
                                checked={form.watch('sends_login_credentials')}
                                onCheckedChange={(v) =>
                                    form.setValue('sends_login_credentials', v, { shouldDirty: true })
                                }
                            />
                            <SwitchRow
                                id="step-create-student"
                                label={t('switches.createStudent')}
                                hint={t('switchHints.createStudent', {
                                    course: instituteTerms().course.toLowerCase(),
                                })}
                                checked={form.watch('create_student')}
                                onCheckedChange={(v) =>
                                    form.setValue('create_student', v, { shouldDirty: true })
                                }
                            />
                        </div>
                    </DialogSection>

                    {form.watch('create_student') && (
                        <DialogSection
                            icon={GraduationCap}
                            title={t('fields.coursePool.label')}
                            description={t('fields.coursePool.helperText')}
                        >
                            <FormItem>
                                <FormControl>
                                    <MultiSelect
                                        options={poolOptions}
                                        selected={packageSessionIds}
                                        onChange={setPackageSessionIds}
                                        placeholder={
                                            poolOptionsQuery.isLoading
                                                ? t('fields.coursePool.loadingPlaceholder')
                                                : t('fields.coursePool.emptyPlaceholder')
                                        }
                                        disabled={poolOptionsQuery.isLoading}
                                    />
                                </FormControl>
                            </FormItem>
                            <SwitchRow
                                id="step-skip-if-enrolled"
                                label={t('switches.skipIfAlreadyEnrolled')}
                                checked={form.watch('skip_if_already_enrolled')}
                                onCheckedChange={(v) =>
                                    form.setValue('skip_if_already_enrolled', v, {
                                        shouldDirty: true,
                                    })
                                }
                            />
                        </DialogSection>
                    )}

                    <DialogSection icon={ShieldCheck} title={t('sections.stepAccess')}>
                        <RoleAccessGrid
                            value={roleAccess}
                            onChange={setRoleAccess}
                            assignableRoles={assignableRoles}
                        />
                    </DialogSection>

                    {isEditing && editingStep && (
                        <StepWorkflowTriggersCard
                            instituteId={instituteId}
                            flowId={flowId}
                            stepId={editingStep.id}
                        />
                    )}

                    <DialogSection
                        icon={ListBullets}
                        title={t('sections.formFields')}
                        description={t('sections.formFieldsHint')}
                    >
                        {loadingFields ? (
                            <div className="text-caption text-neutral-500">{t('sections.loadingFields')}</div>
                        ) : (
                            <StepFieldConfigEditor
                                instituteId={instituteId}
                                catalog={catalogQuery.data ?? []}
                                assignableRoles={assignableRoles}
                                value={fieldRows}
                                onChange={setFieldRows}
                                onPendingSelectionChange={setHasPendingFieldSelection}
                            />
                        )}
                    </DialogSection>
                </form>
            </Form>
        </MyDialog>
    );
}

/** A titled block of the step dialog. */
function DialogSection({
    icon: IconCmp,
    title,
    description,
    children,
}: {
    icon: Icon;
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-start gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                    <IconCmp size={16} weight="duotone" />
                </span>
                <div className="min-w-0">
                    <h3 className="text-body font-semibold text-neutral-900">{title}</h3>
                    {description && <p className="text-caption text-neutral-500">{description}</p>}
                </div>
            </div>
            {children}
        </section>
    );
}

/** One labelled switch, with an optional line explaining it. */
function SwitchRow({
    id,
    label,
    hint,
    checked,
    onCheckedChange,
}: {
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
                <Label htmlFor={id} className="cursor-pointer text-body">
                    {label}
                </Label>
                {hint && <p className="text-caption text-neutral-500">{hint}</p>}
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}
