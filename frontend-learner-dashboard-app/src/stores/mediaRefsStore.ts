import { create } from 'zustand';

interface MediaRefsStore {
  currentPdfPage: number;
  currentYoutubeTime: number;
  currentUploadedVideoTime: number;
  navigationTrigger: number;
  /** Pauses whichever video player is on screen; null when none is. */
  pauseActiveMedia: (() => void) | null;
  setPauseActiveMedia: (pause: (() => void) | null) => void;
  // Media length/duration variables
  currentYoutubeVideoLength: number;
  currentPdfLength: number;
  currentCustomVideoLength: number;
  setCurrentPdfPage: (page: number) => void;
  setCurrentYoutubeTime: (time: number) => void;
  setCurrentUploadedVideoTime: (time: number) => void;
  navigateToPdfPage: (page: number) => void;
  // Setters for media lengths
  setCurrentYoutubeVideoLength: (length: number) => void;
  setCurrentPdfLength: (length: number) => void;
  setCurrentCustomVideoLength: (length: number) => void;
}

export const useMediaRefsStore = create<MediaRefsStore>((set) => ({
  // State values
  currentPdfPage: 0,
  currentYoutubeTime: 0,
  currentUploadedVideoTime: 0,
  navigationTrigger: 0,
  pauseActiveMedia: null,
  // Media length/duration values
  currentYoutubeVideoLength: 0,
  currentPdfLength: 0,
  currentCustomVideoLength: 0,

  // Setters
  setPauseActiveMedia: (pause) => set({ pauseActiveMedia: pause }),
  setCurrentPdfPage: (page: number) => set({ currentPdfPage: page }),
  setCurrentYoutubeTime: (time: number) => set({ currentYoutubeTime: time }),
  setCurrentUploadedVideoTime: (time: number) => set({ currentUploadedVideoTime: time }),
  navigateToPdfPage: (page: number) => set((state) => ({ 
    currentPdfPage: page, 
    navigationTrigger: state.navigationTrigger + 1 
  })),
  // Setters for media lengths
  setCurrentYoutubeVideoLength: (length: number) => set({ currentYoutubeVideoLength: length }),
  setCurrentPdfLength: (length: number) => set({ currentPdfLength: length }),
  setCurrentCustomVideoLength: (length: number) => set({ currentCustomVideoLength: length }),
})); 