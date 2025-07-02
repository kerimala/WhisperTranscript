const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');

/**
 * Whisper Local Client Service
 * Handles communication with the local Python Whisper service with process lifecycle management
 */
class WhisperLocalClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.pythonPath = options.pythonPath || 'python3';
    this.servicePath = path.join(__dirname, 'whisper_service.py');
    this.currentModel = options.model || 'base';
    this.isServiceReady = false;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    
    // Process management
    this.serviceProcess = null;
    this.isStarting = false;
    this.isServiceRunning = false;
    this.healthCheckInterval = null;
    this.healthCheckIntervalMs = 30000; // 30 seconds
    this.restartAttempts = 0;
    this.maxRestartAttempts = 5;
    this.processStartTime = null;
    this.lastHealthCheck = null;
    
    // Supported audio formats
    this.supportedFormats = [
      '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.webm'
    ];
    
    // Bind methods to preserve context
    this.handleProcessExit = this.handleProcessExit.bind(this);
    this.handleProcessError = this.handleProcessError.bind(this);
    this.performHealthCheck = this.performHealthCheck.bind(this);
    
    // Initialize process management
    this.initializeProcessManagement();
  }

  /**
   * Initialize process management
   * @private
   */
  initializeProcessManagement() {
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Handle application shutdown
    process.on('beforeExit', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Start the Python service process
   * @returns {Promise<boolean>} True if started successfully
   */
  async startService() {
    if (this.isServiceRunning || this.isStarting) {
      console.log('[WhisperLocal] Service is already running or starting');
      return true;
    }

    this.isStarting = true;

    try {
      console.log('[WhisperLocal] Starting Python service...');
      
      // Check prerequisites
      if (!await this.checkPrerequisites()) {
        throw new Error('Prerequisites not met');
      }

      // Start the Python service in daemon mode with HTTP server
      this.serviceProcess = spawn(this.pythonPath, [this.servicePath, 'daemon', '--model', this.currentModel, '--port', '8765'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      this.processStartTime = Date.now();
      this.restartAttempts = 0;

      // Set up process event handlers
      this.serviceProcess.on('exit', this.handleProcessExit);
      this.serviceProcess.on('error', this.handleProcessError);
      
      this.serviceProcess.stdout.on('data', (data) => {
        console.log(`[WhisperLocal] Service stdout: ${data.toString().trim()}`);
      });
      
      this.serviceProcess.stderr.on('data', (data) => {
        console.error(`[WhisperLocal] Service stderr: ${data.toString().trim()}`);
      });

      // Wait for the service to become responsive
      const isReady = await this._waitForServiceReady();
      if (!isReady) {
        throw new Error('Service started but failed to become responsive');
      }

      console.log('[WhisperLocal] Service started successfully');
      this.isServiceRunning = true;
      this.isServiceReady = true;
      this.emit('serviceStarted');
      return true;
      
    } catch (error) {
      console.error('[WhisperLocal] Failed to start service:', error.message);
      this.isServiceRunning = false;
      this.emit('serviceError', error);
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop the Python service process
   * @returns {Promise<boolean>} True if stopped successfully
   */
  async stopService() {
    if (!this.isServiceRunning || !this.serviceProcess) {
      console.log('[WhisperLocal] Service not running');
      return true;
    }

    try {
      console.log('[WhisperLocal] Stopping Python service...');
      
      // Graceful shutdown
      this.serviceProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if graceful shutdown fails
          if (this.serviceProcess && !this.serviceProcess.killed) {
            console.log('[WhisperLocal] Force killing service process');
            this.serviceProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
        
        if (this.serviceProcess) {
          this.serviceProcess.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.isServiceRunning = false;
      this.serviceProcess = null;
      this.processStartTime = null;
      
      console.log('[WhisperLocal] Service stopped successfully');
      this.emit('serviceStopped');
      return true;
      
    } catch (error) {
      console.error('[WhisperLocal] Error stopping service:', error.message);
      return false;
    }
  }

  /**
   * Restart the Python service
   * @returns {Promise<boolean>} True if restarted successfully
   */
  async restartService() {
    console.log('[WhisperLocal] Restarting service...');
    
    await this.stopService();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    
    return await this.startService();
  }

  /**
   * Handle process exit events
   * @private
   */
  handleProcessExit(code, signal) {
    console.log(`[WhisperLocal] Service process exited with code ${code}, signal ${signal}`);
    
    this.isServiceRunning = false;
    this.serviceProcess = null;
    
    // Attempt automatic restart if not intentionally stopped
    if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      console.log(`[WhisperLocal] Attempting restart ${this.restartAttempts}/${this.maxRestartAttempts}`);
      
      setTimeout(async () => {
        try {
          await this.startService();
        } catch (error) {
          console.error('[WhisperLocal] Restart failed:', error.message);
          this.emit('restartFailed', error);
        }
      }, this.retryDelay * this.restartAttempts);
    } else if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error('[WhisperLocal] Max restart attempts reached');
      this.emit('maxRestartsReached');
    }
    
    this.emit('serviceExited', { code, signal });
  }

  /**
   * Handle process error events
   * @private
   */
  handleProcessError(error) {
    console.error('[WhisperLocal] Service process error:', error.message);
    this.isServiceRunning = false;
    this.emit('serviceError', error);
  }

  /**
   * Start health monitoring
   * @private
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(this.performHealthCheck, this.healthCheckIntervalMs);
  }

  /**
   * Stop health monitoring
   * @private
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform health check on the service
   * @private
   */
  async performHealthCheck() {
    if (!this.isServiceRunning || this.isStarting) {
      return;
    }

    try {
      const result = await this._testDaemonConnection();
      this.lastHealthCheck = Date.now();
      
      if (!result.success) {
        console.warn('[WhisperLocal] Health check failed, attempting restart');
        await this.restartService();
      } else {
        this.emit('healthCheckPassed');
      }
    } catch (error) {
      console.error('[WhisperLocal] Health check error:', error.message);
      this.emit('healthCheckFailed', error);
    }
  }

  /**
   * Test daemon connection via HTTP
   * @private
   */
  /**
   * Wait for the service to be ready by polling the health endpoint
   * @private
   */
  async _waitForServiceReady(timeout = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await this._testDaemonConnection();
      if (result && result.success) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
    }
    return false;
  }

  /**
   * Test daemon connection via HTTP
   * @private
   */
  async _testDaemonConnection() {
    try {
      const response = await fetch(`http://localhost:8765/health`, {
        method: 'GET',
        timeout: 5000
      });
      
      if (response.ok) {
        const result = await response.json();
        return result;
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send request to daemon via HTTP
   * @private
   */
  async _sendDaemonRequest(command, data = {}) {
    try {
      const requestData = {
        command,
        ...data
      };

      const response = await fetch(`http://localhost:8765/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        timeout: 30000
      });

      if (response.ok) {
        return await response.json();
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Request failed: ${error.message}`
      };
    }
  }

  /**
   * Check if prerequisites are met
   * @private
   */
  async checkPrerequisites() {
    try {
      // Check Python availability
      const pythonCheck = await this._runCommand(this.pythonPath, ['--version']);
      if (!pythonCheck.success) {
        console.error('[WhisperLocal] Python not available');
        return false;
      }

      // Check service file exists
      if (!fs.existsSync(this.servicePath)) {
        console.error('[WhisperLocal] Service file not found:', this.servicePath);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[WhisperLocal] Prerequisites check failed:', error.message);
      return false;
    }
  }

  /**
   * Shutdown the service and cleanup
   */
  async shutdown() {
    console.log('[WhisperLocal] Shutting down...');
    
    this.stopHealthMonitoring();
    await this.stopService();
    
    // Remove event listeners
    this.removeAllListeners();
  }

  /**
   * Get service status information
   * @returns {Object} Service status
   */
  getServiceStatus() {
    return {
      isStarting: this.isStarting,
      isRunning: this.isServiceRunning,
      isReady: this.isServiceReady,
      processId: this.serviceProcess?.pid || null,
      uptime: this.processStartTime ? Date.now() - this.processStartTime : 0,
      restartAttempts: this.restartAttempts,
      lastHealthCheck: this.lastHealthCheck,
      currentModel: this.currentModel
    };
  }

  /**
   * Test if the Python service is available and working
   * @returns {Promise<boolean>} True if service is ready
   */
  async testService() {
    try {
      console.log('[WhisperLocal] Testing Python service availability...');
      
      let result;
      if (this.isServiceRunning) {
        // Use HTTP communication for daemon mode
        result = await this._testDaemonConnection();
      } else {
        // Fallback to direct command for non-daemon mode
        result = await this._runPythonCommand(['test', '--model', this.currentModel]);
      }
      
      if (result.success) {
        this.isServiceReady = true;
        console.log('[WhisperLocal] Service test successful');
        return true;
      } else {
        console.error('[WhisperLocal] Service test failed:', result.error);
        this.isServiceReady = false;
        return false;
      }
    } catch (error) {
      console.error('[WhisperLocal] Service test error:', error.message);
      this.isServiceReady = false;
      return false;
    }
  }

  /**
   * Get available Whisper models
   * @returns {Promise<Object>} Available models information
   */
  async getAvailableModels() {
    try {
      let result;
      if (this.isServiceRunning) {
        // Use HTTP communication for daemon mode
        result = await this._sendDaemonRequest('models');
      } else {
        // Fallback to direct command for non-daemon mode
        result = await this._runPythonCommand(['models']);
      }
      return result;
    } catch (error) {
      console.error('[WhisperLocal] Error getting models:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Change the current Whisper model
   * @param {string} modelName - Name of the model to use
   * @returns {Promise<Object>} Operation result
   */
  async changeModel(modelName) {
    try {
      const oldModel = this.currentModel;
      this.currentModel = modelName;
      console.log(`[WhisperLocal] Model changed to: ${modelName}`);
      
      let result;
      if (this.isServiceRunning) {
        // Use HTTP communication for daemon mode
        result = await this._sendDaemonRequest('change_model', { model: modelName });
        if (!result.success) {
          // Rollback on failure
          this.currentModel = oldModel;
          return result;
        }
      }
      
      // Test the new model
      const testResult = await this.testService();
      
      if (!testResult) {
        // Rollback on test failure
        this.currentModel = oldModel;
      }
      
      return {
        success: testResult,
        message: testResult 
          ? `Model changed to ${modelName} successfully`
          : `Model changed to ${modelName} but failed to load`
      };
    } catch (error) {
      console.error('[WhisperLocal] Error changing model:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Transcribe audio file using local Whisper
   * @param {string} audioFilePath - Path to the audio file
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeAudio(audioFilePath, options = {}) {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    // Validate file format
    const fileExt = path.extname(audioFilePath).toLowerCase();
    if (!this.supportedFormats.includes(fileExt)) {
      throw new Error(`Unsupported audio format: ${fileExt}`);
    }

    const {
      language,
      task = 'transcribe',
      temperature = 0.0,
      onProgress
    } = options;

    try {
      console.log(`[WhisperLocal] Starting transcription: ${audioFilePath}`);
      
      // Notify progress start
      if (onProgress) {
        onProgress({ stage: 'initializing', progress: 0 });
      }

      // Ensure service is running and ready
      if (!this.isServiceRunning) {
        console.log('[WhisperLocal] Service not running, starting...');
        const started = await this.startService();
        if (!started) {
          throw new Error('Failed to start local Whisper service');
        }
      }

      // Verify service is ready via HTTP
      const testResult = await this._testDaemonConnection();
      if (!testResult.success) {
        console.log('[WhisperLocal] Service not responsive, attempting restart...');
        const restarted = await this.restartService();
        if (!restarted) {
          throw new Error('Local Whisper service is not ready');
        }
      }

      // Notify progress
      if (onProgress) {
        onProgress({ stage: 'processing', progress: 50 });
      }

      // Run transcription with retry logic using HTTP communication
      let transcriptionResult;
      let retryCount = 0;
      
      while (retryCount < this.maxRetries) {
        try {
          // Use HTTP communication for daemon mode
          const result = await this._sendDaemonRequest('transcribe', {
            audio_path: audioFilePath,
            model: this.currentModel,
            language: language,
            task: task,
            temperature: temperature
          });
          
          if (result.success) {
            transcriptionResult = result;
            break; // Success, exit retry loop
          } else {
            throw new Error(result.error || 'Transcription failed');
          }
          
        } catch (retryError) {
          retryCount++;
          console.warn(`[WhisperLocal] Transcription attempt ${retryCount} failed:`, retryError.message);
          
          if (retryCount < this.maxRetries) {
            console.log(`[WhisperLocal] Retrying in ${this.retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            
            // Try to restart service if it seems to be the issue
            if (retryError.message.includes('Request failed') || retryError.message.includes('HTTP')) {
              console.log('[WhisperLocal] Attempting service restart due to error');
              await this.restartService();
            }
          } else {
            throw retryError;
          }
        }
      }

      // Notify completion
      if (onProgress) {
        onProgress({ stage: 'complete', progress: 100 });
      }

      if (transcriptionResult && transcriptionResult.success) {
        console.log(`[WhisperLocal] Transcription completed. Text length: ${transcriptionResult.text?.length || 0} characters`);
        
        // Format result to match cloud API structure
        return {
          text: transcriptionResult.text,
          language: transcriptionResult.language,
          segments: transcriptionResult.segments,
          model: transcriptionResult.model,
          source: 'local',
          timestamp: new Date().toISOString()
        };
      } else {
        throw new Error(transcriptionResult?.error || 'Transcription failed');
      }

    } catch (error) {
      console.error('[WhisperLocal] Transcription error:', error.message);
      
      // Emit error event for monitoring
      this.emit('transcriptionError', error);
      
      // Create standardized error
      const transcriptionError = new Error(error.message);
      transcriptionError.type = 'LOCAL_TRANSCRIPTION_ERROR';
      transcriptionError.userMessage = `Local transcription failed: ${error.message}`;
      
      throw transcriptionError;
    }
  }

  /**
   * Check if local Whisper service is available
   * @returns {Promise<boolean>} True if available
   */
  async isAvailable() {
    try {
      // Check if Python is available
      const pythonCheck = await this._runCommand(this.pythonPath, ['--version']);
      if (!pythonCheck.success) {
        console.log('[WhisperLocal] Python not found');
        return false;
      }

      // Check if service file exists
      if (!fs.existsSync(this.servicePath)) {
        console.log('[WhisperLocal] Service file not found');
        return false;
      }

      // Test the service
      return await this.testService();
    } catch (error) {
      console.error('[WhisperLocal] Availability check failed:', error.message);
      return false;
    }
  }

  /**
   * Install required Python dependencies
   * @returns {Promise<Object>} Installation result
   */
  async installDependencies() {
    try {
      console.log('[WhisperLocal] Installing Python dependencies...');
      
      const result = await this._runCommand('pip3', ['install', 'openai-whisper'], {
        timeout: 300000 // 5 minutes for installation
      });

      if (result.success) {
        console.log('[WhisperLocal] Dependencies installed successfully');
        return { success: true, message: 'Dependencies installed successfully' };
      } else {
        throw new Error(result.error || 'Installation failed');
      }
    } catch (error) {
      console.error('[WhisperLocal] Dependency installation failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Run a Python command with the service script
   * @private
   */
  async _runPythonCommand(args, options = {}) {
    const fullArgs = [this.servicePath, ...args];
    return this._runCommand(this.pythonPath, fullArgs, options);
  }

  /**
   * Run a command and return the result
   * @private
   */
  _runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const { timeout = 30000, onProgress } = options;
      
      console.log(`[WhisperLocal] Running: ${command} ${args.join(' ')}`);
      
      const process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let isResolved = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          process.kill('SIGTERM');
          reject(new Error(`Command timeout after ${timeout}ms`));
        }
      }, timeout);

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        
        // Simple progress indication for long-running processes
        if (onProgress && data.toString().includes('Loading')) {
          onProgress({ stage: 'loading_model', progress: 25 });
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (isResolved) return;
        isResolved = true;

        if (code === 0) {
          try {
            // Try to parse JSON output
            const result = JSON.parse(stdout.trim());
            resolve(result);
          } catch (parseError) {
            // If not JSON, return as plain text
            resolve({
              success: true,
              output: stdout.trim(),
              stderr: stderr.trim()
            });
          }
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeoutId);
        
        if (isResolved) return;
        isResolved = true;
        
        reject(new Error(`Process error: ${error.message}`));
      });
    });
  }

  /**
   * Get current model information
   * @returns {string} Current model name
   */
  getCurrentModel() {
    return this.currentModel;
  }

  /**
   * Set Python path (useful for custom Python installations)
   * @param {string} pythonPath - Path to Python executable
   */
  setPythonPath(pythonPath) {
    this.pythonPath = pythonPath;
  }
}

module.exports = WhisperLocalClient;