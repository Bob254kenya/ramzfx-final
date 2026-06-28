import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';
import { setupDiagnostics } from './utils/diagnostics';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Set up diagnostics for crash monitoring
setupDiagnostics();

// Register Service Worker for PWA
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    // Notify user about update (optional)
    console.log('New version available!');
    // You can dispatch a custom event here for your app to show an update notification
    window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: { registration } }));
  },
  onSuccess: (registration) => {
    console.log('PWA installed successfully!');
  },
});

// Removed AnalyticsInitializer() call - analytics dependency removed

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);