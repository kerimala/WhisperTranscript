import React, { useState, useEffect } from 'react';
import './ModelDownloadManager.css';

const ModelDownloadManager = ({ isOpen, onClose }) => {
  const [availableModels, setAvailableModels] = useState([]);
  const [downloadedModels, setDownloadedModels] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [storageInfo, setStorageInfo] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadModelData();
      const cleanupFunctions = setupEventListeners();

      return () => {
        removeEventListeners(cleanupFunctions);
      };
    }
  }, [isOpen]);

  const setupEventListeners = () => {
    if (window.electronAPI) {
      // Set up event listeners for model download events
      const cleanupFunctions = [];
      
      cleanupFunctions.push(window.electronAPI.onModelDownloadStarted((event, modelName) => {
        setDownloadProgress(prev => ({
          ...prev,
          [modelName]: { status: 'downloading', progress: 0 }
        }));
      }));

      cleanupFunctions.push(window.electronAPI.onModelDownloadProgress((event, data) => {
        setDownloadProgress(prev => ({
          ...prev,
          [data.modelName]: {
            status: 'downloading',
            progress: data.progress,
            downloaded: data.downloaded,
            total: data.total
          }
        }));
      }));

      cleanupFunctions.push(window.electronAPI.onModelDownloadCompleted((event, modelName) => {
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[modelName];
          return newProgress;
        });
        loadModelData(); // Refresh the lists
      }));

      cleanupFunctions.push(window.electronAPI.onModelDownloadError((event, data) => {
        setError(`Download failed for ${data.modelName}: ${data.error}`);
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[data.modelName];
          return newProgress;
        });
      }));

      cleanupFunctions.push(window.electronAPI.onModelDownloadCancelled((event, modelName) => {
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[modelName];
          return newProgress;
        });
      }));

      cleanupFunctions.push(window.electronAPI.onModelDeleted((event, modelName) => {
        loadModelData(); // Refresh the lists
      }));
      
      // Store cleanup functions for later use
      return cleanupFunctions;
    }
    return [];
  };

  const removeEventListeners = (cleanupFunctions = []) => {
    // Clean up event listeners
    cleanupFunctions.forEach(cleanup => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    });
  };

  const loadModelData = async () => {
    setIsLoading(true);
    try {
      const [availableResult, downloadedResult, storageResult] = await Promise.all([
        window.electronAPI.whisper.models.getAvailable(),
        window.electronAPI.whisper.models.getDownloaded(),
        window.electronAPI.whisper.models.getStorageInfo()
      ]);

      // Handle the response format from the backend
      if (availableResult.success) {
        const availableModels = Object.entries(availableResult.models || {}).map(([name, info]) => ({
          name,
          ...info
        }));
        setAvailableModels(availableModels);
      } else {
        setError(availableResult.error || 'Failed to load available models');
      }

      if (downloadedResult.success) {
        setDownloadedModels(downloadedResult.models || []);
      } else {
        setError(downloadedResult.error || 'Failed to load downloaded models');
      }

      if (storageResult.success) {
        setStorageInfo(storageResult.storage);
      }
      
    } catch (err) {
      console.error('Failed to load model data:', err);
      setError('Failed to load model information');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (modelName) => {
    try {
      setError(null);
      const result = await window.electronAPI.whisper.models.download(modelName);
      if (!result.success) {
        setError(result.error || `Failed to start download for ${modelName}`);
      }
    } catch (err) {
      console.error('Download error:', err);
      setError(`Failed to start download: ${err.message}`);
    }
  };

  const handleCancelDownload = async (modelName) => {
    try {
      const result = await window.electronAPI.whisper.models.cancelDownload(modelName);
      if (!result.success) {
        setError(result.error || `Failed to cancel download for ${modelName}`);
      }
    } catch (err) {
      console.error('Cancel download error:', err);
      setError(`Failed to cancel download: ${err.message}`);
    }
  };

  const handleDelete = async (modelName) => {
    if (window.confirm(`Are you sure you want to delete the ${modelName} model?`)) {
      try {
        setError(null);
        const result = await window.electronAPI.whisper.models.delete(modelName);
        if (!result.success) {
          setError(result.error || `Failed to delete ${modelName}`);
        }
      } catch (err) {
        console.error('Delete error:', err);
        setError(`Failed to delete model: ${err.message}`);
      }
    }
  };

  const handleVerifyIntegrity = async (modelName) => {
    try {
      setError(null);
      const result = await window.electronAPI.whisper.models.verifyIntegrity(modelName);
      if (result.success && result.isValid) {
        alert(`${modelName} integrity check passed!`);
      } else {
        alert(`${modelName} integrity check failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Verify error:', err);
      setError(`Failed to verify model: ${err.message}`);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getModelDisplayName = (modelName) => {
    const displayNames = {
      'tiny': 'Tiny (39 MB)',
      'base': 'Base (74 MB)',
      'small': 'Small (244 MB)',
      'medium': 'Medium (769 MB)',
      'large': 'Large (1550 MB)'
    };
    return displayNames[modelName] || modelName;
  };

  if (!isOpen) return null;

  return (
    <div className="model-download-overlay">
      <div className="model-download-modal">
        <div className="model-download-header">
          <h2>Model Download Manager</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {storageInfo && (
          <div className="storage-info">
            <h3>Storage Information</h3>
            <div className="storage-details">
              <span>Used: {formatFileSize(storageInfo.used)}</span>
              <span>Available: {formatFileSize(storageInfo.available)}</span>
              <span>Total: {formatFileSize(storageInfo.total)}</span>
            </div>
          </div>
        )}

        <div className="model-sections">
          <div className="downloaded-models">
            <h3>Downloaded Models</h3>
            {isLoading ? (
              <div className="loading">Loading...</div>
            ) : downloadedModels.length === 0 ? (
              <div className="no-models">No models downloaded</div>
            ) : (
              <div className="model-list">
                {downloadedModels.map(model => (
                  <div key={model.name} className="model-item downloaded">
                    <div className="model-info">
                      <span className="model-name">{getModelDisplayName(model.name)}</span>
                      <span className="model-size">{formatFileSize(model.actualSize || model.sizeBytes)}</span>
                    </div>
                    <div className="model-actions">
                      <button
                        className="verify-button"
                        onClick={() => handleVerifyIntegrity(model.name)}
                      >
                        Verify
                      </button>
                      <button
                        className="delete-button"
                        onClick={() => handleDelete(model.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="available-models">
            <h3>Available Models</h3>
            {isLoading ? (
              <div className="loading">Loading...</div>
            ) : (
              <div className="model-list">
                {availableModels.map(model => {
                  const isDownloaded = downloadedModels.some(d => d.name === model.name);
                  const isDownloading = downloadProgress[model.name];
                  
                  return (
                    <div key={model.name} className="model-item available">
                      <div className="model-info">
                        <span className="model-name">{getModelDisplayName(model.name)}</span>
                        <span className="model-size">{model.size || formatFileSize(model.sizeBytes)}</span>
                        {model.description && (
                          <span className="model-description">{model.description}</span>
                        )}
                      </div>
                      
                      {isDownloading ? (
                        <div className="download-progress">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill"
                              style={{ width: `${isDownloading.progress || 0}%` }}
                            ></div>
                          </div>
                          <span className="progress-text">
                            {Math.round(isDownloading.progress || 0)}%
                          </span>
                          <button
                            className="cancel-button"
                            onClick={() => handleCancelDownload(model.name)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="model-actions">
                          {isDownloaded ? (
                            <span className="downloaded-indicator">Downloaded</span>
                          ) : (
                            <button
                              className="download-button"
                              onClick={() => handleDownload(model.name)}
                            >
                              Download
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelDownloadManager;