import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check for saved theme preference or default to dark mode
    const savedTheme = localStorage.getItem('whisper-transcript-theme');
    if (savedTheme) {
      return savedTheme === 'dark';
    }
    // Default to dark mode as specified in PRD
    return true;
  });

  useEffect(() => {
    // Save theme preference
    localStorage.setItem('whisper-transcript-theme', isDarkMode ? 'dark' : 'light');
    
    // Apply theme class to document root
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode(prev => !prev);
  };

  const theme = {
    isDarkMode,
    toggleTheme,
    colors: isDarkMode ? {
      // Dark theme colors
      primary: '#667eea',
      primaryDark: '#5a67d8',
      secondary: '#764ba2',
      background: '#1a1a1a',
      surface: '#2d2d2d',
      surfaceHover: '#3a3a3a',
      text: '#ffffff',
      textSecondary: '#b3b3b3',
      textMuted: '#808080',
      border: '#404040',
      borderLight: '#333333',
      success: '#48bb78',
      warning: '#ed8936',
      error: '#f56565',
      errorBg: '#2d1b1b',
      errorBorder: '#4a2c2c',
      shadow: 'rgba(0, 0, 0, 0.3)',
      shadowLight: 'rgba(0, 0, 0, 0.1)',
      overlay: 'rgba(0, 0, 0, 0.5)'
    } : {
      // Light theme colors
      primary: '#667eea',
      primaryDark: '#5a67d8',
      secondary: '#764ba2',
      background: '#f8f9fa',
      surface: '#ffffff',
      surfaceHover: '#f5f5f5',
      text: '#2d3748',
      textSecondary: '#4a5568',
      textMuted: '#718096',
      border: '#e9ecef',
      borderLight: '#f1f3f4',
      success: '#38a169',
      warning: '#d69e2e',
      error: '#e53e3e',
      errorBg: '#f8d7da',
      errorBorder: '#f5c6cb',
      shadow: 'rgba(0, 0, 0, 0.1)',
      shadowLight: 'rgba(0, 0, 0, 0.05)',
      overlay: 'rgba(0, 0, 0, 0.3)'
    },
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '20px',
      xxl: '24px',
      xxxl: '32px'
    },
    borderRadius: {
      sm: '4px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '50%'
    },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: {
        xs: '12px',
        sm: '14px',
        md: '16px',
        lg: '18px',
        xl: '20px',
        xxl: '24px',
        xxxl: '28px'
      },
      fontWeight: {
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700
      },
      lineHeight: {
        tight: 1.2,
        normal: 1.5,
        relaxed: 1.6
      }
    },
    breakpoints: {
      mobile: '480px',
      tablet: '768px',
      desktop: '1024px',
      wide: '1200px'
    },
    transitions: {
      fast: '0.15s ease',
      normal: '0.2s ease',
      slow: '0.3s ease'
    }
  };

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};