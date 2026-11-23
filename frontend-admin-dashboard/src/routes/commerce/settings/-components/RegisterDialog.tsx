import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import type { CommerceLocation } from '@/routes/commerce/-shared/commerce-types';
import { Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { PosErrorNotice } from '@/routes/commerce/pos/-components/pos-ui';
import { useCreateRegister, useUpdateRegister } from '@/routes/commerce/pos/-shared/pos-hooks';
import type { RegisterView } from '@/routes/commerce/pos/-shared/pos-types';

export const REGISTER_CODE = /^[A-Z0-9-]{1,16}$/;
/** The document series takes a prefix of 1..6 (letters, digits, / and -, starting with a letter or digit). */
export const INVOICE_PREFIX = /^[A-Z0-9][A-Z0-9/-]{0,5}$/;

export interface RegisterForm {
    location_id: string;
    code: string;
    name: string;
    invoice_prefix: string;
    invoice_next_value: string;
}

export type RegisterFormProblem = 'location' | 'code' | 'name' | 'prefix' | 'nextValue';

/** The first thing wrong with a new register, or null. */
export function registerFormProblem(form: RegisterForm, creating: boolean): RegisterFormProblem | null {
    if (creating && !form.location_id) return 'location';
    if (creating && !REGISTER_CODE.test(form.code)) return 'code';
    const name = form.name.trim();
    if (name.length < 1 || name.length > 60) return 'name';
    if (creating && form.invoice_prefix && !INVOICE_PREFIX.test(form.invoice_prefix)) return 'prefix';
    if (creating && form.invoice_prefix && form.invoice_next_value) {
        const n = Number(form.invoice_next_value);
        if (!Number.isInteger(n) || n < 1) return 'nextValue';
    }
    return null;
}

/**
 * Add a billing counter at a location that bills over the counter, with its
 * own invoice numbering (a register series), or rename / retire one.
 */
export function RegisterDialog({
    open,
    onOpenChange,
    register,
    locations,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** null = a new register. */
    register: RegisterView | null;
    locations: CommerceLocation[];
}) {
    const { t } = useTranslation('commerce');
    const create = useCreateRegister();
    const update = useUpdateRegister();
    const { idFor, reset } = useRequestId('posreg');
    const creating = register === null;
    const [form, setForm] = useState<RegisterForm>({
        location_id: '',
        code: '',
        name: '',
        invoice_prefix: '',
        invoice_next_value: '',
    });
    const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        if (!open) return;
        setForm({
            location_id: register?.location_id ?? '',
            code: register?.code ?? '',
            name: register?.name ?? '',
            invoice_prefix: '',
            invoice_next_value: '',
        });
        setStatus(register?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
        setTouched(false);
        setError(null);
        reset();
    }, [open, register, reset]);

    const problem = registerFormProblem(form, creating);
    const posLocations = locations.filter((l) => l.is_pos_enabled && (l.status ?? 'ACTIVE') === 'ACTIVE');

    const save = async () => {
        setTouched(true);
        if (problem) return;
        setError(null);
        try {
            if (creating) {
                const body = {
                    location_id: form.location_id,
                    code: form.code,
                    name: form.name.trim(),
                    ...(form.invoice_prefix
                        ? {
                              invoice_prefix: form.invoice_prefix,
                              ...(form.invoice_next_value ? { invoice_next_value: Number(form.invoice_next_value) } : {}),
                          }
                        : {}),
                };
                await create.mutateAsync([{ ...body, client_request_id: idFor(body) }]);
            } else {
                const body = { name: form.name.trim(), status };
                await update.mutateAsync([register.id, { ...body, client_request_id: idFor(body) }]);
            }
            toast.success(t('pos.registers.saved'));
            onOpenChange(false);
        } catch (raw) {
            setError(raw);
        }
    };

    const err = (p: RegisterFormProblem) => (touched && problem === p ? t(`pos.registers.problems.${p}`) : null);

    return (
        <MyDialog
            heading={creating ? t('pos.registers.add') : t('pos.registers.edit', { code: register?.code ?? '' })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-dialog-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={save} loadingText={t('common.saving')}>
                        {t('common.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                {creating && (
                    <>
                        <PlainSelect
                            label={t('pos.registers.location')}
                            value={form.location_id}
                            onChange={(value) => setForm((f) => ({ ...f, location_id: value }))}
                            placeholder={t('pos.registers.locationPick')}
                            invalid={!!err('location')}
                            options={posLocations.map((l) => ({ value: l.id, label: l.name }))}
                        />
                        {err('location') && <p className="text-caption text-danger-600">{err('location')}</p>}
                        {posLocations.length === 0 && (
                            <p className="text-caption text-muted-foreground">{t('pos.registers.noPosLocation')}</p>
                        )}
                        <Field label={t('pos.registers.code')} htmlFor="reg-code" required hint={t('pos.registers.codeHint')} error={err('code')}>
                            <input
                                id="reg-code"
                                maxLength={16}
                                className={inputClass}
                                value={form.code}
                                onChange={(event) =>
                                    setForm((f) => ({ ...f, code: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') }))
                                }
                            />
                        </Field>
                    </>
                )}
                <Field label={t('pos.registers.name')} htmlFor="reg-name" required error={err('name')}>
                    <input
                        id="reg-name"
                        maxLength={60}
                        className={inputClass}
                        value={form.name}
                        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                    />
                </Field>
                {creating && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field
                            label={t('pos.registers.prefix')}
                            htmlFor="reg-prefix"
                            hint={t('pos.registers.prefixHint')}
                            error={err('prefix')}
                        >
                            <input
                                id="reg-prefix"
                                maxLength={6}
                                className={inputClass}
                                value={form.invoice_prefix}
                                onChange={(event) =>
                                    setForm((f) => ({
                                        ...f,
                                        invoice_prefix: event.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, ''),
                                    }))
                                }
                            />
                        </Field>
                        <Field label={t('pos.registers.nextValue')} htmlFor="reg-next" error={err('nextValue')}>
                            <input
                                id="reg-next"
                                inputMode="numeric"
                                maxLength={9}
                                disabled={!form.invoice_prefix}
                                className={inputClass}
                                value={form.invoice_next_value}
                                placeholder="1"
                                onChange={(event) =>
                                    setForm((f) => ({ ...f, invoice_next_value: event.target.value.replace(/\D/g, '') }))
                                }
                            />
                        </Field>
                    </div>
                )}
                {!creating && (
                    <PlainSelect
                        label={t('pos.registers.status')}
                        value={status}
                        onChange={(value) => setStatus(value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')}
                        options={(['ACTIVE', 'INACTIVE'] as const).map((s) => ({
                            value: s,
                            label: t(`status.posRegister.${s}`),
                        }))}
                    />
                )}
                <PosErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}
