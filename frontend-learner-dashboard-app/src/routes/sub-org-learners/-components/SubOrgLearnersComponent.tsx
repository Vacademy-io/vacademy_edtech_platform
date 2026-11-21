import { useState, useEffect, useRef } from 'react';
import { AdminMappings, StudentMapping, getMembers, addMember, terminateMembers, AddMemberRequest, getInstituteCustomFields, InstituteCustomField } from '@/services/sub-organization-learner-management';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash, Users, ArrowsClockwise, SpinnerGap, UploadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";
import { Trans, useTranslation } from "react-i18next";
import { isValidPhoneValue } from "@/lib/phone-validation";
import { BulkUploadModal } from './BulkUploadModal';
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { FieldRenderType, getFieldRenderType } from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import {
  phoneFieldHasInput,
  usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";

interface SubOrgLearnersComponentProps {
  adminMappings: AdminMappings[];
  instituteDetails: any;
}

// Sub-org members added here are always staff. The backend models staff as the
// LEARNER org-role, so we always send LEARNER — the role is no longer user-selectable.
const STAFF_ORG_ROLE = 'LEARNER';

export function SubOrgLearnersComponent({ adminMappings, instituteDetails }: SubOrgLearnersComponentProps) {
  const { t } = useTranslation('registrationB');
  const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin);
  const batch = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
  const batchLower = batch.toLocaleLowerCase();
  const [selectedPackageSession, setSelectedPackageSession] = useState<string>('');
  const [members, setMembers] = useState<StudentMapping[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [instituteCustomFields, setInstituteCustomFields] = useState<InstituteCustomField[]>([]);
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  const lastFetchedInviteRef = useRef<string | null>(null);
  const [isTerminateDialogOpen, setIsTerminateDialogOpen] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  // Terminate mode: HARD = remove now, SOFT = keep access until a chosen date.
  const [terminateMode, setTerminateMode] = useState<'SOFT' | 'HARD'>('HARD');
  const [terminateAccessTillDate, setTerminateAccessTillDate] = useState<string>('');
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);

  // Form states for add member
  const [formData, setFormData] = useState<any>({
    email: '',
    mobile_number: '',
    full_name: '',
    username: '',
    status: 'ACTIVE'
  });

  // Default selected country + picker order from the institute's preferred
  // countries. Declared after `formData` so the freeze flag can read it.
  //
  // Only the fields that actually RENDER as phone inputs count. Scanning every
  // value instead would freeze on an ordinary text field that happens to hold a
  // digit, silently opting this form out of ever picking up the institute's
  // preference. The phone fields are the built-in `mobile_number` plus any
  // custom field the shared helper types as PHONE — exactly what the renderer
  // below asks.
  const hasTypedPhone =
    phoneFieldHasInput(formData.mobile_number) ||
    instituteCustomFields.some((field) => {
      const key = field.custom_field?.fieldKey;
      if (!key) return false;
      const renderType = getFieldRenderType(
        field.custom_field?.fieldName || key,
        field.custom_field?.fieldType,
      );
      return renderType === FieldRenderType.PHONE && phoneFieldHasInput(formData[key]);
    });
  const { defaultCountry, preferredCountries } = usePreferredPhoneCountries({
    freeze: hasTypedPhone,
  });


  useEffect(() => {
    if (adminMappings.length > 0 && !selectedPackageSession) {
      setSelectedPackageSession(adminMappings[0].package_session_id);
    }
  }, [adminMappings, selectedPackageSession]);

  useEffect(() => {
    const fetchCustomFields = async () => {
      if (!selectedPackageSession) return;

      const selectedMapping = adminMappings.find(m => m.package_session_id === selectedPackageSession);
      if (selectedMapping && selectedMapping.invite_code) {
        // Prevent duplicate calls
        if (lastFetchedInviteRef.current === selectedMapping.invite_code) {
          return;
        }

        setLoadingCustomFields(true);
        try {
          // Update the ref immediately to prevent race conditions or subsequent triggers
          lastFetchedInviteRef.current = selectedMapping.invite_code;

          const response = await getInstituteCustomFields(selectedMapping.institute_id, selectedMapping.invite_code);
          const fields = response.institute_custom_fields || [];
          setInstituteCustomFields(fields);

          // Pre-fill Practice Name if it exists
          const practiceNameField = fields.find(f => f.custom_field.fieldName === 'Practice Name');
          if (practiceNameField && selectedMapping.sub_org_details?.institute_name) {
            setFormData((prev: any) => ({
              ...prev,
              [practiceNameField.custom_field.fieldKey]: selectedMapping.sub_org_details.institute_name
            }));
          }
        } catch (error) {
          console.error("Failed to fetch custom fields", error);
          toast.error(t('subOrgLearners.toast.loadFormConfigFailed'));
        } finally {
          setLoadingCustomFields(false);
        }
      } else {
        // Fallback or clear if no invite code
        setInstituteCustomFields([]);
        lastFetchedInviteRef.current = null;
      }
    };

    fetchCustomFields();
  }, [selectedPackageSession, adminMappings]);

  useEffect(() => {
    if (selectedPackageSession) {
      loadMembers();
    }
  }, [selectedPackageSession]);

  const loadMembers = async () => {
    if (!selectedPackageSession) return;

    setIsLoading(true);
    try {
      const selectedMapping = adminMappings.find(m => m.package_session_id === selectedPackageSession);
      if (!selectedMapping) return;

      const response = await getMembers(selectedPackageSession, selectedMapping.sub_org_id);

      // Filter out the admin user from the members list
      const adminUserId = selectedMapping.user_id;
      const filteredMembers = (response.student_mappings || []).filter(
        member => member.user_id !== adminUserId
      );

      setMembers(filteredMembers);
    } catch (error) {
      console.error('Error loading members:', error);
      setMembers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedPackageSession) {
      toast.error(t('subOrgLearners.toast.selectBatch', { batch: batchLower }));
      return;
    }

    // Extract core fields from dynamic form data
    // We need to map custom fields to core fields: email, full_name, mobile_number, username
    let email = '';
    let full_name = '';
    let mobile_number = '';
    let username = '';

    // Match core identity fields by `fieldKey` (the stable machine ID set at
    // field creation by the backend's CustomFieldKeyGenerator) — NOT by the
    // freeform display label `fieldName`, which admins can rename freely
    // (e.g. "Full Name (First Name & Last Name)") and which breaks string match.
    // Two key patterns coexist in production:
    //   - Legacy seeded defaults:  "full_name" / "email" / "phone_number"
    //   - Admin-created via UI:    "<slug>_inst_<instituteId>"
    const matchKey = (prefix: string) => (f: InstituteCustomField) => {
      const k = f.custom_field.fieldKey;
      return k === prefix || k.startsWith(prefix + '_inst_');
    };

    const nameField  = instituteCustomFields.find(matchKey('full_name'));
    const emailField = instituteCustomFields.find(matchKey('email'));
    const phoneField = instituteCustomFields.find(matchKey('phone_number'));

    if (nameField)  full_name     = formData[nameField.custom_field.fieldKey] || '';
    if (emailField) email         = formData[emailField.custom_field.fieldKey] || '';
    if (phoneField) mobile_number = formData[phoneField.custom_field.fieldKey] || '';

    // Fallback for split-name forms (institutes using First Name + Last Name
    // instead of a single combined Full Name field).
    if (!full_name) {
      const firstNameField = instituteCustomFields.find(matchKey('first_name'));
      const lastNameField  = instituteCustomFields.find(matchKey('last_name'));
      const firstName = firstNameField ? formData[firstNameField.custom_field.fieldKey] || '' : '';
      const lastName  = lastNameField ? formData[lastNameField.custom_field.fieldKey] || '' : '';
      full_name = `${firstName} ${lastName}`.trim();
    }

    // Fallback for institutes whose invite form has no custom fields configured.
    // The hardcoded Email/Full Name/Mobile inputs render in that branch (see the
    // `instituteCustomFields.length === 0` body of the dialog below).
    if (!email && formData.email) email = formData.email;
    if (!full_name && formData.full_name) full_name = formData.full_name;
    if (!mobile_number && formData.mobile_number) mobile_number = formData.mobile_number;

    if (!email || !full_name) {
      // Distinguish "user left a visible input blank" from "this invite form
      // has no recognizable email/name field configured" — the latter is an
      // admin/config problem and needs a different message so the user doesn't
      // think they're missing an input that doesn't exist.
      const hasFormFields = instituteCustomFields.length > 0;
      const isConfigProblem =
        hasFormFields && (!emailField || (!nameField && !full_name));
      if (isConfigProblem) {
        toast.error(
          t('subOrgLearners.addStaff.toast.configProblem', { admin })
        );
      } else {
        toast.error(t('subOrgLearners.addStaff.toast.emailNameRequired'));
      }
      return;
    }

    // Email validation
    if (!validateEmail(email)) {
      toast.error(t('subOrgLearners.addStaff.toast.invalidEmail'));
      return;
    }

    // Phone number validation (if provided)
    if (mobile_number && !validatePhoneNumber(mobile_number)) {
      toast.error(t('subOrgLearners.addStaff.toast.invalidPhone'));
      return;
    }

    const selectedMapping = adminMappings.find(m => m.package_session_id === selectedPackageSession);
    if (!selectedMapping) {
      toast.error(t('subOrgLearners.toast.invalidBatch', { batch }));
      return;
    }

    // Construct custom_field_values
    const customFieldValues = instituteCustomFields.map(field => ({
      custom_field_id: field.custom_field.id,
      value: formData[field.custom_field.fieldKey] || ''
    })).filter(item => item.value !== '');

    setIsAdding(true);
    try {
      const memberData: AddMemberRequest = {
        user: {
          email: email,
          mobile_number: mobile_number || undefined,
          full_name: full_name,
          username: username || undefined,
        },
        package_session_id: selectedPackageSession,
        sub_org_id: selectedMapping.sub_org_id,
        institute_id: selectedMapping.institute_id,
        status: 'ACTIVE',
        comma_separated_org_roles: STAFF_ORG_ROLE,
        custom_field_values: customFieldValues.length > 0 ? customFieldValues : undefined
      };

      await addMember(memberData);

      // Reset form
      setFormData({
        status: 'ACTIVE',
      });

      setIsAddModalOpen(false);
      loadMembers(); // Refresh the list
    } catch (error: any) {
      console.error('Error adding member:', error);
      // Extract error message from API response
      const errorMessage = error?.response?.data?.ex || error?.response?.data?.message || t('subOrgLearners.addStaff.toast.addFailed');
      toast.error(errorMessage);
    } finally {
      setIsAdding(false);
    }
  };

  const openTerminateDialog = () => {
    if (selectedMembers.length === 0) {
      toast.error(t('subOrgLearners.terminate.toast.selectMembers'));
      return;
    }
    setTerminateMode('HARD');
    setTerminateAccessTillDate('');
    setIsTerminateDialogOpen(true);
  };

  const handleTerminateMembers = async () => {
    if (!selectedPackageSession) {
      toast.error(t('subOrgLearners.toast.selectBatch', { batch: batchLower }));
      return;
    }

    const selectedMapping = adminMappings.find(m => m.package_session_id === selectedPackageSession);
    if (!selectedMapping) {
      toast.error(t('subOrgLearners.toast.invalidBatch', { batch }));
      return;
    }

    if (terminateMode === 'SOFT' && !terminateAccessTillDate) {
      toast.error(t('subOrgLearners.terminate.toast.pickDate'));
      return;
    }

    setIsTerminating(true);
    try {
      await terminateMembers({
        sub_org_id: selectedMapping.sub_org_id,
        institute_id: selectedMapping.institute_id,
        package_session_id: selectedPackageSession,
        user_ids: selectedMembers,
        mode: terminateMode,
        access_till_date: terminateMode === 'SOFT' ? terminateAccessTillDate : null,
      });

      toast.success(
        terminateMode === 'SOFT'
          ? t('subOrgLearners.terminate.toast.softSuccess', {
              count: selectedMembers.length,
              date: terminateAccessTillDate,
            })
          : t('subOrgLearners.terminate.toast.hardSuccess', {
              count: selectedMembers.length,
            }),
      );
      setSelectedMembers([]);
      setIsTerminateDialogOpen(false);
      loadMembers(); // Refresh the list
    } catch (error) {
      console.error('Error terminating members:', error);
      toast.error(t('subOrgLearners.terminate.toast.failed'));
    } finally {
      setIsTerminating(false);
    }
  };

  const handleSelectMember = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedMembers(prev => [...prev, userId]);
    } else {
      setSelectedMembers(prev => prev.filter(id => id !== userId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedMembers(members.map(m => m.user_id));
    } else {
      setSelectedMembers([]);
    }
  };
  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Country-aware validity for the selected country (dial code embedded in value).
  const validatePhoneNumber = (phone: string): boolean => isValidPhoneValue(phone);

  const validateUsername = (username: string): boolean => {
    // Username must be lowercase only (no capital letters)
    return /^[a-z0-9_]+$/.test(username) && username === username.toLowerCase();
  };

  // Get package session name from package session ID
  const getPackageSessionName = (packageSessionId: string): string => {
    // First try to get it from adminMappings if available
    const mapping = adminMappings.find(m => m.package_session_id === packageSessionId);
    
    if (mapping && mapping.package_name) {
       const parts = [
         mapping.package_name, 
         (mapping.level_name && mapping.level_name.toUpperCase() !== 'DEFAULT') ? mapping.level_name : null,
         (mapping.session_name && mapping.session_name.toUpperCase() !== 'DEFAULT') ? mapping.session_name : null
       ].filter(Boolean);
       
       return parts.length > 0 ? parts.join(' - ') : packageSessionId;
    }

    if (!instituteDetails?.batches_for_sessions) {
      return packageSessionId;
    }

    const batch = instituteDetails.batches_for_sessions.find(
      (b: any) => b.id === packageSessionId
    );

    if (!batch) {
      return packageSessionId;
    }

    const packageName = batch.package_dto?.package_name || '';
    let levelName = batch.level?.level_name || '';
    let sessionName = batch.session?.session_name || '';

    if (batch.level?.id === 'DEFAULT') levelName = '';
    if (batch.session?.id === 'DEFAULT') sessionName = '';

    // Format: "Package Name - Level Name - Session Name"
    const parts = [packageName, levelName, sessionName].filter(Boolean);
    return parts.length > 0 ? parts.join(' - ') : packageSessionId;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-green-100 text-green-800';
      case 'TERMINATED':
        return 'bg-red-100 text-red-800';
      case 'INVITED':
        return 'bg-blue-100 text-blue-800';
      case 'PENDING_FOR_APPROVAL':
        return 'bg-yellow-100 text-yellow-800';
      case 'INACTIVE':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Helper function to capitalize first letter of each word
  const capitalizeFieldName = (name: string): string => {
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const renderField = (field: InstituteCustomField) => {
    const { fieldKey, fieldName, fieldType, isMandatory, config } = field.custom_field;
    const displayName = capitalizeFieldName(fieldName);

    // Check if field is "Practice Name" to disable it
    if (fieldName === 'Practice Name') {
      return (
        <div key={field.id}>
          <Label htmlFor={fieldKey}>{displayName} {isMandatory && '*'}</Label>
          <Input
            id={fieldKey}
            value={formData[fieldKey] || ''}
            readOnly
            disabled
            className="bg-gray-100 text-gray-500 cursor-not-allowed"
          />
        </div>
      );
    }

    // Resolve the render type using shared helper (auto-detects phone by field name)
    const renderType = getFieldRenderType(fieldName || fieldKey, fieldType);

    // Phone: keep specialised PhoneInput with country-code picker
    if (renderType === FieldRenderType.PHONE) {
      return (
        <div key={field.id}>
          <Label htmlFor={fieldKey}>{displayName} {isMandatory && '*'}</Label>
          <div className={formData[fieldKey] && !validatePhoneNumber(formData[fieldKey]) ? "phone-input-error" : ""}>
            <PhoneInput
              country={defaultCountry}
              value={formData[fieldKey] || ''}
              onChange={(phone) => setFormData((prev: any) => ({ ...prev, [fieldKey]: phone.startsWith('+') ? phone : `+${phone}` }))}
              enableSearch={true}
              placeholder={t('subOrgLearners.addStaff.phonePlaceholder')}
              inputClass="!w-full h-10 !rounded-md !border-input"
              buttonClass="!rounded-s-md !border-input"
              countryCodeEditable={false}
              enableAreaCodes={false}
              disableCountryGuess={false}
              preferredCountries={preferredCountries}
            />
          </div>
        </div>
      );
    }

    // All other types — shared renderer handles text, number, email, url,
    // date, textarea, checkbox, radio, dropdown, file
    return (
      <div key={field.id}>
        <Label htmlFor={fieldKey}>{displayName} {isMandatory && '*'}</Label>
        <CustomFieldRenderer
          type={renderType}
          name={displayName}
          value={formData[fieldKey] || ''}
          onChange={(val) => setFormData((prev: any) => ({ ...prev, [fieldKey]: val }))}
          config={config}
          required={isMandatory}
        />
      </div>
    );
  };

  const currentOrgName =
    (adminMappings.find(m => m.package_session_id === selectedPackageSession) || adminMappings[0])?.sub_org_details?.institute_name ||
    t('subOrgLearners.page.defaultOrgName');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{currentOrgName}</h1>
          <p className="text-gray-600 mt-1">
            {t('subOrgLearners.page.subtitle', { orgName: currentOrgName })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={loadMembers} variant="outline" size="sm">
            <ArrowsClockwise className="w-4 h-4 me-2" />
            {t('subOrgLearners.page.refreshButton')}
          </Button>
          <Button variant="outline" onClick={() => setIsBulkUploadOpen(true)}>
            <UploadSimple className="w-4 h-4 me-2" />
            {t('subOrgLearners.page.bulkUploadButton')}
          </Button>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 me-2" />
                {t('subOrgLearners.addStaff.addButton')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md w-vw-95 max-h-screen-90 overflow-y-auto p-4 sm:p-6 z-50">
              <DialogHeader>
                <DialogTitle>{t('subOrgLearners.addStaff.dialogTitle')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {loadingCustomFields ? (
                  <div className="flex justify-center py-4">
                    <SpinnerGap className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : instituteCustomFields.length > 0 ? (
                  <>
                    {instituteCustomFields
                      .filter(field => {
                        const fieldName = field.custom_field.fieldName;
                        // Only hide Practice Name from the form (it's auto-filled)
                        return fieldName !== 'Practice Name';
                      })
                      .sort((a, b) => (a.custom_field.formOrder || 0) - (b.custom_field.formOrder || 0))
                      .map(field => renderField(field))}
                  </>
                ) : (
                  // Fallback hardcoded fields if no custom fields loaded
                  <>
                    <div>
                      <Label htmlFor="email">{t('subOrgLearners.addStaff.fallback.emailLabel')}</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData((prev: any) => ({ ...prev, email: e.target.value }))}
                        placeholder={t('subOrgLearners.addStaff.fallback.emailPlaceholder')}
                        className={formData.email && !validateEmail(formData.email) ? "border-red-500" : ""}
                      />
                    </div>
                    <div>
                      <Label htmlFor="full_name">{t('subOrgLearners.addStaff.fallback.fullNameLabel')}</Label>
                      <Input
                        id="full_name"
                        value={formData.full_name}
                        onChange={(e) => setFormData((prev: any) => ({ ...prev, full_name: e.target.value }))}
                        placeholder={t('subOrgLearners.addStaff.fallback.fullNamePlaceholder')}
                      />
                    </div>
                    <div>
                      <Label htmlFor="mobile_number">{t('subOrgLearners.addStaff.fallback.mobileLabel')}</Label>
                      <PhoneInput
                        country={defaultCountry}
                        preferredCountries={preferredCountries}
                        value={formData.mobile_number}
                        onChange={(phone) => setFormData((prev: any) => ({ ...prev, mobile_number: phone.startsWith('+') ? phone : `+${phone}` }))}
                        inputClass="!w-full h-10 !rounded-md !border-input"
                        buttonClass="!rounded-s-md !border-input"
                      />
                    </div>
                  </>
                )}

                <div className="flex flex-col sm:flex-row justify-end gap-stack pt-4">
                  <Button variant="outline" onClick={() => setIsAddModalOpen(false)} className="w-full sm:w-auto" disabled={isAdding}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={handleAddMember} className="w-full sm:w-auto" disabled={isAdding}>
                    {isAdding ? t('subOrgLearners.addStaff.addingLabel') : t('subOrgLearners.addStaff.addButton')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>


      {/* Package Session Selector */}
      {adminMappings.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('subOrgLearners.page.selectBatchTitle', { batch })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedPackageSession} onValueChange={setSelectedPackageSession}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue
                  placeholder={t('subOrgLearners.page.selectBatchPlaceholder', {
                    batch: batchLower,
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                {adminMappings.map((mapping) => (
                  <SelectItem key={mapping.package_session_id} value={mapping.package_session_id}>
                    {getPackageSessionName(mapping.package_session_id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      ) : adminMappings.length === 1 && selectedPackageSession ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('subOrgLearners.page.practiceGroupTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 font-medium">
              {getPackageSessionName(selectedPackageSession)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Members Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                {t('subOrgLearners.table.staffCountTitle', { count: members.length })}
              </CardTitle>
              {selectedPackageSession && (
                <p className="text-sm text-gray-600 mt-1">
                  {getPackageSessionName(selectedPackageSession)}
                </p>
              )}
              {selectedMembers.length > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  {t('subOrgLearners.table.selectedCount', { count: selectedMembers.length })}
                </p>
              )}
            </div>
            {selectedMembers.length > 0 && (
              <>
                <Button variant="destructive" size="sm" onClick={openTerminateDialog} className="text-white">
                  <Trash className="w-4 h-4 me-2 text-white" />
                  {t('subOrgLearners.terminate.selectedButton', { count: selectedMembers.length })}
                </Button>

                <AlertDialog open={isTerminateDialogOpen} onOpenChange={setIsTerminateDialogOpen}>
                  <AlertDialogContent className="max-w-md">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-xl font-semibold">
                        {t('subOrgLearners.terminate.confirmTitle')}
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-gray-600">
                        <Trans
                          t={t}
                          i18nKey="subOrgLearners.terminate.confirmDescription"
                          count={selectedMembers.length}
                          values={{ count: selectedMembers.length }}
                          components={{
                            b1: <span className="font-semibold text-gray-900" />,
                          }}
                        />
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    {/* SOFT vs HARD choice + last-access date (SOFT only). */}
                    <div className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-600">
                        {t('subOrgLearners.terminate.modeLabel')}
                      </p>
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="suborg-terminate-mode"
                          checked={terminateMode === 'HARD'}
                          onChange={() => setTerminateMode('HARD')}
                          className="mt-0.5"
                        />
                        <span className="text-xs text-gray-700">
                          <strong>{t('subOrgLearners.terminate.hardLabel')}</strong>{' '}
                          {t('subOrgLearners.terminate.hardDescription')}
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="suborg-terminate-mode"
                          checked={terminateMode === 'SOFT'}
                          onChange={() => setTerminateMode('SOFT')}
                          className="mt-0.5"
                        />
                        <span className="text-xs text-gray-700">
                          <strong>{t('subOrgLearners.terminate.softLabel')}</strong>{' '}
                          {t('subOrgLearners.terminate.softDescription')}
                        </span>
                      </label>

                      {terminateMode === 'SOFT' && (
                        <div className="ms-6 mt-1 flex flex-col gap-1.5">
                          <p className="text-2xs font-medium text-gray-600">
                            {t('subOrgLearners.terminate.lastAccessDateLabel')}
                          </p>
                          <input
                            type="date"
                            value={terminateAccessTillDate}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setTerminateAccessTillDate(e.target.value)}
                            className="w-fit rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 focus:border-primary-300 focus:outline-none"
                          />
                          {!terminateAccessTillDate && (
                            <p className="text-3xs text-red-500">
                              {t('subOrgLearners.terminate.pickDateHint')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <AlertDialogFooter className="gap-2 sm:gap-0">
                      <AlertDialogCancel disabled={isTerminating} className="mt-0">
                        {t('common.cancel')}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleTerminateMembers}
                        disabled={
                          isTerminating ||
                          (terminateMode === 'SOFT' && !terminateAccessTillDate)
                        }
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        {isTerminating ? (
                          <>
                            <SpinnerGap className="w-4 h-4 me-2 animate-spin" />
                            {terminateMode === 'SOFT'
                              ? t('subOrgLearners.terminate.schedulingLabel')
                              : t('subOrgLearners.terminate.terminatingLabel')}
                          </>
                        ) : terminateMode === 'SOFT' ? (
                          t('subOrgLearners.terminate.softLabel')
                        ) : (
                          t('subOrgLearners.terminate.hardLabel')
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
              <span className="ms-3 text-gray-600">{t('subOrgLearners.table.loading')}</span>
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {t('subOrgLearners.table.emptyTitle')}
              </h3>
              <p className="text-gray-600">
                {t('subOrgLearners.table.emptyDescription', { batch: batchLower })}
              </p>
            </div>
          ) : (
            (() => {
              // Fields to hide from the table
              const hiddenFields = new Set([
                'Practice Name'
              ]);

              // Extract unique custom field names from all members to build dynamic columns
              const customFieldColumns: { field_name: string; field_key: string }[] = [];
              const seenFieldKeys = new Set<string>();

              members.forEach(member => {
                if (member.custom_fields) {
                  member.custom_fields.forEach(cf => {
                    // Skip hidden fields
                    if (hiddenFields.has(cf.field_name)) return;

                    if (!seenFieldKeys.has(cf.field_key)) {
                      seenFieldKeys.add(cf.field_key);
                      customFieldColumns.push({
                        field_name: cf.field_name,
                        field_key: cf.field_key
                      });
                    }
                  });
                }
              });

              // Sort columns: name/First Name first, email second, phone third, then others
              customFieldColumns.sort((a, b) => {
                const getOrder = (fieldName: string): number => {
                  const nameLower = fieldName.toLowerCase();
                  if (nameLower === 'name' || nameLower === 'first name' || nameLower === 'full name') return 0;
                  if (nameLower === 'last name') return 1;
                  if (nameLower === 'email') return 2;
                  if (nameLower === 'phone' || nameLower === 'phone type') return 3;
                  if (nameLower === 'city') return 4;
                  if (nameLower === 'state') return 5;
                  if (nameLower.includes('zip') || nameLower.includes('postal')) return 6;
                  if (nameLower === 'country') return 7;
                  if (nameLower === 'job title') return 8;
                  return 999;
                };
                return getOrder(a.field_name) - getOrder(b.field_name);
              });

              // Helper function to get custom field value for a member
              // Falls back to user object data when custom field value is null
              const getCustomFieldValue = (member: StudentMapping, fieldKey: string, fieldName: string): string => {
                const field = member.custom_fields?.find(cf => cf.field_key === fieldKey);
                
                // If custom field has a value, return it
                if (field?.field_value) {
                  return field.field_value;
                }
                
                // Fall back to user object data based on field name/key
                const user = member.user as any;
                if (!user) return '-';
                
                const fieldNameLower = fieldName.toLowerCase();
                const fieldKeyLower = fieldKey.toLowerCase();
                
                // Map field names to user object properties
                if (fieldNameLower === 'name' || fieldNameLower === 'full name') {
                  return user.full_name || '-';
                }
                if (fieldNameLower === 'first name') {
                  // Extract first name from full_name
                  const fullName = user.full_name || '';
                  return fullName.split(' ')[0] || '-';
                }
                if (fieldNameLower === 'last name') {
                  // Extract last name from full_name
                  const fullName = user.full_name || '';
                  const parts = fullName.split(' ');
                  return parts.length > 1 ? parts.slice(1).join(' ') : '-';
                }
                if (fieldNameLower === 'email' || fieldKeyLower === 'email') {
                  return user.email || '-';
                }
                if (fieldNameLower === 'phone' || fieldKeyLower === 'phone' || fieldNameLower.includes('mobile')) {
                  return user.mobile_number || '-';
                }
                if (fieldNameLower === 'city' || fieldKeyLower.includes('city')) {
                  return user.city || '-';
                }
                if (fieldNameLower.includes('zip') || fieldNameLower.includes('postal') || fieldKeyLower.includes('zip') || fieldKeyLower.includes('postal')) {
                  return user.pin_code || '-';
                }
                if (fieldNameLower === 'state' || fieldKeyLower.includes('state')) {
                  return user.region || '-';
                }
                if (fieldNameLower === 'country' || fieldKeyLower.includes('country')) {
                  return user.country || '-';
                }
                if (fieldNameLower === 'address' || fieldKeyLower.includes('address')) {
                  return user.address_line || '-';
                }
                
                return '-';
              };

              return (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 sticky start-0 bg-white z-10">
                          <Checkbox
                            checked={selectedMembers.length === members.length && members.length > 0}
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                        {/* Dynamic columns from custom fields */}
                        {customFieldColumns.map((col) => (
                          <TableHead key={col.field_key} className="whitespace-nowrap">
                            {capitalizeFieldName(col.field_name)}
                          </TableHead>
                        ))}
                        <TableHead className="sticky end-0 bg-white z-10">
                          {t('subOrgLearners.table.statusColumn')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className="sticky start-0 bg-white z-10">
                            <Checkbox
                              checked={selectedMembers.includes(member.user_id)}
                              onCheckedChange={(checked) => handleSelectMember(member.user_id, checked as boolean)}
                            />
                          </TableCell>
                          {/* Dynamic cells from custom fields */}
                          {customFieldColumns.map((col) => (
                            <TableCell key={`${member.id}-${col.field_key}`} className="whitespace-nowrap">
                              {getCustomFieldValue(member, col.field_key, col.field_name)}
                            </TableCell>
                          ))}
                          <TableCell className="sticky end-0 bg-white z-10">
                            <Badge className={getStatusColor(member.status)}>
                              {member.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          )}
        </CardContent>
      </Card>

      {/* Bulk Upload Modal */}
      <BulkUploadModal
        isOpen={isBulkUploadOpen}
        onOpenChange={setIsBulkUploadOpen}
        adminMappings={adminMappings}
        selectedPackageSession={selectedPackageSession}
        instituteCustomFields={instituteCustomFields}
        onUploadComplete={loadMembers}
      />
    </div>
  );
}
