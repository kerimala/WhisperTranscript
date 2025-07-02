import React, { useState, useEffect } from 'react';
import './Settings.css';

const Settings = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkCurrentApiKey();
    }
  }, [isOpen]);

  const checkCurrentApiKey = async () => {
    try {
      const status = await window.electronAPI.whisper.checkApiKeyStatus();
      if (status.configured) {
        setValidationStatus(status.valid ? 'valid' : 'invalid');
      } else {
        setValidationStatus(null);
      }
    } catch (error) {
      console.error('Error checking API key status:', error);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setValidationStatus('empty');
      return;
    }

    setIsValidating(true);
    setValidationStatus(null);

    try {
      const result = await window.electronAPI.whisper.setApiKey(apiKey.trim());
      if (result.success && result.valid) {
        setValidationStatus('valid');
        setApiKey('');
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setValidationStatus('invalid');
      }
    } catch (error) {
      console.error('Error setting API key:', error);
      setValidationStatus('error');
    } finally {
      setIsValidating(false);
    }
  };

  const handleTestConnection = async () => {
    setIsValidating(true);
    try {
      const result = await window.electronAPI.whisper.testConnection();
      setValidationStatus(result.success ? 'valid' : 'invalid');
    } catch (error) {
      console.error('Error testing connection:', error);
      setValidationStatus('error');
    } finally {
      setIsValidating(false);
    }
  };

  const getStatusMessage = () => {
    switch (validationStatus) {
      case 'valid':
        return { text: 'API key is valid and working!', type: 'success' };
      case 'invalid':
        return { text: 'Invalid API key. Please check and try again.', type: 'error' };
      case 'empty':
        return { text: 'Please enter an API key.', type: 'error' };
      case 'error':
        return { text: 'Error validating API key. Please try again.', type: 'error' };
      default:
        return null;
    }
  };

  const statusMessage = getStatusMessage();

  if (!isOpen) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/>
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>

        <div className="settings-content">
          <div className="setting-section">
            <h3>OpenAI API Configuration</h3>
            <p className="setting-description">
              Enter your OpenAI API key to enable transcription. You can get your API key from the{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                OpenAI Platform
              </a>.
            </p>

            <div className="api-key-input-group">
              <div className="input-wrapper">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="api-key-input"
                  disabled={isValidating}
                />
                <button
                  type="button"
                  className="toggle-visibility-btn"
                  onClick={() => setShowApiKey(!showApiKey)}
                  title={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>

              <div className="api-key-actions">
                <button
                  className="btn-primary"
                  onClick={handleSaveApiKey}
                  disabled={isValidating || !apiKey.trim()}
                >
                  {isValidating ? 'Validating...' : 'Save API Key'}
                </button>
                
                {validationStatus === 'valid' && (
                  <button
                    className="btn-secondary"
                    onClick={handleTestConnection}
                    disabled={isValidating}
                  >
                    {isValidating ? 'Testing...' : 'Test Connection'}
                  </button>
                )}
              </div>
            </div>

            {statusMessage && (
              <div className={`status-message ${statusMessage.type}`}>
                {statusMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;