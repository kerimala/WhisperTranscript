const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { ERROR_TYPES, createStandardError, structuredLog, validateInput, safeFileOperation } = require('../utils/errorHandler');

/**
 * Whisper Cloud API Client Service
 * Handles communication with OpenAI's Whisper API for audio transcription
 */
class WhisperApiClient {
  constructor(apiKey = null, options = {}) {
    // Try to load API key from environment variable first
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || null;
    this.baseURL = 'https://api.openai.com/v1';
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000; // Base delay in milliseconds
    
    // Configurable timeouts for different operations
    this.timeouts = {
      default: options.defaultTimeout || 30000,    // 30 seconds for quick operations
      transcription: options.transcriptionTimeout || 300000,  // 5 minutes for transcription
      testConnection: options.testTimeout || 10000, // 10 seconds for connection tests
      ...options.customTimeouts
    };
    
    // Initialize axios instance with default configuration
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeouts.default,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'WhisperTranscript/1.0.0'
      }
    });
    
    // Active request tracking for cancellation
    this.activeRequests = new Map();
    
    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[WhisperAPI] Making request to: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[WhisperAPI] Request error:', error.message);
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[WhisperAPI] Response received: ${response.status} ${response.statusText}`);
        return response;
      },
      (error) => {
        return this._handleResponseError(error);
      }
    );
  }
  
  /**
   * Set or update the API key
   * @param {string} apiKey - OpenAI API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.client.defaults.headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  /**
   * Create a cancelable request with timeout configuration
   * @param {string} requestId - Unique identifier for this request
   * @param {string} operation - Operation type for timeout selection
   * @returns {object} AbortController and timeout value
   */
  createCancelableRequest(requestId, operation = 'default') {
    // Clean up any existing request with the same ID
    if (this.activeRequests.has(requestId)) {
      this.cancelRequest(requestId);
    }
    
    const controller = new AbortController();
    const timeout = this.timeouts[operation] || this.timeouts.default;
    
    // Set up automatic timeout cancellation
    const timeoutId = setTimeout(() => {
      if (this.activeRequests.has(requestId)) {
        structuredLog('warn', 'WhisperApiClient', `Request ${requestId} timed out after ${timeout}ms`);
        controller.abort();
        this.activeRequests.delete(requestId);
      }
    }, timeout);
    
    // Store request info
    this.activeRequests.set(requestId, {
      controller,
      timeoutId,
      operation,
      timeout,
      startTime: Date.now()
    });
    
    return { controller, timeout };
  }
  
  /**
   * Cancel a specific request
   * @param {string} requestId - Request ID to cancel
   * @returns {boolean} True if request was canceled
   */
  cancelRequest(requestId) {
    const requestInfo = this.activeRequests.get(requestId);
    if (requestInfo) {
      clearTimeout(requestInfo.timeoutId);
      requestInfo.controller.abort();
      this.activeRequests.delete(requestId);
      
      structuredLog('info', 'WhisperApiClient', `Canceled request ${requestId}`, {
        operation: requestInfo.operation,
        elapsed: Date.now() - requestInfo.startTime
      });
      
      return true;
    }
    return false;
  }
  
  /**
   * Cancel all active requests
   */
  cancelAllRequests() {
    const requestIds = Array.from(this.activeRequests.keys());
    let canceledCount = 0;
    
    for (const requestId of requestIds) {
      if (this.cancelRequest(requestId)) {
        canceledCount++;
      }
    }
    
    structuredLog('info', 'WhisperApiClient', `Canceled ${canceledCount} active requests`);
    return canceledCount;
  }
  
  /**
   * Clean up completed request
   * @private
   */
  cleanupRequest(requestId) {
    const requestInfo = this.activeRequests.get(requestId);
    if (requestInfo) {
      clearTimeout(requestInfo.timeoutId);
      this.activeRequests.delete(requestId);
    }
  }
  
  /**
   * Validate API key format with comprehensive checks
   * @param {string} apiKey - API key to validate
   * @returns {object} - Validation result with details
   * @throws {object} Standardized validation error for invalid format
   */
  validateApiKey(apiKey) {
    try {
      // Basic format validation
      validateInput(
        { apiKey },
        {
          apiKey: {
            required: true,
            type: 'string',
            minLength: 20,
            maxLength: 200, // Reasonable upper limit
            pattern: /^sk-[A-Za-z0-9]+$/ // Must start with 'sk-' followed by alphanumeric
          }
        },
        'API Key Validation'
      );

      // Additional OpenAI-specific validation
      if (!apiKey.startsWith('sk-')) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          'API key must start with "sk-"',
          'Invalid API key format. OpenAI API keys must start with "sk-"'
        );
      }

      // Check for minimum length after prefix
      const keyBody = apiKey.substring(3); // Remove 'sk-' prefix
      if (keyBody.length < 20) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          'API key body too short after sk- prefix',
          'API key appears to be incomplete or invalid'
        );
      }

      // Check for suspicious patterns (all same character, obvious test keys, etc.)
      if (/^(.)\1*$/.test(keyBody)) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          'API key appears to be a test key (repeated characters)',
          'Please provide a valid OpenAI API key'
        );
      }

      if (keyBody.toLowerCase().includes('test') || keyBody.toLowerCase().includes('fake')) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          'API key appears to be a test key',
          'Please provide a valid OpenAI API key'
        );
      }

      structuredLog('debug', 'WhisperApiClient', 'API key format validation passed');
      return { valid: true, message: 'API key format is valid' };
      
    } catch (error) {
      if (error.type) {
        // Already a standard error, re-throw
        throw error;
      } else {
        // Unexpected error, wrap it
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `API key validation failed: ${error.message}`,
          'Invalid API key format'
        );
      }
    }
  }
  
  /**
   * Transcribe audio file using OpenAI Whisper API
   * @param {string} audioFilePath - Path to the audio file
   * @param {Object} options - Transcription options
   * @param {string} options.model - Model to use (default: 'whisper-1')
   * @param {string} options.language - Language code (optional)
   * @param {string} options.prompt - Optional prompt to guide transcription
   * @param {string} options.response_format - Response format (json, text, srt, verbose_json, vtt)
   * @param {number} options.temperature - Sampling temperature (0-1)
   * @param {Function} options.onProgress - Progress callback function
   * @returns {Promise<Object>} - Transcription result
   */
  async transcribe(audioFilePath, options = {}) {
    if (!this.apiKey) {
      throw createStandardError(
        ERROR_TYPES.API_ERROR,
        'API key is required for transcription',
        'API key is required. Please set your OpenAI API key.'
      );
    }
    
    if (!fs.existsSync(audioFilePath)) {
      throw createStandardError(
        ERROR_TYPES.FILE_ERROR,
        `Audio file not found: ${audioFilePath}`,
        'Audio file not found. Please check the file path.'
      );
    }
    
    const {
      model = 'whisper-1',
      language,
      prompt,
      response_format = 'json',
      temperature = 0,
      onProgress,
      requestId = `transcribe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...restOptions
    } = options;
    
    // Create cancelable request
    const { controller, timeout } = this.createCancelableRequest(requestId, 'transcription');
    
    try {
      structuredLog('info', 'WhisperApiClient', `Starting transcription with request ID: ${requestId}`, {
        timeout,
        model,
        responseFormat: response_format
      });
      
      // Validate file size (25MB limit for Whisper API)
      const stats = fs.statSync(audioFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      if (fileSizeInMB > 25) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `File size (${fileSizeInMB.toFixed(2)}MB) exceeds the 25MB limit for Whisper API`,
          `File too large (${fileSizeInMB.toFixed(2)}MB). Maximum size is 25MB.`
        );
      }
      
      structuredLog('info', 'WhisperApiClient', `Transcribing file: ${path.basename(audioFilePath)}`, {
        fileSizeMB: fileSizeInMB.toFixed(2),
        requestId
      });
      
      // Create form data for multipart upload
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioFilePath));
      formData.append('model', model);
      formData.append('response_format', response_format);
      formData.append('temperature', temperature.toString());
      
      if (language) {
        formData.append('language', language);
      }
      
      if (prompt) {
        formData.append('prompt', prompt);
      }
      
      // Make the API request with retry logic and cancellation support
      const response = await this._makeRequestWithRetry(
        '/audio/transcriptions',
        {
          method: 'POST',
          data: formData,
          headers: {
            ...formData.getHeaders(),
            'Content-Type': 'multipart/form-data'
          },
          signal: controller.signal, // Add abort signal for cancellation
          timeout: timeout, // Use configured timeout
          onUploadProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress({
                type: 'upload',
                progress: percentCompleted,
                loaded: progressEvent.loaded,
                total: progressEvent.total,
                requestId
              });
            }
          }
        },
        requestId
      );
      
      structuredLog('info', 'WhisperApiClient', 'Transcription completed successfully', { requestId });
      const transcription = this._processTranscriptionResponse(response.data, response_format);
      
      // Clean up the completed request
      this.cleanupRequest(requestId);
      
      return { success: true, transcription, requestId };
      
    } catch (error) {
      // Clean up the request on error
      this.cleanupRequest(requestId);
      
      // Handle cancellation specifically
      if (error.name === 'AbortError') {
        const cancelError = createStandardError(
          ERROR_TYPES.API_ERROR,
          `Transcription request ${requestId} was canceled`,
          'Transcription was canceled',
          { requestId, timeout }
        );
        structuredLog('warn', 'WhisperApiClient', cancelError.message);
        throw cancelError;
      }
      
      const detailedError = this._createTranscriptionError(error, requestId);
      structuredLog('error', 'WhisperApiClient', 'Transcription failed', {
        requestId,
        error: detailedError.message,
        type: detailedError.type
      });
      
      return { success: false, error: detailedError.message, details: detailedError, requestId };
    }
  }
  
  /**
   * Make HTTP request with retry logic
   * @param {string} endpoint - API endpoint
   * @param {Object} config - Axios request configuration
   * @returns {Promise<Object>} - Response data
   */
  async _makeRequestWithRetry(endpoint, config) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[WhisperAPI] Attempt ${attempt}/${this.maxRetries}`);
        const response = await this.client.request({
          url: endpoint,
          ...config
        });
        return response;
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors
        if (this._shouldNotRetry(error)) {
          console.log(`[WhisperAPI] Not retrying due to error type: ${error.response?.status}`);
          throw error;
        }
        
        if (attempt < this.maxRetries) {
          const delay = this._calculateRetryDelay(attempt);
          console.log(`[WhisperAPI] Retrying in ${delay}ms...`);
          await this._sleep(delay);
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * Handle response errors and categorize them
   * @param {Object} error - Axios error object
   * @returns {Promise<never>} - Rejected promise with processed error
   */
  _handleResponseError(error) {
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      console.error(`[WhisperAPI] HTTP ${status}:`, data?.error?.message || data?.message || 'Unknown error');
      
      switch (status) {
        case 401:
          error.type = 'AUTHENTICATION_ERROR';
          error.userMessage = 'Invalid API key. Please check your OpenAI API key.';
          break;
        case 429:
          error.type = 'RATE_LIMIT_ERROR';
          error.userMessage = 'Rate limit exceeded. Please try again later.';
          break;
        case 413:
          error.type = 'FILE_TOO_LARGE';
          error.userMessage = 'File size exceeds the maximum limit (25MB).';
          break;
        case 400:
          error.type = 'BAD_REQUEST';
          error.userMessage = data?.error?.message || 'Invalid request. Please check your audio file format.';
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          error.type = 'SERVER_ERROR';
          error.userMessage = 'OpenAI service is temporarily unavailable. Please try again later.';
          break;
        default:
          error.type = 'API_ERROR';
          error.userMessage = data?.error?.message || 'An unexpected error occurred.';
      }
    } else if (error.request) {
      // Network error
      error.type = 'NETWORK_ERROR';
      error.userMessage = `Network error: ${error.message}. Please check your internet connection and ensure the local server is running.`;
      console.error(`[WhisperAPI] Network error: ${error.message}`, error.stack);
    } else {
      // Other error
      error.type = 'UNKNOWN_ERROR';
      error.userMessage = 'An unexpected error occurred.';
      console.error('[WhisperAPI] Unknown error:', error.message);
    }
    
    return Promise.reject(error);
  }
  
  /**
   * Determine if an error should not be retried
   * @param {Object} error - Error object
   * @returns {boolean} - True if should not retry
   */
  _shouldNotRetry(error) {
    if (!error.response) return false;
    
    const status = error.response.status;
    // Don't retry on client errors (4xx) except rate limiting (429)
    return status >= 400 && status < 500 && status !== 429;
  }
  
  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attempt - Current attempt number
   * @returns {number} - Delay in milliseconds
   */
  _calculateRetryDelay(attempt) {
    // Exponential backoff: base delay * 2^(attempt-1) + random jitter
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add up to 1 second of random jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }
  
  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Process transcription response based on format
   * @param {Object|string} data - Response data
   * @param {string} format - Response format
   * @returns {Object} - Processed response
   */
  _processTranscriptionResponse(data, format) {
    const result = {
      format,
      timestamp: new Date().toISOString()
    };
    
    switch (format) {
      case 'json':
        result.text = data.text;
        break;
      case 'verbose_json':
        result.text = data.text;
        result.language = data.language;
        result.duration = data.duration;
        result.segments = data.segments;
        break;
      case 'text':
      case 'srt':
      case 'vtt':
        result.text = data;
        break;
      default:
        result.text = typeof data === 'string' ? data : data.text;
    }
    
    return result;
  }
  
  /**
   * Create a standardized transcription error
   * @param {Object} error - Original error
   * @returns {Error} - Standardized error
   */
  _createTranscriptionError(error) {
    const transcriptionError = new Error(error.userMessage || error.message);
    transcriptionError.type = error.type || 'TRANSCRIPTION_ERROR';
    transcriptionError.originalError = error;
    
    if (error.response) {
      transcriptionError.status = error.response.status;
      transcriptionError.statusText = error.response.statusText;
    }
    
    return transcriptionError;
  }
  
  /**
   * Test API connection and key validity
   * @returns {Promise<boolean>} - True if connection is successful
   */
  async testConnection() {
    try {
      // Make a simple request to test the API key
      await this.client.get('/models');
      return true;
    } catch (error) {
      console.error('[WhisperAPI] Connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Health check method required by ServiceRegistry
   * @returns {Promise<boolean>} True if service is healthy, false otherwise
   */
  async isHealthy() {
    try {
      // If no API key is set, service is not healthy
      if (!this.apiKey) {
        return false;
      }

      // Test connection to OpenAI API
      return await this.testConnection();
    } catch (error) {
      console.warn('[WhisperAPI] Health check failed:', error.message);
      return false;
    }
  }
}

module.exports = WhisperApiClient;