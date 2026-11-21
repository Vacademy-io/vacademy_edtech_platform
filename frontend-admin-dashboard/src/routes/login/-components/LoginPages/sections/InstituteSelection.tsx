import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MyButton } from '@/components/design-system/button';
import { Heading } from '@/routes/login/-components/LoginPages/ui/heading';
import { SplashScreen } from '@/routes/login/-components/LoginPages/layout/splash-container';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { toast } from 'sonner';
import { amplitudeEvents, trackEvent } from '@/lib/amplitude';
import { Building2, GraduationCap, Shield, User, ChevronDown } from 'lucide-react';
import { fetchMultipleInstituteDetails, getInstituteName } from '@/lib/auth/instituteService';
import { InstituteDetailsType } from '@/schemas/student/student-list/institute-schema';
import { useTranslation } from 'react-i18next';

interface Institute {
    id: string;
    name: string;
    roles: string[];
    permissions: string[];
    details?: InstituteDetailsType | null;
}

interface InstituteSelectionProps {
    onInstituteSelect: (instituteId: string) => void;
}

export function InstituteSelection({ onInstituteSelect }: InstituteSelectionProps) {
    const { t } = useTranslation('loginInstituteSelection');
    const [institutes, setInstitutes] = useState<Institute[]>([]);
    const [selectedInstitute, setSelectedInstitute] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const initializeInstitutes = async () => {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            if (!accessToken) {
                toast.error(t('noAccessTokenFound'));
                navigate({ to: '/login' });
                return;
            }

            const tokenData = getTokenDecodedData(accessToken);
            if (!tokenData || !tokenData.authorities) {
                toast.error(t('invalidTokenData'));
                navigate({ to: '/login' });
                return;
            }

            // Extract institutes from authorities
            const instituteList: Institute[] = Object.entries(tokenData.authorities).map(
                ([instituteId, authority]) => ({
                    id: instituteId,
                    name: t('instituteFallbackName', { idPrefix: instituteId.slice(0, 8) }), // Will be updated with real names
                    roles: authority.roles || [],
                    permissions: authority.permissions || [],
                })
            );

            // Filter out institutes where user is only a STUDENT
            const validInstitutes = instituteList.filter((institute) => {
                const roles = institute.roles;
                // If user only has STUDENT role, exclude the institute
                if (roles.length === 1 && roles[0] === 'STUDENT') return false;
                // Include institute if user has any role other than just STUDENT
                return true;
            });

            if (validInstitutes.length === 0) {
                toast.error(t('noInstituteAccess'));
                navigate({ to: '/login' });
                return;
            }

            if (validInstitutes.length === 1) {
                // Auto-select if only one institute
                const institute = validInstitutes[0];
                if (institute) {
                    const primaryRole = getPrimaryRole(institute.roles);
                    trackEvent('Institute Auto-Selected', {
                        institute_id: institute.id,
                        primary_role: primaryRole,
                        timestamp: new Date().toISOString(),
                    });
                    onInstituteSelect(institute.id);
                    return;
                }
            }

            // Set institutes first, then fetch details
            setInstitutes(validInstitutes);
            setIsLoading(false);

            // Fetch institute details for better display names
            await fetchInstituteDetails(validInstitutes);
        };

        initializeInstitutes();
    }, [navigate, onInstituteSelect]);

    // Handle click outside dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const fetchInstituteDetails = async (instituteList: Institute[]) => {
        try {
            setIsLoadingDetails(true);

            const instituteIds = instituteList.map(institute => institute.id);
            const instituteDetails = await fetchMultipleInstituteDetails(instituteIds);

            // Update institute names with real names
            const updatedInstitutes = instituteList.map(institute => {
                const details = instituteDetails[institute.id];
                const newName = getInstituteName(details || null, institute.id);

                return {
                    ...institute,
                    name: newName,
                    details: details || null,
                };
            });

            setInstitutes(updatedInstitutes);
        } catch (error) {
            // Don't log errors as they're handled gracefully with fallback names
            // Keep the original institutes with fallback names
        } finally {
            setIsLoadingDetails(false);
        }
    };

    const getPrimaryRole = (roles: string[]): string => {
        // If ADMIN role is present, always return ADMIN
        if (roles.includes('ADMIN')) return 'ADMIN';

        // Find the first non-STUDENT role in the array
        const nonStudentRole = roles.find(role => role !== 'STUDENT');

        // Return the first non-STUDENT role, or UNKNOWN if only STUDENT roles exist
        return nonStudentRole || 'UNKNOWN';
    };

    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'ADMIN':
                return <Shield className="h-4 w-4 text-red-500" />;
            case 'TEACHER':
                return <GraduationCap className="h-4 w-4 text-blue-500" />;
            case 'STUDENT':
                return <User className="h-4 w-4 text-green-500" />;
            default:
                return <User className="h-4 w-4 text-gray-500" />;
        }
    };

    const getRoleColor = (role: string) => {
        switch (role) {
            case 'ADMIN':
                return 'text-red-600 bg-red-50 border-red-200';
            case 'TEACHER':
                return 'text-blue-600 bg-blue-50 border-blue-200';
            case 'STUDENT':
                return 'text-green-600 bg-green-50 border-green-200';
            default:
                return 'text-gray-600 bg-gray-50 border-gray-200';
        }
    };

    const handleInstituteSelect = (instituteId: string) => {
        setSelectedInstitute(instituteId);
    };

    const handleContinue = () => {
        if (!selectedInstitute) {
            toast.error(t('pleaseSelectAnInstitute'));
            return;
        }

        const institute = institutes.find((inst) => inst.id === selectedInstitute);

        if (!institute) {
            toast.error(t('selectedInstituteNotFound'));
            return;
        }

        const primaryRole = getPrimaryRole(institute.roles);

        trackEvent('Institute Selected', {
            institute_id: selectedInstitute,
            primary_role: primaryRole,
            available_roles: institute.roles,
            timestamp: new Date().toISOString(),
        });

        onInstituteSelect(selectedInstitute);
    };

    if (isLoading) {
        return (
            <SplashScreen isAnimationEnabled={false}>
                <div className="flex w-full flex-col items-center justify-center gap-20">
                    <div className="flex flex-col items-center justify-center gap-4">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
                        <p className="text-sm text-gray-600">{t('loadingInstitutes')}</p>
                    </div>
                </div>
            </SplashScreen>
        );
    }

    return (
        <SplashScreen isAnimationEnabled={false}>
            <div className="flex w-full flex-col items-center justify-center gap-20">
                <div className="flex flex-col items-center gap-4">
                    <Building2 className="h-12 w-12 text-primary-500" />
                    <Heading
                        heading={t('selectYourInstitute')}
                        subHeading={t('chooseInstituteToAccess')}
                    />
                </div>

                <div className="flex w-full flex-col items-center gap-8">
                    {isLoadingDetails && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                            {t('loadingInstituteDetails')}
                        </div>
                    )}

                    {/* Institute Dropdown */}
                    <div className="w-full max-w-md" ref={dropdownRef}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('selectInstituteLabel')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg bg-white text-left shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            >
                                <div className="flex items-center gap-3">
                                    <Building2 className="h-5 w-5 text-gray-600" />
                                    <div>
                                        {selectedInstitute ? (
                                            <>
                                                <div className="font-medium text-gray-900">
                                                    {institutes.find(i => i.id === selectedInstitute)?.name || t('selectAnInstitute')}
                                                </div>
                                                <div className="text-sm text-gray-500">
                                                    {(() => {
                                                        const institute = institutes.find(i => i.id === selectedInstitute);
                                                        if (institute?.details?.city && institute?.details?.state) {
                                                            return `${institute.details.city}, ${institute.details.state}`;
                                                        }
                                                        return '';
                                                    })()}
                                                </div>
                                            </>
                                        ) : (
                                            <span className="text-gray-500">{t('selectAnInstitute')}</span>
                                        )}
                                    </div>
                                </div>
                                <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown Menu */}
                            {isDropdownOpen && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                                    {institutes.map((institute) => {
                                        const primaryRole = getPrimaryRole(institute.roles);
                                        const isSelected = selectedInstitute === institute.id;

                                        return (
                                            <div
                                                key={institute.id}
                                                className={`cursor-pointer px-4 py-3 hover:bg-gray-50 transition-colors ${
                                                    isSelected ? 'bg-primary-50 border-l-4 border-primary-500' : ''
                                                }`}
                                                onClick={() => {
                                                    handleInstituteSelect(institute.id);
                                                    setIsDropdownOpen(false);
                                                }}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <Building2 className="h-5 w-5 text-gray-600" />
                                                        <div>
                                                            <div className="font-medium text-gray-900">
                                                                {institute.name}
                                                            </div>
                                                            <div className="text-sm text-gray-500">
                                                                {institute.details?.city && institute.details?.state
                                                                    ? `${institute.details.city}, ${institute.details.state}`
                                                                    : ''
                                                                }
                                                            </div>
                                                            {institute.details?.type && (
                                                                <div className="text-xs text-gray-400">
                                                                    {institute.details.type}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {isSelected && (
                                                        <div className="h-3 w-3 rounded-full bg-primary-500"></div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex w-full max-w-md flex-col gap-4">
                        {!selectedInstitute && (
                            <p className="text-sm text-gray-500 text-center">
                                {t('pleaseSelectAnInstituteToContinue')}
                            </p>
                        )}

                        <MyButton
                            type="button"
                            scale="large"
                            buttonType={selectedInstitute ? "primary" : "secondary"}
                            layoutVariant="default"
                            onClick={() => {
                                handleContinue();
                            }}
                            disabled={!selectedInstitute}
                        >
                            {selectedInstitute ? t('continueToDashboard') : t('pleaseSelectAnInstitute')}
                        </MyButton>

                        <button
                            type="button"
                            onClick={() => navigate({ to: '/login' })}
                            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                        >
                            {t('backToLogin')}
                        </button>
                    </div>
                </div>
            </div>
        </SplashScreen>
    );
}
