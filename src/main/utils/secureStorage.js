/**
 * Secure Storage Utilities
 * Provides encrypted storage for sensitive data like API keys
 * Uses Node.js built-in crypto module for AES-256-GCM encryption
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ERROR_TYPES, createStandardError, structuredLog, safeFileOperation, validateInput } = require('./errorHandler');

// Encryption constants
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Generate a unique machine-based key for encryption
 * Uses machine-specific identifiers to create a unique key per installation
 * @returns {Buffer} 32-byte encryption key
 */
function generateMachineKey() {
  const machineInfo = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    userInfo: os.userInfo().username
  };
  
  // Create a hash of machine-specific information
  const machineString = JSON.stringify(machineInfo);
  const hash = crypto.createHash('sha256');
  hash.update(machineString);
  hash.update('WhisperTranscript-SecureStorage-v1'); // Add app-specific salt
  
  return hash.digest();
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {Buffer} key - Encryption key
 * @returns {object} Encrypted data with IV and auth tag
 */
function encryptData(plaintext, key) {
  try {
    // Generate random IV for each encryption
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Create cipher with IV
    const cipher = crypto.createCipherGCM(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from('WhisperTranscript', 'utf8')); // Additional authenticated data
    
    // Encrypt the data
    let encrypted = cipher.update(plaintext, 'utf8');
    const final = cipher.final();
    encrypted = Buffer.concat([encrypted, final]);
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      version: '1' // For future compatibility
    };
  } catch (error) {
    throw createStandardError(
      ERROR_TYPES.CONFIG_ERROR,
      `Encryption failed: ${error.message}`,
      'Failed to secure sensitive data'
    );
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {object} encryptedData - Encrypted data object with IV and auth tag
 * @param {Buffer} key - Decryption key
 * @returns {string} Decrypted plaintext
 */
function decryptData(encryptedData, key) {
  try {
    const { encrypted, iv, authTag, version } = encryptedData;
    
    // Version compatibility check
    if (version !== '1') {
      throw new Error(`Unsupported encryption version: ${version}`);
    }
    
    // Convert from base64
    const encryptedBuffer = Buffer.from(encrypted, 'base64');
    const ivBuffer = Buffer.from(iv, 'base64');
    const authTagBuffer = Buffer.from(authTag, 'base64');
    
    // Create decipher with IV
    const decipher = crypto.createDecipherGCM(ALGORITHM, key, ivBuffer);
    decipher.setAAD(Buffer.from('WhisperTranscript', 'utf8'));
    decipher.setAuthTag(authTagBuffer);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedBuffer);
    const final = decipher.final();
    decrypted = Buffer.concat([decrypted, final]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    throw createStandardError(
      ERROR_TYPES.CONFIG_ERROR,
      `Decryption failed: ${error.message}`,
      'Failed to access stored sensitive data. The data may be corrupted or tampered with.'
    );
  }
}

/**
 * Secure Storage Manager
 * Handles encrypted storage and retrieval of sensitive configuration data
 */
class SecureStorage {
  constructor() {
    this.configDir = path.join(os.homedir(), '.whispertranscript');
    this.configPath = path.join(this.configDir, 'config.json');
    this.secureConfigPath = path.join(this.configDir, 'secure.enc');
    this.machineKey = generateMachineKey();
    
    // Ensure config directory exists
    this.ensureConfigDirectory();
  }
  
  /**
   * Ensure configuration directory exists with proper permissions
   * @private
   */
  ensureConfigDirectory() {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { 
          recursive: true, 
          mode: 0o700 // Only user can read/write/execute
        });
        structuredLog('info', 'SecureStorage', 'Created secure config directory', { path: this.configDir });
      } else {
        // Update permissions on existing directory
        fs.chmodSync(this.configDir, 0o700);
      }
    } catch (error) {
      throw createStandardError(
        ERROR_TYPES.CONFIG_ERROR,
        `Failed to create config directory: ${error.message}`,
        'Unable to create secure storage directory'
      );
    }
  }
  
  /**
   * Store sensitive data securely
   * @param {string} key - Storage key
   * @param {string} value - Sensitive value to store
   * @returns {Promise<void>}
   */
  async setSecure(key, value) {
    try {
      validateInput(
        { key, value },
        {
          key: { required: true, type: 'string', minLength: 1 },
          value: { required: true, type: 'string', minLength: 1 }
        },
        'SecureStorage.setSecure'
      );
      
      // Load existing secure config or create new
      let secureConfig = {};
      if (fs.existsSync(this.secureConfigPath)) {
        const rawData = await safeFileOperation(
          () => fs.promises.readFile(this.secureConfigPath, 'utf8'),
          this.secureConfigPath,
          'read secure config'
        );
        
        try {
          secureConfig = JSON.parse(rawData);
        } catch (parseError) {
          structuredLog('warn', 'SecureStorage', 'Corrupted secure config, creating new', { error: parseError.message });
          secureConfig = {};
        }
      }
      
      // Encrypt the value
      const encryptedValue = encryptData(value, this.machineKey);
      secureConfig[key] = encryptedValue;
      
      // Save encrypted config
      const encryptedConfigData = JSON.stringify(secureConfig, null, 2);
      await safeFileOperation(
        () => fs.promises.writeFile(this.secureConfigPath, encryptedConfigData, { mode: 0o600 }),
        this.secureConfigPath,
        'write secure config'
      );
      
      structuredLog('info', 'SecureStorage', `Securely stored value for key: ${key}`);
      
    } catch (error) {
      if (error.type) {
        throw error; // Re-throw standardized errors
      }
      throw createStandardError(
        ERROR_TYPES.CONFIG_ERROR,
        `Failed to store secure value: ${error.message}`,
        'Unable to save sensitive data securely'
      );
    }
  }
  
  /**
   * Retrieve sensitive data securely
   * @param {string} key - Storage key
   * @returns {Promise<string|null>} Decrypted value or null if not found
   */
  async getSecure(key) {
    try {
      validateInput(
        { key },
        {
          key: { required: true, type: 'string', minLength: 1 }
        },
        'SecureStorage.getSecure'
      );
      
      if (!fs.existsSync(this.secureConfigPath)) {
        return null;
      }
      
      const rawData = await safeFileOperation(
        () => fs.promises.readFile(this.secureConfigPath, 'utf8'),
        this.secureConfigPath,
        'read secure config'
      );
      
      let secureConfig;
      try {
        secureConfig = JSON.parse(rawData);
      } catch (parseError) {
        structuredLog('error', 'SecureStorage', 'Failed to parse secure config', { error: parseError.message });
        return null;
      }
      
      if (!secureConfig[key]) {
        return null;
      }
      
      // Decrypt the value
      const decryptedValue = decryptData(secureConfig[key], this.machineKey);
      
      structuredLog('debug', 'SecureStorage', `Retrieved secure value for key: ${key}`);
      return decryptedValue;
      
    } catch (error) {
      if (error.type) {
        throw error; // Re-throw standardized errors
      }
      throw createStandardError(
        ERROR_TYPES.CONFIG_ERROR,
        `Failed to retrieve secure value: ${error.message}`,
        'Unable to access stored sensitive data'
      );
    }
  }
  
  /**
   * Check if a secure key exists
   * @param {string} key - Storage key
   * @returns {Promise<boolean>} True if key exists
   */
  async hasSecure(key) {
    try {
      const value = await this.getSecure(key);
      return value !== null;
    } catch (error) {
      // If there's an error accessing secure storage, assume key doesn't exist
      structuredLog('warn', 'SecureStorage', `Error checking key existence: ${error.message}`, { key });
      return false;
    }
  }
  
  /**
   * Remove a secure key
   * @param {string} key - Storage key to remove
   * @returns {Promise<void>}
   */
  async removeSecure(key) {
    try {
      if (!fs.existsSync(this.secureConfigPath)) {
        return; // Nothing to remove
      }
      
      const rawData = await safeFileOperation(
        () => fs.promises.readFile(this.secureConfigPath, 'utf8'),
        this.secureConfigPath,
        'read secure config'
      );
      
      let secureConfig;
      try {
        secureConfig = JSON.parse(rawData);
      } catch (parseError) {
        return; // Corrupted config, nothing to remove
      }
      
      delete secureConfig[key];
      
      // Save updated config
      const encryptedConfigData = JSON.stringify(secureConfig, null, 2);
      await safeFileOperation(
        () => fs.promises.writeFile(this.secureConfigPath, encryptedConfigData, { mode: 0o600 }),
        this.secureConfigPath,
        'write secure config'
      );
      
      structuredLog('info', 'SecureStorage', `Removed secure key: ${key}`);
      
    } catch (error) {
      throw createStandardError(
        ERROR_TYPES.CONFIG_ERROR,
        `Failed to remove secure key: ${error.message}`,
        'Unable to remove stored data'
      );
    }
  }

  /**
   * Migrate from plain text storage to encrypted storage
   * @param {string} plainConfigPath - Path to plain text config
   * @returns {Promise<object>} Migration result
   */
  async migrateFromPlainText(plainConfigPath = null) {
    const configPath = plainConfigPath || this.configPath;
    const migrationResult = {
      migrated: false,
      migratedKeys: [],
      errors: []
    };
    
    try {
      if (!fs.existsSync(configPath)) {
        return migrationResult;
      }
      
      const rawData = await safeFileOperation(
        () => fs.promises.readFile(configPath, 'utf8'),
        configPath,
        'read plain config for migration'
      );
      
      let plainConfig;
      try {
        plainConfig = JSON.parse(rawData);
      } catch (parseError) {
        migrationResult.errors.push('Failed to parse existing config');
        return migrationResult;
      }
      
      // Keys that should be stored securely
      const secureKeys = ['openaiApiKey', 'apiKey'];
      
      for (const key of secureKeys) {
        if (plainConfig[key] && typeof plainConfig[key] === 'string' && plainConfig[key].trim()) {
          try {
            await this.setSecure(key, plainConfig[key]);
            migrationResult.migratedKeys.push(key);
            delete plainConfig[key]; // Remove from plain config
          } catch (error) {
            migrationResult.errors.push(`Failed to migrate ${key}: ${error.message}`);
          }
        }
      }
      
      if (migrationResult.migratedKeys.length > 0) {
        // Update plain config without sensitive data
        const updatedConfigData = JSON.stringify(plainConfig, null, 2);
        await safeFileOperation(
          () => fs.promises.writeFile(configPath, updatedConfigData, { mode: 0o600 }),
          configPath,
          'update plain config after migration'
        );
        
        migrationResult.migrated = true;
        structuredLog('info', 'SecureStorage', 'Migration completed', {
          migratedKeys: migrationResult.migratedKeys,
          errorCount: migrationResult.errors.length
        });
      }
      
      return migrationResult;
      
    } catch (error) {
      migrationResult.errors.push(`Migration failed: ${error.message}`);
      return migrationResult;
    }
  }
}

// Export a singleton instance
const secureStorage = new SecureStorage();

module.exports = {
  secureStorage,
  SecureStorage
};