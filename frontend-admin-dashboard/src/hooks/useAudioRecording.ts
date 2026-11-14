import { useState, useRef, useCallback } from 'react';
import { createRealtimeConnection, RealtimeTranscript } from '@/services/assemblyai';

interface AudioRecordingState {
    isRecording: boolean;
    isPaused: boolean;
    recordingTime: number;
    audioBlob: Blob | null;
    audioUrl: string | null;
    transcripts: Array<{ text: string; isFinal: boolean; timestamp: number }>;
    error: string | null;
}

export function useAudioRecording() {
    const [state, setState] = useState<AudioRecordingState>({
        isRecording: false,
        isPaused: false,
        recordingTime: 0,
        audioBlob: null,
        audioUrl: null,
        transcripts: [],
        error: null,
    });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);

    // Convert Float32Array to Int16Array (for AssemblyAI format)
    const convertFloat32ToInt16 = useCallback((buffer: Float32Array): Int16Array => {
        const int16Buffer = new Int16Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
            const s = Math.max(-1, Math.min(1, buffer[i]!));
            int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return int16Buffer;
    }, []);

    const startRecording = useCallback(async () => {
        try {
            setState((prev) => ({ ...prev, error: null, transcripts: [] }));

            // Get user media
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Setup MediaRecorder for recording audio
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
                const audioUrl = URL.createObjectURL(audioBlob);

                setState((prev) => ({
                    ...prev,
                    audioBlob,
                    audioUrl,
                    isRecording: false,
                }));
            };

            // Setup WebSocket for real-time transcription
            const ws = await createRealtimeConnection(
                (transcript: RealtimeTranscript) => {
                    if (transcript.message_type === 'PartialTranscript' && transcript.text) {
                        setState((prev) => ({
                            ...prev,
                            transcripts: [
                                ...prev.transcripts.filter((t) => t.isFinal),
                                { text: transcript.text!, isFinal: false, timestamp: Date.now() },
                            ],
                        }));
                    } else if (transcript.message_type === 'FinalTranscript' && transcript.text) {
                        setState((prev) => ({
                            ...prev,
                            transcripts: [
                                ...prev.transcripts.filter((t) => t.isFinal),
                                { text: transcript.text!, isFinal: true, timestamp: Date.now() },
                            ],
                        }));
                    }
                },
                (error) => {
                    console.error('WebSocket error:', error);
                    setState((prev) => ({
                        ...prev,
                        error: 'Real-time transcription error',
                    }));
                }
            );

            wsRef.current = ws;

            // Setup AudioContext for sending audio data to WebSocket
            audioContextRef.current = new AudioContext({ sampleRate: 16000 });
            const source = audioContextRef.current.createMediaStreamSource(stream);
            processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

            processorRef.current.onaudioprocess = (e) => {
                if (ws.readyState === WebSocket.OPEN) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const int16Data = convertFloat32ToInt16(inputData);
                    ws.send(int16Data.buffer as ArrayBuffer);
                }
            };

            source.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current.destination);

            // Start recording
            mediaRecorder.start();

            // Start timer
            const startTime = Date.now();
            timerRef.current = setInterval(() => {
                setState((prev) => ({
                    ...prev,
                    recordingTime: Math.floor((Date.now() - startTime) / 1000),
                }));
            }, 1000);

            setState((prev) => ({
                ...prev,
                isRecording: true,
                isPaused: false,
                recordingTime: 0,
            }));
        } catch (error) {
            console.error('Error starting recording:', error);
            setState((prev) => ({
                ...prev,
                error: 'Failed to start recording. Please check microphone permissions.',
            }));
        }
    }, [convertFloat32ToInt16]);

    const stopRecording = useCallback(() => {
        // Stop MediaRecorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        // Stop all tracks
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
        }

        // Close WebSocket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.close();
        }

        // Stop AudioContext
        if (processorRef.current) {
            processorRef.current.disconnect();
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }

        // Clear timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }

        setState((prev) => ({
            ...prev,
            isRecording: false,
            isPaused: false,
        }));
    }, []);

    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.pause();
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
            setState((prev) => ({ ...prev, isPaused: true }));
        }
    }, []);

    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
            mediaRecorderRef.current.resume();
            const pausedTime = state.recordingTime;
            const startTime = Date.now() - pausedTime * 1000;
            timerRef.current = setInterval(() => {
                setState((prev) => ({
                    ...prev,
                    recordingTime: Math.floor((Date.now() - startTime) / 1000),
                }));
            }, 1000);
            setState((prev) => ({ ...prev, isPaused: false }));
        }
    }, [state.recordingTime]);

    const resetRecording = useCallback(() => {
        stopRecording();
        setState({
            isRecording: false,
            isPaused: false,
            recordingTime: 0,
            audioBlob: null,
            audioUrl: null,
            transcripts: [],
            error: null,
        });
    }, [stopRecording]);

    return {
        ...state,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        resetRecording,
    };
}
