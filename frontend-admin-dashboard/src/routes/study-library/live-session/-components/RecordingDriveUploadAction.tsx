// "Save to library" for Google Meet recordings. Meet saves recordings to the
// organiser's Google Drive; the server downloads the MP4 from Drive into the
// library (Drive access on the connected Google account is opt-in, since
// Google classes it as a restricted scope). When that access isn't granted —
// or Drive refuses — a dialog offers "Allow Google Drive access" and, as a
// fallback, a manual download-and-upload. Once saved (fileId set, storage S3)
// the recording behaves like any library recording — Add to course and
// Upload to YouTube work off the fileId.

import { useState } from 'react';
import { toast } from 'sonner';
import { CloudArrowDown, ArrowSquareOut, GoogleLogo } from '@phosphor-icons/react';

import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { UploadFileInS3 } from '@/services/upload_file';
import { initiateGoogleOAuth } from '@/services/google-accounts';

import {
    attachGoogleRecordingFile,
    saveGoogleRecordingToLibrary,
    type MeetingRecording,
} from '../-services/utils';
import { extractContentLinkErrorMessage } from '../-services/content-link-service';

interface Props {
    rec: MeetingRecording & { scheduleId: string };
    /** Receives the schedule's updated recording list once the file is saved. */
    onAttached: (scheduleId: string, recordings: MeetingRecording[]) => void;
}

export function RecordingDriveUploadAction({ rec, onAttached }: Props) {
    const [isSaving, setIsSaving] = useState(false);
    const [open, setOpen] = useState(false);
    /** Why the automatic save didn't happen — shown at the top of the dialog. */
    const [reason, setReason] = useState<string | undefined>();
    const [needsDriveAccess, setNeedsDriveAccess] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    const driveUrl = rec.playbackUrl || rec.downloadUrl;

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const result = await saveGoogleRecordingToLibrary(rec.scheduleId);
            onAttached(rec.scheduleId, result.recordings ?? []);
            toast.success('Recording saved to library');
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            setNeedsDriveAccess(status === 412);
            setReason(
                extractContentLinkErrorMessage(err) ||
                    'Could not save the recording from Google Drive.'
            );
            setOpen(true);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAllowDriveAccess = async () => {
        setIsConnecting(true);
        try {
            const { oauth_url } = await initiateGoogleOAuth(true);
            window.location.href = oauth_url; // leave the SPA for Google's consent screen
        } catch {
            toast.error('Could not start Google sign-in. Please try again.');
            setIsConnecting(false);
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (isUploading) return; // don't abandon an upload mid-flight
        setOpen(next);
        if (!next) setFile(null);
    };

    const handleUpload = async () => {
        const instituteId = getInstituteId();
        if (!file || !instituteId) return;
        setIsUploading(true);
        try {
            const fileId = await UploadFileInS3(
                file,
                () => undefined,
                instituteId,
                'GOOGLE_MEET_RECORDING',
                rec.scheduleId,
                false
            );
            if (!fileId) throw new Error('Upload failed');
            const result = await attachGoogleRecordingFile(rec.scheduleId, rec.recordingId, fileId);
            onAttached(rec.scheduleId, result.recordings ?? []);
            toast.success('Recording saved to library');
            setOpen(false);
            setFile(null);
        } catch (err) {
            toast.error(
                extractContentLinkErrorMessage(err) ||
                    'Could not save the recording. Please try again.'
            );
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                title="Save this recording from Google Drive to the Vacademy library. Large recordings can take a few minutes."
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
                <CloudArrowDown className="size-3" />
                {isSaving ? 'Saving…' : 'Save to library'}
            </button>

            <MyDialog
                heading="Save recording to library"
                dialogWidth="max-w-md"
                open={open}
                onOpenChange={handleOpenChange}
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            onClick={() => handleOpenChange(false)}
                            disable={isUploading}
                        >
                            Cancel
                        </MyButton>
                        <MyButton onClick={handleUpload} disable={!file || isUploading}>
                            {isUploading ? 'Uploading…' : 'Upload'}
                        </MyButton>
                    </>
                }
            >
                <div className="space-y-4 text-sm">
                    {reason && <p className="text-muted-foreground">{reason}</p>}

                    {needsDriveAccess && (
                        <div className="space-y-2 rounded-md border p-3">
                            <div className="font-medium">Save automatically from Drive</div>
                            <p className="text-xs text-muted-foreground">
                                Sign in with the Google account that hosts the class and allow Drive
                                access. After that, Save to library works in one click.
                            </p>
                            <MyButton
                                buttonType="secondary"
                                onClick={handleAllowDriveAccess}
                                disable={isConnecting}
                            >
                                <GoogleLogo className="size-4" />
                                {isConnecting ? 'Opening Google…' : 'Allow Google Drive access'}
                            </MyButton>
                        </div>
                    )}

                    <div className="space-y-3">
                        <div className="font-medium">
                            {needsDriveAccess ? 'Or upload it yourself' : 'Upload it yourself'}
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs">1. Download the recording from Drive</div>
                            {driveUrl ? (
                                <a
                                    href={driveUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                >
                                    <ArrowSquareOut className="size-3" />
                                    Open in Google Drive
                                </a>
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    Find it in the organiser&apos;s Drive under &quot;Meet
                                    Recordings&quot;.
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs">2. Choose the downloaded MP4</div>
                            <input
                                type="file"
                                accept="video/*"
                                disabled={isUploading}
                                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                className="block w-full text-xs file:mr-3 file:rounded-md file:border file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium"
                            />
                            {file && (
                                <p className="text-xs text-muted-foreground">
                                    {file.name} · {Math.round(file.size / (1024 * 1024))} MB
                                </p>
                            )}
                        </div>
                        {isUploading && (
                            <p className="text-xs text-muted-foreground">
                                Uploading — large recordings can take a few minutes. Keep this tab
                                open.
                            </p>
                        )}
                    </div>
                </div>
            </MyDialog>
        </>
    );
}
