import React, { useState, useEffect } from 'react';

export default function ChunkLoader({ message }: { message: string }) {
    const [progress, setProgress] = useState(0);
    const [currentMessage, setCurrentMessage] = useState('Initializing...');
    const [dots, setDots] = useState('');

    const CONFIG = {
        totalSteps: 100,
        stepDuration: 50, // 5 seconds total
        messages: [
            'Connecting to market...',
            'Analyzing trends...',
            'Loading strategies...',
            'Syncing data...',
            'Preparing charts...',
            'Connecting to server...',
            'Loading dashboard...',
            'Almost ready...'
        ]
    };

    useEffect(() => {
        let progressVal = 0;
        let dotsInterval: NodeJS.Timeout;

        const updateProgress = () => {
            progressVal += 2;
            if (progressVal >= 100) {
                progressVal = 100;
            }

            setProgress(Math.floor(progressVal));

            // Update message based on progress
            const msgIndex = Math.floor((progressVal / 100) * CONFIG.messages.length);
            if (msgIndex < CONFIG.messages.length) {
                setCurrentMessage(CONFIG.messages[Math.min(msgIndex, CONFIG.messages.length - 1)]);
            }

            if (progressVal < 100) {
                setTimeout(updateProgress, CONFIG.stepDuration);
            }
        };

        updateProgress();

        // Animate dots
        let dotCount = 0;
        dotsInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            setDots('.'.repeat(dotCount));
        }, 400);

        return () => clearInterval(dotsInterval);
    }, []);

    return (
        <div className="app-root">
            {/* ===== TRADING WORDS BACKGROUND ===== */}
            <div className="trading-bg">
                <div className="trading-word">📈 BUY</div>
                <div className="trading-word">📊 SELL</div>
                <div className="trading-word">💰 PROFIT</div>
                <div className="trading-word">📉 TRADE</div>
                <div className="trading-word">⚡ BULLISH</div>
                <div className="trading-word">📈 FOREX</div>
                <div className="trading-word">💹 STOCKS</div>
                <div className="trading-word">📊 CRYPTO</div>
                <div className="trading-word">🎯 TARGET</div>
                <div className="trading-word">📈 GAIN</div>
                <div className="trading-word right">🔽 BEARISH</div>
                <div className="trading-word right">📊 INDEX</div>
                <div className="trading-word right">💎 DIAMOND</div>
                <div className="trading-word right">📈 BULL</div>
                <div className="trading-word right">📉 BEAR</div>
                <div className="trading-word right">⚡ MOMENTUM</div>
                <div className="trading-word right">💰 WEALTH</div>
                <div className="trading-word right">📊 ANALYSIS</div>
            </div>

            {/* ===== LOADER ===== */}
            <div className="loader-container">
                {/* Glow Effect */}
                <div className="glow"></div>

                {/* Brand */}
                <div className="brand">
                    <div className="brand-icon">R</div>
                    <div className="brand-name">RamzFX</div>
                    <div className="brand-sub">Trading Bot</div>
                </div>

                {/* Spinner */}
                <div className="spinner-wrapper">
                    <div className="spinner"></div>
                </div>

                {/* Progress Bar */}
                <div className="progress-wrapper">
                    <div className="progress-track">
                        <div 
                            className="progress-fill" 
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                    <div className="progress-label">
                        <span>{currentMessage}</span>
                        <span className="progress-percent">{progress}%</span>
                    </div>
                </div>

                {/* Message */}
                <div className="message">
                    <span className="highlight">RamzFX</span> is getting ready{dots}
                </div>
            </div>
        </div>
    );
}