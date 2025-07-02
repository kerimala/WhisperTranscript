const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const EventEmitter = require('events');

/**
 * Model Manager Service
 * Handles downloading, verification, and storage of Whisper model files
 */
class ModelManager extends EventEmitter {
  constructor() {
    super();
    
    // Model storage directory
    this.modelsDir = path.join(app.getPath('userData'), 'whisper-models');
    
    // Available Whisper models with their metadata (Official OpenAI URLs)
    this.availableModels = {
      'tiny': {
        name: 'tiny',
        size: '39 MB',
        sizeBytes: 39000000,
        description: 'Fastest, least accurate',
        url: 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt',
        checksum: '65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9'
      },
      'base': {
        name: 'base',
        size: '74 MB',
        sizeBytes: 74000000,
        description: 'Good balance of speed and accuracy',
        url: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
        checksum: 'ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e'
      },
      'small': {
        name: 'small',
        size: '244 MB',
        sizeBytes: 244000000,
        description: 'Better accuracy, slower',
        url: 'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
        checksum: '9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794'
      },
      'medium': {
        name: 'medium',
        size: '769 MB',
        sizeBytes: 769000000,
        description: 'High accuracy, moderate speed',
        url: 'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
        checksum: '345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1'
      },
      'large': {
        name: 'large',
        size: '1550 MB',
        sizeBytes: 1550000000,
        description: 'Best accuracy, slowest',
        url: 'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
        checksum: 'e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb'
      }
    };
    
    // Download state tracking
    this.activeDownloads = new Map();
    this.downloadQueue = [];
    this.maxConcurrentDownloads = 2;
    
    // Initialize models directory
    this.initializeModelsDirectory();
  }

  /**
   * Initialize the models directory
   * @private
   */
  initializeModelsDirectory() {
    try {
      if (!fs.existsSync(this.modelsDir)) {
        fs.mkdirSync(this.modelsDir, { recursive: true });
        console.log(`[ModelManager] Created models directory: ${this.modelsDir}`);
      }
    } catch (error) {
      console.error('[ModelManager] Failed to create models directory:', error.message);
      throw error;
    }
  }

  /**
   * Get list of available models with download status
   * @returns {Object} Models information
   */
  getAvailableModels() {
    const models = {};
    
    for (const [modelName, modelInfo] of Object.entries(this.availableModels)) {
      const modelPath = path.join(this.modelsDir, `${modelName}.pt`);
      const isDownloaded = fs.existsSync(modelPath);
      const isDownloading = this.activeDownloads.has(modelName);
      
      models[modelName] = {
        ...modelInfo,
        isDownloaded,
        isDownloading,
        localPath: isDownloaded ? modelPath : null,
        downloadProgress: isDownloading ? this.activeDownloads.get(modelName).progress : 0
      };
    }
    
    return {
      success: true,
      models,
      modelsDirectory: this.modelsDir
    };
  }

  /**
   * Download a specific model
   * @param {string} modelName - Name of the model to download
   * @param {Object} options - Download options
   * @returns {Promise<Object>} Download result
   */
  async downloadModel(modelName, options = {}) {
    if (!this.availableModels[modelName]) {
      return {
        success: false,
        error: `Unknown model: ${modelName}`
      };
    }

    if (this.activeDownloads.has(modelName)) {
      return {
        success: false,
        error: `Model ${modelName} is already being downloaded`
      };
    }

    const modelInfo = this.availableModels[modelName];
    const modelPath = path.join(this.modelsDir, `${modelName}.pt`);
    const tempPath = `${modelPath}.tmp`;

    // Check if model already exists and is valid
    if (fs.existsSync(modelPath)) {
      const isValid = await this.verifyModelIntegrity(modelName, modelPath);
      if (isValid) {
        return {
          success: true,
          message: `Model ${modelName} already exists and is valid`,
          path: modelPath
        };
      } else {
        console.log(`[ModelManager] Existing model ${modelName} is corrupted, re-downloading`);
        fs.unlinkSync(modelPath);
      }
    }

    try {
      // Initialize download tracking
      const downloadState = {
        modelName,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: modelInfo.sizeBytes,
        startTime: Date.now(),
        speed: 0,
        eta: 0
      };
      
      this.activeDownloads.set(modelName, downloadState);
      
      console.log(`[ModelManager] Starting download of ${modelName} model`);
      this.emit('downloadStarted', { modelName, modelInfo });

      // Start the download
      const result = await this._downloadFile(modelInfo.url, tempPath, downloadState, options);
      
      if (result.success) {
        // Verify the downloaded file
        console.log(`[ModelManager] Verifying ${modelName} model integrity`);
        const isValid = await this._verifyModelIntegrityInternal(modelName, tempPath);
        
        if (isValid) {
          // Move temp file to final location
        fs.renameSync(tempPath, modelPath);
        
        // Emit final progress update at 100%
        const finalDownloadState = this.activeDownloads.get(modelName);
        if (finalDownloadState) {
          finalDownloadState.progress = 100;
          finalDownloadState.downloadedBytes = finalDownloadState.totalBytes;
          this.emit('downloadProgress', { ...finalDownloadState });
        }
        
        console.log(`[ModelManager] Successfully downloaded and verified ${modelName} model`);
        this.emit('downloadCompleted', { modelName, path: modelPath });
          
          return {
            success: true,
            message: `Model ${modelName} downloaded successfully`,
            path: modelPath
          };
        } else {
          // Clean up corrupted file
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          
          throw new Error('Downloaded file failed integrity check');
        }
      } else {
        throw new Error(result.error);
      }
      
    } catch (error) {
      console.error(`[ModelManager] Failed to download ${modelName}:`, error.message);
      
      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      
      this.emit('downloadError', { modelName, error: error.message });
      
      return {
        success: false,
        error: `Failed to download ${modelName}: ${error.message}`
      };
    } finally {
      // Clean up download tracking
      this.activeDownloads.delete(modelName);
    }
  }

