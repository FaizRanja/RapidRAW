import { ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, Monitor } from 'lucide-react';

interface TauriGuardProps {
  children: ReactNode;
}

export default function TauriGuard({ children }: TauriGuardProps) {
  const [isTauri, setIsTauri] = useState(true);

  // Bypass Tauri check for web migration
  return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg-primary text-text-primary p-8 text-center space-y-6">
      <div className="bg-surface p-8 rounded-xl border border-surface-border shadow-2xl max-w-md">
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-red-500/10 rounded-full text-red-500">
            <AlertTriangle size={48} />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-2">Desktop Environment Required</h1>
        <p className="text-text-secondary mb-6">
          RapidRAW relies on native desktop features and cannot run in a standard web browser.
        </p>

        <div className="bg-bg-primary p-4 rounded-lg text-left mb-6 font-mono text-sm border border-surface-border">
          <p className="text-text-secondary mb-2">Please start the app using:</p>
          <div className="flex items-center gap-2 text-accent">
            <span className="select-all">$ npm run start</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
          <Monitor size={14} />
          <span>Launches Tauri Desktop App</span>
        </div>
      </div>
    </div>
  );
}
