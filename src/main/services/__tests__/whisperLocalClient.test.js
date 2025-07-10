/**
 * Unit tests for WhisperLocalClient service status handling
 */

const WhisperLocalClient = require('../whisperLocalClient');
const { spawn } = require('child_process');
const http = require('http');

// Mock child_process spawn
jest.mock('child_process');
jest.mock('http');

describe('WhisperLocalClient Service Status', () => {
  let client;
  let mockProcess;
  let mockRequest;

  beforeEach(() => {
    client = new WhisperLocalClient();
    
    // Mock process
    mockProcess = {
      pid: 12345,
      on: jest.fn(),
      kill: jest.fn(),
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() }
    };
    
    // Mock HTTP request
    mockRequest = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn()
    };
    
    spawn.mockReturnValue(mockProcess);
    http.request.mockReturnValue(mockRequest);
    
    // Reset client state
    client.isServiceRunning = false;
    client.isServiceReady = false;
    client.isStarting = false;
    client.serviceProcess = null;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getServiceStatus', () => {
    test('should return correct status when service is starting', () => {
      client.isStarting = true;
      client.isServiceRunning = false;
      client.isServiceReady = false;
      
      const status = client.getServiceStatus();
      
      expect(status.isStarting).toBe(true);
      expect(status.isRunning).toBe(false);
      expect(status.isReady).toBe(false);
    });

    test('should return correct status when service is running and ready', () => {
      client.isStarting = false;
      client.isServiceRunning = true;
      client.isServiceReady = true;
      client.serviceProcess = mockProcess;
      
      const status = client.getServiceStatus();
      
      expect(status.isStarting).toBe(false);
      expect(status.isRunning).toBe(true);
      expect(status.isReady).toBe(true);
      expect(status.processId).toBe(12345);
    });

    test('should return correct status when service is running but not ready', () => {
      client.isStarting = false;
      client.isServiceRunning = true;
      client.isServiceReady = false;
      
      const status = client.getServiceStatus();
      
      expect(status.isStarting).toBe(false);
      expect(status.isRunning).toBe(true);
      expect(status.isReady).toBe(false);
    });
  });

  describe('isHealthy', () => {
    test('should return true when starting', async () => {
      client.isStarting = true;
      
      const result = await client.isHealthy();
      
      expect(result).toBe(true);
    });

    test('should return true when daemon connection succeeds', async () => {
      client.isStarting = false;
      client.isServiceRunning = false;
      client.isServiceReady = false;
      
      // Mock successful daemon connection
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({ success: true, message: 'Service ready' }));
          } else if (event === 'end') {
            callback();
          }
        })
      };
      
      http.request.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });
      
      const result = await client.isHealthy();
      
      expect(result).toBe(true);
      expect(client.isServiceReady).toBe(true);
      expect(client.isServiceRunning).toBe(true); // Should be updated when daemon is found
    });

    test('should return false when daemon connection fails', async () => {
      client.isStarting = false;
      
      // Mock failed daemon connection
      http.request.mockImplementation((options, callback) => {
        mockRequest.on.mockImplementation((event, callback) => {
          if (event === 'error') {
            callback(new Error('Connection refused'));
          }
        });
        return mockRequest;
      });
      
      const result = await client.isHealthy();
      
      expect(result).toBe(false);
      expect(client.isServiceReady).toBe(false);
    });

    test('should update service state when existing daemon is found', async () => {
      client.isStarting = false;
      client.isServiceRunning = false;
      client.isServiceReady = false;
      
      // Mock successful daemon connection
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({ success: true, message: 'Service ready' }));
          } else if (event === 'end') {
            callback();
          }
        })
      };
      
      http.request.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await client.isHealthy();
      
      expect(result).toBe(true);
      expect(client.isServiceRunning).toBe(true);
      expect(client.isServiceReady).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('[WhisperLocal] Found existing daemon, updating service state');
      
      consoleSpy.mockRestore();
    });
  });

  describe('startService with existing daemon', () => {
    test('should handle port already in use error by checking for existing daemon', async () => {
      // Mock spawn to throw port in use error
      spawn.mockImplementation(() => {
        const process = {
          ...mockProcess,
          on: jest.fn((event, callback) => {
            if (event === 'exit') {
              setTimeout(() => callback(1, null), 10);
            }
          })
        };
        return process;
      });
      
      // Mock successful daemon connection
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({ success: true, message: 'Service ready' }));
          } else if (event === 'end') {
            callback();
          }
        })
      };
      
      http.request.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });
      
      // Mock _waitForServiceReady to reject with port in use error
      client._waitForServiceReady = jest.fn().mockRejectedValue(
        new Error('Service started but failed to become responsive')
      );
      
      // Mock checkPrerequisites to return true
      client.checkPrerequisites = jest.fn().mockResolvedValue(true);
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Simulate the error that would occur when port is in use
      const originalError = new Error('Service started but failed to become responsive');
      client._waitForServiceReady.mockRejectedValue(originalError);
      
      // We need to simulate the actual error flow, so let's mock the stderr output
      // that would contain the "Address already in use" message
      const stderrData = '2025-07-11 00:34:20,421 - __main__ - ERROR - Failed to start daemon: [Errno 48] Address already in use';
      
      // Override the error to include the port in use message
      const portInUseError = new Error(`Service started but failed to become responsive. stderr: ${stderrData}`);
      client._waitForServiceReady.mockRejectedValue(portInUseError);
      
      const result = await client.startService();
      
      expect(result).toBe(true);
      expect(client.isServiceRunning).toBe(true);
      expect(client.isServiceReady).toBe(true);
      
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });
});