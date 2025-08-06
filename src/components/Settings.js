import React, { useState, useEffect, useCallback } from 'react';
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
  const [hotkey, setHotkey] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [hotkeyStatus, setHotkeyStatus] = useState('');
  const [modeErrorMessage, setModeErrorMessage] = useState('');
  const [modeTroubleshootingTips, setModeTroubleshootingTips] = useState('');

  // New states for dependency management
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [isInstallingDependencies, setIsInstallingDependencies] = useState(false);
  const [installationProgress, setInstallationProgress] = useState({ stage: '', progress: 0, message: '' });
  const [installationResult, setInstallationResult] = useState(null);
  const [pythonEnvironments, setPythonEnvironments] = useState([]);
  const [selectedPythonPath, setSelectedPythonPath] = useState('');
  const [setupStatus, setSetupStatus] = useState(''); // 'checking', 'ready', 'needs_setup', 'error'

  const handleKeyDown = useCallback((e) => {
    e.preventDefault();
    
    const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta', 'Command'];
    if (modifierKeys.includes(e.key)) {
      return;
    }
    
    const modifiers = [];
    if (e.ctrlKey || e.metaKey) {
      modifiers.push('CommandOrControl');
    }
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    
    let keyName = e.key;
    
    const keyMap = {
      ' ': 'Space',
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Escape': 'Esc'
    };
    
    if (keyMap[keyName]) {
      keyName = keyMap[keyName];
    } else if (keyName.length === 1) {
      keyName = keyName.toUpperCase();
    }

    // Prevent setting just modifiers
    if (modifiers.length > 0 && modifierKeys.includes(keyName)) {
        return;
    }

    const newHotkey = [...modifiers, keyName].join('+');
    setHotkey(newHotkey);
    setIsRecording(false);
  }, [setHotkey, setIsRecording]);

  useEffect(() => {
    let statusInterval;
    if (isOpen) {
      checkCurrentApiKey();
      loadSettings();
      checkLocalServiceStatus();
      checkSetupStatus();
      statusInterval = setInterval(checkLocalServiceStatus, 5000);
    }

    return () => {
      if (statusInterval) {
        clearInterval(statusInterval);
      }
    };
  }, [isOpen]);

  // Set up dependency installation progress listener
  useEffect(() => {
    if (!window.electronAPI?.onDependencyInstallationProgress) return;

    const removeProgressListener = window.electronAPI.onDependencyInstallationProgress((event, progress) => {
      setInstallationProgress(progress);
    });

    return () => {
      removeProgressListener();
    };
  }, []);

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown);
    } else {
      window.removeEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRecording, handleKeyDown]);

  // Safe localStorage helper functions
  const safeGetLocalStorage = (key, defaultValue) => {
    try {
      return localStorage.getItem(key) || defaultValue;
    } catch (error) {
      console.warn(`Failed to read from localStorage key "${key}":`, error);
      return defaultValue;
    }
  };

  const safeSetLocalStorage = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`Failed to write to localStorage key "${key}":`, error);
      return false;
    }
  };

  const loadSettings = async () => {
    try {
      // Load saved transcription mode
      const savedMode = safeGetLocalStorage('transcriptionMode', 'cloud');
      setTranscriptionMode(savedMode);
      
      // Load saved model selection
      const savedModel = safeGetLocalStorage('selectedModel', 'base');
      setSelectedModel(savedModel);

      // Try to get hotkey from the main process config
      const savedHotkey = await window.electronAPI.getGlobalHotkey();
      setHotkey(savedHotkey || 'CommandOrControl+Shift+D');
    } catch (error) {
      console.warn('Failed to load hotkey from config, using default:', error);
      setHotkey('CommandOrControl+Shift+D');
    }
  };

  const handleSaveHotkey = async () => {
    if (!hotkey) {
      setHotkeyStatus('Please set a hotkey.');
      return;
    }
    try {
      const success = await window.electronAPI.registerShortcut(hotkey);
      if (success) {
        setHotkeyStatus(`Hotkey '${hotkey}' saved successfully!`);
      } else {
        setHotkeyStatus(`Failed to register '${hotkey}'. It might be in use.`);
      }
    } catch (error) {
      console.error('Error saving hotkey:', error);
      setHotkeyStatus('Error saving hotkey.');
    }
  };

  const checkLocalServiceStatus = async () => {
    if (!window.electronAPI?.whisper?.local) return;
    
    setIsCheckingLocalService(true);
    try {
      const response = await window.electronAPI.whisper.local.getStatus();
      
      if (response.success) {
        setLocalServiceStatus(response.status);
        
        if (response.status === 'running') {
          // Get available models if service is running
          const models = await window.electronAPI.whisper.local.getAvailableModels();
          if (models.success) {
            setAvailableModels(models.models || []);
          }
        }
      } else {
        setLocalServiceStatus('error');
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
      // Clear any previous error messages
      setModeErrorMessage('');
      setModeTroubleshootingTips('');
      
      setTranscriptionMode(mode);
      safeSetLocalStorage('transcriptionMode', mode);
      
      // Notify the main process about the mode change
      if (window.electronAPI?.whisper?.setMode) {
        const result = await window.electronAPI.whisper.setMode(mode);
        if (!result.success) {
          console.error('Failed to switch transcription mode:', result.error);
          
          // Show user-friendly error message
          const errorMessage = result.userFriendlyError || result.error;
          const troubleshootingTips = result.troubleshootingTips;
          
          // Check if a fallback occurred
          if (result.fallbackUsed && result.actualMode) {
            // Update UI to reflect the actual service being used
            console.log(`Fallback occurred: requested ${result.requestedMode}, using ${result.actualMode}`);
            setTranscriptionMode(result.actualMode);
            safeSetLocalStorage('transcriptionMode', result.actualMode);
            
            // Show a detailed notification to the user about the fallback
            if (result.actualMode === 'cloud' && result.requestedMode === 'local') {
              console.warn('Local service is not available. Falling back to cloud service.');
              
              // Set error message states for UI display
              setModeErrorMessage(`Unable to switch to local transcription: ${errorMessage}`);
              if (troubleshootingTips) {
                setModeTroubleshootingTips(troubleshootingTips);
              }
            }
          } else {
            // No fallback, genuine failure - revert the UI state
            const previousMode = mode === 'local' ? 'cloud' : 'local';
            setTranscriptionMode(previousMode);
            safeSetLocalStorage('transcriptionMode', previousMode);
            
            // Show error message for genuine failures
            console.error('Mode switch failed without fallback:', errorMessage);
            setModeErrorMessage(`Failed to switch to ${mode} mode: ${errorMessage}`);
            if (troubleshootingTips) {
              console.info('Troubleshooting tips:', troubleshootingTips);
              setModeTroubleshootingTips(troubleshootingTips);
            }
          }
          return;
        }
      }
      
      // If switching to local mode, ensure service is available
      if (mode === 'local') {
        await checkLocalServiceStatus();
      }
    } catch (error) {
      console.error('Error changing transcription mode:', error);
      // Revert the UI state on error
      const previousMode = mode === 'local' ? 'cloud' : 'local';
      setTranscriptionMode(previousMode);
      safeSetLocalStorage('transcriptionMode', previousMode);
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
      safeSetLocalStorage('selectedModel', model);
      
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

  // New dependency management functions
  const checkSetupStatus = async () => {
    if (!window.electronAPI?.whisper?.local) return;

    setSetupStatus('checking');
    try {
      // Check if we have a working Python environment
      const envResult = await window.electronAPI.whisper.local.findPythonEnvironments();
      if (envResult.success && envResult.result && envResult.result.hasWhisper) {
        setSetupStatus('ready');
        setSelectedPythonPath(envResult.result.pythonPath);
      } else {
        setSetupStatus('needs_setup');
        // Get available Python environments for setup
        const condaEnvs = await window.electronAPI.whisper.local.findCondaEnvironments();
        setPythonEnvironments(condaEnvs.environments || []);
      }
    } catch (error) {
      console.error('Error checking setup status:', error);
      setSetupStatus('error');
    }
  };

  const handleAutoInstallDependencies = async (options = {}) => {
    setIsInstallingDependencies(true);
    setInstallationResult(null);
    setInstallationProgress({ stage: 'starting', progress: 0, message: 'Starting installation...' });

    try {
      const result = await window.electronAPI.whisper.local.autoInstallDependencies({
        useVirtualEnv: true,
        forcePythonPath: selectedPythonPath || null,
        ...options
      });

      setInstallationResult(result);
      
      if (result.success) {
        setSetupStatus('ready');
        setSelectedPythonPath(result.pythonPath);
        // Refresh local service status
        setTimeout(() => {
          checkLocalServiceStatus();
        }, 2000);
      } else {
        console.error('Dependency installation failed:', result);
      }
    } catch (error) {
      console.error('Error during dependency installation:', error);
      setInstallationResult({
        success: false,
        error: error.message,
        suggestion: 'Please try manual installation or check the troubleshooting guide'
      });
    } finally {
      setIsInstallingDependencies(false);
    }
  };

  const handleQuickSetup = async () => {
    setShowSetupWizard(true);
    await handleAutoInstallDependencies();
  };

  const handleManualPythonSelection = async (pythonPath) => {
    setSelectedPythonPath(pythonPath);
    await handleAutoInstallDependencies({ forcePythonPath: pythonPath });
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      // Show temporary success message
      const originalText = text;
      setTimeout(() => {
        // Could add a toast notification here
        console.log('Copied to clipboard:', originalText);
      }, 100);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
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
        <div className="settings-header titlebar-drag">
          <h2>Settings</h2>
          <button className="close-btn titlebar-no-drag" onClick={onClose} type="button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/>
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h2>Global Hotkey</h2>
            <div className="hotkey-setting">
              <p>Set a global shortcut to start/stop dictation from anywhere.</p>
              <div className="hotkey-input-container">
                <input
                  type="text"
                  readOnly
                  value={isRecording ? 'Recording...' : hotkey}
                  className={`hotkey-input ${isRecording ? 'recording' : ''}`}
                  placeholder="Click to set hotkey"
                />
                <button 
                  onClick={() => setIsRecording(!isRecording)}
                  className="record-button"
                >
                  {isRecording ? 'Cancel' : 'Set Hotkey'}
                </button>
              </div>
              <button onClick={handleSaveHotkey} className="save-button">Save Hotkey</button>
              {hotkeyStatus && <p className="hotkey-status">{hotkeyStatus}</p>}
            </div>
          </div>

          
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
            
            {modeErrorMessage && (
              <div className="mode-error-message">
                <div className="error-content">
                  <div className="error-icon">⚠️</div>
                  <div className="error-text">
                    <div className="error-title">{modeErrorMessage}</div>
                    {modeTroubleshootingTips && (
                      <div className="error-tips">
                        <strong>How to fix this:</strong> {modeTroubleshootingTips}
                      </div>
                    )}
                    {setupStatus === 'needs_setup' && (
                      <div className="error-actions">
                        <button
                          className="btn-primary"
                          onClick={handleQuickSetup}
                          disabled={isInstallingDependencies}
                        >
                          {isInstallingDependencies ? 'Setting Up...' : '🚀 Quick Setup'}
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => setShowSetupWizard(true)}
                          disabled={isInstallingDependencies}
                        >
                          Manual Setup
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
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
                    {localServiceStatus === 'starting' && '🟡 Starting'}
                    {localServiceStatus === 'stopped' && '🔴 Stopped'}
                    {localServiceStatus === 'error' && '⚠️ Error'}
                    {localServiceStatus === 'unknown' && '❓ Unknown'}
                  </span>
                </div>
                
                <div className="service-actions">
                  {(localServiceStatus === 'stopped' || localServiceStatus === 'error') && (
                    <button
                      className="btn-primary"
                      onClick={handleStartLocalService}
                      disabled={isCheckingLocalService || localServiceStatus === 'starting'}
                    >
                      {isCheckingLocalService ? 'Starting...' : 'Start Service'}
                    </button>
                  )}
                  
                  {localServiceStatus === 'starting' && (
                    <button
                      className="btn-primary"
                      disabled={true}
                    >
                      Starting...
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

      {/* Setup Wizard Modal */}
      {showSetupWizard && (
        <div className="settings-overlay">
          <div className="settings-modal setup-wizard-modal">
            <div className="settings-header titlebar-drag">
              <h2>🔧 Local Transcription Setup Wizard</h2>
              <button 
                className="close-btn titlebar-no-drag" 
                onClick={() => setShowSetupWizard(false)}
                disabled={isInstallingDependencies}
                type="button"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/>
                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </button>
            </div>

            <div className="settings-content">
              <div className="setup-wizard-content">
                {/* Setup Status */}
                <div className="setup-status-section">
                  <h3>Setup Status</h3>
                  <div className="status-indicator">
                    {setupStatus === 'checking' && (
                      <div className="status-item checking">
                        <div className="status-icon">🔍</div>
                        <div className="status-text">Checking Python environment...</div>
                      </div>
                    )}
                    {setupStatus === 'ready' && (
                      <div className="status-item ready">
                        <div className="status-icon">✅</div>
                        <div className="status-text">
                          Local transcription is ready!
                          <div className="status-details">Python: {selectedPythonPath}</div>
                        </div>
                      </div>
                    )}
                    {setupStatus === 'needs_setup' && (
                      <div className="status-item needs-setup">
                        <div className="status-icon">⚙️</div>
                        <div className="status-text">Local transcription needs to be set up</div>
                      </div>
                    )}
                    {setupStatus === 'error' && (
                      <div className="status-item error">
                        <div className="status-icon">❌</div>
                        <div className="status-text">Setup check failed</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Installation Progress */}
                {isInstallingDependencies && (
                  <div className="installation-progress-section">
                    <h4>Installation Progress</h4>
                    <div className="progress-container">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ width: `${installationProgress.progress}%` }}
                        ></div>
                      </div>
                      <div className="progress-info">
                        <div className="progress-stage">{installationProgress.stage}</div>
                        <div className="progress-message">{installationProgress.message}</div>
                        <div className="progress-percent">{installationProgress.progress}%</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Installation Result */}
                {installationResult && (
                  <div className="installation-result-section">
                    <h4>Installation Result</h4>
                    {installationResult.success ? (
                      <div className="result-success">
                        <div className="result-icon">🎉</div>
                        <div className="result-content">
                          <div className="result-title">Installation Successful!</div>
                          <div className="result-details">
                            <div>Python: {installationResult.pythonPath}</div>
                            {installationResult.whisperVersion && (
                              <div>Whisper: {installationResult.whisperVersion}</div>
                            )}
                            {installationResult.virtualEnv && (
                              <div>✨ Virtual environment created</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="result-error">
                        <div className="result-icon">⚠️</div>
                        <div className="result-content">
                          <div className="result-title">Installation Failed</div>
                          <div className="result-error-msg">
                            {installationResult.error && installationResult.error.includes('incompatible architecture') ? (
                              <>
                                <strong>Architecture Mismatch Detected</strong>
                                <br />
                                Your Mac has an Apple Silicon (ARM64) processor, but PyTorch was installed for Intel (x86_64). This is a common issue that can be automatically fixed.
                              </>
                            ) : installationResult.error && installationResult.error.includes('libtorch') ? (
                              <>
                                <strong>PyTorch Architecture Conflict</strong>
                                <br />
                                There's a mismatch between your Mac's processor architecture and the installed PyTorch version.
                              </>
                            ) : (
                              installationResult.error
                            )}
                          </div>
                          {installationResult.suggestion && (
                            <div className="result-suggestion">
                              <strong>How to fix this:</strong> {installationResult.suggestion}
                            </div>
                          )}
                          
                          {/* Architecture fix button for Apple Silicon */}
                          {(installationResult.error && 
                            (installationResult.error.includes('incompatible architecture') || 
                             installationResult.error.includes('libtorch'))) && (
                            <div className="architecture-fix-section">
                              <h5>🔧 Automatic Fix for Apple Silicon</h5>
                              <p>Click the button below to automatically fix the architecture mismatch:</p>
                              <button
                                className="btn-primary"
                                onClick={() => handleAutoInstallDependencies({ 
                                  forcePythonPath: selectedPythonPath || null,
                                  cleanInstall: true 
                                })}
                                disabled={isInstallingDependencies}
                              >
                                {isInstallingDependencies ? 'Fixing...' : '🔧 Fix Architecture Issue'}
                              </button>
                            </div>
                          )}
                          
                          {installationResult.installCommand && (
                            <div className="result-command">
                              <strong>Or run this command manually:</strong>
                              <div className="command-box">
                                <code>{installationResult.installCommand}</code>
                                <button
                                  className="copy-btn"
                                  onClick={() => copyToClipboard(installationResult.installCommand)}
                                  title="Copy to clipboard"
                                >
                                  📋
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Setup Actions */}
                {!isInstallingDependencies && setupStatus !== 'ready' && (
                  <div className="setup-actions-section">
                    <h4>Setup Options</h4>
                    
                    <div className="setup-option">
                      <h5>🚀 Automatic Setup (Recommended)</h5>
                      <p>Creates a virtual environment and installs all required dependencies automatically.</p>
                      <button
                        className="btn-primary setup-btn"
                        onClick={() => handleAutoInstallDependencies()}
                        disabled={isInstallingDependencies}
                      >
                        Start Automatic Setup
                      </button>
                    </div>

                    {pythonEnvironments.length > 0 && (
                      <div className="setup-option">
                        <h5>🐍 Use Existing Python Environment</h5>
                        <p>Install dependencies in an existing Python environment:</p>
                        <select 
                          value={selectedPythonPath}
                          onChange={(e) => setSelectedPythonPath(e.target.value)}
                          className="python-env-select"
                        >
                          <option value="">Select Python environment...</option>
                          {pythonEnvironments.map((envPath, index) => (
                            <option key={index} value={envPath}>
                              {envPath}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-secondary setup-btn"
                          onClick={() => handleManualPythonSelection(selectedPythonPath)}
                          disabled={!selectedPythonPath || isInstallingDependencies}
                        >
                          Install in Selected Environment
                        </button>
                      </div>
                    )}

                    <div className="setup-option manual-setup">
                      <h5>⚒️ Manual Setup</h5>
                      <p>If automatic setup doesn't work, you can install dependencies manually:</p>
                      <div className="manual-commands">
                        <div className="command-step">
                          <strong>1. Install Python dependencies:</strong>
                          <div className="command-box">
                            <code>pip install openai-whisper torch</code>
                            <button
                              className="copy-btn"
                              onClick={() => copyToClipboard('pip install openai-whisper torch')}
                              title="Copy to clipboard"
                            >
                              📋
                            </button>
                          </div>
                        </div>
                        <div className="command-step">
                          <strong>2. Or with conda:</strong>
                          <div className="command-box">
                            <code>conda install pytorch torchvision torchaudio && pip install openai-whisper</code>
                            <button
                              className="copy-btn"
                              onClick={() => copyToClipboard('conda install pytorch torchvision torchaudio && pip install openai-whisper')}
                              title="Copy to clipboard"
                            >
                              📋
                            </button>
                          </div>
                        </div>
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={checkSetupStatus}
                      >
                        Check Setup Status
                      </button>
                    </div>
                  </div>
                )}

                {setupStatus === 'ready' && (
                  <div className="setup-complete-section">
                    <div className="setup-complete-message">
                      <div className="success-icon">🎉</div>
                      <h4>Setup Complete!</h4>
                      <p>Local transcription is ready to use. You can now close this wizard and start transcribing.</p>
                      <button
                        className="btn-primary"
                        onClick={() => setShowSetupWizard(false)}
                      >
                        Close Wizard
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;