/**
 * Standardized Error Handling Utilities
 * Provides consistent error formatting, logging, and handling across the application
 */

/**
 * Standard error types used throughout the application
 */
const ERROR_TYPES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR', 
  FILE_ERROR: 'FILE_ERROR',
  SERVICE_ERROR: 'SERVICE_ERROR',
  API_ERROR: 'API_ERROR',
  TRANSCRIPTION_ERROR: 'TRANSCRIPTION_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR',
  IPC_HANDLER_ERROR: 'IPC_HANDLER_ERROR',
  PROCESS_ERROR: 'PROCESS_ERROR',
};

/**
 * Create a standardized error object
 * @param {string} type - Error type from ERROR_TYPES
 * @param {string} message - Technical error message for logs
 * @param {string} userMessage - User-friendly error message
 * @param {object} metadata - Additional error context
 * @returns {object} Standardized error object
 */
function createStandardError(type, message, userMessage = null, metadata = {}) {
  return {
    type,
    message,
    userMessage: userMessage || message,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

/**
 * Enhanced console logging with structured format
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {string} context - Context/component name
 * @param {string} message - Log message
 * @param {object} data - Additional data to log
 */
function structuredLog(level, context, message, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    context,
    message,
    ...data,
  };

  const formatMessage = `[${logEntry.timestamp}] ${logEntry.level} [${context}] ${message}`;
  
  switch (level) {
    case 'error':
      console.error(formatMessage, data);
      break;
    case 'warn':
      console.warn(formatMessage, data);
      break;
    case 'info':
      console.info(formatMessage, data);
      break;
    case 'debug':
      console.debug(formatMessage, data);
      break;
    default:
      console.log(formatMessage, data);
  }
}

/**
 * Safe async function wrapper that standardizes error handling
 * @param {function} asyncFn - Async function to wrap
 * @param {string} context - Context name for logging
 * @param {string} defaultErrorType - Default error type if not specified
 * @returns {function} Wrapped function with standardized error handling
 */
function withErrorHandler(asyncFn, context, defaultErrorType = ERROR_TYPES.SERVICE_ERROR) {
  return async function(...args) {
    try {
      return await asyncFn.apply(this, args);
    } catch (error) {
      const standardError = createStandardError(
        error.type || defaultErrorType,
        error.message,
        error.userMessage,
        { context, originalStack: error.stack }
      );
      
      structuredLog('error', context, standardError.message, {
        type: standardError.type,
        userMessage: standardError.userMessage,
        metadata: standardError.metadata,
      });
      
      throw standardError;
    }
  };
}

/**
 * Validate and sanitize input parameters
 * @param {object} params - Parameters to validate
 * @param {object} schema - Validation schema
 * @param {string} context - Context for error messages
 * @throws {object} Standardized validation error
 */
function validateInput(params, schema, context = 'Input validation') {
  for (const [key, rules] of Object.entries(schema)) {
    const value = params[key];
    
    // Required field check
    if (rules.required && (value === undefined || value === null || value === '')) {
      throw createStandardError(
        ERROR_TYPES.VALIDATION_ERROR,
        `Missing required parameter: ${key}`,
        `${key} is required`,
        { context, parameter: key, provided: params }
      );
    }
    
    // Type check
    if (value !== undefined && rules.type && typeof value !== rules.type) {
      throw createStandardError(
        ERROR_TYPES.VALIDATION_ERROR,
        `Invalid type for parameter ${key}: expected ${rules.type}, got ${typeof value}`,
        `Invalid ${key} format`,
        { context, parameter: key, expected: rules.type, actual: typeof value }
      );
    }
    
    // String validation
    if (rules.type === 'string' && value) {
      if (rules.minLength && value.length < rules.minLength) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `Parameter ${key} too short: minimum ${rules.minLength} characters`,
          `${key} must be at least ${rules.minLength} characters`,
          { context, parameter: key, minLength: rules.minLength, actual: value.length }
        );
      }
      
      if (rules.maxLength && value.length > rules.maxLength) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `Parameter ${key} too long: maximum ${rules.maxLength} characters`,
          `${key} cannot exceed ${rules.maxLength} characters`,
          { context, parameter: key, maxLength: rules.maxLength, actual: value.length }
        );
      }
      
      if (rules.pattern && !rules.pattern.test(value)) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `Parameter ${key} does not match required pattern`,
          `Invalid ${key} format`,
          { context, parameter: key, pattern: rules.pattern.toString() }
        );
      }
    }
    
    // Numeric validation
    if (rules.type === 'number' && value !== undefined) {
      if (rules.min !== undefined && value < rules.min) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `Parameter ${key} too small: minimum ${rules.min}`,
          `${key} must be at least ${rules.min}`,
          { context, parameter: key, min: rules.min, actual: value }
        );
      }
      
      if (rules.max !== undefined && value > rules.max) {
        throw createStandardError(
          ERROR_TYPES.VALIDATION_ERROR,
          `Parameter ${key} too large: maximum ${rules.max}`,
          `${key} cannot exceed ${rules.max}`,
          { context, parameter: key, max: rules.max, actual: value }
        );
      }
    }
  }
}

/**
 * Safe file operation wrapper
 * @param {function} fileOp - File operation function
 * @param {string} filePath - File path for context
 * @param {string} operation - Operation name for error messages
 * @returns {Promise} Result of file operation
 */
async function safeFileOperation(fileOp, filePath, operation = 'file operation') {
  try {
    return await fileOp();
  } catch (error) {
    const errorCode = error.code || 'UNKNOWN';
    let userMessage;
    
    switch (errorCode) {
      case 'ENOENT':
        userMessage = 'File not found';
        break;
      case 'EACCES':
        userMessage = 'Permission denied';
        break;
      case 'ENOSPC':
        userMessage = 'Not enough disk space';
        break;
      case 'EMFILE':
        userMessage = 'Too many open files';
        break;
      default:
        userMessage = `Failed to ${operation}`;
    }
    
    throw createStandardError(
      ERROR_TYPES.FILE_ERROR,
      `${operation} failed for ${filePath}: ${error.message}`,
      userMessage,
      { filePath, operation, errorCode, originalError: error.message }
    );
  }
}

module.exports = {
  ERROR_TYPES,
  createStandardError,
  structuredLog,
  withErrorHandler,
  validateInput,
  safeFileOperation,
};