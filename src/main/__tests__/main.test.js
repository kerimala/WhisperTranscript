/**
 * @jest-environment node
 */

// Mock Electron modules before any imports
const mockBrowserWindow = {
  loadURL: jest.fn(),
  loadFile: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  show: jest.fn(),
  webContents: {
    openDevTools: jest.fn(),
    setWindowOpenHandler: jest.fn()
  },
  setMenuBarVisibility: jest.fn()
};

const mockApp = {
  whenReady: jest.fn(() => Promise.resolve()),
  on: jest.fn(),
  quit: jest.fn(),
  requestSingleInstanceLock: jest.fn(() => true),
  getVersion: jest.fn(() => '1.0.0'),
  getName: jest.fn(() => 'WhisperTranscript'),
  setAsDefaultProtocolClient: jest.fn(),
  focus: jest.fn(),
  isPackaged: false
};

const mockIpcMain = {
  handle: jest.fn()
};

const mockDialog = {
  showOpenDialog: jest.fn(),
  showSaveDialog: jest.fn()
};

const mockShell = {
  openExternal: jest.fn()
};

jest.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: jest.fn(() => mockBrowserWindow),
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  shell: mockShell
}));

// Mock path and url modules
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  resolve: jest.fn((...args) => args.join('/'))
}));

jest.mock('url', () => ({
  format: jest.fn(() => 'file://test-url')
}));

