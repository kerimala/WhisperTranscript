/**
 * Test script to reproduce the service status issue
 * This test simulates the race condition between service startup and health checks
 */

const path = require('path');
const WhisperLocalClient = require('./src/main/services/whisperLocalClient');
const ServiceRegistry = require('./src/main/services/serviceRegistry');

async function testServiceStatusRaceCondition() {
  console.log('=== Testing Service Status Race Condition ===\n');
  
  // Initialize clients
  const whisperLocalClient = new WhisperLocalClient();
  const serviceRegistry = new ServiceRegistry();
  
  // Register the service with health checking enabled
  serviceRegistry.registerService('local', whisperLocalClient, {
    priority: 2,
    healthCheck: true,
    fallback: true
  });
  
  console.log('1. Starting service...');
  
  // Monitor status changes
  let statusChecks = 0;
  const statusInterval = setInterval(() => {
    const status = whisperLocalClient.getServiceStatus();
    console.log(`Status check ${++statusChecks}:`, {
      isStarting: status.isStarting,
      isRunning: status.isRunning,
      isReady: status.isReady,
      processId: status.processId
    });
    
    // Stop monitoring after 20 checks or when service is ready
    if (statusChecks >= 20 || (status.isRunning && status.isReady)) {
      clearInterval(statusInterval);
      console.log('\n=== Status monitoring stopped ===\n');
    }
  }, 500); // Check every 500ms
  
  try {
    // Start the service
    const startResult = await whisperLocalClient.startService();
    console.log('2. Service start result:', startResult);
    
    // Wait a bit for the service to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test the health check method directly
    console.log('3. Testing isHealthy() method...');
    const isHealthy = await whisperLocalClient.isHealthy();
    console.log('   isHealthy result:', isHealthy);
    
    // Test daemon connection directly
    console.log('4. Testing _testDaemonConnection() directly...');
    const daemonTest = await whisperLocalClient._testDaemonConnection();
    console.log('   Daemon connection result:', daemonTest);
    
    // Get final status
    const finalStatus = whisperLocalClient.getServiceStatus();
    console.log('5. Final service status:', finalStatus);
    
    // Test service registry health check
    console.log('6. Testing ServiceRegistry health check...');
    const registryHealthy = await serviceRegistry.checkServiceHealth('local');
    console.log('   ServiceRegistry health check result:', registryHealthy);
    
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    // Cleanup
    console.log('\n7. Cleaning up...');
    await whisperLocalClient.stopService();
    serviceRegistry.stopHealthMonitoring();
    console.log('   Cleanup complete');
  }
}

// Run the test
testServiceStatusRaceCondition().catch(console.error);