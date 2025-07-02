import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import './Header.css';

const Header = ({ version, onOpenSettings }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  const [apiKeyStatus, setApiKeyStatus] = useState('checking');
  const [showApiKeyInfo, setShowApiKeyInfo] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    checkApiKeyStatus();
  }, []);

  const checkApiKeyStatus = async () => {
    setIsTestingConnection(true);
    setTestResult(null);
    
    try {
      // Check if we're in Electron environment
      if (window.electronAPI && window.electronAPI.whisper) {
        // First check if API key is already configured
        const checkResult = await window.electronAPI.invoke('whisper-check-api-key');
        
        if (checkResult.configured) {
          setApiKeyStatus(checkResult.valid ? 'valid' : 'invalid');
          setTestResult({
            success: checkResult.valid,
            message: checkResult.valid ? 'Connection successful!' : (checkResult.error || 'Connection failed')
          });
        } else {
          // No API key configured
          setApiKeyStatus('invalid');
          setTestResult({
            success: false,
            message: 'No API key configured. Please add your OpenAI API key to the .env file.'
          });
        }
      } else {
        // Browser environment - API key not accessible
        setApiKeyStatus('browser-mode');
        setTestResult({
          success: false,
          message: 'API key testing is only available in the Electron app'
        });
      }
    } catch (error) {
      console.error('Failed to check API key status:', error);
      setApiKeyStatus('invalid');
      setTestResult({
        success: false,
        message: error.message || 'Connection test failed'
      });
    } finally {
      setIsTestingConnection(false);
      // Clear test result after 3 seconds
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const getApiKeyStatusIcon = () => {
    if (isTestingConnection) {
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="spinning">
          <circle cx="12" cy="12" r="10" fill="#6b7280" stroke="currentColor" strokeWidth="2"/>
          <path d="M12 6v6l4 2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    }
    
    switch (apiKeyStatus) {
      case 'valid':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="#10b981" stroke="currentColor" strokeWidth="2"/>
            <path d="m9 12 2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'invalid':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="#ef4444" stroke="currentColor" strokeWidth="2"/>
            <path d="m15 9-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="m9 9 6 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'browser-mode':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="#6b7280" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 6v6l4 2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
    }
  };

  const getApiKeyStatusText = () => {
    if (isTestingConnection) {
      return 'Testing Connection...';
    }
    
    switch (apiKeyStatus) {
      case 'valid':
        return 'OpenAI API Connected';
      case 'invalid':
        return 'API Key Required';
      case 'browser-mode':
        return 'Browser Mode - Limited Features';
      default:
        return 'Checking API...';
    }
  };

  return (
    <header className="app-header titlebar-drag">
      <div className="header-content">
        <div className="header-main">
          <div className="app-title">
            <h1>WhisperTranscript</h1>
            {version && <span className="version">v{version}</span>}
          </div>
          <div className="header-subtitle">
            Audio transcription powered by OpenAI Whisper
          </div>
        </div>
        <div className="header-actions">
          <div 
            className="api-status-indicator titlebar-no-drag"
            onClick={() => setShowApiKeyInfo(!showApiKeyInfo)}
            title={getApiKeyStatusText()}
          >
            {getApiKeyStatusIcon()}
            <span className="api-status-text">{getApiKeyStatusText()}</span>
            {showApiKeyInfo && (
               <>
                 <div 
                   className="tooltip-backdrop"
                   onClick={() => setShowApiKeyInfo(false)}
                 />
                 <div className="api-key-info-tooltip">
                   <div className="tooltip-content">
                     <h4>API Key Configuration</h4>
                     <p>
                       {apiKeyStatus === 'valid' 
                         ? 'Your OpenAI API key is configured and working properly.' 
                         : apiKeyStatus === 'browser-mode'
                         ? 'You are running in browser mode. For full functionality including API key management, please use the Electron desktop app.'
                         : 'To use Whisper transcription, add your OpenAI API key to the .env file:'}
                     </p>
                     {apiKeyStatus === 'invalid' && (
                       <>
                         <code>OPENAI_API_KEY=your_api_key_here</code>
                         <p className="tooltip-note">
                           Get your API key from: <br/>
                           <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                             https://platform.openai.com/api-keys
                           </a>
                         </p>
                       </>
                     )}
                     {testResult && (
                       <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                         {testResult.message}
                       </div>
                     )}
                     {apiKeyStatus !== 'browser-mode' && (
                       <button 
                         className="test-connection-btn"
                         onClick={(e) => {
                           e.stopPropagation();
                           checkApiKeyStatus();
                         }}
                         disabled={isTestingConnection}
                       >
                         {isTestingConnection ? 'Testing...' : 'Test Connection'}
                       </button>
                     )}
                   </div>
                 </div>
               </>
             )}
          </div>
          <button 
            className="settings-btn titlebar-no-drag focus-visible"
            onClick={onOpenSettings}
            aria-label="Open Settings"
            title="Settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              <path d="m12 1 1.27 3.18a9 9 0 0 1 2.73.73l2.91-1.46 1.41 1.41-1.46 2.91a9 9 0 0 1 .73 2.73L23 12l-3.18 1.27a9 9 0 0 1-.73 2.73l1.46 2.91-1.41 1.41-2.91-1.46a9 9 0 0 1-2.73.73L12 23l-1.27-3.18a9 9 0 0 1-2.73-.73l-2.91 1.46-1.41-1.41 1.46-2.91a9 9 0 0 1-.73-2.73L1 12l3.18-1.27a9 9 0 0 1 .73-2.73L3.45 5.09l1.41-1.41L7.77 5.14a9 9 0 0 1 2.73-.73L12 1Z" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
          <button 
            className="theme-toggle-btn titlebar-no-drag focus-visible"
            onClick={toggleTheme}
            aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
          >
            {isDarkMode ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/>
                <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2"/>
                <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2"/>
                <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2"/>
                <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="2"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;