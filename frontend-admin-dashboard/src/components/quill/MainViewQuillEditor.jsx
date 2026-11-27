import katex from 'katex';
window.katex = katex;
import 'katex/dist/katex.css';

import ReactQuill, { Quill } from 'react-quill';
import 'react-quill/dist/quill.snow.css';

// NOTE: jQuery is loaded from CDN in index.html BEFORE bundles load
// This ensures MathQuill can find window.jQuery when it initializes

import '@edtr-io/mathquill/build/mathquill.js';
import '@edtr-io/mathquill/build/mathquill.css';

import mathquill4quill from 'mathquill4quill';
import 'mathquill4quill/mathquill4quill.css';
import './index.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_OPERATORS } from './Operators';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

// Function to resize an image to 300x300 px
const resizeImage = (file, callback) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Set the canvas size to 300x300
            canvas.width = 200;
            canvas.height = 200;

            // Draw the image onto the canvas
            ctx.drawImage(img, 0, 0, 200, 200);

            // Convert canvas back to base64
            const resizedImage = canvas.toDataURL('image/png');
            callback(resizedImage);
        };
    };
};

// Custom Image Handler for Quill Editor
const imageHandler = function () {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (file) {
            resizeImage(file, (resizedImage) => {
                const quill = this.quill;
                const range = quill.getSelection();
                quill.insertEmbed(range.index, 'image', resizedImage);
            });
        }
    };
};

