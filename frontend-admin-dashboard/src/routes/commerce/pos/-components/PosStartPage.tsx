import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CashRegister, ClockCounterClockwise, GearSix, SignOut } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { cn } from '@/lib/utils';
import {
    CommerceEmptyState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { readLastRegister, writeLastRegister } from '../-shared/pos-catalogue';
import { readPosError } from '../-shared/pos-errors';
import { useOpenSession, useRegisters } from '../-shared/pos-hooks';
import { REGISTER_SETUP_WARNINGS, type RegisterView } from '../-shared/pos-types';
import { useOnline } from '../-shared/use-online';
import { PosOfflineBanner } from './PosOfflineBanner';
import { PosErrorNotice, PosField, isAmount, posInputClass, sanitizeAmount, timeOnly } from './pos-ui';

/**
 * P1 (contract §7.3): the counters as big cards. Mine and open → Continue
 * billing; open by someone else → who and since when (a manager may close it);
 * free → the cash in the drawer now, then Open counter. The last counter used
 * on this device is picked first.
 */
export function PosStartPage() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const online = useOnline();
    const navigate = useNavigate();
    const instituteId = getInstituteId() ?? '';
    const registers = useRegisters();
    const list = useMemo(() => registers.data ?? [], [registers.data]);
    const [selected, setSelected] = useState<string | null>(() => readLastRegister(instituteId));

    useEffect(() => {
        if (list.length === 0) return;
        if (!selected || !list.some((r) => r.id === selected)) {
            const mine = list.find((r) => r.open_session?.mine);
            const free = list.find((r) => !r.open_session && r.status === 'ACTIVE');
            setSelected((mine ?? free ?? list[0])?.id ?? null);
        }
    }, [list, selected]);

    const warnings = access.isManager ? list.filter((r) => r.setup_warnings.length > 0) : [];

    return (
        <div className="flex min-h-screen flex-col bg-neutral-50">
            <Helmet>
                <title>{t('meta.pageTitle', { title: t('pos.title') })}</title>
            </Helmet>
            <header className="flex min-h-16 items-center gap-3 border-b border-border bg-card px-4">
                <CashRegister size={28} className="text-primary-500" />
                <h1 className="flex-1 text-title font-medium text-foreground">{t('pos.title')}</h1>
                {access.isManager && (
                    <>
                        <Link
                            to="/commerce/pos/sessions"
                            className="flex min-h-12 items-center gap-2 rounded-md px-3 text-body text-neutral-600 hover:bg-neutral-100"
                        >
                            <ClockCounterClockwise size={20} />
                            {t('pos.sessions.title')}
                        </Link>
                        <Link
                            to="/commerce/settings/registers"
                            className="flex min-h-12 items-center gap-2 rounded-md px-3 text-body text-neutral-600 hover:bg-neutral-100"
                        >
                            <GearSix size={20} />
                            {t('pos.registers.title')}
                        </Link>
                        <Link
                            to="/commerce"
                            className="flex min-h-12 items-center gap-2 rounded-md px-3 text-body text-neutral-600 hover:bg-neutral-100"
                        >
                            <SignOut size={20} />
                            {t('pos.nav.exit')}
                        </Link>
                    </>
                )}
            </header>
            <PosOfflineBanner online={online} />
            <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-24">
                <h2 className="text-h3 font-medium text-foreground">{t('pos.start.pick')}</h2>
                {warnings.map((register) => (
                    <OrderNotice key={register.id} tone="warning">
                        <p className="font-medium">{`${register.code} · ${register.name}`}</p>
                        {register.setup_warnings.map((code) => (
                            <p key={code}>
                                {(REGISTER_SETUP_WARNINGS as readonly string[]).includes(code)
                                    ? t(`pos.registers.warnings.${code}`)
                                    : code}
                            </p>
                        ))}
                    </OrderNotice>
                ))}
                {registers.isLoading && <CommerceLoadingRows rows={3} />}
                {registers.isError && <PosErrorNotice error={registers.error} />}
                {registers.isSuccess && list.length === 0 && (
                    <CommerceEmptyState title={t('pos.start.emptyTitle')} description={t('pos.start.empty')}>
                        {access.isManager && (
                            <Link to="/commerce/settings/registers">
                                <MyButton type="button" buttonType="primary" scale="large" className="h-12">
                                    {t('pos.registers.add')}
                                </MyButton>
                            </Link>
                        )}
                    </CommerceEmptyState>
                )}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {list.map((register) => (
                        <RegisterCard
                            key={register.id}
                            register={register}
                            selected={selected === register.id}
                            online={online}
                            isManager={access.isManager}
                            onSelect={() => setSelected(register.id)}
                            onOpened={(sessionId) => {
                                writeLastRegister(instituteId, register.id);
                                void navigate({ to: '/commerce/pos/$sessionId', params: { sessionId } });
                            }}
                            onContinue={(sessionId) => {
                                writeLastRegister(instituteId, register.id);
                                void navigate({ to: '/commerce/pos/$sessionId', params: { sessionId } });
                            }}
                        />
                    ))}
                </div>
            </main>
        </div>
    );
}