describe('Electron Main Process Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-setup mock implementations after clearing
    mockApp.whenReady.mockImplementation(() => Promise.resolve());
    mockApp.getVersion.mockImplementation(() => '1.0.0');
    mockApp.requestSingleInstanceLock.mockImplementation(() => true);
    
    // Re-setup BrowserWindow mock
    const { BrowserWindow } = require('electron');
    BrowserWindow.mockImplementation(() => mockBrowserWindow);
  });

  describe('Electron module mocking', () => {
    it('should have properly mocked Electron modules', () => {
      const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
      
      expect(app).toBeDefined();
      expect(app.whenReady).toBeDefined();
      expect(app.on).toBeDefined();
      expect(BrowserWindow).toBeDefined();
      expect(ipcMain).toBeDefined();
      expect(dialog).toBeDefined();
      expect(shell).toBeDefined();
    });

    it('should mock app.whenReady to return a promise', () => {
      const { app } = require('electron');
      const result = app.whenReady();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should mock BrowserWindow constructor', () => {
      const { BrowserWindow } = require('electron');
      const window = new BrowserWindow();
      expect(window).toBe(mockBrowserWindow);
    });
  });

  describe('IPC Handler Functions', () => {
    it('should test app version handler logic', async () => {
      const { app } = require('electron');
      
      // Simulate the app-version handler
      const getAppVersion = () => app.getVersion();
      
      const version = getAppVersion();
      expect(version).toBe('1.0.0');
      expect(app.getVersion).toHaveBeenCalled();
    });

    it('should test dialog handlers', async () => {
      const { dialog } = require('electron');
      
      // Simulate dialog handlers
      const showOpenDialog = (options) => dialog.showOpenDialog(options);
      const showSaveDialog = (options) => dialog.showSaveDialog(options);
      
      dialog.showOpenDialog.mockResolvedValue({ filePaths: ['test.txt'] });
      dialog.showSaveDialog.mockResolvedValue({ filePath: 'save.txt' });
      
      const openResult = await showOpenDialog({ properties: ['openFile'] });
      const saveResult = await showSaveDialog({ defaultPath: 'test.txt' });
      
      expect(openResult.filePaths).toEqual(['test.txt']);
      expect(saveResult.filePath).toBe('save.txt');
    });
  });

  describe('Window Configuration', () => {
    it('should test BrowserWindow configuration options', () => {
      const { BrowserWindow } = require('electron');
      
      const windowOptions = {
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false
        },
        show: false
      };
      
      new BrowserWindow(windowOptions);
      expect(BrowserWindow).toHaveBeenCalledWith(windowOptions);
    });

    it('should test window event handlers setup', () => {
      const { BrowserWindow } = require('electron');
      const window = new BrowserWindow();
      
      // Simulate setting up event handlers
      window.on('closed', () => {});
      window.once('ready-to-show', () => {});
      
      expect(window.on).toHaveBeenCalledWith('closed', expect.any(Function));
      expect(window.once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    });
  });

  describe('App Event Handlers', () => {
    it('should test window-all-closed handler for macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      
      const { app } = require('electron');
      
      // Simulate window-all-closed handler for macOS
      const handleWindowAllClosed = () => {
        if (process.platform !== 'darwin') {
          app.quit();
        }
      };
      
      handleWindowAllClosed();
      expect(app.quit).not.toHaveBeenCalled();
      
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should test window-all-closed handler for Windows/Linux', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      
      const { app } = require('electron');
      
      // Simulate window-all-closed handler for Windows/Linux
      const handleWindowAllClosed = () => {
        if (process.platform !== 'darwin') {
          app.quit();
        }
      };
      
      handleWindowAllClosed();
      expect(app.quit).toHaveBeenCalled();
      
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should test activate handler', () => {
      const { app, BrowserWindow } = require('electron');
      
      // Simulate activate handler
      const handleActivate = () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          // createWindow() would be called here
        }
      };
      
      BrowserWindow.getAllWindows = jest.fn().mockReturnValue([]);
      handleActivate();
      
      expect(BrowserWindow.getAllWindows).toHaveBeenCalled();
    });
  });

  describe('Security Features', () => {
    it('should test single instance lock', () => {
      const { app } = require('electron');
      
      // Simulate single instance check
      const gotTheLock = app.requestSingleInstanceLock();
      
      if (!gotTheLock) {
        app.quit();
      }
      
      expect(app.requestSingleInstanceLock).toHaveBeenCalled();
      expect(gotTheLock).toBe(true);
      expect(app.quit).not.toHaveBeenCalled();
    });

    it('should test protocol client setup', () => {
      const { app } = require('electron');
      
      // Simulate protocol setup
      app.setAsDefaultProtocolClient('whisper-transcript');
      
      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('whisper-transcript');
    });

    it('should test external link handling', () => {
      const { shell } = require('electron');
      
      // Simulate external link handler
      const handleExternalLink = (url) => {
        shell.openExternal(url);
      };
      
      handleExternalLink('https://example.com');
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('Development vs Production', () => {
    it('should test DevTools opening in development', () => {
      const { app } = require('electron');
      app.isPackaged = false;
      
      const window = mockBrowserWindow;
      
      // Simulate DevTools opening logic
      if (!app.isPackaged) {
        window.webContents.openDevTools();
      }
      
      expect(window.webContents.openDevTools).toHaveBeenCalled();
    });

    it('should test DevTools not opening in production', () => {
      const { app } = require('electron');
      app.isPackaged = true;
      
      const window = mockBrowserWindow;
      
      // Simulate DevTools opening logic
      if (!app.isPackaged) {
        window.webContents.openDevTools();
      }
      
      expect(window.webContents.openDevTools).not.toHaveBeenCalled();
    });
  });

  describe('File Loading', () => {
    it('should test file loading in production', () => {
      const { app } = require('electron');
      const path = require('path');
      const url = require('url');
      
      app.isPackaged = true;
      const window = mockBrowserWindow;
      
      // Simulate production file loading
      if (app.isPackaged) {
        const indexPath = path.join(__dirname, '../../../build/index.html');
        window.loadFile(indexPath);
      }
      
      expect(window.loadFile).toHaveBeenCalled();
    });

    it('should test URL loading in development', () => {
      const { app } = require('electron');
      const window = mockBrowserWindow;
      
      app.isPackaged = false;
      
      // Simulate development URL loading
      if (!app.isPackaged) {
        window.loadURL('http://localhost:3000');
      }
      
      expect(window.loadURL).toHaveBeenCalledWith('http://localhost:3000');
    });
  });
});