const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Whisper Local Client Service
 * Handles communication with the local Python Whisper service
 */
class WhisperLocalClient {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || 'python3';
    this.servicePath = path.join(__dirname, 'whisper_service.py');
    this.currentModel = options.model || 'base';
    this.isServiceReady = false;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    
    // Supported audio formats
    this.supportedFormats = [
      '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.webm'
    ];
  }

  /**
   * Test if the Python service is available and working
   * @returns {Promise<boolean>} True if service is ready
   */
  async testService() {
    try {
      console.log('[WhisperLocal] Testing Python service availability...');
      
      const result = await this._runPythonCommand(['test', '--model', this.currentModel]);
      
      if (result.success) {
        this.isServiceReady = true;
        console.log('[WhisperLocal] Service test successful');
        return true;
      } else {
        console.error('[WhisperLocal] Service test failed:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[WhisperLocal] Service test error:', error.message);
      return false;
    }
  }

  /**
   * Get available Whisper models
   * @returns {Promise<Object>} Available models information
   */
  async getAvailableModels() {
    try {
      const result = await this._runPythonCommand(['models']);
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
      this.currentModel = modelName;
      console.log(`[WhisperLocal] Model changed to: ${modelName}`);
      
      // Test the new model
      const testResult = await this.testService();
      
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

      // Prepare command arguments
      const args = [
        'transcribe',
        '--audio', audioFilePath,
        '--model', this.currentModel
      ];

      if (language) {
        args.push('--language', language);
      }

      // Create temporary output file
      const tempDir = os.tmpdir();
      const outputFile = path.join(tempDir, `whisper-result-${Date.now()}.json`);
      args.push('--output', outputFile);

      // Notify progress
      if (onProgress) {
        onProgress({ stage: 'processing', progress: 50 });
      }

      // Run transcription
      const result = await this._runPythonCommand(args, {
        timeout: 300000, // 5 minutes timeout
        onProgress
      });

      // Read result from output file if it exists
      let transcriptionResult;
      if (fs.existsSync(outputFile)) {
        try {
          const resultData = fs.readFileSync(outputFile, 'utf8');
          transcriptionResult = JSON.parse(resultData);
          
          // Clean up temp file
          fs.unlinkSync(outputFile);
        } catch (parseError) {
          console.error('[WhisperLocal] Error parsing result file:', parseError);
          transcriptionResult = result;
        }
      } else {
        transcriptionResult = result;
      }

      // Notify completion
      if (onProgress) {
        onProgress({ stage: 'complete', progress: 100 });
      }

      if (transcriptionResult.success) {
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
        throw new Error(transcriptionResult.error || 'Transcription failed');
      }

    } catch (error) {
      console.error('[WhisperLocal] Transcription error:', error.message);
      
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