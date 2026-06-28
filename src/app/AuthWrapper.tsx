import App from './App';
import PWAUpdateNotification from '../components/PWAUpdateNotification';

export const AuthWrapper = () => {
    return (
        <>
            <App />
            <PWAUpdateNotification />
        </>
    );
};