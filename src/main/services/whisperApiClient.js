const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

/**
 * Whisper Cloud API Client Service
 * Handles communication with OpenAI's Whisper API for audio transcription
 */
class WhisperApiClient {
  constructor(apiKey = null) {
    // Try to load API key from environment variable first
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || null;
    this.baseURL = 'https://api.openai.com/v1';
    this.maxRetries = 3;
    this.retryDelay = 1000; // Base delay in milliseconds
    
    // Initialize axios instance with default configuration
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 300000, // 5 minutes timeout for large audio files
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'WhisperTranscript/1.0.0'
      }
    });
    
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
   * Validate API key format
   * @param {string} apiKey - API key to validate
   * @returns {boolean} - True if valid format
   */
  validateApiKey(apiKey) {
    return typeof apiKey === 'string' && apiKey.startsWith('sk-') && apiKey.length > 20;
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
      throw new Error('API key is required. Please set your OpenAI API key.');
    }
    
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }
    
    const {
      model = 'whisper-1',
      language,
      prompt,
      response_format = 'json',
      temperature = 0,
      onProgress,
      ...restOptions
    } = options;
    
    try {
      // Validate file size (25MB limit for Whisper API)
      const stats = fs.statSync(audioFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      if (fileSizeInMB > 25) {
        throw new Error(`File size (${fileSizeInMB.toFixed(2)}MB) exceeds the 25MB limit for Whisper API`);
      }
      
      console.log(`[WhisperAPI] Transcribing file: ${path.basename(audioFilePath)} (${fileSizeInMB.toFixed(2)}MB)`);
      
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
      
      // Make the API request with retry logic
      const response = await this._makeRequestWithRetry(
        '/audio/transcriptions',
        {
          method: 'POST',
          data: formData,
          headers: {
            ...formData.getHeaders(),
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress({
                type: 'upload',
                progress: percentCompleted,
                loaded: progressEvent.loaded,
                total: progressEvent.total
              });
            }
          }
        }
      );
      
      console.log('[WhisperAPI] Transcription completed successfully');
      const transcription = this._processTranscriptionResponse(response.data, response_format);
      return { success: true, transcription };
      
    } catch (error) {
      const detailedError = this._createTranscriptionError(error);
      console.error('[WhisperAPI] Transcription failed:', detailedError.message);
      return { success: false, error: detailedError.message, details: detailedError };
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