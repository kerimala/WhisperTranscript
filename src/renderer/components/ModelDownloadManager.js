import React, { useState, useEffect, useCallback } from 'react';
import './ModelDownloadManager.css';

const ModelDownloadManager = ({ isVisible, onClose }) => {
  const [availableModels, setAvailableModels] = useState([]);
  const [downloadedModels, setDownloadedModels] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [storageInfo, setStorageInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [available, downloaded, storage] = await Promise.all([
        window.electronAPI.whisper.models.getAvailable(),
        window.electronAPI.whisper.models.getDownloaded(),
        window.electronAPI.whisper.models.getStorageInfo()
      ]);
      
      setAvailableModels(available.models || []);
      setDownloadedModels(downloaded.models || []);
      setStorageInfo(storage);
    } catch (err) {
      console.error('Error loading model data:', err);
      setError('Failed to load model information');
    } finally {
      setLoading(false);
    }
  }, []);

  // Set up event listeners
  useEffect(() => {
    if (!isVisible) return;

    loadData();

    // Model download event listeners
    const removeDownloadStarted = window.electronAPI.onModelDownloadStarted((event, data) => {
      setDownloadProgress(prev => ({
        ...prev,
        [data.modelName]: {
          status: 'downloading',
          progress: 0,
          speed: 0,
          eta: null
        }
      }));
    });

    const removeDownloadProgress = window.electronAPI.onModelDownloadProgress((event, data) => {
      setDownloadProgress(prev => ({
        ...prev,
        [data.modelName]: {
          status: 'downloading',
          progress: data.progress,
          speed: data.speed,
          eta: data.eta,
          downloaded: data.downloaded,
          total: data.total
        }
      }));
    });

    const removeDownloadCompleted = window.electronAPI.onModelDownloadCompleted((event, data) => {
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[data.modelName];
        return newProgress;
      });
      
      // Refresh downloaded models list
      loadData();
    });

    const removeDownloadError = window.electronAPI.onModelDownloadError((event, data) => {
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[data.modelName];
        return newProgress;
      });
      
      setError(`Download failed for ${data.modelName}: ${data.error}`);
    });

    const removeDownloadCancelled = window.electronAPI.onModelDownloadCancelled((event, data) => {
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[data.modelName];
        return newProgress;
      });
    });

    const removeModelDeleted = window.electronAPI.onModelDeleted((event, data) => {
      // Refresh downloaded models list
      loadData();
    });

    return () => {
      removeDownloadStarted();
      removeDownloadProgress();
      removeDownloadCompleted();
      removeDownloadError();
      removeDownloadCancelled();
      removeModelDeleted();
    };
  }, [isVisible, loadData]);

  const handleDownloadModel = async (modelName) => {
    try {
      setError(null);
      const result = await window.electronAPI.whisper.models.download(modelName);
      if (!result.success) {
        setError(`Failed to start download: ${result.error}`);
      }
    } catch (err) {
      console.error('Error starting download:', err);
      setError('Failed to start model download');
    }
  };

  const handleCancelDownload = async (modelName) => {
    try {
      await window.electronAPI.whisper.models.cancelDownload(modelName);
    } catch (err) {
      console.error('Error cancelling download:', err);
      setError('Failed to cancel download');
    }
  };

  const handleDeleteModel = async (modelName) => {
    if (!window.confirm(`Are you sure you want to delete the ${modelName} model?`)) {
      return;
    }

    try {
      setError(null);
      const result = await window.electronAPI.whisper.models.delete(modelName);
      if (!result.success) {
        setError(`Failed to delete model: ${result.error}`);
      }
    } catch (err) {
      console.error('Error deleting model:', err);
      setError('Failed to delete model');
    }
  };

  const handleVerifyModel = async (modelName) => {
    try {
      setError(null);
      const result = await window.electronAPI.whisper.models.verifyIntegrity(modelName);
      if (result.success) {
        if (result.valid) {
          alert(`Model ${modelName} integrity verified successfully.`);
        } else {
          alert(`Model ${modelName} integrity check failed. Consider re-downloading.`);
        }
      } else {
        setError(`Verification failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Error verifying model:', err);
      setError('Failed to verify model integrity');
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSecond) => {
    if (!bytesPerSecond) return '';
    return `${formatFileSize(bytesPerSecond)}/s`;
  };

  const formatETA = (seconds) => {
    if (!seconds || seconds === Infinity) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const isModelDownloaded = (modelName) => {
    return downloadedModels.some(model => model.name === modelName);
  };

  const isModelDownloading = (modelName) => {
    return downloadProgress[modelName]?.status === 'downloading';
  };

  if (!isVisible) return null;

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
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {storageInfo && (
          <div className="storage-info">
            <h3>Storage Information</h3>
            <div className="storage-details">
              <span>Models Directory: {storageInfo.modelsPath}</span>
              <span>Total Space Used: {formatFileSize(storageInfo.totalSize)}</span>
              <span>Available Space: {formatFileSize(storageInfo.freeSpace)}</span>
            </div>
          </div>
        )}

        <div className="model-sections">
          <div className="available-models-section">
            <h3>Available Models</h3>
            {loading ? (
              <div className="loading">Loading models...</div>
            ) : (
              <div className="models-list">
                {availableModels.map(model => {
                  const isDownloaded = isModelDownloaded(model.name);
                  const isDownloading = isModelDownloading(model.name);
                  const progress = downloadProgress[model.name];

                  return (
                    <div key={model.name} className="model-item">
                      <div className="model-info">
                        <div className="model-name">{model.name}</div>
                        <div className="model-details">
                          <span className="model-size">Size: {formatFileSize(model.size)}</span>
                          <span className="model-description">{model.description}</span>
                        </div>
                      </div>

                      <div className="model-actions">
                        {isDownloading ? (
                          <div className="download-progress">
                            <div className="progress-bar">
                              <div 
                                className="progress-fill" 
                                style={{ width: `${progress?.progress || 0}%` }}
                              ></div>
                            </div>
                            <div className="progress-info">
                              <span>{Math.round(progress?.progress || 0)}%</span>
                              {progress?.speed && <span>{formatSpeed(progress.speed)}</span>}
                              {progress?.eta && <span>ETA: {formatETA(progress.eta)}</span>}
                            </div>
                            <button 
                              className="cancel-button"
                              onClick={() => handleCancelDownload(model.name)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : isDownloaded ? (
                          <div className="downloaded-status">
                            <span className="downloaded-badge">Downloaded</span>
                          </div>
                        ) : (
                          <button 
                            className="download-button"
                            onClick={() => handleDownloadModel(model.name)}
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="downloaded-models-section">
            <h3>Downloaded Models</h3>
            <div className="models-list">
              {downloadedModels.map(model => (
                <div key={model.name} className="model-item downloaded">
                  <div className="model-info">
                    <div className="model-name">{model.name}</div>
                    <div className="model-details">
                      <span className="model-size">Size: {formatFileSize(model.size)}</span>
                      <span className="model-path">Path: {model.path}</span>
                      {model.downloadDate && (
                        <span className="download-date">
                          Downloaded: {new Date(model.downloadDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="model-actions">
                    <button 
                      className="verify-button"
                      onClick={() => handleVerifyModel(model.name)}
                    >
                      Verify
                    </button>
                    <button 
                      className="delete-button"
                      onClick={() => handleDeleteModel(model.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {downloadedModels.length === 0 && (
                <div className="no-models">No models downloaded yet</div>
              )}
            </div>
          </div>
        </div>

        <div className="model-download-footer">
          <button className="close-footer-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelDownloadManager;