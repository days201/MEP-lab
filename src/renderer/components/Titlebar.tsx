import { Minus, Square, X, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

export function Titlebar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  return (
    <div
      className={`h-10 bg-background-secondary border-b border-border flex items-center titlebar-drag shrink-0 ${
        isMac ? 'justify-start pl-20' : 'justify-end'
      }`}
    >
      {/* macOS: Traffic lights are positioned by trafficLightPosition, we just need left padding */}

      {/* Window Controls (for Windows/Linux - macOS uses native traffic lights) */}
      {!isMac && (
        <div className="flex items-center titlebar-no-drag h-full">
          <button
            onClick={handleMinimize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-all duration-150"
            title={t('window.minimize')}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-all duration-150"
            title={isMaximized ? t('window.restore') : t('window.maximize')}
          >
            {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClose}
            className="w-12 h-full flex items-center justify-center hover:bg-[#e81123] text-text-secondary hover:text-white transition-all duration-150"
            title={t('window.close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
