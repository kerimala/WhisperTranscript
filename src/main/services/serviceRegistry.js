const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Service Registry for managing transcription service switching
 * Handles configuration persistence, service health monitoring, and fallback mechanisms
 */
class ServiceRegistry extends EventEmitter {
  constructor() {
    super();
    
    this.configPath = path.join(os.homedir(), '.whispertranscript', 'config.json');
    this.services = new Map();
    this.currentService = null;
    this.fallbackService = null;
    this.healthCheckInterval = null;
    this.healthCheckIntervalMs = 30000; // 30 seconds
    
    // Service states
    this.serviceStates = new Map();
    
    // Load configuration on initialization
    this.loadConfiguration();
  }
  
  /**
   * Register a service with the registry
   * @param {string} name - Service name (e.g., 'cloud', 'local')
   * @param {Object} service - Service instance
   * @param {Object} config - Service configuration
   */
  registerService(name, service, config = {}) {
    this.services.set(name, {
      instance: service,
      config: {
        priority: config.priority || 0,
        healthCheck: config.healthCheck || true,
        fallback: config.fallback || false,
        ...config
      },
      lastHealthCheck: null,
      isHealthy: false
    });
    
    this.serviceStates.set(name, {
      status: 'unknown',
      lastError: null,
      lastSuccess: null,
      dependencyFailure: null
    });
    
    // Listen for dependency failure events from services
    if (service && typeof service.on === 'function') {
      service.on('dependencyFailure', (failureInfo) => {
        console.warn(`[ServiceRegistry] Dependency failure in service '${name}':`, failureInfo.reason?.message);
        
        const state = this.serviceStates.get(name);
        if (state) {
          state.status = 'dependency_error';
          state.lastError = failureInfo.reason?.message || 'Dependency failure';
          state.dependencyFailure = failureInfo.reason;
        }
        
        this.emit('dependencyFailure', { 
          service: name, 
          failure: failureInfo,
          timestamp: new Date().toISOString()
        });
      });
    }
    
    console.log(`[ServiceRegistry] Registered service: ${name}`);
    this.emit('serviceRegistered', { name, config });
  }
  
