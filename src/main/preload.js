const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getVersion: () => ipcRenderer.invoke('app-version'),
  
  // Dialog methods
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showAudioFileDialog: () => ipcRenderer.invoke('show-audio-file-dialog'),
  
  // File system operations (we'll add these as needed)
  // readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  // writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  
  // Whisper API operations
  whisper: {
    setApiKey: (apiKey) => ipcRenderer.invoke('whisper-set-api-key', apiKey),
    validateApiKey: (apiKey) => ipcRenderer.invoke('whisper-validate-api-key', apiKey),
    transcribeAudio: (audioPath, options) => ipcRenderer.invoke('whisper-transcribe-audio', audioPath, options),
    testConnection: () => ipcRenderer.invoke('whisper-test-connection'),
    checkApiKeyStatus: () => ipcRenderer.invoke('whisper-check-api-key')
  },
  
  // Generic invoke method for backward compatibility
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  
  // Event listeners
  onTranscriptionProgress: (callback) => {
    ipcRenderer.on('transcription-progress', callback);
    return () => ipcRenderer.removeListener('transcription-progress', callback);
  },
  
  onTranscriptionComplete: (callback) => {
    ipcRenderer.on('transcription-complete', callback);
    return () => ipcRenderer.removeListener('transcription-complete', callback);
  },
  
  onTranscriptionError: (callback) => {
    ipcRenderer.on('transcription-error', callback);
    return () => ipcRenderer.removeListener('transcription-error', callback);
  }
});

// Platform detection
contextBridge.exposeInMainWorld('platform', {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux'
});

// Environment info
contextBridge.exposeInMainWorld('env', {
  isDev: process.env.NODE_ENV === 'development'
});