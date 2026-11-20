import React from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';
import { RealtimeProvider } from './context/RealtimeContext';
import NotificationToast from './components/NotificationToast';
import { AppRoutes } from './routes/AppRoutes';

// Detect Electron environment (set by preload via contextBridge, or by user-agent)
const isElectron =
  (typeof window !== 'undefined' && window.electronAPI?.isElectron === true) ||
  (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron'));

// In Electron (file:// protocol), BrowserRouter's HTML5 history doesn't work on
// deep routes. HashRouter (#/path) works perfectly with file:// loading.
// On web, BrowserRouter is used as before.
const Router = isElectron ? HashRouter : BrowserRouter;


class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('GlobalErrorBoundary caught runtime error:', error, errorInfo);
    this.setState({ errorInfo });

    const msg = String(error?.message || error || '');
    const isChunkError =
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Expected a JavaScript-or-Wasm module script') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('error loading dynamically imported module') ||
      msg.includes('Loading chunk') ||
      msg.includes('MIME type');

    if (isChunkError && typeof window !== 'undefined') {
      const key = 'ams_global_chunk_reload';
      const last = sessionStorage.getItem(key);
      const now = Date.now();
      if (!last || now - parseInt(last, 10) > 15000) {
        sessionStorage.setItem(key, String(now));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const msg = String(this.state.error?.message || this.state.error || '');
      const isChunkError =
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Expected a JavaScript-or-Wasm module script') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('error loading dynamically imported module') ||
        msg.includes('Loading chunk') ||
        msg.includes('MIME type');

      return (
        <div className="min-h-screen bg-slate-900 text-white p-6 sm:p-10 font-mono">
          <div className="max-w-3xl mx-auto bg-slate-800/90 border border-rose-500/50 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400 pb-3 border-b border-slate-700">
              <span className="text-lg font-bold">
                {isChunkError ? '🔄 Update Available' : '⚠️ Application Error'}
              </span>
            </div>
            <div className="text-rose-300 font-semibold text-sm">
              {isChunkError
                ? 'A new version of the application was deployed. Please reload to load the latest updates.'
                : this.state.error?.toString()}
            </div>
            {this.state.errorInfo?.componentStack && !isChunkError && (
              <pre className="text-xs text-slate-300 bg-slate-950 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap border border-slate-800">
                {this.state.errorInfo.componentStack}
              </pre>
            )}
            <button
              onClick={() => {
                sessionStorage.clear();
                window.location.reload();
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-bold rounded-xl transition cursor-pointer"
            >
              {isChunkError ? 'Refresh to Update' : 'Reload Page'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { theme, isDark } = useTheme();

  return (
    <div className={`min-h-screen ${isDark ? 'dark bg-[#0b1322] text-slate-100' : 'light bg-[#f8fafc] text-[#001D51]'} transition-colors duration-200`}>
      <AppRoutes />
      <NotificationToast />
    </div>
  );
}

export default function App() {
  return (
    <GlobalErrorBoundary>
      <ThemeProvider>
        <Router>
          <AuthProvider>
            <RealtimeProvider>
              <NotificationProvider>
                <AppContent />
              </NotificationProvider>
            </RealtimeProvider>
          </AuthProvider>
        </Router>
      </ThemeProvider>
    </GlobalErrorBoundary>
  );
}