  /**
   * Switch to a specific service
   * @param {string} serviceName - Name of the service to switch to
   * @param {Object} options - Switch options
   */
  async switchToService(serviceName, options = {}) {
    const { preserveState = true, force = false } = options;
    
    if (!this.services.has(serviceName)) {
      throw new Error(`Service '${serviceName}' is not registered`);
    }
    
    const targetService = this.services.get(serviceName);
    const previousService = this.currentService;
    
    try {
      // Preserve current state if requested
      let preservedState = null;
      if (preserveState && previousService) {
        preservedState = await this.preserveServiceState(previousService);
      }
      
      // Check service health before switching (unless forced)
      if (!force) {
        let isHealthy = await this.checkServiceHealth(serviceName);
        if (!isHealthy) {
          // Try to start the service if it's not healthy and has a startService method
          const serviceInstance = targetService.instance;
          if (serviceInstance && typeof serviceInstance.startService === 'function') {
            console.log(`[ServiceRegistry] Service '${serviceName}' is not healthy, attempting to start it...`);
            try {
              const startResult = await serviceInstance.startService();
              if (startResult) {
                // Give the service a moment to become ready, then check health again
                await new Promise(resolve => setTimeout(resolve, 2000));
                isHealthy = await this.checkServiceHealth(serviceName);
                if (isHealthy) {
                  console.log(`[ServiceRegistry] Successfully started and verified service '${serviceName}'`);
                } else {
                  console.warn(`[ServiceRegistry] Service '${serviceName}' started but still not healthy`);
                }
              } else {
                console.warn(`[ServiceRegistry] Failed to start service '${serviceName}'`);
              }
            } catch (startError) {
              console.warn(`[ServiceRegistry] Error starting service '${serviceName}':`, startError.message);
            }
          }
          
          // If still not healthy after start attempt, check for dependency failures
          if (!isHealthy) {
            const serviceInstance = targetService.instance;
            const serviceState = this.serviceStates.get(serviceName);
            let errorMessage = `Service '${serviceName}' is not available`;
            
            // Check if we have dependency failure information
            if (serviceState?.dependencyFailure) {
              const failure = serviceState.dependencyFailure;
              errorMessage = `${failure.message}. Solution: ${failure.solution}`;
            } else if (serviceName === 'local' && serviceInstance) {
              // Fallback to checking prerequisites if no dependency failure info available
              if (typeof serviceInstance.checkPrerequisites === 'function') {
                try {
                  const prereqResult = await serviceInstance.checkPrerequisites();
                  if (!prereqResult.success) {
                    const missing = prereqResult.missing || [];
                    const details = prereqResult.details || {};
                    
                    if (missing.includes('python')) {
                      errorMessage = `Python 3.7+ is required but not found. ${details.python?.suggestion || 'Please install Python first.'}`;
                    } else if (missing.includes('whisper')) {
                      errorMessage = `OpenAI Whisper package is missing. ${details.whisper?.suggestion || 'Please run: pip install openai-whisper'}`;
                    } else if (missing.includes('service_file')) {
                      errorMessage = `Local transcription service files are missing. Please reinstall the application.`;
                    } else if (missing.length > 0) {
                      const suggestions = missing.map(item => {
                        const detail = details[item];
                        return detail?.suggestion || `${item} is required`;
                      }).join('; ');
                      errorMessage = `Missing dependencies: ${missing.join(', ')}. ${suggestions}`;
                    } else {
                      errorMessage = `Local transcription service prerequisites check failed.`;
                    }
                  }
                } catch (prereqError) {
                  errorMessage = `Local transcription service prerequisites check failed: ${prereqError.message}`;
                }
              } else {
                errorMessage = `Local transcription service failed to start. Please ensure Python and required dependencies are installed.`;
              }
            }
            
            throw new Error(errorMessage);
          }
        }
      }
      
      // Perform the switch
      await this.performServiceSwitch(serviceName, preservedState);
      
      // Update configuration
      await this.updateConfiguration({ currentService: serviceName });
      
      console.log(`[ServiceRegistry] Successfully switched to service: ${serviceName}`);
      this.emit('serviceSwitch', {
        from: previousService,
        to: serviceName,
        preservedState: !!preservedState
      });
      
      return { success: true, service: serviceName };
      
    } catch (error) {
      console.error(`[ServiceRegistry] Failed to switch to service '${serviceName}':`, error);
      
      // Attempt fallback if available
      if (!force && this.fallbackService && this.fallbackService !== serviceName) {
        console.log(`[ServiceRegistry] Attempting fallback to: ${this.fallbackService}`);
        try {
          return await this.switchToService(this.fallbackService, { force: true });
        } catch (fallbackError) {
          console.error(`[ServiceRegistry] Fallback also failed:`, fallbackError);
        }
      }
      
      this.emit('serviceSwitchError', {
        service: serviceName,
        error: error.message,
        previousService
      });
      
      throw error;
    }
  }
  
  /**
   * Get the current active service
   */
  getCurrentService() {
    return this.currentService;
  }
  
  /**
   * Get service instance by name
   * @param {string} serviceName - Name of the service
   */
  getService(serviceName) {
    const service = this.services.get(serviceName);
    return service ? service.instance : null;
  }
  
  /**
   * Get all registered services
   */
  getServices() {
    const services = {};
    for (const [name, service] of this.services) {
      services[name] = {
        config: service.config,
        isHealthy: service.isHealthy,
        lastHealthCheck: service.lastHealthCheck
      };
    }
    return services;
  }
  
  /**
   * Set fallback service
   * @param {string} serviceName - Name of the fallback service
   */
  setFallbackService(serviceName) {
    if (!this.services.has(serviceName)) {
      throw new Error(`Service '${serviceName}' is not registered`);
    }
    
    this.fallbackService = serviceName;
    this.updateConfiguration({ fallbackService: serviceName });
    console.log(`[ServiceRegistry] Fallback service set to: ${serviceName}`);
  }
  
