import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileUpload from '../FileUpload';

afterEach(cleanup);

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
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const dropZone = screen.getByText(/drop your audio file here/i).closest('.drop-zone');
      
      fireEvent.dragOver(dropZone);
      
      expect(dropZone).toHaveClass('drag-over');
    });

    it('handles drag leave event', () => {
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const dropZone = screen.getByText(/drop your audio file here/i).closest('.drop-zone');
      
      fireEvent.dragOver(dropZone);
      expect(dropZone).toHaveClass('drag-over');
      
      fireEvent.dragLeave(dropZone);
      expect(dropZone).not.toHaveClass('drag-over');
    });

    it('handles file drop', () => {
      render(<FileUpload onFileSelect={mockOnFileSelect} />);
      
      const dropZone = screen.getByText(/drop your audio file here/i).closest('.drop-zone');
      const file = createMockFile('dropped.mp3', 1024, 'audio/mpeg');
      
      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file]
        }
      });
      
      expect(mockOnFileSelect).toHaveBeenCalledWith(file);
      expect(dropZone).not.toHaveClass('drag-over');
    });
  });

  describe('File display', () => {
    const selectedFile = createMockFile('selected.mp3', 2048576, 'audio/mpeg');
    
    it('displays file information when file is selected', () => {
      render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={selectedFile}
        />
      );
      
      // Check if file name is displayed in h4 element
      expect(screen.getByRole('heading', { level: 4, name: 'selected.mp3' })).toBeInTheDocument();
      // Check if file size is displayed (should be 1.95 MB for 2048576 bytes)
      expect(screen.getByText('1.95 MB')).toBeInTheDocument();
      // Check if change file button is displayed
      expect(screen.getByRole('button', { name: 'Change File' })).toBeInTheDocument();
    });

    it('displays file duration when available', () => {
      const fileWithDuration = { ...selectedFile, duration: 180 };
      
      render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={fileWithDuration}
        />
      );
      
      expect(screen.getByText('3:00')).toBeInTheDocument();
    });

    it('hides change file button when transcribing', () => {
      render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={selectedFile}
          isTranscribing={true}
        />
      );
      
      expect(screen.queryByText('Change File')).not.toBeInTheDocument();
    });

    it('disables file input when transcribing', () => {
      render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={selectedFile}
          isTranscribing={true}
        />
      );
      
      const input = document.querySelector('input[type="file"]');
      expect(input).toBeDisabled();
    });
  });

  describe('Utility functions', () => {
    it('formats file sizes correctly', () => {
      const testCases = [
        { size: 0, expected: '0 Bytes' },
        { size: 1024, expected: '1 KB' },
        { size: 1048576, expected: '1 MB' },
        { size: 1073741824, expected: '1 GB' }
      ];
      
      testCases.forEach(({ size, expected }) => {
        const file = createMockFile('test.mp3', size, 'audio/mpeg');
        render(
          <FileUpload 
            onFileSelect={mockOnFileSelect} 
            selectedFile={file}
          />
        );
        
        expect(screen.getByText(expected)).toBeInTheDocument();
      });
    });

    it('formats duration correctly', () => {
      const fileWithDuration = {
        ...createMockFile('test.mp3', 1024, 'audio/mpeg'),
        duration: 125 // 2:05
      };
      
      render(
        <FileUpload 
          onFileSelect={mockOnFileSelect} 
          selectedFile={fileWithDuration}
        />
      );
      
      expect(screen.getByText('2:05')).toBeInTheDocument();
    });
  });

  describe('Audio file validation', () => {
    const validAudioTypes = [
      { name: 'test.mp3', type: 'audio/mpeg' },
      { name: 'test.wav', type: 'audio/wav' },
      { name: 'test.m4a', type: 'audio/mp4' },
      { name: 'test.aac', type: 'audio/aac' },
      { name: 'test.ogg', type: 'audio/ogg' },
      { name: 'test.flac', type: 'audio/flac' },
      { name: 'test.wma', type: 'audio/x-ms-wma' }
    ];

    validAudioTypes.forEach(({ name, type }) => {
      it(`accepts ${name} files`, async () => {
        render(<FileUpload onFileSelect={mockOnFileSelect} />);
        
        const file = createMockFile(name, 1024, type);
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
  });
});