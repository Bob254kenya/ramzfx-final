import React, { useEffect } from 'react';

export default function ChunkLoader({ message }: { message: string }) {
    // Dismiss the HTML splash screen as soon as React is ready to render
    useEffect(() => {
        if (typeof window.__dismissSplash === 'function') {
            window.__dismissSplash();
        }
    }, []);

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100vw',
                height: '100vh',
                background: '#0a0a0a',
                gap: '16px',
            }}
        >
            <div
                style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    border: '4px solid rgba(79,195,247,0.15)',
                    borderTop: '4px solid #4FC3F7',
                    borderRight: '4px solid #f44336',
                    animation: 'chunkSpin 1s linear infinite',
                }}
            />
            {message ? (
                <span style={{ color: '#4FC3F7', fontSize: '14px', opacity: 0.7 }}>
                    {message}
                </span>
            ) : null}
            <style>{`@keyframes chunkSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

declare global {
    interface Window {
        __dismissSplash?: () => void;
    }
}
