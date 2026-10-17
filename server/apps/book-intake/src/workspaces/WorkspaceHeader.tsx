import { OMLogo, ThemeToggle } from '../components/Brand';
import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { AccountControls } from '../components/AccountGate';
import { currentAccount } from '../lib/backend';
export type Navigate = (path: string) => void;
export function WorkspaceHeader({ active, navigate, trailing }: { active: 'library' | 'preparation'; navigate: Navigate; trailing?: ReactNode }) {
    return <header className="workspace-header"><button className="workspace-brand" onClick={() => navigate('/library')}><OMLogo/><span><strong>OM DAILY READING</strong><small>Orthodox Metrics</small></span></button>
        <nav className="workspace-nav" aria-label="Main workspaces"><button aria-current={active === 'library' ? 'page' : undefined} onClick={() => navigate('/library')}><Icon name="book" size={17}/>Library</button>{currentAccount?.role!=='reader'&&<button aria-current={active === 'preparation' ? 'page' : undefined} onClick={() => navigate('/preparation')}><Icon name="scan" size={17}/>Book Preparation</button>}</nav>
        <div className="workspace-header-end"><ThemeToggle/>{trailing}<AccountControls/></div></header>;
}
