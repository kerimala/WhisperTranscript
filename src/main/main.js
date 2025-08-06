// Load environment variables from .env file
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ERROR_TYPES, createStandardError, structuredLog, validateInput, safeFileOperation } = require('./utils/errorHandler');
const { secureStorage } = require('./utils/secureStorage');
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

// Function to initialize global hotkey from saved settings
function initializeGlobalHotkey() {
  try {
    // Get the config directory path
    const configDir = path.join(os.homedir(), '.whispertranscript');
    const configPath = path.join(configDir, 'config.json');
    
    let savedHotkey = 'CommandOrControl+Shift+D'; // Default fallback
    
    // Try to read saved hotkey from config file
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.globalHotkey) {
          savedHotkey = config.globalHotkey;
        }
      } catch (error) {
        console.warn('Failed to read hotkey from config file:', error);
      }
    }
    
    // Register the hotkey
    const ret = globalShortcut.register(savedHotkey, () => {
      console.log(`Global shortcut ${savedHotkey} pressed`);
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('global-shortcut-triggered', 'dictation-toggle');
      }
    });
    
    if (!ret) {
      console.log(`Global shortcut registration failed for: ${savedHotkey}`);
    } else {
      console.log(`Global shortcut registered successfully: ${savedHotkey}`);
    }
  } catch (error) {
    console.error('Error initializing global hotkey:', error);
  }
}

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
    icon: path.join(__dirname, '../../assets/icon.svg'),
    show: false, // Don't show until ready
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

// IPC handlers for local Whisper service
ipcMain.handle('whisper-get-mode', async () => {
  return currentMode;
});

