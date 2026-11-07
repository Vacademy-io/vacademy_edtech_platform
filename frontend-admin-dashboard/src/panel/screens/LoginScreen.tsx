/**
 * Password form. On a paired panel it is #/signin?mode=password and posts to
 * /session/login-password, where an admin has allowed that for the panel. In a lab
 * build with VITE_PANEL_LEGACY_LOGIN=1 an unpaired panel also gets the Phase 0
 * login here. Flow copied from login-form.tsx L385-470, not imported (it uses
 * @tanstack/react-router). Shared device: the browser is told not to save the
 * password (MyInput's default autocomplete opt-out).
 */
import { useEffect, useState, type FocusEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Check, PencilLine, Stethoscope, WarningCircle } from '@phosphor-icons/react';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PANEL_LEGACY_LOGIN } from '../config';
import { readDevice, usesDeviceAuth } from '../device/store';
import { refreshBranding } from '../lib/branding';
import {
    DevicePasswordError,
    PanelLoginError,
    loginWithDevicePassword,
    loginWithPassword,
    usePanelSession,
} from '../lib/session';
import { getPanelLanguage, setPanelLanguage, PANEL_LANGUAGES, type PanelLanguage } from '../i18n';
import { goBack, navigate, routeFromNext, usePanelRoute } from '../router';

const INPUT_CLASS = 'h-16 text-h3 sm:w-full';

