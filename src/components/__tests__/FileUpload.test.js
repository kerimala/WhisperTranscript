import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileUpload from '../FileUpload';

afterEach(() => {
  cleanup();
  // Clear any remaining DOM elements
  document.body.innerHTML = '';
});

// Mock file for testing
const createMockFile = (name, size, type) => {
  const file = new File([''], name, { type });
  Object.defineProperty(file, 'size', {
    value: size,
    writable: false
  });
  return file;
};

describe('FileUpload Component', () => {
  const mockOnFileSelect = jest.fn();
  
  beforeEach(() => {
    mockOnFileSelect.mockClear();
  });

  describe('Initial render', () => {
    it('renders upload prompt when no file is selected', () => {
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      expect(screen.getByText('Drop your audio file here')).toBeInTheDocument();
      expect(screen.getByText('browse files')).toBeInTheDocument();
      expect(screen.getByText(/Supported formats:/)).toBeInTheDocument();
    });

    it('displays supported formats correctly', () => {
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const supportedFormats = screen.getByText(/Supported formats:/);
      expect(supportedFormats).toHaveTextContent('.mp3, .wav, .m4a, .aac, .ogg, .flac, .wma');
    });
  });

  describe('File selection', () => {
    it('calls onFileSelect when valid audio file is selected', async () => {
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.mp3', 1024, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]');
      
      // Simulate file selection by firing change event
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
    });

    it('shows alert for invalid file type', async () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.txt', 1024, 'text/plain');
      const input = document.querySelector('input[type="file"]');
      
      // Simulate file selection by firing change event
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(alertSpy).toHaveBeenCalledWith('Please select a valid audio file.');
      expect(mockOnFileSelect).not.toHaveBeenCalled();
      
      alertSpy.mockRestore();
    });

    it('accepts files with valid audio extensions', async () => {
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.wav', 2048, 'audio/wav');
      const input = document.querySelector('input[type="file"]');
      
      // Simulate file selection by firing change event
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
    });
  });

  describe('Drag and drop functionality', () => {
    it('handles drag over event', () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const dropZone = screen.getByText(/drop your audio file here/i).closest('.drop-zone');
      
      fireEvent.dragOver(dropZone);
      
      expect(dropZone).toHaveClass('drag-over');
      unmount();
    });

    it('handles drag leave event', () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const dropZone = screen.getByText(/drop your audio file here/i).closest('.drop-zone');
      
      fireEvent.dragOver(dropZone);
      expect(dropZone).toHaveClass('drag-over');
      
      fireEvent.dragLeave(dropZone);
      expect(dropZone).not.toHaveClass('drag-over');
      unmount();
    });

    it('handles file drop', () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const dropZone = screen.getByText(/drop your audio file here/i).closest('.drop-zone');
      const file = createMockFile('dropped.mp3', 1024, 'audio/mpeg');
      
      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file]
        }
      });
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      expect(dropZone).not.toHaveClass('drag-over');
      unmount();
    });
  });

  describe('File display', () => {
    const selectedFile = createMockFile('selected.mp3', 2048576, 'audio/mpeg');
    
    it('displays file information when file is selected', () => {
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={selectedFile}
        />
      );
      
      // Check if file name is displayed in h4 element
      const fileNameElement = container.querySelector('.file-name');
      expect(fileNameElement).toHaveTextContent('selected.mp3');
      // Check if file size is displayed (should be 1.95 MB for 2048576 bytes)
      const sizeElement = container.querySelector('.file-size');
      expect(sizeElement).toHaveTextContent('1.95 MB');
      // Check if change file button is displayed
      const changeButton = container.querySelector('.change-file-btn');
      expect(changeButton).toBeInTheDocument();
      unmount();
    });

    it('displays file duration when available', () => {
      const fileWithDuration = { ...selectedFile, duration: 180 };
      
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={fileWithDuration}
        />
      );
      
      const durationElement = container.querySelector('.file-duration');
      expect(durationElement).toHaveTextContent('3:00');
      unmount();
    });

    it('hides change file button when transcribing', () => {
      const { unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={selectedFile}
          isTranscribing={true}
        />
      );
      
      expect(screen.queryByText('Change File')).not.toBeInTheDocument();
      unmount();
    });

    it('disables file input when transcribing', () => {
      const { unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={selectedFile}
          isTranscribing={true}
        />
      );
      
      const input = document.querySelector('input[type="file"]');
      expect(input).toBeDisabled();
      unmount();
    });
  });

  describe('Utility functions', () => {
    it('formats 0 Bytes correctly', () => {
      const file = createMockFile('test.mp3', 0, 'audio/mpeg');
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={file}
        />
      );
      
      const sizeElement = container.querySelector('.file-size');
      expect(sizeElement).toHaveTextContent('0 Bytes');
      unmount();
    });

    it('formats KB correctly', () => {
      const file = createMockFile('test.mp3', 1024, 'audio/mpeg');
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={file}
        />
      );
      
      const sizeElement = container.querySelector('.file-size');
      expect(sizeElement).toHaveTextContent('1 KB');
      unmount();
    });

    it('formats MB correctly', () => {
      const file = createMockFile('test.mp3', 1048576, 'audio/mpeg');
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={file}
        />
      );
      
      const sizeElement = container.querySelector('.file-size');
      expect(sizeElement).toHaveTextContent('1 MB');
      unmount();
    });

    it('formats GB correctly', () => {
      const file = createMockFile('test.mp3', 1073741824, 'audio/mpeg');
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={file}
        />
      );
      
      const sizeElement = container.querySelector('.file-size');
      expect(sizeElement).toHaveTextContent('1 GB');
      unmount();
    });

    it('formats duration correctly', () => {
      const fileWithDuration = {
        ...createMockFile('test.mp3', 1024, 'audio/mpeg'),
        duration: 125 // 2:05
      };
      
      const { container, unmount } = render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={fileWithDuration}
        />
      );
      
      const durationElement = container.querySelector('.file-duration');
      expect(durationElement).toHaveTextContent('2:05');
      unmount();
    });
  });

  describe('Audio file validation', () => {
    it('accepts MP3 files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.mp3', 1024, 'audio/mpeg');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });

    it('accepts WAV files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.wav', 1024, 'audio/wav');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });

    it('accepts M4A files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.m4a', 1024, 'audio/mp4');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });

    it('accepts AAC files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.aac', 1024, 'audio/aac');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });

    it('accepts OGG files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.ogg', 1024, 'audio/ogg');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });

    it('accepts FLAC files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.flac', 1024, 'audio/flac');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });

    it('accepts WMA files', async () => {
      const { unmount } = render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const file = createMockFile('test.wma', 1024, 'audio/x-ms-wma');
      const input = document.querySelector('input[type="file"]');
      
      if (input) {
        Object.defineProperty(input, 'files', {
          value: [file],
          writable: false,
        });
        
        fireEvent.change(input);
      }
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      unmount();
    });
  });
});