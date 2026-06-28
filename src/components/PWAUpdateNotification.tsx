import React, { useState, useEffect } from 'react';
import './PWAUpdateNotification.scss';

interface PWAUpdateNotificationProps {
  className?: string;
}

const PWAUpdateNotification: React.FC<PWAUpdateNotificationProps> = ({ className }) => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const customEvent = event as CustomEvent<{ registration: ServiceWorkerRegistration }>;
      const registration = customEvent.detail.registration;
      
      if (registration && registration.waiting) {
        setWaitingWorker(registration.waiting);
        setShowUpdate(true);
      }
    };

    window.addEventListener('pwa-update-available', handleUpdateAvailable);

    // Also listen for service worker updates directly
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setWaitingWorker(newWorker);
                setShowUpdate(true);
              }
            });
          }
        });
      });
    }

    // Listen for PWA install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for app installed event
    const handleAppInstalled = () => {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('pwa-update-available', handleUpdateAvailable);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      setShowUpdate(false);
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismissInstall = () => {
    setShowInstallPrompt(false);
  };

  return (
    <>
      {showUpdate && (
        <div className={className || 'pwa-update-notification'}>
          <div className="notification-content">
            <span className="notification-message">
              ✨ New version available! Update for the best experience.
            </span>
            <div className="notification-actions">
              <button onClick={handleUpdate} className="update-button">
                Update Now
              </button>
              <button onClick={handleDismiss} className="dismiss-button">
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {showInstallPrompt && (
        <div className="pwa-install-prompt">
          <div className="install-card">
            <div className="install-card-header">
              <div className="app-icon">
                <img src="/logo192.png" alt="RAMZFX" />
              </div>
              <div className="app-info">
                <h2>Install RAMZFX</h2>
                <p>Your ultimate trading hub</p>
              </div>
            </div>
            <div className="install-card-body">
              <ul className="install-features">
                <li>🚀 Fast and responsive</li>
                <li>📱 Works offline</li>
                <li>🎯 One-tap access</li>
              </ul>
            </div>
            <div className="install-card-footer">
              <button onClick={handleDismissInstall} className="cancel-install-button">
                Later
              </button>
              <button onClick={handleInstall} className="install-button">
                Install App
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PWAUpdateNotification;