import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { TagInput } from '@/components/ui/tag-input';
import { Image as ImageIcon } from 'lucide-react';

interface CourseMetadata {
    courseName?: string;
    courseDescription?: string;
    mediaImageUrl?: string;
    tags?: string[];
    [key: string]: any;
}

interface MetadataDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    metadata: CourseMetadata | null;
    onSave: (metadata: CourseMetadata) => void;
}

export const MetadataDialog: React.FC<MetadataDialogProps> = ({
    open,
    onOpenChange,
    metadata,
    onSave,
}) => {
    const { t } = useTranslation('studyLibraryMetadataDialog');
    const [courseName, setCourseName] = useState('');
    const [courseDescription, setCourseDescription] = useState('');
    const [tags, setTags] = useState<string[]>([]);

    useEffect(() => {
        if (metadata) {
            setCourseName(metadata.courseName || '');
            setCourseDescription(metadata.courseDescription || '');
            setTags(metadata.tags || []);
        }
    }, [metadata, open]);

    const handleSave = () => {
        onSave({
            ...metadata,
            courseName,
            courseDescription,
            tags,
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:w-full sm:max-w-lg max-h-[90vh] flex flex-col p-0 sm:p-6">
                <DialogHeader>
                    <DialogTitle>{t('courseDetails')}</DialogTitle>
                    <DialogDescription>
                        {t('editYourCourseMetadata')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-4">
                    {/* Course Thumbnail Preview */}
                    {metadata?.mediaImageUrl && (
                        <div>
                            <Label className="mb-2 block">{t('courseThumbnail')}</Label>
                            <div className="relative aspect-video rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200">
                                <img
                                    src={metadata.mediaImageUrl}
                                    alt={t('courseThumbnailAlt')}
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        </div>
                    )}

                    {/* Course Name */}
                    <div>
                        <Label htmlFor="courseName" className="mb-2 block">
                            {t('courseName')}
                        </Label>
                        <Input
                            id="courseName"
                            value={courseName}
                            onChange={(e) => setCourseName(e.target.value)}
                            placeholder={t('enterCourseName')}
                        />
                    </div>

                    {/* Course Description */}
                    <div>
                        <Label htmlFor="courseDescription" className="mb-2 block">
                            {t('courseDescription')}
                        </Label>
                        <Textarea
                            id="courseDescription"
                            value={courseDescription}
                            onChange={(e) => setCourseDescription(e.target.value)}
                            placeholder={t('enterCourseDescription')}
                            className="min-h-[100px]"
                        />
                    </div>

                    {/* Tags */}
                    <div>
                        <Label className="mb-2 block">{t('tags')}</Label>
                        <TagInput
                            tags={tags}
                            onChange={setTags}
                            placeholder={t('addTags')}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                        {t('cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" onClick={handleSave}>
                        {t('saveChanges')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
