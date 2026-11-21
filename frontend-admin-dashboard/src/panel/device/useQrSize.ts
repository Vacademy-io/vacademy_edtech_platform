import { useEffect, useState } from 'react';

function measure(): number {
    return Math.max(200, Math.min(Math.round(window.innerHeight * 0.45), 480));
}

/** A QR readable across a room, that still fits a 540 px tall TV. */
export function useQrSize(): number {
    const [size, setSize] = useState(measure);
    useEffect(() => {
        const update = () => setSize(measure());
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);
    return size;
}
