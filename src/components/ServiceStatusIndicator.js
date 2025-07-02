import React, { useState, useEffect } from 'react';
import './ServiceStatusIndicator.css';

const ServiceStatusIndicator = ({ onServiceSwitch }) => {
  const [serviceStatus, setServiceStatus] = useState({
    currentService: 'cloud',
    availableServices: [],
    healthStatus: {},
    fallbackService: null
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadServiceStatus();
    
    // Set up periodic health checks
    const healthCheckInterval = setInterval(() => {
      loadServiceStatus();
    }, 30000); // Check every 30 seconds

    return () => clearInterval(healthCheckInterval);
  }, []);

  const loadServiceStatus = async () => {
    try {
      const status = await window.electronAPI.getServiceStatus();
      setServiceStatus(status);
      setError(null);
    } catch (err) {
      console.error('Failed to load service status:', err);
      setError('Failed to load service status');
    }
  };

  const handleServiceSwitch = async (serviceName) => {
    if (serviceName === serviceStatus.currentService) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await window.electronAPI.switchService(serviceName, {
        preserveState: true,
        timeout: 10000
      });
      
      if (result.success) {
        await loadServiceStatus();
        if (onServiceSwitch) {
          onServiceSwitch(serviceName, result);
        }
      } else {
        setError(`Failed to switch to ${serviceName}: ${result.error}`);
      }
    } catch (err) {
      console.error('Service switch error:', err);
      setError(`Error switching to ${serviceName}: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getHealthStatusIcon = (serviceName) => {
    const health = serviceStatus.healthStatus[serviceName];
    if (!health) return '❓';

    if (health.isStarting) return '⏳';
    
    switch (health.status) {
      case 'healthy': return '✅';
      case 'unhealthy': return '❌';
      case 'degraded': return '⚠️';
      default: return '❓';
    }
  };

  const getHealthStatusText = (serviceName) => {
    const health = serviceStatus.healthStatus[serviceName];
    if (!health) return 'Unknown';

    if (health.isStarting) return 'Starting';
    
    return health.status.charAt(0).toUpperCase() + health.status.slice(1);
  };

  const getServiceDisplayName = (serviceName) => {
    switch (serviceName) {
      case 'cloud': return 'OpenAI Cloud';
      case 'local': return 'Local Whisper';
      default: return serviceName;
    }
  };

  return (
    <div className="service-status-indicator">
      <div className="service-status-header">
        <h3>Service Status</h3>
        <button 
          className="refresh-button"
          onClick={loadServiceStatus}
          disabled={isLoading}
        >
          🔄
        </button>
      </div>

      {error && (
        <div className="service-error">
          {error}
        </div>
      )}

      <div className="current-service">
        <div className="service-info">
          <span className="service-label">Current Service:</span>
          <span className="service-name">
            {getServiceDisplayName(serviceStatus.currentService)}
            <span className="health-icon">
              {getHealthStatusIcon(serviceStatus.currentService)}
            </span>
          </span>
        </div>
      </div>

      <div className="available-services">
        <h4>Available Services</h4>
        <div className="service-list">
          {serviceStatus.availableServices.map(serviceName => {
            const isCurrent = serviceName === serviceStatus.currentService;
            const health = serviceStatus.healthStatus[serviceName];
            
            return (
              <div 
                key={serviceName}
                className={`service-item ${isCurrent ? 'current' : ''} ${health?.status || 'unknown'}`}
              >
                <div className="service-details">
                  <span className="service-name">
                    {getServiceDisplayName(serviceName)}
                  </span>
                  <span className="service-health">
                    {getHealthStatusIcon(serviceName)} {getHealthStatusText(serviceName)}
                  </span>
                  {health?.lastCheck && (
                    <span className="last-check">
                      Last checked: {new Date(health.lastCheck).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                
                {!isCurrent && (
                  <button
                    className="switch-button"
                    onClick={() => handleServiceSwitch(serviceName)}
                    disabled={isLoading || health?.status === 'unhealthy'}
                  >
                    {isLoading ? 'Switching...' : 'Switch'}
                  </button>
                )}
                
                {isCurrent && (
                  <span className="current-indicator">Active</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {serviceStatus.fallbackService && (
        <div className="fallback-service">
          <span className="fallback-label">Fallback Service:</span>
          <span className="fallback-name">
            {getServiceDisplayName(serviceStatus.fallbackService)}
          </span>
        </div>
      )}
    </div>
  );
};

export default ServiceStatusIndicator;