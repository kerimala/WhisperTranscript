module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  testMatch: [
    '<rootDir>/src/components/**/__tests__/**/*.(test|spec).(js|jsx)',
    '<rootDir>/src/utils/**/__tests__/**/*.(test|spec).(js|jsx)',
    '<rootDir>/src/hooks/**/__tests__/**/*.(test|spec).(js|jsx)'
  ],
  moduleNameMapping: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy'
  },

  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.test.{js,jsx}',
    '!src/index.js',
    '!src/reportWebVitals.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};