import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AccountGate } from './components/AccountGate';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles.css';
import './theme/minimal-ui.css';
import './theme/accounts.css';
class ErrorBoundary extends React.Component<{
    children: React.ReactNode;
}, {
    error: string;
}> {
    state = { error: '' };
    static getDerivedStateFromError(error: Error) { return { error: error.message }; }
    render() { return this.state.error ? <main className="fatal-error"><h1>The reader encountered an error.</h1><p>{this.state.error}</p><p>Your saved library has not been intentionally cleared. Reload to recover; keep external backups.</p><button onClick={() => location.reload()}>Reload reader</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><ErrorBoundary><AccountGate><App /></AccountGate></ErrorBoundary></ThemeProvider>);
