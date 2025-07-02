import React, { useState, useEffect } from 'react';
import './Settings.css';
import ModelDownloadManager from './ModelDownloadManager';

const Settings = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [transcriptionMode, setTranscriptionMode] = useState('cloud');
  const [localServiceStatus, setLocalServiceStatus] = useState('unknown');
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('base');
  const [isCheckingLocalService, setIsCheckingLocalService] = useState(false);
  const [showModelManager, setShowModelManager] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkCurrentApiKey();
      loadSettings();
      checkLocalServiceStatus();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      // Load saved transcription mode
      const savedMode = localStorage.getItem('transcriptionMode') || 'cloud';
      setTranscriptionMode(savedMode);
      
      // Load saved model selection
      const savedModel = localStorage.getItem('selectedModel') || 'base';
      setSelectedModel(savedModel);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const checkLocalServiceStatus = async () => {
    if (!window.electronAPI?.whisper?.local) return;
    
    setIsCheckingLocalService(true);
    try {
      const status = await window.electronAPI.whisper.local.getStatus();
      setLocalServiceStatus(status.isRunning ? 'running' : 'stopped');
      
      if (status.isRunning) {
        // Get available models if service is running
        const models = await window.electronAPI.whisper.local.getAvailableModels();
        if (models.success) {
          setAvailableModels(models.models || []);
        }
      }
    } catch (error) {
      console.error('Error checking local service status:', error);
      setLocalServiceStatus('error');
    } finally {
      setIsCheckingLocalService(false);
    }
  };

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

  const handleModeChange = async (mode) => {
    try {
      setTranscriptionMode(mode);
      localStorage.setItem('transcriptionMode', mode);
      
      // If switching to local mode, ensure service is available
      if (mode === 'local') {
        await checkLocalServiceStatus();
      }
    } catch (error) {
      console.error('Error changing transcription mode:', error);
    }
  };

  const handleStartLocalService = async () => {
    if (!window.electronAPI?.whisper?.local) return;
    
    setIsCheckingLocalService(true);
    try {
      const result = await window.electronAPI.whisper.local.startService();
      if (result.success) {
        setLocalServiceStatus('running');
        // Refresh available models
        setTimeout(() => checkLocalServiceStatus(), 2000);
      } else {
        setLocalServiceStatus('error');
      }
    } catch (error) {
      console.error('Error starting local service:', error);
      setLocalServiceStatus('error');
    } finally {
      setIsCheckingLocalService(false);
    }
  };

  const handleStopLocalService = async () => {
    if (!window.electronAPI?.whisper?.local) return;
    
    setIsCheckingLocalService(true);
    try {
      const result = await window.electronAPI.whisper.local.stopService();
      if (result.success) {
        setLocalServiceStatus('stopped');
        setAvailableModels([]);
      }
    } catch (error) {
      console.error('Error stopping local service:', error);
    } finally {
      setIsCheckingLocalService(false);
    }
  };

  const handleModelChange = async (model) => {
    try {
      setSelectedModel(model);
      localStorage.setItem('selectedModel', model);
      
      // If local service is running, change the model
      if (localServiceStatus === 'running' && window.electronAPI?.whisper?.local) {
        const result = await window.electronAPI.whisper.local.changeModel(model);
        if (!result.success) {
          console.error('Failed to change model:', result.error);
        }
      }
    } catch (error) {
      console.error('Error changing model:', error);
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
          <button className="close-btn" onClick={onClose} type="button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/>
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>

        <div className="settings-content">
          <h2>Settings</h2>
          
          <div className="setting-section">
            <h3>Transcription Mode</h3>
            <p className="setting-description">
              Choose between cloud-based transcription using OpenAI's API or local transcription using your own hardware.
            </p>
            
            <div className="mode-selector">
              <div className="mode-options">
                <label className={`mode-option ${transcriptionMode === 'cloud' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="transcriptionMode"
                    value="cloud"
                    checked={transcriptionMode === 'cloud'}
                    onChange={(e) => handleModeChange(e.target.value)}
                  />
                  <div className="mode-content">
                    <div className="mode-icon">☁️</div>
                    <div className="mode-info">
                      <div className="mode-title">Cloud</div>
                      <div className="mode-desc">Fast, accurate transcription via OpenAI API</div>
                    </div>
                  </div>
                </label>
                
                <label className={`mode-option ${transcriptionMode === 'local' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="transcriptionMode"
                    value="local"
                    checked={transcriptionMode === 'local'}
                    onChange={(e) => handleModeChange(e.target.value)}
                  />
                  <div className="mode-content">
                    <div className="mode-icon">🖥️</div>
                    <div className="mode-info">
                      <div className="mode-title">Local</div>
                      <div className="mode-desc">Private transcription on your device</div>
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {transcriptionMode === 'local' && (
            <div className="setting-section">
              <h3>Local Service Management</h3>
              <p className="setting-description">
                Manage the local Whisper transcription service running on your device.
              </p>
              
              <div className="service-status">
                <div className="status-info">
                  <span className="status-label">Service Status:</span>
                  <span className={`status-badge ${localServiceStatus}`}>
                    {localServiceStatus === 'running' && '🟢 Running'}
                    {localServiceStatus === 'stopped' && '🔴 Stopped'}
                    {localServiceStatus === 'error' && '⚠️ Error'}
                    {localServiceStatus === 'unknown' && '❓ Unknown'}
                  </span>
                </div>
                
                <div className="service-actions">
                  {localServiceStatus === 'stopped' && (
                    <button
                      className="btn-primary"
                      onClick={handleStartLocalService}
                      disabled={isCheckingLocalService}
                    >
                      {isCheckingLocalService ? 'Starting...' : 'Start Service'}
                    </button>
                  )}
                  
                  {localServiceStatus === 'running' && (
                    <button
                      className="btn-secondary"
                      onClick={handleStopLocalService}
                      disabled={isCheckingLocalService}
                    >
                      {isCheckingLocalService ? 'Stopping...' : 'Stop Service'}
                    </button>
                  )}
                  
                  <button
                    className="btn-secondary"
                    onClick={checkLocalServiceStatus}
                    disabled={isCheckingLocalService}
                  >
                    {isCheckingLocalService ? 'Checking...' : 'Refresh Status'}
                  </button>
                </div>
              </div>
              
              {localServiceStatus === 'running' && availableModels.length > 0 && (
                <div className="model-selection">
                  <h4>Model Selection</h4>
                  <p className="setting-description">
                    Choose the Whisper model to use for transcription. Larger models are more accurate but slower.
                  </p>
                  
                  <select
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="model-select"
                  >
                    {availableModels.map(model => (
                      <option key={model} value={model}>
                        {model} {model === 'tiny' ? '(Fastest)' : model === 'base' ? '(Balanced)' : model === 'large' ? '(Most Accurate)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              
              <div className="model-management">
                <h4>Model Management</h4>
                <p className="setting-description">
                  Download, manage, and verify Whisper models for local transcription.
                </p>
                
                <button
                  className="btn-secondary"
                  onClick={() => setShowModelManager(true)}
                >
                  Manage Models
                </button>
              </div>
            </div>
          )}

          {transcriptionMode === 'cloud' && (
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
          )}
        </div>
      </div>
      
      {showModelManager && (
        <ModelDownloadManager
          isOpen={showModelManager}
          onClose={() => setShowModelManager(false)}
        />
      )}
    </div>
  );
};

export default Settings;