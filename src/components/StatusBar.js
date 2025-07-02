import React from 'react';
import './StatusBar.css';

const StatusBar = ({ selectedFile, isTranscribing, progress }) => {
  const getStatusText = () => {
    if (isTranscribing) {
      return `Transcribing... ${Math.round(progress)}%`;
    }
    if (selectedFile) {
      return `File loaded: ${selectedFile.name}`;
    }
    return 'Ready - Select an audio file to begin';
  };

  const getStatusIcon = () => {
    if (isTranscribing) {
      return (
        <div className="status-spinner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
      );
    }
    if (selectedFile) {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    }
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
        <path d="M12 16v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getPlatformInfo = () => {
    if (window.platform) {
      if (window.platform.isMac) return 'macOS';
      if (window.platform.isWindows) return 'Windows';
      if (window.platform.isLinux) return 'Linux';
    }
    return 'Unknown';
  };

  return (
    <footer className="status-bar">
      <div className="status-section">
        <div className="status-indicator">
          {getStatusIcon()}
        </div>
        <span className="status-text">{getStatusText()}</span>
      </div>
      
      <div className="info-section">
        {selectedFile && (
          <>
            <span className="file-size">{formatFileSize(selectedFile.size)}</span>
            <span className="separator">•</span>
          </>
        )}
        <span className="platform">{getPlatformInfo()}</span>
        {window.env?.isDev && (
          <>
            <span className="separator">•</span>
            <span className="dev-mode">DEV</span>
          </>
        )}
      </div>
    </footer>
  );
};

export default StatusBar;