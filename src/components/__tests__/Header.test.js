import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import Header from '../Header';

afterEach(cleanup);

describe('Header Component', () => {
  describe('Basic rendering', () => {
    it('renders the app title', () => {
      render(<Header />);
      expect(screen.getByRole('heading', { name: 'WhisperTranscript' })).toBeInTheDocument();
    });

    it('renders the subtitle', () => {
      render(<Header />);
      expect(screen.getByText('Audio transcription powered by OpenAI Whisper')).toBeInTheDocument();
    });

    it('applies correct CSS classes', () => {
      render(<Header />);
      
      const header = screen.getByRole('banner');
      expect(header).toHaveClass('app-header', 'titlebar-drag');
      
      const headerContent = header.querySelector('.header-content');
      expect(headerContent).toBeInTheDocument();
      
      const appTitle = header.querySelector('.app-title');
      expect(appTitle).toBeInTheDocument();
      
      const subtitle = header.querySelector('.header-subtitle');
      expect(subtitle).toBeInTheDocument();
    });
  });

  describe('Version display', () => {
    it('displays version when provided', () => {
      const version = '1.2.3';
      render(<Header version={version} />);
      
      expect(screen.getByText('v1.2.3')).toBeInTheDocument();
      
      const versionElement = screen.getByText('v1.2.3');
      expect(versionElement).toHaveClass('version');
    });

    it('does not display version when not provided', () => {
      render(<Header />);
      expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
    });

    it('does not display version when empty string is provided', () => {
      render(<Header version="" />);
      expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
    });

    it('does not display version when null is provided', () => {
      render(<Header version={null} />);
      expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
    });

    it('handles different version formats', () => {
      const testVersions = [
        '1.0.0',
        '2.1.0-beta',
        '3.0.0-alpha.1',
        '1.0.0-rc.1'
      ];

      testVersions.forEach(version => {
        const { unmount } = render(<Header version={version} />);
        expect(screen.getByText(`v${version}`)).toBeInTheDocument();
        unmount(); // Clean up for next iteration
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper semantic structure', () => {
      render(<Header version="1.0.0" />);
      
      // Should have a header landmark
      const header = screen.getByRole('banner');
      expect(header).toBeInTheDocument();
      
      // Should have a proper heading hierarchy
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('WhisperTranscript');
    });

    it('maintains heading hierarchy', () => {
      render(<Header />);
      
      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toBeInTheDocument();
      expect(h1).toHaveTextContent('WhisperTranscript');
    });
  });

  describe('Electron titlebar integration', () => {
    it('applies titlebar-drag class for Electron window dragging', () => {
      render(<Header />);
      
      const header = screen.getByRole('banner');
      expect(header).toHaveClass('titlebar-drag');
    });
  });

  describe('Component structure', () => {
    it('renders with correct DOM structure', () => {
      render(<Header version="1.0.0" />);
      
      const header = screen.getByRole('banner');
      const headerContent = header.querySelector('.header-content');
      const appTitle = headerContent.querySelector('.app-title');
      const subtitle = headerContent.querySelector('.header-subtitle');
      
      expect(headerContent).toBeInTheDocument();
      expect(appTitle).toBeInTheDocument();
      expect(subtitle).toBeInTheDocument();
      
      // Check that title contains both h1 and version span
      const h1 = appTitle.querySelector('h1');
      const versionSpan = appTitle.querySelector('.version');
      
      expect(h1).toBeInTheDocument();
      expect(versionSpan).toBeInTheDocument();
      expect(h1).toHaveTextContent('WhisperTranscript');
      expect(versionSpan).toHaveTextContent('v1.0.0');
    });
  });
});