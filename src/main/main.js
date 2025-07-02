// Load environment variables from .env file
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const WhisperApiClient = require('./services/whisperApiClient');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let whisperClient;

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

// App event handlers
app.whenReady().then(() => {
  createWindow();

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

ipcMain.handle('whisper-transcribe-audio', async (event, audioFilePath, options = {}) => {
  try {
    if (!whisperClient) {
      throw new Error('Whisper client not initialized. Please set your API key first.');
    }
    
    // Set up progress callback
    const onProgress = (progressData) => {
      mainWindow.webContents.send('transcription-progress', progressData);
    };
    
    const result = await whisperClient.transcribeAudio(audioFilePath, {
      ...options,
      onProgress
    });
    
    // Send completion event
    mainWindow.webContents.send('transcription-complete', result);
    
    return { success: true, result };
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
  }
});

ipcMain.handle('whisper-test-connection', async (event) => {
  try {
    if (!whisperClient) {
      return { success: false, error: 'No API key set' };
    }
    
    const isConnected = await whisperClient.testConnection();
    return { success: true, connected: isConnected };
  } catch (error) {
    console.error('Connection test error:', error);
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