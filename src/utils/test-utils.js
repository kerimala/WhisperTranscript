import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../contexts/ThemeContext';

// Custom render function that includes ThemeProvider
export const renderWithTheme = (ui, options = {}) => {
  const Wrapper = ({ children }) => (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
};

// Re-export everything from testing-library/react
export * from '@testing-library/react';

// Override render with our custom renderWithTheme
export { renderWithTheme as render };