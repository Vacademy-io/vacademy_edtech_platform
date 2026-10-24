import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UploadSimple, DownloadSimple, FileXls, CheckCircle, XCircle, WarningCircle, SpinnerGap } from '@phosphor-icons/react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';
import { AdminMappings, InstituteCustomField, AddMemberRequest, addMember } from '@/services/sub-organization-learner-management';

// Members uploaded here are always staff. The backend models staff as the LEARNER
// org-role, so every row is sent as LEARNER — the sheet no longer carries a role column.
const STAFF_ORG_ROLE = 'LEARNER';

interface BulkUploadModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  adminMappings: AdminMappings[];
  selectedPackageSession: string;
  instituteCustomFields: InstituteCustomField[];
  onUploadComplete: () => void;
}

interface UploadResult {
  rowNumber: number;
  email: string;
  fullName: string;
  status: 'success' | 'error' | 'pending';
  message: string;
}

export function BulkUploadModal({
  isOpen,
  onOpenChange,
  adminMappings,
  selectedPackageSession,
  instituteCustomFields,
  onUploadComplete,
}: BulkUploadModalProps) {
  const { t } = useTranslation('registrationB');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [processedRows, setProcessedRows] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getSelectedMapping = () => {
    return adminMappings.find(m => m.package_session_id === selectedPackageSession);
  };

  // Generate sample Excel file based on custom fields
  const downloadSampleSheet = () => {
    const headers: string[] = [];
    const sampleRow: string[] = [];

    // Build headers from custom fields (excluding Practice Name which is auto-filled)
    const fieldsToInclude = instituteCustomFields.filter(
      field => field.custom_field.fieldName !== 'Practice Name'
    );

    // Helper to match field names case-insensitively
    const matchesFieldName = (fieldName: string, targets: string[]) => {
      return targets.some(t => fieldName.toLowerCase() === t.toLowerCase());
    };

    // Helper to capitalize first letter of each word
    const capitalizeFieldName = (name: string): string => {
      return name
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    // Sort fields by formOrder
    const sortedFields = [...fieldsToInclude].sort(
      (a, b) => (a.custom_field.formOrder || 0) - (b.custom_field.formOrder || 0)
    );

    sortedFields.forEach(field => {
      const { fieldName, fieldType, isMandatory, config } = field.custom_field;
      const displayName = capitalizeFieldName(fieldName);
      const headerText = isMandatory ? `${displayName}*` : displayName;
      headers.push(headerText);

      // Add sample data based on field name/type (case-insensitive)
      const fieldNameLower = fieldName.toLowerCase();
      if (matchesFieldName(fieldName, ['first name', 'firstname'])) {
        sampleRow.push('John');
      } else if (matchesFieldName(fieldName, ['last name', 'lastname'])) {
        sampleRow.push('Doe');
      } else if (matchesFieldName(fieldName, ['name', 'full name', 'fullname'])) {
        sampleRow.push('John Doe');
      } else if (matchesFieldName(fieldName, ['email'])) {
        sampleRow.push('john.doe@example.com');
      } else if (matchesFieldName(fieldName, ['phone', 'mobile', 'mobile_number'])) {
        sampleRow.push('+61412345678');
      } else if (fieldNameLower.includes('moodle username')) {
        sampleRow.push('johndoe');
      } else if (fieldNameLower.includes('moodle password')) {
        sampleRow.push('password123');
      } else if (fieldType === 'dropdown' && config) {
        try {
          const options = JSON.parse(config);
          sampleRow.push(options[0]?.value || '');
        } catch {
          sampleRow.push('');
        }
      } else if (fieldType === 'number') {
        sampleRow.push('123');
      } else {
        sampleRow.push('Sample Value');
      }
    });

    // Create workbook and worksheet
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);

    // Set column widths
    const colWidths = headers.map(h => ({ wch: Math.max(h.length + 2, 15) }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Staff');

    // Download the file
    XLSX.writeFile(wb, 'staff_bulk_upload_template.xlsx');
    toast.success(t('subOrgLearners.bulkUpload.toast.templateDownloaded'));
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePhoneNumber = (phone: string): boolean => {
    if (!phone) return true; // Phone is optional
    const cleanPhone = phone.replace(/[\s\-\.\(\)]/g, '');
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    return phoneRegex.test(cleanPhone);
  };

  const parseFile = async (file: File): Promise<Record<string, string>[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // Convert to JSON with header row
          const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, {
            raw: false,
            defval: '',
          });

          resolve(jsonData);
        } catch (error) {
          reject(
            new Error(t('subOrgLearners.bulkUpload.toast.parseFailed'))
          );
        }
      };

      reader.onerror = () =>
        reject(new Error(t('subOrgLearners.bulkUpload.toast.readFailed')));
      reader.readAsBinaryString(file);
    });
  };

  const mapRowToMemberData = (row: Record<string, string>): AddMemberRequest | null => {
    const selectedMapping = getSelectedMapping();
    if (!selectedMapping) return null;

    // Helper to match field names case-insensitively
    const matchesFieldName = (fieldName: string, targets: string[]) => {
      return targets.some(t => fieldName.toLowerCase() === t.toLowerCase());
    };

    // Helper to capitalize first letter of each word (for matching capitalized headers)
    const capitalizeFieldName = (name: string): string => {
      return name
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    // Helper to find value in row by field name
    // Checks multiple variations: original, capitalized, with/without * suffix
    const getRowValue = (fieldName: string): string => {
      const capitalizedName = capitalizeFieldName(fieldName);
      const variations = [
        fieldName,
        `${fieldName}*`,
        capitalizedName,
        `${capitalizedName}*`,
        fieldName.toLowerCase(),
        `${fieldName.toLowerCase()}*`,
      ];
      
      for (const variation of variations) {
        if (row[variation] !== undefined && row[variation] !== '') {
          return row[variation].toString().trim();
        }
      }
      return '';
    };

    // Map custom field values from the row
    const customFieldValues: Array<{ custom_field_id: string; value: string }> = [];
    let fullName = '';
    let firstName = '';
    let lastName = '';
    let email = '';
    let phone = '';

    // Find fields by their header names (which might have * suffix for mandatory)
    const fieldsToInclude = instituteCustomFields.filter(
      field => field.custom_field.fieldName !== 'Practice Name'
    );

    fieldsToInclude.forEach(field => {
      const { fieldName, id } = field.custom_field;
      const fieldNameLower = fieldName.toLowerCase();
      
      // Try to find the value in the row (with or without * suffix)
      let value = getRowValue(fieldName);

      // Map to standard fields based on field name (case-insensitive)
      if (matchesFieldName(fieldName, ['name', 'full name', 'fullname'])) {
        fullName = value;
      } else if (matchesFieldName(fieldName, ['first name', 'firstname'])) {
        firstName = value;
      } else if (matchesFieldName(fieldName, ['last name', 'lastname'])) {
        lastName = value;
      } else if (matchesFieldName(fieldName, ['email'])) {
        email = value;
      } else if (matchesFieldName(fieldName, ['phone', 'mobile', 'mobile_number']) && !fieldNameLower.includes('type')) {
        phone = value;
        // Ensure phone starts with +
        if (phone && !phone.startsWith('+')) {
          phone = `+${phone}`;
        }
      }

      // Add to custom field values if we have a value
      if (value) {
        customFieldValues.push({
          custom_field_id: id,
          value: value,
        });
      }
    });

    // Build full name from first + last if not provided directly
    if (!fullName && (firstName || lastName)) {
      fullName = `${firstName} ${lastName}`.trim();
    }

    // Also add Practice Name to custom fields
    const practiceNameField = instituteCustomFields.find(
      f => f.custom_field.fieldName === 'Practice Name'
    );
    if (practiceNameField && selectedMapping.sub_org_details?.institute_name) {
      customFieldValues.push({
        custom_field_id: practiceNameField.custom_field.id,
        value: selectedMapping.sub_org_details.institute_name,
      });
    }

    // Validation
    if (!email || !fullName) {
      return null;
    }

    if (!validateEmail(email)) {
      return null;
    }

    if (phone && !validatePhoneNumber(phone)) {
      return null;
    }

    return {
      user: {
        email,
        mobile_number: phone || undefined,
        full_name: fullName,
        username: undefined,
      },
      package_session_id: selectedPackageSession,
      sub_org_id: selectedMapping.sub_org_id,
      institute_id: selectedMapping.institute_id,
      status: 'ACTIVE',
      comma_separated_org_roles: STAFF_ORG_ROLE,
      custom_field_values: customFieldValues.length > 0 ? customFieldValues : undefined,
    };
  };

  const processUpload = async (rows: Record<string, string>[]) => {
    setIsUploading(true);
    setTotalRows(rows.length);
    setProcessedRows(0);
    setUploadResults([]);

    const results: UploadResult[] = [];

    // Helper to get value from row with multiple possible header names
    const getRowValueMultiple = (row: Record<string, string>, names: string[]): string => {
      for (const name of names) {
        const val = row[name] || row[`${name}*`];
        if (val) return val.toString().trim();
      }
      return '';
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

      // Extract email and name for result tracking (case-insensitive)
      const unknownValue = t('subOrgLearners.bulkUpload.unknownValue');
      const email = getRowValueMultiple(row, ['Email', 'email']) || unknownValue;
      const firstName = getRowValueMultiple(row, ['First Name', 'first name', 'FirstName', 'firstname']);
      const lastName = getRowValueMultiple(row, ['Last Name', 'last name', 'LastName', 'lastname']);
      const nameField = getRowValueMultiple(row, ['name', 'Name', 'full name', 'Full Name', 'fullname', 'FullName']);
      const fullName = nameField || `${firstName} ${lastName}`.trim() || unknownValue;

      try {
        const memberData = mapRowToMemberData(row);

        if (!memberData) {
          results.push({
            rowNumber,
            email,
            fullName,
            status: 'error',
            message: t('subOrgLearners.bulkUpload.result.invalidData'),
          });
          continue;
        }

        // Call the API
        await addMember(memberData);

        results.push({
          rowNumber,
          email,
          fullName,
          status: 'success',
          message: t('subOrgLearners.bulkUpload.result.success'),
        });
      } catch (error: unknown) {
        const errorMessage =
          (error as { response?: { data?: { ex?: string; message?: string } } })?.response?.data?.ex ||
          (error as { response?: { data?: { ex?: string; message?: string } } })?.response?.data?.message ||
          t('subOrgLearners.addStaff.toast.addFailed');
        
        results.push({
          rowNumber,
          email,
          fullName,
          status: 'error',
          message: errorMessage,
        });
      }

      setProcessedRows(i + 1);
      setUploadProgress(((i + 1) / rows.length) * 100);
      setUploadResults([...results]);

      // Small delay between API calls to avoid overwhelming the server
      if (i < rows.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    setIsUploading(false);
    
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    if (successCount > 0) {
      toast.success(
        t('subOrgLearners.bulkUpload.toast.addedSuccess', { count: successCount })
      );
      onUploadComplete();
    }

    if (errorCount > 0) {
      toast.error(
        t('subOrgLearners.bulkUpload.toast.addedFailedCount', { count: errorCount })
      );
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await processFile(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Shared file processing logic
  const processFile = async (file: File) => {
    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    
    if (!validTypes.includes(file.type) && !['xlsx', 'xls', 'csv'].includes(fileExtension || '')) {
      toast.error(t('subOrgLearners.bulkUpload.toast.invalidFileType'));
      return;
    }

    try {
      const rows = await parseFile(file);

      if (rows.length === 0) {
        toast.error(t('subOrgLearners.bulkUpload.toast.emptyFile'));
        return;
      }

      await processUpload(rows);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('subOrgLearners.bulkUpload.toast.processFailed')
      );
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isUploading) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      await processFile(file);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setUploadResults([]);
      setUploadProgress(0);
      setProcessedRows(0);
      setTotalRows(0);
      onOpenChange(false);
    }
  };

  const successCount = uploadResults.filter(r => r.status === 'success').length;
  const errorCount = uploadResults.filter(r => r.status === 'error').length;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl w-vw-95 max-h-screen-80 overflow-hidden flex flex-col top-1/2 translate-y-[-50%]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileXls className="w-5 h-5" />
            {t('subOrgLearners.bulkUpload.dialogTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-2">
          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
            <h4 className="font-medium text-blue-900 text-sm">
              {t('subOrgLearners.bulkUpload.instructionsTitle')}
            </h4>
            <ol className="text-xs text-blue-800 list-decimal list-inside space-y-0.5">
              <li>{t('subOrgLearners.bulkUpload.steps.step1')}</li>
              <li>{t('subOrgLearners.bulkUpload.steps.step2')}</li>
              <li>{t('subOrgLearners.bulkUpload.steps.step3')}</li>
              <li>{t('subOrgLearners.bulkUpload.steps.step4')}</li>
            </ol>
          </div>

          {/* Download Template Button */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-stack">
            <Button variant="outline" size="sm" onClick={downloadSampleSheet} className="w-full sm:w-auto">
              <DownloadSimple className="w-4 h-4 me-2" />
              {t('subOrgLearners.bulkUpload.downloadButton')}
            </Button>
            <p className="text-xs text-gray-500">
              {t('subOrgLearners.bulkUpload.downloadHint')}
            </p>
          </div>

          {/* File Upload */}
          <div 
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
              isDragging 
                ? 'border-primary-500 bg-primary-50' 
                : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
            
            {isUploading ? (
              <div className="space-y-3">
                <SpinnerGap className="w-8 h-8 text-primary-500 mx-auto animate-spin" />
                <p className="text-gray-600 text-sm">
                  {t('subOrgLearners.bulkUpload.processingLabel', {
                    processed: processedRows,
                    total: totalRows,
                  })}
                </p>
                <Progress value={uploadProgress} className="w-full" />
              </div>
            ) : isDragging ? (
              <div className="py-4 space-y-2">
                <UploadSimple className="w-10 h-10 text-primary-500 mx-auto" />
                <p className="text-primary-600 font-medium">
                  {t('subOrgLearners.bulkUpload.dropHere')}
                </p>
              </div>
            ) : (
              <>
                <UploadSimple className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600 text-sm mb-2">
                  {t('subOrgLearners.bulkUpload.dragDropPrompt')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('subOrgLearners.bulkUpload.browseButton')}
                </Button>
                <p className="text-xs text-gray-500 mt-2">
                  {t('subOrgLearners.bulkUpload.supportsHint')}
                </p>
              </>
            )}
          </div>

          {/* Upload Results */}
          {uploadResults.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-gray-900 text-sm">
                  {t('subOrgLearners.bulkUpload.resultsTitle')}
                </h4>
                <div className="flex gap-2">
                  {successCount > 0 && (
                    <Badge variant="default" className="bg-green-100 text-green-800">
                      <CheckCircle className="w-3 h-3 me-1" />
                      {t('subOrgLearners.bulkUpload.resultsSuccessBadge', { count: successCount })}
                    </Badge>
                  )}
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="bg-red-100 text-red-800">
                      <XCircle className="w-3 h-3 me-1" />
                      {t('subOrgLearners.bulkUpload.resultsFailedBadge', { count: errorCount })}
                    </Badge>
                  )}
                </div>
              </div>

              <ScrollArea className="h-40 border rounded-lg">
                <div className="p-2 space-y-1.5">
                  {uploadResults.map((result, index) => (
                    <div
                      key={index}
                      className={`flex items-start gap-2 p-2 rounded-lg ${
                        result.status === 'success'
                          ? 'bg-green-50 border border-green-200'
                          : 'bg-red-50 border border-red-200'
                      }`}
                    >
                      {result.status === 'success' ? (
                        <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <WarningCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm">
                          {t('subOrgLearners.bulkUpload.resultRowLabel', {
                            rowNumber: result.rowNumber,
                            fullName: result.fullName,
                          })}
                        </p>
                        <p className="text-xs text-gray-600 truncate">{result.email}</p>
                        <p
                          className={`text-xs ${
                            result.status === 'success' ? 'text-green-700' : 'text-red-700'
                          }`}
                        >
                          {result.message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            {uploadResults.length > 0
              ? t('subOrgLearners.bulkUpload.closeButton')
              : t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

