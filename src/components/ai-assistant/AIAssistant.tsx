import { useEffect, useRef } from 'react';

/**
 * Mounts the beginner AI assistant chat widget (loaded from /ai-widget.js in
 * the public folder) once, on app load. Mirrors the pattern used by
 * useLiveChat.ts for the existing live chat widget.
 *
 * Usage: render <AIAssistant /> once near the root of the app (see App.tsx).
 */
const WIDGET_SCRIPT_ID = 'ramzfx-ai-assistant-script';

// TODO: replace with your actual deployed backend URL
const API_URL = 'https://trading-ai-backend-lfqx.vercel.app/api/ask';
const PLATFORM_NAME = 'RamzFX';

const AIAssistant = () => {
    const injected = useRef(false);

    useEffect(() => {
        if (injected.current) return;
        if (document.getElementById(WIDGET_SCRIPT_ID)) return;

        const script = document.createElement('script');
        script.id = WIDGET_SCRIPT_ID;
        script.src = '/ai-widget.js';
        script.setAttribute('data-api-url', API_URL);
        script.setAttribute('data-platform-name', PLATFORM_NAME);
        script.async = true;
        document.body.appendChild(script);
        injected.current = true;

        return () => {
            // Intentionally not removing on unmount — this component is
            // meant to stay mounted for the app's lifetime (root-level).
        };
    }, []);

    return null;
};

export default AIAssistant;
