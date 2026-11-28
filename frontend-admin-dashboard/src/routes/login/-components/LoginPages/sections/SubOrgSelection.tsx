import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MyButton } from '@/components/design-system/button';
import { Heading } from '@/routes/login/-components/LoginPages/ui/heading';
import { SplashScreen } from '@/routes/login/-components/LoginPages/layout/splash-container';
import { toast } from 'sonner';
import { Building2, ChevronDown, Check } from 'lucide-react';
import {
    getFacultyAccessData,
    setSelectedSubOrgId,
} from '@/lib/auth/facultyAccessUtils';
import type { SubOrgAccess } from '@/types/faculty-access';
import { BASE_URL } from '@/constants/urls';
import { useTranslation } from 'react-i18next';

interface SubOrgSelectionProps {
    onSubOrgSelect: (subOrgId: string) => void;
}

const getLogoUrl = (fileId?: string) => {
    if (!fileId) return null;
    return `${BASE_URL}/media-service/public/get-public-url?fileId=${fileId}`;
};

export function SubOrgSelection({ onSubOrgSelect }: SubOrgSelectionProps) {
    const { t } = useTranslation('loginSubOrgSelection');
    const [subOrgs, setSubOrgs] = useState<SubOrgAccess[]>([]);
    const [selectedSubOrg, setSelectedSubOrg] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const initializeSubOrgs = () => {
            const facultyData = getFacultyAccessData();
            if (!facultyData || !facultyData.subOrgs || facultyData.subOrgs.length === 0) {
                toast.error(t('noSubOrgsFound'));
                navigate({ to: '/login' });
                return;
            }

            setSubOrgs(facultyData.subOrgs);
            setIsLoading(false);

            // If only one sub-org, auto-select it
            if (facultyData.subOrgs.length === 1 && facultyData.subOrgs[0]) {
                const subOrgId = facultyData.subOrgs[0].subOrgId;
                setSelectedSubOrg(subOrgId);
                setSelectedSubOrgId(subOrgId);
                onSubOrgSelect(subOrgId);
            }
        };

        initializeSubOrgs();
    }, [navigate, onSubOrgSelect]);

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

    const handleSubOrgSelect = (subOrgId: string) => {
        setSelectedSubOrg(subOrgId);
    };

    const handleContinue = () => {
        if (!selectedSubOrg) {
            toast.error(t('pleaseSelectASubOrg'));
            return;
        }

        setSelectedSubOrgId(selectedSubOrg);
        onSubOrgSelect(selectedSubOrg);
    };

    if (isLoading) {
        return (
            <SplashScreen isAnimationEnabled={false}>
                <div className="flex w-full flex-col items-center justify-center gap-20">
                    <div className="flex flex-col items-center justify-center gap-4">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
                        <p className="text-sm text-gray-600">{t('loadingSubOrgs')}</p>
                    </div>
                </div>
            </SplashScreen>
        );
    }

    const currentSubOrg = subOrgs.find(s => s.subOrgId === selectedSubOrg);
    const currentLogoUrl = getLogoUrl(currentSubOrg?.instituteLogoFileId);

    return (
        <SplashScreen isAnimationEnabled={false}>
            <div className="flex w-full flex-col items-center justify-center gap-20 px-4">
                <div className="flex flex-col items-center gap-4 text-center">
                    {currentLogoUrl ? (
                        <div className="h-20 w-20 rounded-xl border border-gray-100 bg-white p-2 shadow-sm flex items-center justify-center overflow-hidden">
                            <img src={currentLogoUrl} alt={t('logoAlt')} className="max-h-full max-w-full object-contain" />
                        </div>
                    ) : (
                        <Building2 className="h-12 w-12 text-primary-500" />
                    )}
                    <Heading
                        heading={t('selectSubOrg')}
                        subHeading={t('pleaseChooseSubOrgToAccess')}
                    />
                </div>

                <div className="flex w-full flex-col items-center gap-8">
                    {/* Sub-Org Dropdown */}
                    <div className="w-full max-w-md" ref={dropdownRef}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('availableSubOrgs')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg bg-white text-left shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all"
                            >
                                <div className="flex items-center gap-3">
                                    {getLogoUrl(currentSubOrg?.instituteLogoFileId) ? (
                                        <img src={getLogoUrl(currentSubOrg?.instituteLogoFileId) || ''} className="h-6 w-6 object-contain" alt="" />
                                    ) : (
                                        <Building2 className="h-5 w-5 text-gray-400" />
                                    )}
                                    <div className="truncate">
                                        {selectedSubOrg ? (
                                            <span className="font-medium text-gray-900 truncate block">
                                                {currentSubOrg?.subOrgName || t('subOrgFallbackName', { subOrgId: selectedSubOrg })}
                                            </span>
                                        ) : (
                                            <span className="text-gray-500">{t('chooseASubOrg')}</span>
                                        )}
                                    </div>
                                </div>
                                <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown Menu */}
                            {isDropdownOpen && (
                                <div className="absolute z-20 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-auto py-1 animate-in fade-in zoom-in-95 duration-100">
                                    {subOrgs.map((subOrg) => {
                                        const isSelected = selectedSubOrg === subOrg.subOrgId;
                                        const logoUrl = getLogoUrl(subOrg.instituteLogoFileId);
                                        return (
                                            <div
                                                key={subOrg.subOrgId}
                                                className={`cursor-pointer px-4 py-3 hover:bg-primary-50 transition-colors flex items-center justify-between ${isSelected ? 'bg-primary-50' : ''
                                                    }`}
                                                onClick={() => {
                                                    handleSubOrgSelect(subOrg.subOrgId);
                                                    setIsDropdownOpen(false);
                                                }}
                                            >
                                                <div className="flex items-center gap-3 truncate mr-2">
                                                    {logoUrl ? (
                                                        <img src={logoUrl} className="h-8 w-8 object-contain rounded border bg-white" alt="" />
                                                    ) : (
                                                        <Building2 className={`h-5 w-5 flex-shrink-0 ${isSelected ? 'text-primary-500' : 'text-gray-400'}`} />
                                                    )}
                                                    <div className="truncate">
                                                        <div className={`font-medium truncate ${isSelected ? 'text-primary-700' : 'text-gray-900'}`}>
                                                            {subOrg.subOrgName || t('subOrgFallbackName', { subOrgId: subOrg.subOrgId })}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {t('idLabel', { idPrefix: subOrg.subOrgId.slice(0, 8) })}
                                                        </div>
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <Check className="h-5 w-5 text-primary-500 flex-shrink-0" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex w-full max-w-md flex-col gap-4">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType={selectedSubOrg ? "primary" : "secondary"}
                            layoutVariant="default"
                            onClick={handleContinue}
                            disabled={!selectedSubOrg}
                            className="w-full"
                        >
                            {selectedSubOrg ? t('continueToPortal') : t('selectASubOrg')}
                        </MyButton>

                        <button
                            type="button"
                            onClick={() => navigate({ to: '/login' })}
                            className="text-sm font-medium text-gray-500 hover:text-primary-600 transition-colors py-2"
                        >
                            {t('backToLogin')}
                        </button>
                    </div>
                </div>
            </div>
        </SplashScreen>
    );
}
