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
      lastSuccess: null
    });
    
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
        const isHealthy = await this.checkServiceHealth(serviceName);
        if (!isHealthy) {
          throw new Error(`Service '${serviceName}' is not healthy`);
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
   */
  async checkServiceHealth(serviceName) {
    const service = this.services.get(serviceName);
    if (!service || !service.config.healthCheck) {
      return true; // No health check needed
    }

    // If the service is starting, wait for it to be ready
    if (service.instance.isStarting) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait and re-check
      return this.checkServiceHealth(serviceName);
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
      config: service.config
    };
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