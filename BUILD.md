# Build Pipeline Documentation

## Overview
This document outlines the build pipeline configuration for the WhisperTranscript Electron application.

## Build Scripts

### Development
- `npm run dev` - Start development server with hot reload
- `npm run dev:renderer` - Start React development server on port 3001
- `npm run dev:electron` - Start Electron in development mode

### Production Build
- `npm run build` - Build React application for production
- `npm run build:renderer` - Build React app only
- `npm run build:electron` - Package Electron application

### Distribution
- `npm run dist` - Create distribution packages
- `npm run dist:all` - Build for all platforms (macOS, Windows, Linux)
- `npm run dist:mac` - Build for macOS only
- `npm run dist:win` - Build for Windows only
- `npm run dist:linux` - Build for Linux only
- `npm run pack` - Create unpacked directory

### Utilities
- `npm run clean` - Clean build artifacts and cache
- `npm run rebuild` - Clean and reinstall dependencies

## Build Configuration

### Electron Builder
The project uses `electron-builder` for packaging and distribution. Configuration is in `package.json` under the `build` section.

#### Basic Configuration
- **App ID**: `com.whispertranscript.app`
- **Product Name**: `WhisperTranscript`
- **Output Directory**: `dist/`

#### Files Included
- `build/**/*` - React production build
- `src/main/**/*` - Electron main process files
- `node_modules/**/*` - Dependencies
- `package.json` - Package metadata

### CI/CD Integration

#### GitHub Actions Workflows
1. **Development Workflow** (`.github/workflows/dev.yml`)
   - Runs on PR and push to main/develop
   - Linting and formatting checks
   - Type checking
   - Test coverage
   - Build verification

2. **Build Workflow** (`.github/workflows/build.yml`)
   - Multi-platform builds
   - Automated releases
   - Security scanning
   - Artifact uploads

### Code Quality

#### Prettier Configuration
- Configuration: `.prettierrc`
- Ignore patterns: `.prettierignore`
- Automatic formatting for consistent code style

#### ESLint Integration
- Integrated with React Scripts
- Runs during development and CI

## Assets and Resources

### Icons
- SVG icon: `assets/icon.svg`
- Used across all platforms

### macOS Specific
- Entitlements: `assets/entitlements.mac.plist`
- Required for code signing and security

## Known Issues

### Electron Builder Binary Issues
Currently experiencing issues with the `app-builder` binary on ARM64 macOS. This affects:
- `npm run build:electron`
- `npm run pack`
- `npm run dist*` commands

#### Workarounds
1. Use `npm run build` (React only) for development testing
2. Consider alternative packaging tools like `electron-forge`
3. Use Docker for consistent build environments

### Potential Solutions
1. Update to latest electron-builder version
2. Clear node_modules and reinstall
3. Use Rosetta 2 for Intel compatibility
4. Switch to electron-forge for packaging

## Development Workflow

1. **Start Development**
   ```bash
   npm run dev
   ```

2. **Test Production Build**
   ```bash
   npm run build
   ```

3. **Clean Environment**
   ```bash
   npm run clean
   npm install
   ```

## Security Considerations

- Code signing certificates required for distribution
- Entitlements configured for macOS security
- Dependency scanning in CI pipeline
- No secrets or keys committed to repository

## Future Enhancements

1. **Auto-updater Integration**
   - Implement electron-updater
   - Configure update server

2. **Code Signing**
   - Set up certificates for all platforms
   - Configure signing in CI/CD

3. **Bundle Optimization**
   - Implement tree shaking
   - Optimize asset loading
   - Reduce bundle size

4. **Testing Pipeline**
   - Unit tests for main process
   - E2E testing with Playwright
   - Performance testing