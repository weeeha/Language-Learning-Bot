import { useState } from 'react';
import Sessions from './tabs/Sessions';
import Workspace from './tabs/Workspace';

export default function App() {
  const [tab, setTab] = useState<'sessions' | 'workspace'>('sessions');
  return (
    <>
      <div className="screen">{tab === 'sessions' ? <Sessions /> : <Workspace />}</div>
      <nav className="tabbar" role="tablist">
        <button role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</button>
        <button role="tab" aria-selected={tab === 'workspace'} onClick={() => setTab('workspace')}>Workspace</button>
      </nav>
    </>
  );
}