function RegisterCard({
    register,
    selected,
    online,
    isManager,
    onSelect,
    onOpened,
    onContinue,
}: {
    register: RegisterView;
    selected: boolean;
    online: boolean;
    isManager: boolean;
    onSelect: () => void;
    onOpened: (sessionId: string) => void;
    onContinue: (sessionId: string) => void;
}) {
    const { t } = useTranslation('commerce');
    const open = useOpenSession();
    const { idFor, reset } = useRequestId('posopen');
    const [cash, setCash] = useState('');
    const [note, setNote] = useState('');
    const [needNote, setNeedNote] = useState(false);
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const session = register.open_session;
    const active = register.status === 'ACTIVE';
    const cashOk = isAmount(cash, { allowZero: true });
    const noteOk = !needNote || (note.trim().length > 0 && note.trim().length <= 500);

    const submit = async () => {
        setTouched(true);
        if (!cashOk || !noteOk) return;
        setError(null);
        const body = {
            register_id: register.id,
            opening_cash: Number(cash).toFixed(2),
            ...(needNote ? { opening_note: note.trim() } : {}),
        };
        try {
            const opened = await open.mutateAsync([{ ...body, client_request_id: idFor(body) }]);
            onOpened(opened.id);
        } catch (raw) {
            const read = readPosError(raw);
            if (read.code === 'OPENING_NOTE_REQUIRED') {
                setNeedNote(true);
                reset();
                return;
            }
            if (read.code === 'IDEMPOTENCY_MISMATCH') reset();
            setError(raw);
        }
    };

    return (
        <section
            aria-label={`${register.code} ${register.name}`}
            data-testid={`pos-register-${register.code}`}
            onClick={onSelect}
            className={cn(
                'flex flex-col gap-3 rounded-xl border-2 bg-card p-4 transition-colors',
                selected ? 'border-primary-500' : 'border-border hover:border-primary-200'
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                    <span className="text-h3 font-medium text-foreground">{register.code}</span>
                    <span className="truncate text-body text-foreground">{register.name}</span>
                    <span className="truncate text-caption text-muted-foreground">{register.location_name}</span>
                </div>
                {session ? (
                    <CommerceStatusChip kind="posSession" value="OPEN" />
                ) : (
                    <CommerceStatusChip kind="posRegister" value={register.status} />
                )}
            </div>

            {session && session.mine && (
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="h-14 w-full"
                    onClick={() => onContinue(session.id)}
                >
                    {t('pos.start.continue')}
                </MyButton>
            )}
            {session && !session.mine && (
                <div className="flex flex-col gap-2">
                    <p className="text-body text-neutral-600">
                        {t('pos.start.openBy', {
                            name: session.cashier_name || t('pos.start.someone'),
                            time: timeOnly(session.opened_at),
                        })}
                    </p>
                    {isManager && (
                        <div className="flex flex-wrap gap-2">
                            <Link to="/commerce/pos/$sessionId" params={{ sessionId: session.id }}>
                                <MyButton type="button" buttonType="secondary" scale="large" className="h-12">
                                    {t('pos.start.view')}
                                </MyButton>
                            </Link>
                            <Link to="/commerce/pos/$sessionId/close" params={{ sessionId: session.id }}>
                                <MyButton type="button" buttonType="secondary" scale="large" className="h-12">
                                    {t('pos.start.closeIt')}
                                </MyButton>
                            </Link>
                        </div>
                    )}
                </div>
            )}
            {!session && active && selected && (
                <div className="flex flex-col gap-3" onClick={(event) => event.stopPropagation()}>
                    <PosField
                        label={t('pos.start.openingCash')}
                        htmlFor={`open-cash-${register.id}`}
                        required
                        error={touched && !cashOk ? t('pos.validation.amountOrZero') : null}
                    >
                        <input
                            id={`open-cash-${register.id}`}
                            inputMode="decimal"
                            autoFocus
                            className={posInputClass}
                            value={cash}
                            onChange={(event) => setCash(sanitizeAmount(event.target.value))}
                        />
                    </PosField>
                    {needNote && (
                        <PosField
                            label={t('pos.start.openingNote')}
                            htmlFor={`open-note-${register.id}`}
                            required
                            error={touched && !noteOk ? t('pos.validation.reason') : null}
                        >
                            <input
                                id={`open-note-${register.id}`}
                                maxLength={500}
                                autoFocus
                                className={posInputClass}
                                value={note}
                                onChange={(event) => setNote(event.target.value)}
                            />
                        </PosField>
                    )}
                    <PosErrorNotice error={error} />
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        className="h-14 w-full"
                        disable={!online}
                        onAsyncClick={submit}
                        loadingText={t('pos.start.opening')}
                    >
                        {t('pos.start.open')}
                    </MyButton>
                </div>
            )}
            {!session && active && !selected && (
                <p className="text-body text-muted-foreground">{t('pos.start.tapToOpen')}</p>
            )}
        </section>
    );
}