  /**
   * Start health monitoring for all services
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.healthCheckIntervalMs);
    
    console.log('[ServiceRegistry] Health monitoring started');
  }
  
  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    console.log('[ServiceRegistry] Health monitoring stopped');
  }
  
  /**
   * Perform health checks on all services
   */
  async performHealthChecks() {
    for (const [name, service] of this.services) {
      if (service.config.healthCheck) {
        await this.checkServiceHealth(name);
      }
    }
  }
  
  /**
   * Check health of a specific service
   * @param {string} serviceName - Name of the service to check
   * @param {number} retryCount - Internal retry counter to prevent infinite recursion
   * @param {number} maxRetries - Maximum number of retries for starting services
   */
  async checkServiceHealth(serviceName, retryCount = 0, maxRetries = 5) {
    const service = this.services.get(serviceName);
    if (!service || !service.config.healthCheck) {
      return true; // No health check needed
    }

    // If the service is starting, wait for it to be ready with retry limit
    if (service.instance.isStarting) {
      if (retryCount >= maxRetries) {
        console.warn(`[ServiceRegistry] Service ${serviceName} has been starting for too long (${maxRetries} retries), considering it unhealthy`);
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait and re-check
      return this.checkServiceHealth(serviceName, retryCount + 1, maxRetries);
    }
    
    try {
      const isHealthy = await service.instance.isHealthy();
      service.isHealthy = isHealthy;
      service.lastHealthCheck = new Date().toISOString();
      
      this.serviceStates.set(serviceName, {
        status: isHealthy ? 'healthy' : 'unhealthy',
        lastError: isHealthy ? null : 'Health check failed',
        lastSuccess: isHealthy ? new Date().toISOString() : this.serviceStates.get(serviceName).lastSuccess
      });
      
      this.emit('healthCheckResult', { name: serviceName, isHealthy });
      return isHealthy;
      
    } catch (error) {
      console.error(`[ServiceRegistry] Health check failed for ${serviceName}:`, error);
      
      service.isHealthy = false;
      service.lastHealthCheck = new Date().toISOString();
      
      const state = this.serviceStates.get(serviceName);
      state.status = 'error';
      state.lastError = error.message;
      
      this.emit('healthCheck', {
        service: serviceName,
        isHealthy: false,
        error: error.message,
        timestamp: service.lastHealthCheck
      });
      
      return false;
    }
  }
  
  /**
   * Preserve service state before switching
   * @param {string} serviceName - Name of the service
   */
  async preserveServiceState(serviceName) {
    const service = this.services.get(serviceName);
    if (!service || !service.instance.getState) {
      return null;
    }
    
    try {
      return await service.instance.getState();
    } catch (error) {
      console.warn(`[ServiceRegistry] Failed to preserve state for ${serviceName}:`, error);
      return null;
    }
  }
  
  /**
   * Perform the actual service switch
   * @param {string} serviceName - Name of the target service
   * @param {Object} preservedState - Previously preserved state
   */
  async performServiceSwitch(serviceName, preservedState) {
    const service = this.services.get(serviceName);
    
    // Deactivate current service if any
    if (this.currentService && this.currentService !== serviceName) {
      const currentService = this.services.get(this.currentService);
      if (currentService && currentService.instance.deactivate) {
        try {
          await currentService.instance.deactivate();
        } catch (error) {
          console.warn(`[ServiceRegistry] Failed to deactivate ${this.currentService}:`, error);
        }
      }
    }
    
    // Activate new service
    if (service.instance.activate) {
      await service.instance.activate();
    }
    
    // Restore state if available
    if (preservedState && service.instance.setState) {
      try {
        await service.instance.setState(preservedState);
      } catch (error) {
        console.warn(`[ServiceRegistry] Failed to restore state for ${serviceName}:`, error);
      }
    }
    
    this.currentService = serviceName;
  }
  
  /**
   * Load configuration from disk
   */
  loadConfiguration() {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.currentService = config.currentService || null;
        this.fallbackService = config.fallbackService || null;
        console.log('[ServiceRegistry] Configuration loaded');
      } else {
        console.log('[ServiceRegistry] No configuration file found, using defaults');
      }
    } catch (error) {
      console.error('[ServiceRegistry] Failed to load configuration:', error);
    }
  }
  
  /**
   * Update and save configuration
   * @param {Object} updates - Configuration updates
   */
  async updateConfiguration(updates) {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // Load existing config
      let config = {};
      if (fs.existsSync(this.configPath)) {
        config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
      
      // Apply updates
      Object.assign(config, updates);
      
      // Save updated config
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      
      console.log('[ServiceRegistry] Configuration updated');
    } catch (error) {
      console.error('[ServiceRegistry] Failed to update configuration:', error);
    }
  }
  
  /**
   * Get service status information
   * @param {string} serviceName - Name of the service
   */
  getServiceStatus(serviceName) {
    const service = this.services.get(serviceName);
    const state = this.serviceStates.get(serviceName);
    
    if (!service || !state) {
      return null;
    }
    
    return {
      name: serviceName,
      isActive: this.currentService === serviceName,
      isHealthy: service.isHealthy,
      lastHealthCheck: service.lastHealthCheck,
      status: state.status,
      lastError: state.lastError,
      lastSuccess: state.lastSuccess,
      dependencyFailure: state.dependencyFailure,
      config: service.config
    };
  }

  /**
   * Get available services list
   * @returns {Array<string>} Array of service names
   */
  getAvailableServices() {
    return Array.from(this.services.keys());
  }

  /**
   * Get health status for all services
   * @returns {Object} Health status object with service names as keys
   */
  getHealthStatus() {
    const healthStatus = {};
    
    for (const [serviceName, service] of this.services) {
      const state = this.serviceStates.get(serviceName);
      
      healthStatus[serviceName] = {
        isHealthy: service.isHealthy || false,
        status: state?.status || 'unknown',
        lastCheck: service.lastHealthCheck,
        lastError: state?.lastError || null,
        dependencyFailure: state?.dependencyFailure || null,
        isStarting: service.instance.isStarting || false
      };
    }
    
    return healthStatus;
  }

  /**
   * Get fallback service name
   * @returns {string|null} Name of fallback service or null
   */
  getFallbackService() {
    return this.fallbackService;
  }

  async executeWithFallback(command, ...args) {
    console.log(`[ServiceRegistry] executeWithFallback called with command: ${command}, currentService: ${this.currentService}`);
    
    if (!this.currentService) {
      throw new Error('No service is currently active');
    }

    const primaryService = this.services.get(this.currentService);
    if (!primaryService) {
      throw new Error(`Current service '${this.currentService}' not found`);
    }

    try {
      if (typeof primaryService.instance[command] !== 'function') {
        throw new Error(`Command '${command}' not found on service '${this.currentService}'`);
      }
      console.log(`[ServiceRegistry] Executing ${command} on ${this.currentService} service`);
      return await primaryService.instance[command](...args);
    } catch (error) {
      console.warn(`[ServiceRegistry] Primary service command '${command}' failed:`, error.message);

      // Do not fallback to cloud service if local service fails
      if (this.currentService === 'local') {
        console.error(`[ServiceRegistry] Local service command '${command}' failed. No fallback.`, error);
        throw new Error('Local transcription service failed. Please check if the local model is running correctly.');
      }

      if (this.fallbackService && this.fallbackService !== this.currentService) {
        const fallback = this.services.get(this.fallbackService);
        if (fallback && typeof fallback.instance[command] === 'function') {
          console.log(`[ServiceRegistry] Attempting fallback to '${this.fallbackService}' for command '${command}'`);
          try {
            return await fallback.instance[command](...args);
          } catch (fallbackError) {
            console.error(`[ServiceRegistry] Fallback service command '${command}' also failed:`, fallbackError.message);
            throw fallbackError; // Re-throw fallback error
          }
        }
      }
      
      throw error; // Re-throw original error if no fallback
    }
  }
  
  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopHealthMonitoring();
    
    // Deactivate current service
    if (this.currentService) {
      const service = this.services.get(this.currentService);
      if (service && service.instance.deactivate) {
        try {
          service.instance.deactivate();
        } catch (error) {
          console.warn(`[ServiceRegistry] Failed to deactivate ${this.currentService} during cleanup:`, error);
        }
      }
    }
    
    console.log('[ServiceRegistry] Cleanup completed');
  }
}

module.exports = ServiceRegistry;