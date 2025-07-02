module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/main/**/__tests__/**/*.(test|spec).js'
  ],
  collectCoverageFrom: [
    'src/main/**/*.js',
    '!src/main/**/*.test.js'
  ],
  coverageDirectory: 'coverage-main',
  coverageReporters: ['text', 'lcov', 'html']
};