  /**
   * Download file with progress tracking and resume capability
   * @private
   */
  async _downloadFile(url, filePath, downloadState, options = {}) {
    const { timeout = 300000, retries = 3 } = options;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[ModelManager] Download attempt ${attempt}/${retries} for ${downloadState.modelName}`);
        
        // Check if partial file exists for resume
        let resumePosition = 0;
        if (fs.existsSync(filePath)) {
          resumePosition = fs.statSync(filePath).size;
          downloadState.downloadedBytes = resumePosition;
          console.log(`[ModelManager] Resuming download from byte ${resumePosition}`);
        }
        
        const response = await fetch(url, {
          headers: resumePosition > 0 ? { 'Range': `bytes=${resumePosition}-` } : {},
          signal: AbortSignal.timeout(timeout)
        });
        
        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const totalBytes = resumePosition + parseInt(response.headers.get('content-length') || '0');
        downloadState.totalBytes = totalBytes;
        
        const fileStream = fs.createWriteStream(filePath, { flags: resumePosition > 0 ? 'a' : 'w' });
        const reader = response.body.getReader();
        
        let lastProgressUpdate = Date.now();
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          fileStream.write(value);
          downloadState.downloadedBytes += value.length;
          
          // Update progress and emit events
          const now = Date.now();
          if (now - lastProgressUpdate > 1000) { // Update every second
            downloadState.progress = Math.round((downloadState.downloadedBytes / downloadState.totalBytes) * 100);
            downloadState.speed = downloadState.downloadedBytes / ((now - downloadState.startTime) / 1000);
            downloadState.eta = (downloadState.totalBytes - downloadState.downloadedBytes) / downloadState.speed;
            
            this.emit('downloadProgress', { ...downloadState });
            lastProgressUpdate = now;
          }
        }
        
        fileStream.end();
        
        return { success: true };
        
      } catch (error) {
        console.error(`[ModelManager] Download attempt ${attempt} failed:`, error.message);
        
        if (attempt === retries) {
          return { success: false, error: error.message };
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  /**
   * Verify model file integrity using checksum (public method)
   * @param {string} modelName - Name of the model
   * @returns {Promise<Object>} Verification result
   */
  async verifyModelIntegrity(modelName) {
    try {
      if (!this.availableModels[modelName]) {
        return {
          success: false,
          error: `Unknown model: ${modelName}`
        };
      }
      
      const modelPath = path.join(this.modelsDir, `${modelName}.pt`);
      const isValid = await this._verifyModelIntegrityInternal(modelName, modelPath);
      
      return {
        success: true,
        isValid,
        message: isValid ? 'Model integrity verified successfully' : 'Model integrity check failed'
      };
    } catch (error) {
      console.error(`[ModelManager] Error verifying ${modelName}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Internal method to verify model file integrity using checksum
   * @param {string} modelName - Name of the model
   * @param {string} filePath - Path to the model file
   * @returns {Promise<boolean>} True if valid
   */
  async _verifyModelIntegrityInternal(modelName, filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      
      const modelInfo = this.availableModels[modelName];
      if (!modelInfo || !modelInfo.checksum) {
        console.warn(`[ModelManager] No checksum available for ${modelName}, skipping verification`);
        return true; // Assume valid if no checksum
      }
      
      console.log(`[ModelManager] Verifying checksum for ${modelName}`);
      
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      return new Promise((resolve, reject) => {
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => {
          const fileChecksum = hash.digest('hex');
          const isValid = fileChecksum === modelInfo.checksum;
          
          if (isValid) {
            console.log(`[ModelManager] Checksum verification passed for ${modelName}`);
          } else {
            console.error(`[ModelManager] Checksum verification failed for ${modelName}`);
            console.error(`Expected: ${modelInfo.checksum}`);
            console.error(`Got: ${fileChecksum}`);
          }
          
          resolve(isValid);
        });
        stream.on('error', reject);
      });
      
    } catch (error) {
      console.error(`[ModelManager] Error verifying ${modelName}:`, error.message);
      return false;
    }
  }

  /**
   * Delete a downloaded model
   * @param {string} modelName - Name of the model to delete
   * @returns {Object} Deletion result
   */
  deleteModel(modelName) {
    try {
      if (!this.availableModels[modelName]) {
        return {
          success: false,
          error: `Unknown model: ${modelName}`
        };
      }
      
      const modelPath = path.join(this.modelsDir, `${modelName}.pt`);
      
      if (!fs.existsSync(modelPath)) {
        return {
          success: false,
          error: `Model ${modelName} is not downloaded`
        };
      }
      
      fs.unlinkSync(modelPath);
      
      console.log(`[ModelManager] Deleted model ${modelName}`);
      this.emit('modelDeleted', { modelName });
      
      return {
        success: true,
        message: `Model ${modelName} deleted successfully`
      };
      
    } catch (error) {
      console.error(`[ModelManager] Failed to delete ${modelName}:`, error.message);
      return {
        success: false,
        error: `Failed to delete ${modelName}: ${error.message}`
      };
    }
  }

  /**
   * Cancel an active download
   * @param {string} modelName - Name of the model to cancel
   * @returns {Object} Cancellation result
   */
  cancelDownload(modelName) {
    if (!this.activeDownloads.has(modelName)) {
      return {
        success: false,
        error: `No active download for ${modelName}`
      };
    }
    
    // Remove from active downloads (this will cause the download to stop)
    this.activeDownloads.delete(modelName);
    
    // Clean up temp file
    const tempPath = path.join(this.modelsDir, `${modelName}.pt.tmp`);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    
    console.log(`[ModelManager] Cancelled download of ${modelName}`);
    this.emit('downloadCancelled', { modelName });
    
    return {
      success: true,
      message: `Download of ${modelName} cancelled`
    };
  }

  /**
   * Cancel all active downloads
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelAllDownloads() {
    const activeDownloadNames = Array.from(this.activeDownloads.keys());
    
    if (activeDownloadNames.length === 0) {
      return {
        success: true,
        message: 'No active downloads to cancel'
      };
    }
    
    console.log(`[ModelManager] Cancelling ${activeDownloadNames.length} active downloads`);
    
    const results = [];
    for (const modelName of activeDownloadNames) {
      const result = this.cancelDownload(modelName);
      results.push({ modelName, ...result });
    }
    
    // Clear the download queue as well
    this.downloadQueue = [];
    
    const successCount = results.filter(r => r.success).length;
    
    return {
      success: true,
      message: `Cancelled ${successCount} downloads`,
      results
    };
  }

  /**
   * Get download progress for all active downloads
   * @returns {Object} Download progress information
   */
  getDownloadProgress() {
    const progress = {};
    
    for (const [modelName, downloadState] of this.activeDownloads) {
      progress[modelName] = { ...downloadState };
    }
    
    return {
      success: true,
      activeDownloads: progress,
      queueLength: this.downloadQueue.length
    };
  }

  /**
   * Get list of downloaded models with their information
   * @returns {Object} Downloaded models information
   */
  getDownloadedModels() {
    try {
      const downloadedModels = [];
      
      for (const [modelName, modelInfo] of Object.entries(this.availableModels)) {
        const modelPath = path.join(this.modelsDir, `${modelName}.pt`);
        if (fs.existsSync(modelPath)) {
          const stats = fs.statSync(modelPath);
          downloadedModels.push({
            name: modelName,
            ...modelInfo,
            actualSize: stats.size,
            path: modelPath,
            modified: stats.mtime,
            isDownloaded: true
          });
        }
      }
      
      return {
        success: true,
        models: downloadedModels,
        modelsDirectory: this.modelsDir
      };
      
    } catch (error) {
      console.error('[ModelManager] Error getting downloaded models:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get storage information
   * @returns {Object} Storage usage information
   */
  getStorageInfo() {
    try {
      let totalSize = 0;
      const downloadedModels = [];
      
      for (const modelName of Object.keys(this.availableModels)) {
        const modelPath = path.join(this.modelsDir, `${modelName}.pt`);
        if (fs.existsSync(modelPath)) {
          const stats = fs.statSync(modelPath);
          totalSize += stats.size;
          downloadedModels.push({
            name: modelName,
            size: stats.size,
            path: modelPath,
            modified: stats.mtime
          });
        }
      }
      
      return {
        success: true,
        modelsDirectory: this.modelsDir,
        totalSize,
        downloadedModels,
        downloadedCount: downloadedModels.length,
        availableCount: Object.keys(this.availableModels).length
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ModelManager;