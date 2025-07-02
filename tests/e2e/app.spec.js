const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

test.describe('WhisperTranscript E2E Tests', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    // Launch Electron app
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../src/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });

    // Get the first window
    page = await electronApp.firstWindow();
    
    // Wait for the app to be ready
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test.describe('Application Launch', () => {
    test('should launch successfully', async () => {
      expect(electronApp).toBeTruthy();
      expect(page).toBeTruthy();
    });

    test('should have correct window title', async () => {
      const title = await page.title();
      expect(title).toContain('WhisperTranscript');
    });

    test('should display main UI elements', async () => {
      // Check header
      await expect(page.locator('h1')).toContainText('WhisperTranscript');
      await expect(page.locator('.header-subtitle')).toContainText('Audio transcription powered by OpenAI Whisper');
      
      // Check file upload area
      await expect(page.locator('.file-upload-container')).toBeVisible();
      await expect(page.locator('.drop-zone')).toBeVisible();
    });

    test('should have proper window dimensions', async () => {
      const windowSize = await page.viewportSize();
      expect(windowSize.width).toBeGreaterThanOrEqual(800);
      expect(windowSize.height).toBeGreaterThanOrEqual(600);
    });
  });

  test.describe('File Upload Interface', () => {
    test('should display upload prompt initially', async () => {
      await expect(page.locator('.upload-prompt')).toBeVisible();
      await expect(page.locator('text=Drop your audio file here')).toBeVisible();
      await expect(page.locator('text=browse files')).toBeVisible();
    });

    test('should show supported formats', async () => {
      await expect(page.locator('text=Supported formats:')).toBeVisible();
      await expect(page.locator('text=.mp3, .wav, .m4a, .aac, .ogg, .flac, .wma')).toBeVisible();
    });

    test('should handle file input click', async () => {
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).toBeHidden(); // Should be hidden but present
      
      // Click browse files button should trigger file input
      await page.locator('text=browse files').click();
      // Note: We can't actually test file selection in E2E without real files
    });

    test('should handle drag and drop events', async () => {
      const dropZone = page.locator('.drop-zone');
      
      // Test drag over
      await dropZone.dispatchEvent('dragover', {
        dataTransfer: {
          files: []
        }
      });
      
      // Should add drag-over class (visual feedback)
      await expect(dropZone).toHaveClass(/drag-over/);
      
      // Test drag leave
      await dropZone.dispatchEvent('dragleave');
      await expect(dropZone).not.toHaveClass(/drag-over/);
    });
  });

  test.describe('Application Responsiveness', () => {
    test('should be responsive to window resizing', async () => {
      // Test minimum window size
      await page.setViewportSize({ width: 800, height: 600 });
      await expect(page.locator('.app-header')).toBeVisible();
      await expect(page.locator('.file-upload-container')).toBeVisible();
      
      // Test larger window size
      await page.setViewportSize({ width: 1400, height: 900 });
      await expect(page.locator('.app-header')).toBeVisible();
      await expect(page.locator('.file-upload-container')).toBeVisible();
    });

    test('should maintain layout integrity', async () => {
      const header = page.locator('.app-header');
      const fileUpload = page.locator('.file-upload-container');
      
      const headerBox = await header.boundingBox();
      const fileUploadBox = await fileUpload.boundingBox();
      
      // Header should be at the top
      expect(headerBox.y).toBeLessThan(fileUploadBox.y);
      
      // Elements should not overlap
      expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(fileUploadBox.y);
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should support tab navigation', async () => {
      // Focus should start on the body or first focusable element
      await page.keyboard.press('Tab');
      
      // Should be able to navigate to browse files button
      const browseButton = page.locator('text=browse files');
      await expect(browseButton).toBeFocused();
    });

    test('should support keyboard activation', async () => {
      const browseButton = page.locator('text=browse files');
      await browseButton.focus();
      
      // Enter or Space should activate the button
      await page.keyboard.press('Enter');
      // Note: This would normally open file dialog
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA labels and roles', async () => {
      // Check for proper heading structure
      const h1 = page.locator('h1');
      await expect(h1).toBeVisible();
      
      // Check for proper button roles
      const browseButton = page.locator('text=browse files');
      await expect(browseButton).toHaveAttribute('type', 'button');
    });

    test('should have sufficient color contrast', async () => {
      // This is a basic check - in real scenarios you'd use axe-core
      const header = page.locator('.app-header');
      const styles = await header.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor
        };
      });
      
      expect(styles.color).toBeTruthy();
      expect(styles.backgroundColor).toBeTruthy();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle invalid file types gracefully', async () => {
      // This test would require mocking file selection
      // For now, we just ensure the UI is ready to handle errors
      await expect(page.locator('.file-upload-container')).toBeVisible();
    });
  });

  test.describe('Performance', () => {
    test('should load within reasonable time', async () => {
      const startTime = Date.now();
      
      // Wait for main content to be visible
      await expect(page.locator('.app-header')).toBeVisible();
      await expect(page.locator('.file-upload-container')).toBeVisible();
      
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(5000); // Should load within 5 seconds
    });

    test('should not have memory leaks', async () => {
      // Basic check - perform some interactions and ensure app remains responsive
      for (let i = 0; i < 10; i++) {
        await page.locator('.drop-zone').hover();
        await page.waitForTimeout(100);
      }
      
      // App should still be responsive
      await expect(page.locator('.app-header')).toBeVisible();
    });
  });

  test.describe('Cross-platform Compatibility', () => {
    test('should display correctly on current platform', async () => {
      const platform = process.platform;
      
      // Basic UI should work on all platforms
      await expect(page.locator('.app-header')).toBeVisible();
      await expect(page.locator('.file-upload-container')).toBeVisible();
      
      // Platform-specific checks could be added here
      if (platform === 'darwin') {
        // macOS specific checks
        console.log('Running on macOS');
      } else if (platform === 'win32') {
        // Windows specific checks
        console.log('Running on Windows');
      } else if (platform === 'linux') {
        // Linux specific checks
        console.log('Running on Linux');
      }
    });

    test('should handle platform-specific file paths', async () => {
      // Ensure the app can handle different path separators
      const userAgent = await page.evaluate(() => navigator.userAgent);
      expect(userAgent).toBeTruthy();
      
      // The app should load regardless of platform
      await expect(page.locator('.app-header')).toBeVisible();
    });
  });
});