ipcMain.handle('whisper-set-mode', async (event, mode) => {
  try {
    console.log(`[Main] whisper-set-mode called with mode: ${mode}, current currentMode: ${currentMode}`);
    if (mode === 'cloud' || mode === 'local') {
      const previousMode = currentMode;
      
      // Use ServiceRegistry to switch services
      const serviceName = mode === 'local' ? 'local' : 'cloud';
      
      try {
        const switchResult = await serviceRegistry.switchToService(serviceName, { 
          preserveState: true,
          timeout: 10000 
        });
        
        if (switchResult.success) {
          // Check if the actual service matches the requested service
          const actualService = switchResult.service || serviceRegistry.getCurrentService();
          const actualMode = actualService === 'local' ? 'local' : 'cloud';
          
          if (actualMode === mode) {
            // Successful switch to requested service
            currentMode = mode;
            console.log(`[Main] Transcription mode switched from ${previousMode} to: ${mode}, currentMode now: ${currentMode}, serviceRegistry currentService: ${serviceRegistry.getCurrentService()}`);
            return { 
              success: true, 
              mode: currentMode,
              previousMode,
              serviceInfo: switchResult.serviceInfo
            };
          } else {
            // Fallback occurred - service registry succeeded but used different service
            currentMode = actualMode;
            console.log(`[Main] Fallback occurred during switch. Requested: ${mode}, actual service: ${actualService}, currentMode updated to: ${currentMode}`);
            
            return {
              success: false,
              error: `Failed to switch to ${mode} service. Using ${actualMode} service instead.`,
              fallbackUsed: true,
              actualMode: actualMode,
              requestedMode: mode
            };
          }
        }
      } catch (switchError) {
        console.warn(`Failed to switch to ${mode} service:`, switchError.message);
        
        // Check what service is actually active after the failed switch (fallback might have occurred)
        const actualService = serviceRegistry.getCurrentService();
        const actualMode = actualService === 'local' ? 'local' : 'cloud';
        
        // Provide more specific error messages based on the error type and service
        let userFriendlyError = switchError.message;
        let troubleshootingTips = '';
        
        if (mode === 'local') {
          if (switchError.message.includes('Python') || switchError.message.includes('dependencies')) {
            userFriendlyError = 'Local transcription requires Python 3.7+ and additional packages.';
            troubleshootingTips = 'Please install Python and run: pip install openai-whisper torch';
          } else if (switchError.message.includes('not available') || switchError.message.includes('not healthy')) {
            userFriendlyError = 'Local transcription service failed to start.';
            troubleshootingTips = 'Check that Python and required dependencies are installed. Try running the service manually to see detailed error messages.';
          } else if (switchError.message.includes('Address already in use') || switchError.message.includes('port')) {
            userFriendlyError = 'Local transcription service port is already in use.';
            troubleshootingTips = 'Another instance may be running. Try restarting the application.';
          } else if (switchError.message.includes('Whisper module not found') || switchError.message.includes('openai-whisper')) {
            userFriendlyError = 'OpenAI Whisper package not found in any Python installation.';
            troubleshootingTips = 'The app checked both virtual environments (.venv, venv, env) and system Python installations. If using a virtual environment, activate it first. Try: python3 -m pip install openai-whisper';
          } else if (switchError.message.includes('Prerequisites not met')) {
            // Extract more specific information from the prerequisite check if available
            userFriendlyError = switchError.message;
            troubleshootingTips = 'The app automatically detects virtual environments in your project folder. If you have a .venv folder with whisper installed, it should be detected automatically.';
          } else {
            userFriendlyError = `Local transcription service error: ${switchError.message}`;
            troubleshootingTips = 'The app searches for Python in this order: 1) Virtual environments (.venv, venv, env), 2) System installations. If whisper is installed in a virtual environment, make sure the .venv folder is in your project root.';
          }
        }
        
        if (actualMode !== mode) {
          // Fallback occurred, update currentMode to match actual service
          currentMode = actualMode;
          console.log(`[Main] Fallback occurred. Requested: ${mode}, actual service: ${actualService}, currentMode updated to: ${currentMode}`);
          
          return {
            success: false,
            error: `Failed to switch to ${mode} service. Using ${actualMode} service instead.`,
            userFriendlyError: userFriendlyError,
            troubleshootingTips: troubleshootingTips,
            fallbackUsed: true,
            actualMode: actualMode,
            requestedMode: mode
          };
        } else {
          // No fallback, genuine failure
          return { 
            success: false, 
            error: `Failed to switch to ${mode} service: ${switchError.message}`,
            userFriendlyError: userFriendlyError,
            troubleshootingTips: troubleshootingTips,
            fallbackUsed: false
          };
        }
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
  if (!whisperLocalClient) {
    // During startup, the client might not be initialized yet.
    // Return a default 'stopped' status to avoid UI errors.
    return {
      success: true,
      status: 'stopped',
      isRunning: false,
      isReady: false,
      isStarting: false,
      processId: null,
      uptime: 0,
      restartAttempts: 0,
      lastHealthCheck: null,
      currentModel: null,
    };
  }
  try {
    const statusObj = whisperLocalClient.getServiceStatus();

    // Convert complex status object to simple status string for UI
    let status = 'unknown';
    if (statusObj.isStarting) {
      status = 'starting';
    } else if (statusObj.isRunning && statusObj.isReady) {
      status = 'running';
    } else if (statusObj.isRunning && !statusObj.isReady) {
      // If it's running but not ready, it's still in the process of starting up
      status = 'starting';
    } else {
      status = 'stopped';
    }

    return {
      success: true,
      status,
      isRunning: statusObj.isRunning,
      isReady: statusObj.isReady,
      isStarting: statusObj.isStarting,
      processId: statusObj.processId,
      uptime: statusObj.uptime,
      restartAttempts: statusObj.restartAttempts,
      lastHealthCheck: statusObj.lastHealthCheck,
      currentModel: statusObj.currentModel,
    };
  } catch (error) {
    return { success: false, error: error.message, status: 'error' };
  }
});

ipcMain.handle('whisper-local-check-prerequisites', async () => {
  if (!whisperLocalClient) {
    return {
      success: false,
      error: 'Local whisper client not initialized',
      missing: ['client'],
      details: {}
    };
  }
  try {
    const prereqResult = await whisperLocalClient.checkPrerequisites();
    return prereqResult;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      missing: ['unknown'],
      details: { error: error.message }
    };
  }
});

ipcMain.handle('whisper-local-get-diagnostics', async () => {
  if (!whisperLocalClient) {
    return {
      error: 'Local whisper client not initialized'
    };
  }
  try {
    const diagnostics = await whisperLocalClient.getDiagnosticInfo();
    return diagnostics;
  } catch (error) {
    return {
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// New automated dependency installation handlers
ipcMain.handle('whisper-local-auto-install-dependencies', async (event, options = {}) => {
  if (!whisperLocalClient) {
    return {
      success: false,
      error: 'Local whisper client not initialized'
    };
  }
  try {
    const result = await whisperLocalClient.autoInstallDependencies({
      ...options,
      onProgress: (progressData) => {
        // Send progress updates to the renderer process
        mainWindow?.webContents.send('dependency-installation-progress', progressData);
      }
    });
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('whisper-local-setup-virtual-environment', async (event, pythonPath) => {
  if (!whisperLocalClient) {
    return {
      success: false,
      error: 'Local whisper client not initialized'
    };
  }
  try {
    const result = await whisperLocalClient.setupVirtualEnvironment(pythonPath, (progressData) => {
      mainWindow?.webContents.send('dependency-installation-progress', progressData);
    });
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('whisper-local-find-conda-environments', async () => {
  if (!whisperLocalClient) {
    return {
      success: false,
      error: 'Local whisper client not initialized',
      environments: []
    };
  }
  try {
    const environments = await whisperLocalClient.findCondaEnvironments();
    return {
      success: true,
      environments: environments
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      environments: []
    };
  }
});

ipcMain.handle('whisper-local-find-python-environments', async () => {
  if (!whisperLocalClient) {
    return {
      success: false,
      error: 'Local whisper client not initialized'
    };
  }
  try {
    const result = await whisperLocalClient.findWorkingPythonPath();
    return {
      success: true,
      result: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

  // Load the index.html of the app.
  if (isDev) {
    // In development, load the app from the local web server
    mainWindow.loadURL('http://localhost:3001');
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the app from the local file system
    mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
  }

  // Show the window when it's ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Initialize hotkey from saved settings
    initializeGlobalHotkey();
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

// IPC handler for getting the saved global hotkey
ipcMain.handle('get-global-hotkey', () => {
  try {
    const configDir = path.join(os.homedir(), '.whispertranscript');
    const configPath = path.join(configDir, 'config.json');
    
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.globalHotkey || 'CommandOrControl+Shift+D';
      } catch (error) {
        console.warn('Failed to read hotkey from config file:', error);
      }
    }
    
    return 'CommandOrControl+Shift+D'; // Default fallback
  } catch (error) {
    console.error('Error getting global hotkey:', error);
    return 'CommandOrControl+Shift+D';
  }
});

// IPC handler for registering a custom shortcut
ipcMain.handle('register-shortcut', (event, shortcut) => {
  // Validate shortcut format
  if (!shortcut || typeof shortcut !== 'string' || shortcut.trim() === '') {
    console.error('Invalid shortcut provided:', shortcut);
    return false;
  }

  const normalizedShortcut = shortcut.trim();
  
  // Check if the exact same shortcut is already registered
  if (globalShortcut.isRegistered(normalizedShortcut)) {
    console.log(`Shortcut ${normalizedShortcut} is already registered`);
    return true; // Consider this a success since the desired shortcut is active
  }
  
  try {
    // Create the shortcut callback
    const shortcutCallback = () => {
      console.log(`Global shortcut ${normalizedShortcut} pressed`);
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('global-shortcut-triggered', 'dictation-toggle');
      }
    };

    // Attempt to register the new shortcut first
    const registrationSuccess = globalShortcut.register(normalizedShortcut, shortcutCallback);

    if (!registrationSuccess) {
      console.error(`Failed to register shortcut ${normalizedShortcut}: registration failed`);
      return false;
    }

    // Only if registration succeeded, unregister other shortcuts to avoid conflicts
    // First get the list of all registered shortcuts
    const allRegisteredShortcuts = [];
    
    // Since Electron doesn't provide a way to get all registered shortcuts,
    // we'll unregister all and re-register our new one to ensure no conflicts
    // But we do this atomically by keeping track of success
    try {
      // Unregister all old shortcuts
      globalShortcut.unregisterAll();
      
      // Re-register our shortcut immediately to avoid the gap
      const finalRegistration = globalShortcut.register(normalizedShortcut, shortcutCallback);
      
      if (!finalRegistration) {
        console.error(`Failed to re-register shortcut ${normalizedShortcut} after cleanup`);
        return false;
      }
    } catch (cleanupError) {
      console.error('Error during shortcut cleanup:', cleanupError);
      // At least try to register our shortcut again
      try {
        globalShortcut.register(normalizedShortcut, shortcutCallback);
      } catch (fallbackError) {
        console.error('Fallback registration also failed:', fallbackError);
        return false;
      }
    }

    // Save the hotkey to config file
    try {
      const configDir = path.join(os.homedir(), '.whispertranscript');
      const configPath = path.join(configDir, 'config.json');
      
      // Ensure config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Read existing config or create new one
      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
          console.warn('Failed to read existing config, creating new one:', error);
        }
      }
      
      // Update hotkey in config
      config.globalHotkey = shortcut;
      
      // Write config back to file
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`Hotkey ${shortcut} saved to config file`);
    } catch (error) {
      console.error('Failed to save hotkey to config file:', error);
      // Don't fail the registration if we can't save to file
    }

    console.log(`Shortcut ${shortcut} registered successfully`);
    return true;
  } catch (error) {
    console.error('Failed to register shortcut:', error);
    return false;
  }
});

// Initialize Whisper clients
async function initializeWhisperClients() {
  // Initialize service registry
  console.log('Initializing Service Registry');
  serviceRegistry = new ServiceRegistry();
  
  // Initialize secure storage and migrate from plain text config
  console.log('Initializing secure storage and performing migration');
  try {
    const migrationResult = await secureStorage.migrateFromPlainText();
    if (migrationResult.migrated) {
      structuredLog('info', 'AppStartup', 'Successfully migrated API key to secure storage', {
        migratedKeys: migrationResult.migratedKeys,
        errorCount: migrationResult.errors.length
      });
    }
    if (migrationResult.errors.length > 0) {
      structuredLog('warn', 'AppStartup', 'Some migration errors occurred', {
        errors: migrationResult.errors
      });
    }
  } catch (error) {
    structuredLog('error', 'AppStartup', 'Failed to perform secure storage migration', { error: error.message });
  }
  
  // Initialize cloud client - check secure storage first, then environment
  let apiKey = null;
  try {
    apiKey = await secureStorage.getSecure('openaiApiKey');
    if (apiKey) {
      structuredLog('info', 'AppStartup', 'Loaded API key from secure storage');
    }
  } catch (error) {
    structuredLog('warn', 'AppStartup', 'Failed to load API key from secure storage, trying environment', { error: error.message });
  }
  
  // Fallback to environment variable if no secure storage
  if (!apiKey) {
    apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      structuredLog('info', 'AppStartup', 'Loaded API key from environment variable');
    }
  }
  
  if (apiKey) {
    console.log('Initializing Whisper cloud client with API key');
    try {
      whisperClient = new WhisperApiClient(apiKey);
      // Validate the API key format
      whisperClient.validateApiKey(apiKey);
      structuredLog('info', 'AppStartup', 'Whisper cloud client initialized successfully');
    } catch (error) {
      structuredLog('error', 'AppStartup', 'Failed to initialize Whisper cloud client with stored API key', { error: error.message });
      whisperClient = new WhisperApiClient(); // Initialize without API key
    }
  } else {
    console.log('No API key found in secure storage or environment variables');
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
  console.log(`[Main] Initial currentMode: ${currentMode}`);
  console.log(`[Main] ServiceRegistry currentService: ${serviceRegistry.getCurrentService()}`);
  
  if (currentMode === 'local') {
    try {
      await serviceRegistry.switchToService('local', { force: true });
      console.log(`[Main] Successfully switched to local service`);
    } catch (error) {
      console.warn('Failed to switch to local service, falling back to cloud:', error);
      currentMode = 'cloud';
      await serviceRegistry.switchToService('cloud', { force: true });
    }
  } else {
    try {
      await serviceRegistry.switchToService('cloud', { force: true });
      console.log(`[Main] Successfully switched to cloud service`);
    } catch (error) {
      console.warn('Failed to switch to cloud service:', error);
    }
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
app.whenReady().then(async () => {
  createWindow();
  await initializeWhisperClients();

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
  const context = 'whisper-set-api-key';
  
  try {
    // Validate input
    validateInput(
      { apiKey },
      {
        apiKey: { required: true, type: 'string', minLength: 1 }
      },
      context
    );

    // Initialize or update whisper client
    if (!whisperClient) {
      whisperClient = new WhisperApiClient(apiKey);
    } else {
      whisperClient.setApiKey(apiKey);
    }
    
    // Validate API key format first (will throw if invalid)
    whisperClient.validateApiKey(apiKey);
    
    // Test the connection
    const isValid = await whisperClient.testConnection();
    
    if (isValid) {
      // Store API key securely
      await secureStorage.setSecure('openaiApiKey', apiKey);
      structuredLog('info', context, 'API key validated and stored securely');
      
      return { success: true, valid: true, message: 'API key saved securely' };
    } else {
      structuredLog('warn', context, 'API key format valid but connection test failed');
      return { 
        success: false, 
        valid: false, 
        error: 'API key validation failed. Please check your key and internet connection.' 
      };
    }
    
  } catch (error) {
    const standardError = error.type ? error : createStandardError(
      ERROR_TYPES.API_ERROR,
      `Failed to set API key: ${error.message}`,
      error.userMessage || 'Failed to save API key. Please try again.',
      { context, originalError: error.message }
    );
    
    structuredLog('error', context, standardError.message, {
      type: standardError.type,
      userMessage: standardError.userMessage
    });
    
    return { 
      success: false, 
      error: standardError.userMessage,
      type: standardError.type
    };
  }
});

ipcMain.handle('whisper-validate-api-key', async (event, apiKey) => {
  const context = 'whisper-validate-api-key';
  
  try {
    // Validate input parameters
    validateInput(
      { apiKey },
      {
        apiKey: {
          required: true,
          type: 'string',
          minLength: 1
        }
      },
      context
    );

    if (!whisperClient) {
      whisperClient = new WhisperApiClient();
    }
    
    // Validate API key format (now returns object instead of boolean)
    const formatValidation = whisperClient.validateApiKey(apiKey);
    if (!formatValidation.valid) {
      structuredLog('warn', context, 'API key format validation failed', { reason: formatValidation.message });
      return { valid: false, error: formatValidation.message || 'Invalid API key format' };
    }
    
    // Test connection with the API
    whisperClient.setApiKey(apiKey);
    const isValid = await whisperClient.testConnection();
    
    if (isValid) {
      structuredLog('info', context, 'API key validation successful');
      return { valid: true, message: 'API key is valid and working' };
    } else {
      structuredLog('warn', context, 'API key format valid but connection test failed');
      return { valid: false, error: 'API key format is correct but connection test failed. Please check your key and internet connection.' };
    }
    
  } catch (error) {
    const standardError = error.type ? error : createStandardError(
      ERROR_TYPES.API_ERROR,
      `API key validation failed: ${error.message}`,
      error.userMessage || 'Failed to validate API key. Please try again.',
      { context, originalError: error.message }
    );
    
    structuredLog('error', context, standardError.message, {
      type: standardError.type,
      userMessage: standardError.userMessage
    });
    
    return { 
      valid: false, 
      error: standardError.userMessage,
      type: standardError.type
    };
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



// Helper functions for transcription processing

/**
 * Process and validate audio input, handling different input types
 * @param {string|object} audioInput - Audio file path or serialized File object
 * @returns {Promise<{audioFilePath: string, tempFilePath: string|null}>}
 */
async function processAudioInput(audioInput) {
  let audioFilePath;
  let tempFilePath = null;

  if (typeof audioInput === 'string') {
    // Direct file path from dialog
    audioFilePath = audioInput;
  } else if (audioInput && typeof audioInput === 'object' && audioInput.arrayBuffer) {
    // Serialized File object from recorded audio - save to temp file
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
    // File object from dialog (fallback)
    audioFilePath = audioInput.path;
  } else {
    throw new Error('Invalid audio input provided');
  }

  return { audioFilePath, tempFilePath };
}

/**
 * Create progress callback for transcription updates
 * @returns {function} Progress callback function
 */
function createProgressCallback() {
  return (progressData) => {
    mainWindow?.webContents.send('transcription-progress', progressData);
  };
}

/**
 * Send transcription results to renderer process
 * @param {object} result - Transcription result from service
 */
function sendTranscriptionResult(result) {
  if (result.success) {
    mainWindow?.webContents.send('transcription-complete', {
      ...result,
      serviceUsed: result.serviceUsed,
      fallbackUsed: result.fallbackUsed,
    });
  } else {
    mainWindow?.webContents.send('transcription-error', {
      type: result.error?.type || 'TRANSCRIPTION_ERROR',
      message: result.error?.message || 'An unknown error occurred.',
      userMessage: result.error?.userMessage || 'Transcription failed.',
      serviceUsed: result.serviceUsed,
    });
  }
}

/**
 * Handle transcription errors and send to renderer
 * @param {Error} error - The error that occurred
 */
function handleTranscriptionError(error) {
  console.error('Transcription error in IPC handler:', error);
  
  mainWindow?.webContents.send('transcription-error', {
    type: error.type || 'IPC_HANDLER_ERROR',
    message: error.message,
    userMessage: error.userMessage || 'An unexpected error occurred during transcription.',
  });
  
  return { 
    success: false, 
    error: {
      type: error.type || 'IPC_HANDLER_ERROR',
      message: error.message,
      userMessage: error.userMessage || error.message,
    }
  };
}

/**
 * Clean up temporary files
 * @param {string|null} tempFilePath - Path to temporary file to clean up
 */
function cleanupTempFile(tempFilePath) {
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    try {
      fs.unlinkSync(tempFilePath);
      console.log('Cleaned up temporary file:', tempFilePath);
    } catch (cleanupError) {
      console.error('Error cleaning up temporary file:', cleanupError);
    }
  }
}

// Main transcription handler - now much cleaner and focused
ipcMain.handle('whisper-transcribe-audio', async (event, audioInput, options = {}) => {
  if (!serviceRegistry) {
    console.error('ServiceRegistry not initialized');
    return { success: false, error: 'ServiceRegistry not initialized' };
  }
  
  let tempFilePath = null;

  try {
    // Process and validate audio input
    const { audioFilePath, tempFilePath: temp } = await processAudioInput(audioInput);
    tempFilePath = temp;

    // Set up transcription options with progress callback
    const transcriptionOptions = {
      ...options,
      onProgress: createProgressCallback(),
    };

    // Execute transcription with fallback support
    const result = await serviceRegistry.executeWithFallback(
      'transcribe',
      audioFilePath, 
      transcriptionOptions
    );

    // Send results to renderer process
    sendTranscriptionResult(result);
    
    return result;

  } catch (error) {
    return handleTranscriptionError(error);
  } finally {
    cleanupTempFile(tempFilePath);
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

  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
  
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