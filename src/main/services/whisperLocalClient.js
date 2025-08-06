const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
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
    
    // Error tracking
    this.lastErrorOutput = '';
    this.dependencyFailure = false;
    this.lastFailureReason = null;
    
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
    
    // Reset error tracking for this attempt
    this.lastErrorOutput = '';
    this.dependencyFailure = false;
    this.lastFailureReason = null;

    try {
      console.log('[WhisperLocal] Starting Python service...');
      
      // Check prerequisites - this will also detect and set the correct Python path
      const prereqResult = await this.checkPrerequisites();
      if (!prereqResult.success) {
        // If prerequisites fail, this is a dependency issue
        this.dependencyFailure = true;
        this.lastFailureReason = {
          type: 'prerequisites_failed',
          message: `Prerequisites check failed: ${prereqResult.missing.join(', ')} missing`,
          solution: prereqResult.missing.map(item => {
            const detail = prereqResult.details[item];
            return detail?.suggestion || `Install ${item}`;
          }).join('; ')
        };
        throw new Error(`Prerequisites not met: ${prereqResult.missing.join(', ')}`);
      }
      
      // Log which Python we're using for transparency
      console.log(`[WhisperLocal] Using Python: ${this.pythonPath} (${prereqResult.details.python?.version})`);
      if (prereqResult.details.whisper?.version) {
        console.log(`[WhisperLocal] Whisper version: ${prereqResult.details.whisper.version}`);
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
      
      // Capture output to detect dependency failures
      let stdoutBuffer = '';
      let stderrBuffer = '';
      
      this.serviceProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdoutBuffer += output;
        console.log(`[WhisperLocal] Service stdout: ${output.trim()}`);
        
        // Check for dependency-related errors
        if (this.isDependencyError(output)) {
          this.dependencyFailure = true;
          this.lastFailureReason = this.extractFailureReason(output);
        }
      });
      
      this.serviceProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderrBuffer += output;
        console.error(`[WhisperLocal] Service stderr: ${output.trim()}`);
        
        // Check for dependency-related errors in stderr as well
        if (this.isDependencyError(output)) {
          this.dependencyFailure = true;
          this.lastFailureReason = this.extractFailureReason(output);
        }
      });
      
      // Store the complete output for analysis
      this.lastErrorOutput = stdoutBuffer + stderrBuffer;

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
      
      // Check if there's already a daemon running (port in use error)
      if (error.message.includes('Address already in use') || error.message.includes('EADDRINUSE')) {
        console.log('[WhisperLocal] Port already in use, checking for existing daemon...');
        try {
          const daemonTest = await this._testDaemonConnection();
          if (daemonTest.success) {
            console.log('[WhisperLocal] Found existing daemon, using it');
            this.isServiceRunning = true;
            this.isServiceReady = true;
            this.emit('serviceStarted');
            return true;
          }
        } catch (daemonError) {
          console.error('[WhisperLocal] Failed to test existing daemon:', daemonError.message);
        }
      }
      
      this.isServiceRunning = false;
      this.isServiceReady = false;
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
   * Check if an error output indicates a dependency issue
   * @private
   */
  isDependencyError(output) {
    const dependencyPatterns = [
      /OpenAI Whisper library not found/i,
      /No module named ['"]whisper['"]/i,
      /ModuleNotFoundError.*whisper/i,
      /ImportError.*whisper/i,
      /No module named ['"]torch['"]/i,
      /ModuleNotFoundError.*torch/i,
      /ImportError.*torch/i,
      /Python.*not found/i,
      /command not found.*python/i
    ];
    
    return dependencyPatterns.some(pattern => pattern.test(output));
  }
  
  /**
   * Extract the specific failure reason from error output
   * @private
   */
  extractFailureReason(output) {
    if (/OpenAI Whisper library not found/i.test(output)) {
      return {
        type: 'missing_whisper',
        message: 'OpenAI Whisper library not found',
        solution: 'pip install openai-whisper'
      };
    }
    
    if (/No module named ['"]whisper['"]|ModuleNotFoundError.*whisper|ImportError.*whisper/i.test(output)) {
      return {
        type: 'missing_whisper',
        message: 'Whisper module not found',
        solution: 'pip install openai-whisper'
      };
    }
    
    if (/No module named ['"]torch['"]|ModuleNotFoundError.*torch|ImportError.*torch/i.test(output)) {
      return {
        type: 'missing_torch',
        message: 'PyTorch not found',
        solution: 'pip install torch'
      };
    }
    
    if (/Python.*not found|command not found.*python/i.test(output)) {
      return {
        type: 'missing_python',
        message: 'Python not found',
        solution: 'Install Python 3.7+ from python.org'
      };
    }
    
    return {
      type: 'unknown_dependency',
      message: 'Unknown dependency issue',
      solution: 'Check Python installation and dependencies'
    };
  }

  /**
   * Handle process exit events
   * @private
   */
  handleProcessExit(code, signal) {
    console.log(`[WhisperLocal] Service process exited with code ${code}, signal ${signal}`);
    
    this.isServiceRunning = false;
    this.serviceProcess = null;
    this.isServiceReady = false;
    
    // Check if this was an intentional shutdown (SIGTERM/SIGKILL) or normal exit
    const wasIntentional = signal === 'SIGTERM' || signal === 'SIGKILL' || code === 0;
    
    // Check if the failure was due to dependency issues
    if (this.dependencyFailure && this.lastFailureReason) {
      console.error(`[WhisperLocal] Service failed due to dependency issue: ${this.lastFailureReason.message}`);
      console.info(`[WhisperLocal] To fix this issue: ${this.lastFailureReason.solution}`);
      
      // Don't restart for dependency failures - they'll just fail again
      this.emit('dependencyFailure', {
        code,
        signal,
        reason: this.lastFailureReason,
        errorOutput: this.lastErrorOutput
      });
      
      // Reset the dependency failure flag for next attempt
      this.dependencyFailure = false;
      return;
    }
    
    // Attempt automatic restart only for unintentional failures that aren't dependency-related
    if (!wasIntentional && !this.dependencyFailure && this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      
      // Calculate delay with exponential backoff and jitter
      const baseDelay = this.retryDelay;
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.restartAttempts - 1), 30000); // Cap at 30 seconds
      const jitter = Math.random() * 1000; // Add up to 1 second jitter
      const delayMs = exponentialDelay + jitter;
      
      console.log(`[WhisperLocal] Attempting restart ${this.restartAttempts}/${this.maxRestartAttempts} in ${Math.round(delayMs)}ms`);
      
      setTimeout(async () => {
        try {
          const started = await this.startService();
          if (!started) {
            console.error('[WhisperLocal] Restart failed: service failed to start');
            this.emit('restartFailed', new Error('Service failed to start'));
          }
        } catch (error) {
          console.error('[WhisperLocal] Restart failed:', error.message);
          this.emit('restartFailed', error);
        }
      }, delayMs);
    } else if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error('[WhisperLocal] Max restart attempts reached, giving up');
      this.emit('maxRestartsReached');
    } else if (wasIntentional) {
      console.log('[WhisperLocal] Service stopped intentionally, not restarting');
      this.restartAttempts = 0; // Reset counter for intentional stops
    }
    
    this.emit('serviceExited', { code, signal, wasIntentional, dependencyFailure: this.dependencyFailure });
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
    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 8765,
        path: '/health',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const result = JSON.parse(data);
              resolve(result);
            } else {
              resolve({ success: false, error: `HTTP ${res.statusCode}` });
            }
          } catch (error) {
            resolve({ success: false, error: `Parse error: ${error.message}` });
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });
      
      req.end();
    });
  }

  /**
   * Send request to daemon via HTTP
   * @private
   */
  async _sendDaemonRequest(command, data = {}) {
    return new Promise((resolve) => {
      const requestData = {
        command,
        ...data
      };
      
      const postData = JSON.stringify(requestData);
      
      const req = http.request({
        hostname: 'localhost',
        port: 8765,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const result = JSON.parse(responseData);
              resolve(result);
            } else {
              resolve({
                success: false,
                error: `HTTP ${res.statusCode}: ${res.statusMessage}`
              });
            }
          } catch (error) {
            resolve({
              success: false,
              error: `Parse error: ${error.message}`
            });
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({
          success: false,
          error: `Request failed: ${error.message}`
        });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timeout'
        });
      });
      
      req.write(postData);
      req.end();
    });
  }

  /**
   * Detect the correct pip command for a given Python executable
   * @param {string} pythonPath - Path to Python executable
   * @returns {Promise<string>} The correct pip command to use
   */
  async detectCorrectPipCommand(pythonPath) {
    // Try to determine the correct pip command for this Python
    const pythonBaseName = pythonPath.split('/').pop(); // Get just the executable name
    
    // Common pip command patterns
    const pipCandidates = [
      `${pythonBaseName} -m pip`, // Most reliable method
      'pip3',
      'pip',
      '/usr/local/bin/pip3',
      '/usr/bin/pip3'
    ];
    
    for (const pipCmd of pipCandidates) {
      try {
        const pipCheck = await this._runCommand('bash', ['-c', `${pipCmd} --version`]);
        if (pipCheck.success) {
          console.log(`[WhisperLocal] Found working pip command: ${pipCmd}`);
          return pipCmd;
        }
      } catch (error) {
        continue;
      }
    }
    
    // Fallback to the most reliable method
    return `${pythonBaseName} -m pip`;
  }

  /**
   * Automatically install Python dependencies
   * @param {Object} options - Installation options
   * @returns {Promise<Object>} Installation result
   */
  async autoInstallDependencies(options = {}) {
    const { 
      forcePythonPath = null,
      useVirtualEnv = true,
      onProgress = null,
      cleanInstall = false
    } = options;

    console.log(`[WhisperLocal] Starting automated dependency installation... (cleanInstall: ${cleanInstall})`);
    
    if (onProgress) {
      onProgress({ 
        stage: cleanInstall ? 'cleaning' : 'checking', 
        progress: 0, 
        message: cleanInstall ? 'Preparing clean installation...' : 'Checking Python environment...' 
      });
    }

    try {
      // First, check if we already have a working Python with whisper (unless clean install requested)
      if (!forcePythonPath && !cleanInstall) {
        const workingPython = await this.findWorkingPythonPath();
        if (workingPython) {
          console.log('[WhisperLocal] Found working Python with whisper, no installation needed');
          return {
            success: true,
            message: 'Dependencies are already installed',
            pythonPath: workingPython.pythonPath,
            skipped: true
          };
        }
      }

      const pythonPath = forcePythonPath || this.pythonPath;
      console.log(`[WhisperLocal] Using Python: ${pythonPath}`);

      // Check if Python exists
      const pythonCheck = await this._runCommand(pythonPath, ['--version']);
      if (!pythonCheck.success) {
        return {
          success: false,
          error: 'Python not found',
          suggestion: 'Please install Python 3.7+ from python.org or your system package manager',
          installCommand: 'Visit https://python.org/downloads/ to install Python'
        };
      }

      if (onProgress) {
        onProgress({ stage: 'installing', progress: 20, message: 'Installing Whisper dependencies...' });
      }

      // Create or use existing virtual environment if requested
      let actualPythonPath = pythonPath;
      let actualPipCommand;

      if (useVirtualEnv) {
        const venvResult = await this.setupVirtualEnvironment(pythonPath, onProgress);
        if (venvResult.success) {
          actualPythonPath = venvResult.pythonPath;
          actualPipCommand = venvResult.pipCommand;
          console.log(`[WhisperLocal] Using virtual environment: ${actualPythonPath}`);
        } else {
          console.warn('[WhisperLocal] Virtual environment setup failed, using system Python');
          actualPipCommand = await this.detectCorrectPipCommand(actualPythonPath);
        }
      } else {
        actualPipCommand = await this.detectCorrectPipCommand(actualPythonPath);
      }

      if (onProgress) {
        onProgress({ stage: 'installing', progress: 40, message: 'Installing OpenAI Whisper...' });
      }

      // Install openai-whisper with progress tracking
      const installResult = await this.installWhisperPackage(actualPipCommand, onProgress, cleanInstall);
      
      if (!installResult.success) {
        return {
          success: false,
          error: installResult.error,
          suggestion: installResult.suggestion,
          installCommand: installResult.installCommand
        };
      }

      // Update our Python path to use the working one
      this.pythonPath = actualPythonPath;

      if (onProgress) {
        onProgress({ stage: 'verifying', progress: 90, message: 'Verifying installation...' });
      }

      // Verify the installation
      const verifyResult = await this._runCommand(actualPythonPath, ['-c', 'import whisper; print("whisper-" + (whisper.__version__ if hasattr(whisper, "__version__") else "unknown"))']);
      
      if (!verifyResult.success) {
        return {
          success: false,
          error: 'Installation verification failed',
          suggestion: 'Try manually installing: ' + actualPipCommand + ' install openai-whisper',
          details: verifyResult.error
        };
      }

      if (onProgress) {
        onProgress({ stage: 'complete', progress: 100, message: 'Installation completed successfully!' });
      }

      console.log('[WhisperLocal] Automated dependency installation completed successfully');
      return {
        success: true,
        message: 'Dependencies installed successfully',
        pythonPath: actualPythonPath,
        whisperVersion: verifyResult.output.trim(),
        virtualEnv: useVirtualEnv
      };

    } catch (error) {
      console.error('[WhisperLocal] Automated installation failed:', error);
      return {
        success: false,
        error: error.message,
        suggestion: 'Try manual installation or check the troubleshooting guide'
      };
    }
  }

  /**
   * Setup or use existing virtual environment
   * @param {string} pythonPath - Path to Python executable
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Virtual environment setup result
   */
  async setupVirtualEnvironment(pythonPath, onProgress = null) {
    try {
      // Get project directory
      const projectDir = process.cwd();
      const venvPath = path.join(projectDir, '.venv');
      const venvPythonPath = path.join(venvPath, 'bin', 'python');
      const venvPipPath = path.join(venvPath, 'bin', 'pip');

      // Check if virtual environment already exists
      if (fs.existsSync(venvPythonPath)) {
        console.log('[WhisperLocal] Using existing virtual environment');
        return {
          success: true,
          pythonPath: venvPythonPath,
          pipCommand: `${venvPythonPath} -m pip`,
          existing: true
        };
      }

      if (onProgress) {
        onProgress({ stage: 'creating_venv', progress: 25, message: 'Creating virtual environment...' });
      }

      // Create virtual environment
      console.log(`[WhisperLocal] Creating virtual environment at: ${venvPath}`);
      const createVenvResult = await this._runCommand(pythonPath, ['-m', 'venv', venvPath], { timeout: 60000 });
      
      if (!createVenvResult.success) {
        console.warn('[WhisperLocal] Failed to create virtual environment:', createVenvResult.error);
        return {
          success: false,
          error: 'Failed to create virtual environment',
          details: createVenvResult.error
        };
      }

      // Verify virtual environment was created
      if (!fs.existsSync(venvPythonPath)) {
        return {
          success: false,
          error: 'Virtual environment created but Python executable not found'
        };
      }

      console.log('[WhisperLocal] Virtual environment created successfully');
      return {
        success: true,
        pythonPath: venvPythonPath,
        pipCommand: `${venvPythonPath} -m pip`,
        existing: false
      };

    } catch (error) {
      console.error('[WhisperLocal] Virtual environment setup error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Install Whisper package with progress tracking
   * @param {string} pipCommand - Pip command to use
   * @param {Function} onProgress - Progress callback
   * @param {boolean} cleanInstall - Whether to perform clean install
   * @returns {Promise<Object>} Installation result
   */
  async installWhisperPackage(pipCommand, onProgress = null, cleanInstall = false) {
    try {
      console.log(`[WhisperLocal] Installing openai-whisper using: ${pipCommand} (cleanInstall: ${cleanInstall})`);
      
      let installCommand;
      
      if (cleanInstall) {
        if (onProgress) {
          onProgress({ stage: 'cleaning', progress: 35, message: 'Cleaning existing installation...' });
        }
        
        // Use architecture-specific fix command for clean installs
        installCommand = await this.getArchitectureFixCommand(pipCommand);
        console.log(`[WhisperLocal] Using architecture fix command: ${installCommand}`);
      } else {
        if (onProgress) {
          onProgress({ stage: 'downloading', progress: 45, message: 'Downloading Whisper package...' });
        }
        
        // Determine the correct PyTorch installation command based on platform
        installCommand = await this.getPlatformSpecificInstallCommand(pipCommand);
        console.log(`[WhisperLocal] Using platform-specific install command: ${installCommand}`);
      }

      // Install with verbose output for better progress tracking
      const installResult = await this._runCommand('bash', ['-c', installCommand], {
        timeout: 600000, // 10 minutes timeout
        onProgress: (data) => {
          // Parse pip output for progress updates
          if (data && typeof data === 'string') {
            if (data.includes('Downloading')) {
              if (onProgress) {
                onProgress({ stage: 'downloading', progress: 60, message: 'Downloading dependencies...' });
              }
            } else if (data.includes('Installing')) {
              if (onProgress) {
                onProgress({ stage: 'installing', progress: 75, message: 'Installing packages...' });
              }
            } else if (data.includes('Successfully installed')) {
              if (onProgress) {
                onProgress({ stage: 'finalizing', progress: 85, message: 'Finalizing installation...' });
              }
            }
          }
        }
      });

      if (!installResult.success) {
        let errorMsg = installResult.error || 'Installation failed';
        let suggestion = 'Try running the installation command manually in your terminal';
        let installCommand = `${pipCommand} install openai-whisper torch`;

        // Provide specific suggestions based on error type
        if (errorMsg.includes('permission')) {
          suggestion = 'Permission error. Try using a virtual environment or add --user flag';
          installCommand = `${pipCommand} install --user openai-whisper torch`;
        } else if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
          suggestion = 'Network error. Check your internet connection and try again';
        } else if (errorMsg.includes('disk space') || errorMsg.includes('space')) {
          suggestion = 'Insufficient disk space. Please free up some space and try again';
        } else if (errorMsg.includes('incompatible architecture') || errorMsg.includes('have \'x86_64\', need \'arm64')) {
          suggestion = 'Architecture mismatch detected. The installation used the wrong CPU architecture for your Mac.';
          installCommand = await this.getArchitectureFixCommand(pipCommand);
        } else if (errorMsg.includes('mach-o file') || errorMsg.includes('libtorch')) {
          suggestion = 'PyTorch architecture conflict. This often happens on Apple Silicon Macs.';
          installCommand = await this.getArchitectureFixCommand(pipCommand);
        }

        return {
          success: false,
          error: errorMsg,
          suggestion: suggestion,
          installCommand: installCommand
        };
      }

      console.log('[WhisperLocal] Package installation completed');
      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        suggestion: 'Installation failed. Check the error details and try manual installation'
      };
    }
  }

  /**
   * Check for conda environments and add them to detection
   * @returns {Promise<Array>} Array of conda environment paths
   */
  async findCondaEnvironments() {
    const condaPaths = [];
    
    try {
      // Check if conda is available
      const condaCheck = await this._runCommand('conda', ['--version']);
      if (!condaCheck.success) {
        return condaPaths;
      }

      console.log('[WhisperLocal] Conda found, checking for environments...');

      // Get list of conda environments
      const envListResult = await this._runCommand('conda', ['env', 'list', '--json']);
      if (envListResult.success) {
        try {
          const envData = JSON.parse(envListResult.output);
          if (envData.envs && Array.isArray(envData.envs)) {
            envData.envs.forEach(envPath => {
              // Add Python executable paths for each conda environment
              const pythonPath = path.join(envPath, 'bin', 'python');
              if (fs.existsSync(pythonPath)) {
                condaPaths.push(pythonPath);
                console.log(`[WhisperLocal] Found conda environment: ${envPath}`);
              }
            });
          }
        } catch (parseError) {
          console.warn('[WhisperLocal] Failed to parse conda env list output:', parseError);
        }
      }

      // Also check for conda's base environment
      const condaInfoResult = await this._runCommand('conda', ['info', '--json']);
      if (condaInfoResult.success) {
        try {
          const infoData = JSON.parse(condaInfoResult.output);
          if (infoData.default_prefix) {
            const basePythonPath = path.join(infoData.default_prefix, 'bin', 'python');
            if (fs.existsSync(basePythonPath) && !condaPaths.includes(basePythonPath)) {
              condaPaths.push(basePythonPath);
              console.log(`[WhisperLocal] Found conda base environment: ${infoData.default_prefix}`);
            }
          }
        } catch (parseError) {
          console.warn('[WhisperLocal] Failed to parse conda info output:', parseError);
        }
      }

    } catch (error) {
      console.warn('[WhisperLocal] Error checking conda environments:', error);
    }

    return condaPaths;
  }

  /**
   * Get platform-specific installation command for PyTorch and Whisper
   * @param {string} pipCommand - Base pip command
   * @returns {Promise<string>} Platform-optimized installation command
   */
  async getPlatformSpecificInstallCommand(pipCommand) {
    const platform = process.platform;
    const arch = process.arch;
    
    console.log(`[WhisperLocal] Detecting platform: ${platform}, architecture: ${arch}`);

    // For Apple Silicon Macs, we need to ensure we get the ARM64 version of PyTorch
    if (platform === 'darwin' && arch === 'arm64') {
      console.log('[WhisperLocal] Apple Silicon Mac detected - using ARM64 PyTorch');
      
      // Check if this is a native ARM64 Python or running under Rosetta
      const pythonArch = await this.detectPythonArchitecture(pipCommand);
      
      if (pythonArch === 'arm64') {
        // Native ARM64 Python - install ARM64 PyTorch
        return `${pipCommand} install --upgrade pip && ${pipCommand} install torch torchvision torchaudio && ${pipCommand} install openai-whisper`;
      } else {
        // Python running under Rosetta or x86_64 - need to be more specific
        console.warn('[WhisperLocal] Python appears to be running under Rosetta or is x86_64. Attempting ARM64 PyTorch installation anyway.');
        return `${pipCommand} install --upgrade pip && ${pipCommand} install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && ${pipCommand} install openai-whisper`;
      }
    } 
    // For Intel Macs
    else if (platform === 'darwin' && arch === 'x64') {
      console.log('[WhisperLocal] Intel Mac detected');
      return `${pipCommand} install --upgrade pip && ${pipCommand} install torch torchvision torchaudio && ${pipCommand} install openai-whisper`;
    }
    // For Windows
    else if (platform === 'win32') {
      console.log('[WhisperLocal] Windows detected');
      return `${pipCommand} install --upgrade pip && ${pipCommand} install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118 && ${pipCommand} install openai-whisper`;
    }
    // For Linux
    else if (platform === 'linux') {
      console.log('[WhisperLocal] Linux detected');
      return `${pipCommand} install --upgrade pip && ${pipCommand} install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && ${pipCommand} install openai-whisper`;
    }
    // Fallback for unknown platforms
    else {
      console.log(`[WhisperLocal] Unknown platform ${platform}/${arch}, using generic installation`);
      return `${pipCommand} install --upgrade pip && ${pipCommand} install torch torchvision torchaudio && ${pipCommand} install openai-whisper`;
    }
  }

  /**
   * Detect the architecture that Python is running under
   * @param {string} pipCommand - Pip command to test
   * @returns {Promise<string>} Architecture ('arm64', 'x86_64', or 'unknown')
   */
  async detectPythonArchitecture(pipCommand) {
    try {
      // Extract Python path from pip command
      const pythonPath = pipCommand.includes(' -m pip') ? pipCommand.replace(' -m pip', '') : 'python3';
      
      // Check Python's platform.machine()
      const result = await this._runCommand(pythonPath, ['-c', 'import platform; print(platform.machine())'], { timeout: 5000 });
      
      if (result.success) {
        const arch = result.output.trim().toLowerCase();
        console.log(`[WhisperLocal] Python architecture: ${arch}`);
        
        if (arch.includes('arm64') || arch.includes('aarch64')) {
          return 'arm64';
        } else if (arch.includes('x86_64') || arch.includes('amd64')) {
          return 'x86_64';
        }
      }
      
      console.warn('[WhisperLocal] Could not detect Python architecture:', result.error || 'Unknown error');
      return 'unknown';
    } catch (error) {
      console.error('[WhisperLocal] Error detecting Python architecture:', error);
      return 'unknown';
    }
  }

  /**
   * Get architecture-specific fix command for PyTorch conflicts
   * @param {string} pipCommand - Base pip command
   * @returns {Promise<string>} Fix command for architecture issues
   */
  async getArchitectureFixCommand(pipCommand) {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'darwin' && arch === 'arm64') {
      // Apple Silicon Mac - force clean installation with correct architecture
      return `${pipCommand} uninstall -y torch torchvision torchaudio && ${pipCommand} cache purge && ${pipCommand} install --no-cache-dir torch torchvision torchaudio && ${pipCommand} install --no-cache-dir --force-reinstall openai-whisper`;
    } else {
      // Other platforms - generic clean reinstall
      return `${pipCommand} uninstall -y torch torchvision torchaudio openai-whisper && ${pipCommand} cache purge && ${pipCommand} install --no-cache-dir torch torchvision torchaudio openai-whisper`;
    }
  }

  /**
   * Find the correct Python executable that has whisper installed
   * @returns {Promise<{pythonPath: string, version: string, hasWhisper: boolean}>}
   */
  async findWorkingPythonPath() {
    // Detect project directory more reliably
    let projectDir;
    try {
      // Try to find the project root by looking for package.json
      projectDir = process.cwd();
      let currentDir = projectDir;
      
      // Walk up the directory tree to find package.json
      while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, 'package.json'))) {
          projectDir = currentDir;
          break;
        }
        currentDir = path.dirname(currentDir);
      }
      
      console.log(`[WhisperLocal] Project directory detected as: ${projectDir}`);
    } catch (error) {
      // Fallback to current working directory
      projectDir = process.cwd();
      console.log(`[WhisperLocal] Using fallback project directory: ${projectDir}`);
    }
    
    // Get conda environments first (high priority)
    const condaCandidates = await this.findCondaEnvironments();
    
    // Virtual environment candidates (highest priority)
    const venvCandidates = [
      // VIRTUAL_ENV environment variable (if set)
      ...(process.env.VIRTUAL_ENV ? [
        path.join(process.env.VIRTUAL_ENV, 'bin', 'python3'),
        path.join(process.env.VIRTUAL_ENV, 'bin', 'python')
      ] : []),
      
      // Common virtual environment locations in project directory
      path.join(projectDir, '.venv', 'bin', 'python3'),
      path.join(projectDir, '.venv', 'bin', 'python'),
      path.join(projectDir, 'venv', 'bin', 'python3'),
      path.join(projectDir, 'venv', 'bin', 'python'),
      path.join(projectDir, 'env', 'bin', 'python3'),
      path.join(projectDir, 'env', 'bin', 'python'),
      
      // Check parent directory too (in case we're in a subdirectory)
      path.join(path.dirname(projectDir), '.venv', 'bin', 'python3'),
      path.join(path.dirname(projectDir), '.venv', 'bin', 'python'),
      
      // Common virtual environment patterns
      path.join(os.homedir(), '.virtualenvs', '*', 'bin', 'python*'),
      path.join(os.homedir(), '.pyenv', 'versions', '*', 'bin', 'python*')
    ].filter(p => !p.includes('*')); // Remove glob patterns for now
    
    // System-wide Python installations (lower priority)  
    const systemCandidates = [
      'python3', 
      'python', 
      'python3.12',
      'python3.11', 
      'python3.10', 
      'python3.9', 
      'python3.8',
      'python3.7',
      '/usr/bin/python3',
      '/usr/bin/python',
      '/usr/local/bin/python3',
      '/usr/local/bin/python',
      '/opt/homebrew/bin/python3',
      '/opt/homebrew/bin/python',
      
      // Additional macOS paths
      '/usr/local/opt/python@3.11/bin/python3',
      '/usr/local/opt/python@3.10/bin/python3',
      '/usr/local/opt/python@3.9/bin/python3',
      '/usr/local/opt/python@3.8/bin/python3',
      '/usr/local/opt/python@3.7/bin/python3',
      
      // pyenv paths
      ...(process.env.PYENV_ROOT ? [
        path.join(process.env.PYENV_ROOT, 'shims', 'python3'),
        path.join(process.env.PYENV_ROOT, 'shims', 'python')
      ] : [])
    ];
    
    // Priority order: conda > virtual envs > system (conda environments often have ML packages)
    const pythonCandidates = [...condaCandidates, ...venvCandidates, ...systemCandidates];
    
    console.log('[WhisperLocal] Searching for Python executable with whisper package...');
    console.log(`[WhisperLocal] Will check ${pythonCandidates.length} Python candidates (${condaCandidates.length} conda, ${venvCandidates.length} venv, ${systemCandidates.length} system)`);
    
    const results = [];
    
    for (const pythonPath of pythonCandidates) {
      try {
        // Check if this Python executable exists and works
        const pythonCheck = await this._runCommand(pythonPath, ['--version'], { timeout: 5000 });
        if (!pythonCheck.success) {
          continue; // Try next candidate
        }
        
        const version = pythonCheck.output.trim();
        const isVirtualEnv = pythonPath.includes('.venv') || pythonPath.includes('venv') || pythonPath.includes('env') || pythonPath.includes('.virtualenvs');
        const isCondaEnv = condaCandidates.includes(pythonPath);
        
        const envType = isCondaEnv ? 'conda' : (isVirtualEnv ? 'virtual env' : 'system');
        console.log(`[WhisperLocal] Testing ${pythonPath}: ${version} (${envType})`);
        
        // Check if this Python has whisper installed
        const whisperCheck = await this._runCommand(pythonPath, ['-c', 'import whisper; print("whisper-" + (whisper.__version__ if hasattr(whisper, "__version__") else "unknown"))'], { timeout: 10000 });
        
        const result = {
          pythonPath: pythonPath,
          version: version,
          hasWhisper: whisperCheck.success,
          whisperVersion: whisperCheck.success ? whisperCheck.output.trim() : null,
          error: whisperCheck.success ? null : (whisperCheck.error || 'Import failed'),
          isVirtualEnv: isVirtualEnv,
          isCondaEnv: isCondaEnv,
          envType: envType
        };
        
        results.push(result);
        
        if (whisperCheck.success) {
          console.log(`[WhisperLocal] ✓ Found working Python with whisper: ${pythonPath} (${version}) (${envType})`);
          console.log(`[WhisperLocal] Whisper version: ${whisperCheck.output.trim()}`);
          return {
            pythonPath: pythonPath,
            version: version,
            hasWhisper: true,
            whisperVersion: whisperCheck.output.trim(),
            isVirtualEnv: isVirtualEnv,
            isCondaEnv: isCondaEnv,
            envType: envType
          };
        } else {
          console.log(`[WhisperLocal] ✗ ${pythonPath} exists but whisper not found: ${whisperCheck.error || 'Import failed'}`);
        }
      } catch (error) {
        // This Python path doesn't work, try next one
        continue;
      }
    }
    
    // Log summary of what we found
    console.log(`[WhisperLocal] Python search complete. Found ${results.length} working Python installations:`);
    results.forEach(result => {
      console.log(`[WhisperLocal]   - ${result.pythonPath}: ${result.version} (whisper: ${result.hasWhisper ? '✓' : '✗'}) (${result.envType})`);
    });
    
    // If we get here, no Python executable with whisper was found
    console.warn('[WhisperLocal] No Python executable with whisper package found');
    
    // Return info about the best candidate for installation
    const bestCandidate = results.find(r => r.isCondaEnv) || results.find(r => r.isVirtualEnv) || results[0];
    return bestCandidate ? {
      pythonPath: bestCandidate.pythonPath,
      version: bestCandidate.version,
      hasWhisper: false,
      error: 'Whisper not installed',
      suggestion: `Install whisper using: ${bestCandidate.pythonPath} -m pip install openai-whisper torch`,
      envType: bestCandidate.envType
    } : null;
  }

  /**
   * Check if prerequisites are met
   * @returns {Promise<{success: boolean, missing: string[], details: object}>}
   */
  async checkPrerequisites() {
    console.log('[WhisperLocal] Checking prerequisites...');
    const results = {
      success: true,
      missing: [],
      details: {}
    };
    
    try {
      // First, try to find a Python executable that actually has whisper installed
      const workingPython = await this.findWorkingPythonPath();
      
      if (workingPython) {
        // Found a working Python with whisper - update our python path to use it
        if (this.pythonPath !== workingPython.pythonPath) {
          console.log(`[WhisperLocal] Switching from ${this.pythonPath} to ${workingPython.pythonPath}`);
          this.pythonPath = workingPython.pythonPath;
        }
        
        results.details.python = {
          available: true,
          version: workingPython.version,
          path: workingPython.pythonPath
        };
        
        results.details.whisper = {
          available: true,
          version: workingPython.whisperVersion
        };
        
      } else {
        // No Python with whisper found - check if any Python exists at all
        console.log(`[WhisperLocal] Checking default Python path: ${this.pythonPath}`);
        const pythonCheck = await this._runCommand(this.pythonPath, ['--version']);
        
        if (!pythonCheck.success) {
          // No Python found at all
          results.success = false;
          results.missing.push('python');
          results.details.python = {
            available: false,
            error: pythonCheck.error,
            userFriendlyError: 'Python 3.7+ is required but not found on your system',
            path: this.pythonPath,
            suggestion: 'Install Python 3.7+ from python.org or your system package manager',
            quickFixAvailable: false, // Can't auto-install Python itself
            installCommands: {
              'macOS (Homebrew)': 'brew install python@3.11',
              'macOS (Official)': 'Download from https://python.org/downloads/',
              'Ubuntu/Debian': 'sudo apt update && sudo apt install python3 python3-pip python3-venv',
              'CentOS/RHEL': 'sudo yum install python3 python3-pip',
              'Windows': 'Download from https://python.org/downloads/ or install from Microsoft Store',
              'Windows (Chocolatey)': 'choco install python'
            },
            troubleshooting: 'After installing Python, restart the application. Make sure Python is added to your system PATH during installation.',
            postInstallInstructions: 'Once Python is installed, restart this app and the Quick Setup wizard will be able to install Whisper automatically.'
          };
        } else {
          // Python exists but doesn't have whisper
          console.log(`[WhisperLocal] Python found: ${pythonCheck.output.trim()}`);
          results.details.python = {
            available: true,
            version: pythonCheck.output.trim(),
            path: this.pythonPath
          };
          
          // Check what pip command should be used for this Python
          const pipCommand = await this.detectCorrectPipCommand(this.pythonPath);
          
          results.success = false;
          results.missing.push('whisper');
          results.details.whisper = {
            available: false,
            error: 'Whisper module not found in any Python installation',
            userFriendlyError: 'OpenAI Whisper is not installed in your Python environment',
            suggestion: `Try: ${pipCommand} install openai-whisper torch`,
            quickFixAvailable: true,
            installCommands: {
              'Quick Setup (Recommended)': 'Use the "🚀 Quick Setup" button for automatic installation',
              'Manual Command': `${pipCommand} install openai-whisper torch`,
              'With Virtual Environment': 'python3 -m venv .venv && source .venv/bin/activate && pip install openai-whisper torch',
              'Alternative Method': 'python3 -m pip install openai-whisper torch'
            },
            troubleshooting: 'If you encounter permission errors, try using --user flag or create a virtual environment. For conda users, install PyTorch first.',
            diagnostics: {
              searchedPaths: 'Searched virtual environments (.venv, venv, env) and system Python installations',
              currentPython: this.pythonPath,
              recommendedCommand: `${pipCommand} install openai-whisper torch`,
              troubleshooting: 'If using a virtual environment, make sure it\'s activated when running the app. Virtual environments are checked first.',
              venvNote: 'Tip: If you have a .venv folder in your project, the app will automatically use it if whisper is installed there.',
              quickSetup: 'The fastest way is to use the automated Quick Setup feature which handles everything for you'
            }
          };
        }
      }

      // Check service file exists
      console.log(`[WhisperLocal] Checking for service file at: ${this.servicePath}`);
      if (!fs.existsSync(this.servicePath)) {
        console.error('[WhisperLocal] Service file not found:', this.servicePath);
        results.success = false;
        results.missing.push('service_file');
        results.details.service_file = {
          available: false,
          path: this.servicePath,
          error: 'Python service script not found'
        };
      } else {
        console.log('[WhisperLocal] Service file found.');
        results.details.service_file = {
          available: true,
          path: this.servicePath
        };
      }

      // If we have a working Python with whisper, also check torch (optional but useful info)
      if (workingPython) {
        try {
          const torchCheck = await this._runCommand(workingPython.pythonPath, ['-c', 'import torch; print("torch-" + torch.__version__)']);
          if (torchCheck.success) {
            console.log(`[WhisperLocal] Torch package found: ${torchCheck.output.trim()}`);
            results.details.torch = {
              available: true,
              version: torchCheck.output.trim()
            };
          } else {
            console.log('[WhisperLocal] Torch package not found (but whisper might still work)');
            results.details.torch = {
              available: false,
              note: 'Not required if whisper is working'
            };
          }
        } catch (error) {
          console.log('[WhisperLocal] Could not check torch package');
          results.details.torch = {
            available: false,
            note: 'Could not verify torch installation'
          };
        }
      }

      if (results.success) {
        console.log('[WhisperLocal] All prerequisites met.');
      } else {
        console.log(`[WhisperLocal] Prerequisites check failed. Missing: ${results.missing.join(', ')}`);
      }
      
      return results;
    } catch (error) {
      console.error('[WhisperLocal] Prerequisites check failed:', error.message);
      return {
        success: false,
        missing: ['unknown'],
        details: {
          error: error.message
        }
      };
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
   * Health check method required by ServiceRegistry
   * @returns {Promise<boolean>} True if service is healthy, false otherwise
   */
  async isHealthy() {
    try {
      // If service is starting, consider it temporarily healthy
      if (this.isStarting) {
        return true;
      }

      // Always perform actual health check by testing daemon connection
      // This handles cases where the process might have exited but daemon is still running
      const healthCheck = await this._testDaemonConnection();
      this.lastHealthCheck = Date.now();
      
      // If daemon is responding, update our internal state
      if (healthCheck.success) {
        this.isServiceReady = true;
        // If daemon is responding but we think the service isn't running,
        // it means there's an existing daemon from a previous session
        if (!this.isServiceRunning) {
          console.log('[WhisperLocal] Found existing daemon, updating service state');
          this.isServiceRunning = true;
        }
        return true;
      } else {
        this.isServiceReady = false;
        
        // If the service is not running and not starting, this might be the first health check
        // The ServiceRegistry will call startService() separately, so we don't auto-start here
        // Just return false and let the ServiceRegistry handle starting
        console.log('[WhisperLocal] Health check failed, service appears to be stopped');
        return false;
      }
      
    } catch (error) {
      console.warn('[WhisperLocal] Health check failed:', error.message);
      this.lastHealthCheck = Date.now();
      this.isServiceReady = false;
      return false;
    }
  }

  /**
   * Test if the Python service is available and working
   * @returns {Promise<boolean>} True if service is ready
   */
  async transcribe(audioFilePath, options = {}) {
    if (!this.isServiceRunning || !this.isServiceReady) {
      return { success: false, error: 'Local service is not running or not ready.' };
    }

    if (!fs.existsSync(audioFilePath)) {
      return { success: false, error: `Audio file not found: ${audioFilePath}` };
    }

    const fileExtension = path.extname(audioFilePath).toLowerCase();
    if (!this.supportedFormats.includes(fileExtension)) {
      return { success: false, error: `Unsupported audio format: ${fileExtension}` };
    }

    try {
      console.log(`[WhisperLocal] Transcribing file: ${path.basename(audioFilePath)}`);
      
      const { onProgress, ...restOptions } = options;
      const result = await this._sendDaemonRequest('transcribe', {
        audio_path: audioFilePath,
        ...restOptions
      });

      if (result.success) {
        return { success: true, transcription: result.transcription };
      } else {
        return { success: false, error: result.error || 'Unknown error during local transcription' };
      }
    } catch (error) {
      console.error('[WhisperLocal] Transcription failed:', error.message);
      return { success: false, error: `Transcription failed: ${error.message}` };
    }
  }

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
        result = await this._sendDaemonRequest('change_model', { model_name: modelName });
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
   * Get diagnostic information for troubleshooting
   * @returns {Promise<Object>} Diagnostic information
   */
  async getDiagnosticInfo() {
    console.log('[WhisperLocal] Gathering diagnostic information...');
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      currentPythonPath: this.pythonPath,
      pythonSearchResults: [],
      systemInfo: {
        platform: process.platform,
        arch: process.arch
      }
    };
    
    // Test all common Python paths
    const pythonCandidates = [
      'python3', 'python', 'python3.11', 'python3.10', 'python3.9', 'python3.8', 'python3.7',
      '/usr/bin/python3', '/usr/bin/python', '/usr/local/bin/python3', '/usr/local/bin/python'
    ];
    
    for (const pythonPath of pythonCandidates) {
      const result = {
        path: pythonPath,
        exists: false,
        version: null,
        hasWhisper: false,
        whisperVersion: null,
        error: null
      };
      
      try {
        // Test if Python exists
        const pythonCheck = await this._runCommand(pythonPath, ['--version']);
        if (pythonCheck.success) {
          result.exists = true;
          result.version = pythonCheck.output.trim();
          
          // Test if whisper is available
          const whisperCheck = await this._runCommand(pythonPath, ['-c', 'import whisper; print("whisper-" + (whisper.__version__ if hasattr(whisper, "__version__") else "unknown"))']);
          if (whisperCheck.success) {
            result.hasWhisper = true;
            result.whisperVersion = whisperCheck.output.trim();
          } else {
            result.error = whisperCheck.error;
          }
        } else {
          result.error = pythonCheck.error;
        }
      } catch (error) {
        result.error = error.message;
      }
      
      diagnostics.pythonSearchResults.push(result);
    }
    
    return diagnostics;
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