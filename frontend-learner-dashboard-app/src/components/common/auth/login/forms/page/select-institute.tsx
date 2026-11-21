"use client";
import { Preferences } from "@capacitor/preferences";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ArrowsClockwise, Shield } from "@phosphor-icons/react";

import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Heading } from "@/components/common/auth/login/components/heading";
import { MyButton } from "@/components/design-system/button";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import {
    getTokenDecodedData,
    getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import {
    hasLiveEnrollment,
    withTimeout,
} from "@/lib/auth/pick-login-institute";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { INSTITUTE_DETAIL, SELECT_INSTITUTE_SESSION } from "@/constants/urls";
import { SessionLimitDialog } from "@/components/common/auth/login/components/SessionLimitDialog";
import {
    INSTITUTE_SELECTED_EVENT,
    navigateAfterLogin,
} from "@/lib/auth/post-login-redirect";
import {
    getCurrentDomainInfo,
    resolveDomainRouting,
} from "@/services/domain-routing";
import axios from "axios";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "@/components/ui/select"; // radix-style select

/**
 * Built per-render (not a module constant) so the validation message follows
 * the active language instead of freezing at import time.
 */
const makeInstituteSelectionSchema = () =>
    z.object({
        instituteId: z.string().nonempty(i18n.t("auth:validation.selectInstitute")),
    });

type FormValues = z.infer<ReturnType<typeof makeInstituteSelectionSchema>>;

export function InstituteSelection() {
    const { t, i18n: i18nInstance } = useTranslation("auth");
    const instituteSelectionSchema = useMemo(
        () => makeInstituteSelectionSchema(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [i18nInstance.language]
    );
    const location = useLocation();
    const { type, courseId } = (location.state as { type?: string; courseId?: string }) || {};
    const navigate = useNavigate();
    const search = useSearch({ from: "/institute-selection/" });
    const rawRedirect = (search as { redirect?: string })?.redirect;
    // The page login forms forward their `redirect` search param here, which
    // defaults to "/login/" when there's no real deep-link. Treat that sentinel
    // (and any value pointing back at the login route) as "no redirect" so a
    // normal multi-institute login lands on the dashboard instead of bouncing
    // back to the login screen.
    const redirect =
        rawRedirect && !/^\/login\/?(?:[?#]|$)/.test(rawRedirect)
            ? rawRedirect
            : undefined;

    const form = useForm<FormValues>({
        resolver: zodResolver(instituteSelectionSchema),
        defaultValues: { instituteId: "" },
        mode: "onTouched",
    });

    const [dropdownList, setDropdownList] = useState<
        { label: string; value: string }[]
    >([]);
    const [isLoadingInstitutes, setIsLoadingInstitutes] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sessionLimitOpen, setSessionLimitOpen] = useState(false);
    const [activeSessions, setActiveSessions] = useState<any[]>([]);
    const [pendingInstituteId, setPendingInstituteId] = useState<string | null>(null);
    // White-label auto-selection: while true we keep the loader up instead of
    // flashing the dropdown, because the domain has already made the choice.
    const [isAutoSelecting, setIsAutoSelecting] = useState(false);
    const autoSelectAttempted = useRef(false);
    // Institute this host is mapped to, resolved straight from the routing API.
    // We deliberately do NOT use useDomainRouting() here: that hook redirects
    // away from any path not in its allow-list (and /institute-selection is not
    // in it), so mounting it on this page bounces the learner to /login. Its
    // instituteId also silently falls back to the device's cached InstituteId
    // from a previous session on API failure, which must never be allowed to
    // pick an institute on someone's behalf. A non-null result here means the
    // API really did map this domain.
    const [domainInstituteId, setDomainInstituteId] = useState<string | null>(null);
    const [isResolvingDomain, setIsResolvingDomain] = useState(true);

    useEffect(() => {
        const fetchInstitutes = async () => {
            setIsLoadingInstitutes(true);
            try {
                const token = await getTokenFromStorage(TokenKey.accessToken);
                if (!token)
                    return toast.error(i18n.t("auth:instituteSelection.noToken"));

                const decodedData = await getTokenDecodedData(token);
                const authorities = decodedData?.authorities;
                const userId = decodedData?.user;

                if (!authorities || !userId)
                    return toast.error(i18n.t("auth:instituteSelection.invalidToken"));

                const instituteIds = Object.keys(authorities);
                
                const instituteList = await Promise.all(
                    instituteIds.map(async (instituteId) => {
                        try {
                            const response =
                                await authenticatedAxiosInstance.get(
                                    `${INSTITUTE_DETAIL}/${instituteId}`,
                                    { params: { instituteId, userId } }
                                );
                            const data = response.data;
                            return {
                                label: data?.institute_name || instituteId,
                                value: instituteId,
                            };
                        } catch (error) {
                            return {
                                label: instituteId,
                                value: instituteId,
                            };
                        }
                    })
                );

                setDropdownList(instituteList);
            } catch (error) {
                
            } finally {
                setIsLoadingInstitutes(false);
            }
        };

        fetchInstitutes();
    }, []);

    // Resolve which institute this host belongs to (white-label domains map to
    // exactly one). Failure is not fatal — it just means we ask the learner.
    // Time-boxed so a slow or hung routing API shows the dropdown after a few
    // seconds, as the page did before auto-select existed.
    useEffect(() => {
        let cancelled = false;
        const resolve = async () => {
            try {
                const resolveHost = async () => {
                    const { domain, subdomain } = await getCurrentDomainInfo();
                    return resolveDomainRouting(domain, subdomain || "*");
                };
                const result = await withTimeout(resolveHost(), null);
                if (!cancelled) setDomainInstituteId(result?.instituteId ?? null);
            } catch {
                // 404 returns null; anything else throws. Either way: no domain
                // institute, so fall through to the manual picker.
                if (!cancelled) setDomainInstituteId(null);
            } finally {
                if (!cancelled) setIsResolvingDomain(false);
            }
        };
        resolve();
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * The one place institute selection actually happens. Both the manual
     * dropdown and the white-label auto-selection go through this, so the
     * session registration, `selectedInstituteId` write and session-limit
     * dialog below can never be skipped by one path and not the other.
     *
     * `auto` marks the white-label path, where nobody chose anything: if it
     * cannot complete cleanly we fall back to showing the dropdown rather than
     * stranding the learner.
     */
    const selectInstitute = async (
        instituteId: string,
        opts?: { auto?: boolean }
    ) => {
        const data = { instituteId };
        if (!data.instituteId)
            return toast.error(i18n.t("auth:validation.selectInstitute"));

        setIsSubmitting(true);
        try {
            // Save selected instituteId
            await Preferences.set({
                key: "selectedInstituteId",
                value: data.instituteId,
            });

            const userId = await getTokenFromStorage(TokenKey.accessToken)
                .then(getTokenDecodedData)
                .then((data) => data?.user);

            if (!userId) {
                if (opts?.auto) setIsAutoSelecting(false);
                toast.error(i18n.t("auth:instituteSelection.userNotFound"));
                return;
            }

            // Session limit check for the selected institute
            const accessToken = await getTokenFromStorage(TokenKey.accessToken);
            try {
                const sessionRes = await axios.post(SELECT_INSTITUTE_SESSION, {
                    user_id: userId,
                    institute_id: data.instituteId,
                    access_token: accessToken,
                    device_type: "WEB",
                });
                if (sessionRes.data.session_limit_exceeded === true) {
                    setActiveSessions(sessionRes.data.active_sessions || []);
                    setPendingInstituteId(data.instituteId);
                    setSessionLimitOpen(true);
                    setIsSubmitting(false);
                    // Drop the auto-select loader: SessionLimitDialog renders
                    // inside the main tree, so leaving the loader up would hide
                    // the very dialog the learner has to act on.
                    setIsAutoSelecting(false);
                    return;
                }
            } catch (err) {
                // If session check fails, proceed anyway (don't block institute selection)
                console.error("Session check failed:", err);
            }

            // Step 1: Fetch and store InstituteDetails
            await fetchAndStoreInstituteDetails(data.instituteId, userId);

            // Step 2: Wait and get updated InstituteDetails from Preferences
            const { value: instituteRaw } = await Preferences.get({
                key: "InstituteDetails",
            });
            if (!instituteRaw)
                throw new Error("No InstituteDetails found after storing.");
            
            // Step 3: Fetch and store student details using updated institute data
            const studentStatus = await fetchAndStoreStudentDetails(
                data.instituteId,
                userId
            );

            // A JWT authority only proves a user_role row exists — it does NOT
            // prove an enrollment. When the learner has no active mapping here
            // the backend answers 201 with a student record carrying no
            // package_session_id, which renders as a completely empty
            // dashboard. That is a fine outcome if the learner chose this
            // institute, but on the auto-selected white-label path nobody
            // chose it, so hand them the dropdown instead of a dead end.
            if (
                opts?.auto &&
                studentStatus === 201 &&
                dropdownList.length > 1
            ) {
                setIsAutoSelecting(false);
                setIsSubmitting(false);
                return;
            }

            // Institute is now stored: let the root layout reload the
            // institute-keyed settings it may have loaded before the pick.
            window.dispatchEvent(new Event(INSTITUTE_SELECTED_EVENT));

            // Always redirect to dashboard after institute selection, regardless of course enrollment
            if (type) {
                if (type === "coursesPage")
                    navigate({ to: "/study-library/courses" });
                else
                    navigate({
                        to: "/study-library/courses/course-details",
                        search: { courseId: courseId || "" },
                    });
                return;
            }
            // Honor explicit deep-link redirect (?redirect=/some/path?param=...)
            // This is set when an unauthenticated user clicks a deep link that
            // routes them through institute selection. TanStack navigate({to})
            // strips query strings, so use window.location.assign for paths
            // containing '?' to preserve the full URL.
            if (redirect) {
                if (/^https?:\/\//.test(redirect) || redirect.includes("?")) {
                    window.location.assign(redirect);
                } else {
                    navigate({ to: redirect as never });
                }
                return;
            }
            // Skip session selection and go straight to the institute's landing route
            await navigateAfterLogin(navigate);
        } catch (error) {
            // On the auto path, drop back to the dropdown so the learner still
            // has a way in instead of staring at a spinner.
            if (opts?.auto) setIsAutoSelecting(false);
            toast.error(i18n.t("auth:instituteSelection.submissionFailed"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const onSubmit = async (data: FormValues) => {
        await selectInstitute(data.instituteId);
    };

    /**
     * White-label domains identify the institute by themselves, so a learner
     * who holds a role there should never be asked to pick it out of a list.
     *
     * Driven only by `domainInstituteId`, which is set solely from a successful
     * routing API answer — never from useDomainRouting, which falls back to the
     * device's cached InstituteId when the API 404s or errors. That cached
     * value is previous-session state, not a statement about this domain, and
     * must never silently choose an institute for someone.
     */
    useEffect(() => {
        if (autoSelectAttempted.current) return;
        if (isLoadingInstitutes || isResolvingDomain) return;
        if (!domainInstituteId) return;
        // Only auto-select an institute this learner actually holds a role in.
        // Without this a shared domain would hand someone another org's portal.
        if (!dropdownList.some((i) => i.value === domainInstituteId)) return;

        autoSelectAttempted.current = true;
        setIsAutoSelecting(true);
        const autoSelect = async () => {
            // Confirm a live enrollment BEFORE selecting: selecting registers
            // the session and saves the institute, and without a live
            // enrollment both would point at an institute the learner then
            // doesn't pick. Any doubt → the dropdown, nothing saved.
            let live = false;
            try {
                const userId = await getTokenFromStorage(TokenKey.accessToken)
                    .then(getTokenDecodedData)
                    .then((data) => data?.user);
                live = await hasLiveEnrollment(domainInstituteId, userId);
            } catch {
                live = false;
            }
            if (!live) {
                setIsAutoSelecting(false);
                return;
            }
            await selectInstitute(domainInstituteId, { auto: true });
        };
        void autoSelect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoadingInstitutes, dropdownList, isResolvingDomain, domainInstituteId]);

    const handleSessionTerminated = () => {
        // Session was terminated, user can retry
    };

    const handleRetryInstituteSelect = () => {
        setSessionLimitOpen(false);
        if (pendingInstituteId) {
            selectInstitute(pendingInstituteId);
        }
    };

    // Keep the loader up until we know whether this host picks the institute
    // for us, and while that choice is being applied, so the learner never
    // sees a dropdown flash on a white-label domain.
    if (isLoadingInstitutes || isResolvingDomain || isAutoSelecting) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-pink-50 z-50">
                <DashboardLoader />
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4 relative overflow-hidden">
            <motion.div
                animate={{ x: [0, 20, 0], y: [0, -10, 0], rotate: [0, 2, 0] }}
                transition={{ duration: 12, repeat: Infinity }}
                className="absolute top-20 start-20 w-48 h-48 bg-gradient-to-br from-gray-200/10 to-gray-300/10 rounded-full blur-3xl"
            />
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-md"
            >
                <div className="bg-white rounded-md shadow-md border border-gray-200 p-5 lg:p-6">
                    <div className="text-center mb-6 space-y-4">
                        <div className="w-12 h-12 bg-gray-900 rounded-lg mx-auto flex items-center justify-center">
                            <svg
                                className="w-6 h-6 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                                />
                            </svg>
                        </div>

                        <Heading
                            heading={t("instituteSelection.title")}
                            subHeading={t("instituteSelection.subtitle")}
                        />
                    </div>

                    <Form {...form}>
                        <form
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="space-y-4"
                        >
                            <FormField
                                control={form.control}
                                name="instituteId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Select
                                                value={field.value || undefined}
                                                onValueChange={field.onChange}
                                            >
                                                <SelectTrigger className="w-full bg-white border border-gray-300 text-gray-700 focus:ring-1 focus:ring-gray-900 rounded-md px-3.5 py-2.5 text-sm">
                                                    <SelectValue
                                                        placeholder={t(
                                                            "instituteSelection.placeholder"
                                                        )}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white text-sm rounded-md shadow-md">
                                                    {dropdownList.map(
                                                        (item) => (
                                                            <SelectItem
                                                                key={item.value}
                                                                value={
                                                                    item.value
                                                                }
                                                                className="hover:bg-gray-100 text-gray-700 cursor-pointer px-3 py-2 rounded-md"
                                                            >
                                                                {item.label}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <motion.button
                                type="submit"
                                disabled={isSubmitting}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                className="w-full bg-gray-900 hover:bg-black text-white font-medium py-2.5 px-3.5 rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                            >
                                {isSubmitting ? (
                                    <div className="flex items-center justify-center space-x-2">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{
                                                duration: 1,
                                                repeat: Infinity,
                                                ease: "linear",
                                            }}
                                        >
                                            <ArrowsClockwise className="w-4 h-4" />
                                        </motion.div>
                                        <span className="text-sm">
                                            {t("common.processing")}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center space-x-2">
                                        <Shield className="w-4 h-4" />
                                        <span className="text-sm">
                                            {t("instituteSelection.loginToInstitute")}
                                        </span>
                                    </div>
                                )}
                            </motion.button>
                        </form>
                    </Form>

                    <div className="text-center mt-6 text-sm">
                        <span className="text-neutral-500">
                            {t("instituteSelection.anotherAccount")}
                        </span>
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="text"
                            layoutVariant="default"
                            className="text-gray-700 hover:text-black hover:underline ms-1"
                            onClick={() =>
                                navigate({ to: "/login", search: { redirect: redirect || "/dashboard/" } })
                            }
                            disabled={isSubmitting}
                        >
                            {t("common.backToLogin")}
                        </MyButton>
                    </div>

                    <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.8 }}
                        className="mt-6 grid grid-cols-2 gap-4 text-sm text-gray-700"
                    >
                        <div className="text-center p-4 bg-white border rounded-md">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="w-5 h-5 text-gray-700"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
                                    />
                                    <circle cx="9" cy="7" r="4" />
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M23 21v-2a4 4 0 00-3-3.87"
                                    />
                                    <circle cx="17" cy="7" r="4" />
                                </svg>
                            </div>
                            <p className="font-medium">
                                {t("instituteSelection.multiInstitute")}
                            </p>
                            <p className="text-xs text-gray-500">
                                {t("instituteSelection.accessMultiple")}
                            </p>
                        </div>
                        <div className="text-center p-4 bg-white border rounded-md">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
                                <svg
                                    className="w-5 h-5 text-black-600"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                    />
                                </svg>
                            </div>
                            <p className="font-medium">
                                {t("instituteSelection.secureAccess")}
                            </p>
                            <p className="text-xs text-gray-500">
                                {t("instituteSelection.protectedData")}
                            </p>
                        </div>
                    </motion.div>
                </div>
            </motion.div>
            <SessionLimitDialog
                open={sessionLimitOpen}
                onOpenChange={setSessionLimitOpen}
                activeSessions={activeSessions}
                onSessionTerminated={handleSessionTerminated}
                onRetryLogin={handleRetryInstituteSelect}
            />
        </div>
    );
}
