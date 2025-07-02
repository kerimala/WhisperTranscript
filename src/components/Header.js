import React from 'react';
import './Header.css';

const Header = ({ version }) => {
  return (
    <header className="app-header titlebar-drag">
      <div className="header-content">
        <div className="app-title">
          <h1>WhisperTranscript</h1>
          {version && <span className="version">v{version}</span>}
        </div>
        <div className="header-subtitle">
          Audio transcription powered by OpenAI Whisper
        </div>
      </div>
    </header>
  );
};

export default Header;