export default function LoginScreen() {
    const { t } = useTranslation('panel');
    const { t: td } = useTranslation('device');
    const { params } = usePanelRoute();
    const { isSignedIn } = usePanelSession();
    const deviceMode = !PANEL_LEGACY_LOGIN || usesDeviceAuth();
    const [formError, setFormError] = useState<string | null>(null);
    const [language, setLanguage] = useState<PanelLanguage>(getPanelLanguage);

    const schema = z.object({
        username: z.string().trim().min(1, t('login.usernameRequired')),
        password: z.string().min(1, t('login.passwordRequired')),
    });
    type LoginValues = z.infer<typeof schema>;

    const form = useForm<LoginValues>({
        resolver: zodResolver(schema),
        defaultValues: { username: '', password: '' },
    });

    const goNext = () => {
        const next = routeFromNext(params.next);
        if (next) navigate(next.screen, next.params, { replace: true });
        else navigate('home', undefined, { replace: true });
    };

    // Already signed in (e.g. back button): nothing to do here. On a paired panel a
    // signed-in teacher can be here on purpose, handing over by password.
    useEffect(() => {
        if (isSignedIn && !deviceMode) goNext();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onSubmit = async (values: LoginValues) => {
        setFormError(null);
        if (deviceMode) {
            try {
                const result = await loginWithDevicePassword(values.username, values.password);
                void refreshBranding();
                // Same teacher: back past the QR card to the screen they were on.
                if (isSignedIn && result.sameUser) window.history.go(-2);
                else goNext();
            } catch (error) {
                const code = error instanceof DevicePasswordError ? error.code : 'SERVER';
                setFormError(
                    td(`password.errors.${code}`, { institute: readDevice()?.institute_name ?? '' })
                );
                form.setValue('password', '');
            }
            return;
        }
        if (!PANEL_LEGACY_LOGIN) return;
        try {
            const result = await loginWithPassword(values.username, values.password);
            if (result.status === 'pick') {
                navigate('institutes', params.next ? { next: params.next } : undefined, {
                    replace: true,
                });
                return;
            }
            void refreshBranding();
            goNext();
        } catch (error) {
            const code = error instanceof PanelLoginError ? error.code : 'SERVER';
            setFormError(t(`login.errors.${code}`));
            form.setValue('password', '');
        }
    };

    const changeLanguage = (lng: PanelLanguage) => {
        setLanguage(lng);
        void setPanelLanguage(lng);
    };

    // The classroom APK runs immersive, where Android ignores adjustResize: the
    // on-screen keyboard covers the lower half without resizing the WebView. On
    // tv_api31 (960x540 CSS) it hid the password field and Sign in. While a field
    // is focused, a spacer lets the page scroll and the field is moved to the top.
    const [typing, setTyping] = useState(false);
    const onFieldFocus = (event: FocusEvent<HTMLElement>) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        setTyping(true);
        const item = (target.closest('.space-y-2') as HTMLElement | null) || target;
        window.requestAnimationFrame(() => {
            try {
                item.scrollIntoView({ block: 'start' });
            } catch {
                item.scrollIntoView(true);
            }
        });
    };
    const onFieldBlur = (event: FocusEvent<HTMLElement>) => {
        const form = event.currentTarget;
        window.setTimeout(() => {
            if (!form.contains(document.activeElement)) setTyping(false);
        }, 0);
    };

    return (
        <PanelStage className={deviceMode ? 'z-50' : undefined}>
            <PanelTopBar onBack={goBack} showHome={false} sessionActions={false} />
            <PanelStageBody className="p-8">
                {/* Two columns from md (768): an Android TV is 960 CSS px wide, and in
                    one column the sign-in card sat below its 540 px fold. Narrower than
                    that, the card comes first. */}
                <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 md:grid-cols-2">
                    <section className="space-y-6">
                        <h2 className="text-h1 font-semibold text-neutral-800">
                            {deviceMode ? td('password.title') : t('login.title')}
                        </h2>
                        <p className="text-title text-neutral-500">
                            {deviceMode ? td('password.subtitle') : t('login.subtitle')}
                        </p>
                        <p className="text-subtitle text-neutral-500">
                            {deviceMode ? td('password.note') : t('login.sharedDeviceNote')}
                        </p>
                        <div className="space-y-4 pt-4">
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 w-full justify-start px-6"
                                onClick={() => navigate('whiteboard')}
                            >
                                <span className="flex items-center space-x-3">
                                    <PencilLine size={28} aria-hidden />
                                    <span>{t('login.whiteboardLink')}</span>
                                </span>
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 w-full justify-start px-6"
                                onClick={() => navigate('diagnostics')}
                            >
                                <span className="flex items-center space-x-3">
                                    <Stethoscope size={28} aria-hidden />
                                    <span>{t('login.diagnosticsLink')}</span>
                                </span>
                            </MyButton>
                        </div>
                        <div
                            className="space-x-2 pt-2"
                            role="group"
                            aria-label={t('language.label')}
                        >
                            {PANEL_LANGUAGES.map((lng) => (
                                <MyButton
                                    key={lng}
                                    type="button"
                                    buttonType={language === lng ? 'secondary' : 'text'}
                                    scale="large"
                                    className="h-14 px-6"
                                    aria-pressed={language === lng}
                                    onClick={() => changeLanguage(lng)}
                                >
                                    <span className="flex items-center space-x-2">
                                        {language === lng && <Check size={24} aria-hidden />}
                                        <span>{t(`language.${lng}`)}</span>
                                    </span>
                                </MyButton>
                            ))}
                        </div>
                    </section>

                    <section
                        className="order-first rounded-lg border border-border bg-card p-8 shadow-sm md:order-none"
                        onFocus={onFieldFocus}
                        onBlur={onFieldBlur}
                    >
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-6"
                                noValidate
                            >
                                <FormField
                                    control={form.control}
                                    name="username"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    label={t('login.username')}
                                                    inputType="text"
                                                    size="large"
                                                    required
                                                    className={INPUT_CLASS}
                                                    labelStyle="text-h3"
                                                    input={field.value}
                                                    onChangeFunction={field.onChange}
                                                    onBlur={field.onBlur}
                                                    name={field.name}
                                                    ref={field.ref}
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-subtitle" />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    label={t('login.password')}
                                                    inputType="password"
                                                    size="large"
                                                    required
                                                    className={INPUT_CLASS}
                                                    labelStyle="text-h3"
                                                    input={field.value}
                                                    onChangeFunction={field.onChange}
                                                    onBlur={field.onBlur}
                                                    name={field.name}
                                                    ref={field.ref}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-subtitle" />
                                        </FormItem>
                                    )}
                                />
                                {formError && (
                                    <div
                                        role="alert"
                                        className="flex items-start space-x-3 rounded-md border border-danger-200 bg-danger-50 p-4 text-title text-danger-700"
                                    >
                                        <WarningCircle size={28} className="shrink-0" aria-hidden />
                                        <span>{formError}</span>
                                    </div>
                                )}
                                <MyButton
                                    type="submit"
                                    buttonType="primary"
                                    scale="large"
                                    className="h-16 w-full text-h3"
                                    disable={form.formState.isSubmitting}
                                >
                                    {form.formState.isSubmitting
                                        ? t('login.submitting')
                                        : t('login.submit')}
                                </MyButton>
                            </form>
                        </Form>
                    </section>
                </div>
                {/* Room to scroll the focused field above the on-screen keyboard. */}
                {typing && <div className="h-96" aria-hidden />}
            </PanelStageBody>
        </PanelStage>
    );
}