export const MainViewQuillEditor = ({
    value,
    onChange,
    onBlur,
    CustomclasssName = '',
    placeholder = '',
    minHeight = 80,
}) => {
    const reactQuillRef = useRef(null);
    const mathQuillInitialized = useRef(false);
    const mediaRecorderRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const [isRecording, setIsRecording] = useState(false);
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        if (!mathQuillInitialized.current) {
            try {
                const enableMathQuillFormulaAuthoring = mathquill4quill({ Quill, katex });
                const quill = reactQuillRef.current?.getEditor();
                if (quill) {
                    enableMathQuillFormulaAuthoring(quill, { operators: ALL_OPERATORS });
                    mathQuillInitialized.current = true;
                }
            } catch (err) {
                // If mathquill4quill is incompatible (e.g., with Quill v2), continue without it
                console.warn('MathQuill integration unavailable:', err);
                mathQuillInitialized.current = true;
            }
        }
    }, []);

    // Ensure client-only rendering to avoid SSR fallback <pre>
    useEffect(() => {
        setIsClient(true);
    }, []);

    // Removed event listener suppression to avoid interfering with Quill internals

    useEffect(() => {
        const styleElement = document.createElement('style');
        styleElement.innerHTML = `
            .ql-action::after {
                content: 'Insert' !important;
                color: white !important;
            }
            /* Custom toolbar button labels */
            .ql-attach::before {
                content: 'File';
            }
            .ql-recordAudio::before {
                content: 'Audio';
            }
        `;
        document.head.appendChild(styleElement);

        return () => {
            document.head.removeChild(styleElement);
        };
    }, []);

    // Cleanup any active media stream on unmount
    useEffect(() => {
        return () => {
            try {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    mediaRecorderRef.current.stop();
                }
            } catch (_) {
                /* ignore */
            }
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((t) => t.stop());
            }
        };
    }, []);

    const getInstituteAndUser = () => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const data = getTokenDecodedData(accessToken);
        const INSTITUTE_ID =
            data && data.authorities ? Object.keys(data.authorities)[0] : undefined;
        const USER_ID = (data && (data.userId || data.sub || data.id)) || 'your-user-id';
        return { INSTITUTE_ID, USER_ID };
    };

    const insertHtmlAtCursor = (html) => {
        const quill = reactQuillRef.current?.getEditor();
        if (!quill) return;
        const range = quill.getSelection(true);
        const index = range ? range.index : quill.getLength();
        const beforeLen = quill.getLength();
        quill.clipboard.dangerouslyPasteHTML(index, html, 'user');
        const afterLen = quill.getLength();
        const inserted = Math.max(0, afterLen - beforeLen);
        const nextIndex = Math.min(index + inserted, quill.getLength());
        // Defer selection update to avoid addRange errors during DOM mutation
        setTimeout(() => {
            try {
                if (document && quill && quill.root && document.body.contains(quill.root)) {
                    quill.setSelection(nextIndex, 0, 'user');
                }
            } catch (_) {
                // ignore selection errors
            }
        }, 0);
    };

    const uploadAndInsertFile = async (file) => {
        try {
            const quill = reactQuillRef.current?.getEditor();
            if (!quill || !file) return;
            const { INSTITUTE_ID, USER_ID } = getInstituteAndUser();

            const fileId = await UploadFileInS3(
                file,
                () => { },
                USER_ID,
                INSTITUTE_ID,
                'STUDENTS',
                true
            );
            const publicUrl = await getPublicUrl(fileId);

            if (!publicUrl) return;

            const range = quill.getSelection(true) || { index: quill.getLength() };

            if (file.type?.startsWith('image/')) {
                quill.insertEmbed(range.index, 'image', publicUrl, 'user');
                const nextIndex = Math.min(range.index + 1, quill.getLength());
                setTimeout(() => {
                    try {
                        quill.setSelection(nextIndex, 0, 'user');
                    } catch (err) {
                        // no-op
                    }
                }, 0);
                return;
            }

            if (file.type?.startsWith('audio/')) {
                insertHtmlAtCursor(
                    `<audio controls src="${publicUrl}" style="outline:none; width: 100%;"></audio>`
                );
                return;
            }

            if (file.type?.startsWith('video/')) {
                insertHtmlAtCursor(
                    `<video controls src="${publicUrl}" style="max-width:100%; height:auto;"></video>`
                );
                return;
            }

            // Fallback: insert as a link
            const safeName = (file.name || 'file').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            insertHtmlAtCursor(
                `<a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a>`
            );
        } catch (error) {
            console.error('Failed to upload/insert file:', error);
        }
    };

    // Custom File Handler (any file)
    const fileHandler = function () {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', '*/*');
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (file) {
                await uploadAndInsertFile(file);
            }
        };
        input.click();
    };

    // Audio recording handler using MediaRecorder API
    const recordAudioHandler = async function () {
        try {
            if (!isRecording) {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    console.error('Audio recording is not supported in this browser.');
                    return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : MediaRecorder.isTypeSupported('audio/mp4')
                        ? 'audio/mp4'
                        : '';
                const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
                recordedChunksRef.current = [];
                recorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
                };
                recorder.onstop = async () => {
                    try {
                        const blob = new Blob(recordedChunksRef.current, {
                            type: recorder.mimeType || 'audio/webm',
                        });
                        const fileExt = blob.type.includes('mp4') ? 'm4a' : 'webm';
                        const file = new File([blob], `recording_${Date.now()}.${fileExt}`, {
                            type: blob.type,
                        });
                        await uploadAndInsertFile(file);
                    } catch (err) {
                        console.error('Failed to process recorded audio:', err);
                    } finally {
                        if (mediaStreamRef.current) {
                            mediaStreamRef.current.getTracks().forEach((t) => t.stop());
                        }
                        mediaRecorderRef.current = null;
                        mediaStreamRef.current = null;
                        setIsRecording(false);
                    }
                };
                mediaRecorderRef.current = recorder;
                mediaStreamRef.current = stream;
                recorder.start();
                setIsRecording(true);
            } else {
                // Stop recording
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    mediaRecorderRef.current.stop();
                }
            }
        } catch (error) {
            console.error('Audio recording error:', error);
            try {
                if (mediaStreamRef.current) {
                    mediaStreamRef.current.getTracks().forEach((t) => t.stop());
                }
            } catch (_) {
                /* ignore */
            }
            setIsRecording(false);
        }
    };

    // `modules` must keep one identity for the editor's lifetime. react-quill 2.0.0 rebuilds
    // the editor when `modules` changes (deep-compared, functions by reference), and that
    // rebuild leaves an empty <pre> with no editor in it: rebuilt here on every render, every
    // field of the assessment preview came up blank once its form reset. The toolbar handlers
    // go through a ref so they still see this render's state (isRecording).
    const toolbarHandlersRef = useRef({ attach: fileHandler, recordAudio: recordAudioHandler });
    toolbarHandlersRef.current = { attach: fileHandler, recordAudio: recordAudioHandler };
    const rightBarmodules = useMemo(
        () => ({
            toolbar: {
                container: [
                    ['bold', 'italic', 'underline'],
                    [{ align: [] }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    ['formula'], // Formula button
                    ['image'], // Image button
                    ['attach', 'recordAudio'], // Custom buttons
                ],
                handlers: {
                    image: imageHandler, // Custom image handler
                    attach: function (...args) {
                        return toolbarHandlersRef.current.attach.apply(this, args);
                    },
                    recordAudio: function (...args) {
                        return toolbarHandlersRef.current.recordAudio.apply(this, args);
                    },
                },
            },
            formula: true,
        }),
        []
    );

    if (!isClient) {
        return <div className={CustomclasssName} />;
    }

    return (
        <ReactQuill
            ref={reactQuillRef}
            modules={rightBarmodules}
            theme="snow"
            value={value || ''}
            onChange={onChange}
            onBlur={onBlur}
            preserveWhitespace={true}
            className={`${CustomclasssName} custom-quill-min`}
            placeholder={placeholder}
            style={{ minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight }}
        />
    );
};
