// Load environment variables from .env file
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WhisperApiClient = require('./services/whisperApiClient');
const WhisperLocalClient = require('./services/whisperLocalClient');
const ModelManager = require('./services/modelManager');
const ServiceRegistry = require('./services/serviceRegistry');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let whisperClient;
let whisperLocalClient;
let modelManager;
let serviceRegistry;
let currentMode = 'cloud'; // 'cloud' or 'local'

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'), // We'll add this later
    show: false, // Don't show until ready
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

// IPC handlers for local Whisper service
ipcMain.handle('whisper-get-mode', async () => {
  return currentMode;
});

ipcMain.handle('whisper-set-mode', async (event, mode) => {
  try {
    if (mode === 'cloud' || mode === 'local') {
      const previousMode = currentMode;
      
      // Use ServiceRegistry to switch services
      const switchResult = await serviceRegistry.switchToService(mode, { 
        preserveState: true,
        timeout: 10000 
      });
      
      if (switchResult.success) {
        currentMode = mode;
        console.log(`Transcription mode switched from ${previousMode} to: ${mode}`);
        return { 
          success: true, 
          mode: currentMode,
          previousMode,
          serviceInfo: switchResult.serviceInfo
        };
      } else {
        console.warn(`Failed to switch to ${mode} service:`, switchResult.error);
        return { 
          success: false, 
          error: `Failed to switch to ${mode} service: ${switchResult.error}`,
          fallbackUsed: switchResult.fallbackUsed
        };
      }
    } else {
      throw new Error('Invalid mode. Must be "cloud" or "local"');
    }
  } catch (error) {
    console.error('Error setting transcription mode:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-check-service', async () => {
  try {
    const isAvailable = await whisperLocalClient.isAvailable();
    return { success: true, available: isAvailable };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-install-dependencies', async () => {
  try {
    const result = await whisperLocalClient.installDependencies();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-get-models', async () => {
  try {
    const result = await whisperLocalClient.getAvailableModels();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-change-model', async (event, modelName) => {
  try {
    const result = await whisperLocalClient.changeModel(modelName);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-test-service', async () => {
  try {
    const result = await whisperLocalClient.testService();
    return { success: true, ready: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Process management handlers
ipcMain.handle('whisper-local-start-service', async () => {
  try {
    const result = await whisperLocalClient.startService();
    return { success: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-stop-service', async () => {
  try {
    const result = await whisperLocalClient.stopService();
    return { success: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-restart-service', async () => {
  try {
    const result = await whisperLocalClient.restartService();
    return { success: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-local-get-status', async () => {
  try {
    const status = whisperLocalClient.getServiceStatus();
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

  // Load the app
  const startUrl = isDev 
    ? 'http://localhost:3001' 
    : `file://${path.join(__dirname, '../../build/index.html')}`;
  
  // In development, wait for the React dev server to be ready
  if (isDev) {
    // Try to load the URL, and if it fails, retry after a delay
    const loadDevUrl = () => {
      mainWindow.loadURL(startUrl).catch(() => {
        setTimeout(loadDevUrl, 1000);
      });
    };
    loadDevUrl();
  } else {
    mainWindow.loadURL(startUrl);
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Open DevTools in development
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Initialize Whisper clients
function initializeWhisperClients() {
  // Initialize service registry
  console.log('Initializing Service Registry');
  serviceRegistry = new ServiceRegistry();
  
  // Initialize cloud client
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log('Initializing Whisper cloud client with API key from environment');
    whisperClient = new WhisperApiClient(apiKey);
  } else {
    console.log('No API key found in environment variables');
    whisperClient = new WhisperApiClient();
  }
  
  // Initialize local client
  console.log('Initializing Whisper local client');
  whisperLocalClient = new WhisperLocalClient();
  
  // Register services with the registry
  serviceRegistry.registerService('cloud', whisperClient, {
    priority: 1,
    healthCheck: true,
    fallback: false
  });
  
  serviceRegistry.registerService('local', whisperLocalClient, {
    priority: 2,
    healthCheck: true,
    fallback: true
  });
  
  // Set initial service based on currentMode
  if (currentMode === 'local') {
    serviceRegistry.switchToService('local', { force: true }).catch(error => {
      console.warn('Failed to switch to local service, falling back to cloud:', error);
      currentMode = 'cloud';
      serviceRegistry.switchToService('cloud', { force: true });
    });
  } else {
    serviceRegistry.switchToService('cloud', { force: true }).catch(error => {
      console.warn('Failed to switch to cloud service:', error);
    });
  }
  
  // Set fallback service
  serviceRegistry.setFallbackService('cloud');
  
  // Start health monitoring
  serviceRegistry.startHealthMonitoring();
  
  // Initialize model manager
  console.log('Initializing Model Manager');
  modelManager = new ModelManager();
  
  // Set up model manager event listeners
  modelManager.on('downloadStarted', (data) => {
    mainWindow?.webContents.send('model-download-started', data);
  });
  
  modelManager.on('downloadProgress', (data) => {
    mainWindow?.webContents.send('model-download-progress', data);
  });
  
  modelManager.on('downloadCompleted', (data) => {
    mainWindow?.webContents.send('model-download-completed', data);
  });
  
  modelManager.on('downloadError', (data) => {
    mainWindow?.webContents.send('model-download-error', data);
  });
  
  modelManager.on('downloadCancelled', (data) => {
    mainWindow?.webContents.send('model-download-cancelled', data);
  });
  
  modelManager.on('modelDeleted', (data) => {
    mainWindow?.webContents.send('model-deleted', data);
  });
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  initializeWhisperClients();

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    require('electron').shell.openExternal(navigationUrl);
  });
});

// IPC handlers for communication with renderer process
ipcMain.handle('app-version', () => {
  return app.getVersion();
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Audio file dialog handler
ipcMain.handle('show-audio-file-dialog', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Audio File',
    filters: [
      {
        name: 'Audio Files',
        extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'webm']
      },
      {
        name: 'All Files',
        extensions: ['*']
      }
    ],
    properties: ['openFile']
  });
  return result;
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

// Whisper API handlers
ipcMain.handle('whisper-set-api-key', async (event, apiKey) => {
  try {
    if (!whisperClient) {
      whisperClient = new WhisperApiClient(apiKey);
    } else {
      whisperClient.setApiKey(apiKey);
    }
    
    // Test the connection
    const isValid = await whisperClient.testConnection();
    return { success: true, valid: isValid };
  } catch (error) {
    console.error('Error setting API key:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whisper-validate-api-key', async (event, apiKey) => {
  try {
    if (!whisperClient) {
      whisperClient = new WhisperApiClient();
    }
    
    const isValidFormat = whisperClient.validateApiKey(apiKey);
    if (!isValidFormat) {
      return { valid: false, error: 'Invalid API key format' };
    }
    
    whisperClient.setApiKey(apiKey);
    const isValid = await whisperClient.testConnection();
    return { valid: isValid };
  } catch (error) {
    console.error('Error validating API key:', error);
    return { valid: false, error: error.message };
  }
});

// Check if API key is already configured
ipcMain.handle('whisper-check-api-key', async () => {
  try {
    if (!whisperClient) {
      return { configured: false };
    }
    
    const isValid = await whisperClient.testConnection();
    return { configured: true, valid: isValid };
  } catch (error) {
    console.error('Error checking API key:', error);
    return { configured: true, valid: false, error: error.message };
  }
});



ipcMain.handle('whisper-transcribe-audio', async (event, audioInput, options = {}) => {
  let tempFilePath = null;
  
  try {
    let audioFilePath;
    
    // Check if audioInput is a serialized File object or a file path
    if (typeof audioInput === 'string') {
      // It's a file path
      audioFilePath = audioInput;
    } else if (audioInput && typeof audioInput === 'object' && audioInput.arrayBuffer) {
      // It's a serialized File object from recorded audio - save to temp file
      console.log('Processing recorded audio file:', audioInput.name);
      
      const tempDir = os.tmpdir();
      const fileExtension = audioInput.name.split('.').pop() || 'webm';
      tempFilePath = path.join(tempDir, `whisper-temp-${Date.now()}.${fileExtension}`);
      
      // Convert serialized arrayBuffer back to Buffer and save
      const uint8Array = new Uint8Array(audioInput.arrayBuffer);
      const buffer = Buffer.from(uint8Array);
      fs.writeFileSync(tempFilePath, buffer);
      
      audioFilePath = tempFilePath;
      console.log('Saved recorded audio to temp file:', tempFilePath, 'Size:', audioInput.size);
    } else if (audioInput && audioInput.path) {
      // This is a file object with path property
      audioFilePath = audioInput.path;
    } else {
      throw new Error('Invalid audio input. Expected file path or File object.');
    }
    
    console.log(`Starting transcription using ServiceRegistry for:`, audioFilePath);
    
    // Set up progress callback
    const onProgress = (progressData) => {
      mainWindow.webContents.send('transcription-progress', progressData);
    };
    
    // Use ServiceRegistry for transcription with automatic fallback
    const transcriptionOptions = {
      ...options,
      onProgress
    };
    
    const result = await serviceRegistry.executeWithFallback(
      'transcribeAudio',
      [audioFilePath, transcriptionOptions],
      {
        timeout: 300000, // 5 minutes timeout
        retryAttempts: 1
      }
    );
    
    // Send completion event
    mainWindow.webContents.send('transcription-complete', {
      ...result.data,
      serviceUsed: result.serviceUsed,
      fallbackUsed: result.fallbackUsed
    });
    
    return { success: true, result: result.data };
  } catch (error) {
    console.error('Transcription error:', error);
    
    // Send error event
    mainWindow.webContents.send('transcription-error', {
      type: error.type || 'TRANSCRIPTION_ERROR',
      message: error.message,
      userMessage: error.userMessage || error.message
    });
    
    return { 
      success: false, 
      error: {
        type: error.type || 'TRANSCRIPTION_ERROR',
        message: error.message,
        userMessage: error.userMessage || error.message
      }
    };
  } finally {
    // Clean up temporary file if it was created
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('Cleaned up temporary file:', tempFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
  }
});

ipcMain.handle('whisper-test-connection', async (event) => {
  try {
    if (!whisperClient) {
      return { success: false, message: 'No API key set. Please configure your OpenAI API key first.' };
    }
    
    const isConnected = await whisperClient.testConnection();
    if (isConnected) {
      return { success: true, message: 'Connection successful! API key is valid and working.' };
    } else {
      return { success: false, message: 'Connection failed. Please check your API key.' };
    }
  } catch (error) {
    console.error('Connection test error:', error);
    return { success: false, message: `Connection failed: ${error.message}` };
  }
});

// Service Registry IPC handlers
ipcMain.handle('service-get-status', async () => {
  try {
    return {
      currentService: serviceRegistry.getCurrentService(),
      availableServices: serviceRegistry.getAvailableServices(),
      healthStatus: serviceRegistry.getHealthStatus(),
      fallbackService: serviceRegistry.getFallbackService()
    };
  } catch (error) {
    console.error('Error getting service status:', error);
    throw error;
  }
});

ipcMain.handle('service-switch', async (event, serviceName, options = {}) => {
  try {
    const result = await serviceRegistry.switchToService(serviceName, options);
    if (result.success) {
      currentMode = serviceName;
    }
    return result;
  } catch (error) {
    console.error('Error switching service:', error);
    throw error;
  }
});

ipcMain.handle('service-health-check', async (event, serviceName) => {
  try {
    return await serviceRegistry.checkServiceHealth(serviceName);
  } catch (error) {
    console.error('Error checking service health:', error);
    throw error;
  }
});

ipcMain.handle('service-get-config', async (event, serviceName) => {
  try {
    return serviceRegistry.getServiceConfig(serviceName);
  } catch (error) {
    console.error('Error getting service config:', error);
    throw error;
  }
});

// Model Management IPC handlers
ipcMain.handle('model-get-available-models', async () => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.getAvailableModels();
  } catch (error) {
    console.error('Error getting available models:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('model-get-downloaded-models', async () => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.getDownloadedModels();
  } catch (error) {
    console.error('Error getting downloaded models:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('model-download', async (event, modelName) => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.downloadModel(modelName);
  } catch (error) {
    console.error('Error downloading model:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('model-cancel-download', async (event, modelName) => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.cancelDownload(modelName);
  } catch (error) {
    console.error('Error cancelling download:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('model-delete', async (event, modelName) => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.deleteModel(modelName);
  } catch (error) {
    console.error('Error deleting model:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('model-get-download-status', async (event, modelName) => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.getDownloadStatus(modelName);
  } catch (error) {
    console.error('Error getting download status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('model-verify-integrity', async (event, modelName) => {
  try {
    console.log(`[IPC] Received model-verify-integrity request for: ${modelName}`);
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    const result = await modelManager.verifyModelIntegrity(modelName);
    console.log(`[IPC] Verification result for ${modelName}:`, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error verifying model integrity:', error);
    const errorResult = { success: false, error: error.message };
    console.log(`[IPC] Error result for ${modelName}:`, JSON.stringify(errorResult, null, 2));
    return errorResult;
  }
});

ipcMain.handle('model-get-storage-info', async () => {
  try {
    if (!modelManager) {
      throw new Error('Model manager not initialized');
    }
    return await modelManager.getStorageInfo();
  } catch (error) {
    console.error('Error getting storage info:', error);
    return { success: false, error: error.message };
  }
});

// Handle app protocol for deep linking (optional)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('whisper-transcript', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('whisper-transcript');
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Graceful shutdown handlers
const gracefulShutdown = async () => {
  console.log('Initiating graceful shutdown...');
  
  try {
    // Stop service registry health monitoring
    if (serviceRegistry) {
      serviceRegistry.stopHealthMonitoring();
    }
    
    // Shutdown local whisper client
    if (whisperLocalClient) {
      await whisperLocalClient.shutdown();
    }
    
    // Cancel any ongoing model downloads
    if (modelManager) {
      await modelManager.cancelAllDownloads();
    }
    
    console.log('Graceful shutdown completed');
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
  }
};

// Handle app shutdown events
app.on('before-quit', async (event) => {
  console.log('App before-quit event triggered');
  event.preventDefault();
  
  await gracefulShutdown();
  app.exit(0);
});

app.on('will-quit', async (event) => {
  console.log('App will-quit event triggered');
  event.preventDefault();
  
  await gracefulShutdown();
  app.exit(0);
});

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT (Ctrl+C), shutting down gracefully...');
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await gracefulShutdown();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await gracefulShutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  await gracefulShutdown();
  process.exit(1);
});