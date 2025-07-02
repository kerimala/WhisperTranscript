import React, { useRef, useState } from 'react';
import AudioRecorder from './AudioRecorder';
import './FileUpload.css';

const FileUpload = ({ onFileSelect, selectedFile, isTranscribing }) => {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState('file'); // 'file' or 'record'

  const supportedFormats = [
    '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma'
  ];

  const handleFileSelect = (file) => {
    if (file && isAudioFile(file)) {
      onFileSelect(file);
    } else {
      alert('Please select a valid audio file.');
    }
  };

  const isAudioFile = (file) => {
    const audioTypes = [
      'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 
      'audio/ogg', 'audio/flac', 'audio/x-ms-wma'
    ];
    return audioTypes.includes(file.type) || 
           supportedFormats.some(format => file.name.toLowerCase().endsWith(format));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleBrowseClick = async () => {
    // Use Electron dialog if available, otherwise fall back to file input
    if (window.electronAPI && window.electronAPI.showAudioFileDialog) {
      try {
        const result = await window.electronAPI.showAudioFileDialog();
        if (!result.canceled && result.filePaths.length > 0) {
          const filePath = result.filePaths[0];
          // Create a File object from the selected path
          // Note: In a real implementation, we'd need to read the file
          // For now, we'll create a mock file object
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
          const mockFile = {
            name: fileName,
            path: filePath,
            size: 0, // We'd get this from fs.stat in the main process
            type: 'audio/' + (fileName.split('.').pop() || 'unknown')
          };
          handleFileSelect(mockFile);
        }
      } catch (error) {
        console.error('Error opening file dialog:', error);
        // Fall back to file input
        fileInputRef.current?.click();
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRecordingComplete = (audioFile) => {
    onFileSelect(audioFile);
  };

  return (
    <div className="file-upload-container">
      {!selectedFile && (
        <div className="upload-tabs">
          <button 
            className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => setActiveTab('file')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Import File
          </button>
          <button 
            className={`tab-btn ${activeTab === 'record' ? 'active' : ''}`}
            onClick={() => setActiveTab('record')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Record Audio
          </button>
        </div>
      )}
      
      {activeTab === 'file' && (
        <div 
          className={`drop-zone ${dragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={!selectedFile ? handleBrowseClick : undefined}
        >
        <input
          ref={fileInputRef}
          type="file"
          accept={supportedFormats.join(',')}
          onChange={handleInputChange}
          style={{ display: 'none' }}
          disabled={isTranscribing}
        />
        
        {!selectedFile ? (
          <div className="upload-prompt">
            <div className="upload-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3>Drop your audio file here</h3>
            <p>or <button type="button" className="browse-link">browse files</button></p>
            <div className="supported-formats">
              <small>Supported formats: {supportedFormats.join(', ')}</small>
            </div>
          </div>
        ) : (
          <div className="file-info">
            <div className="file-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="file-details">
              <h4 className="file-name">{selectedFile.name}</h4>
              <div className="file-meta">
                <span className="file-size">{formatFileSize(selectedFile.size)}</span>
                {selectedFile.duration && (
                  <span className="file-duration">{formatDuration(selectedFile.duration)}</span>
                )}
              </div>
            </div>
            {!isTranscribing && (
              <button 
                type="button" 
                className="change-file-btn titlebar-no-drag"
                onClick={handleBrowseClick}
              >
                Change File
              </button>
            )}
          </div>
        )}
        </div>
      )}
      
      {activeTab === 'record' && !selectedFile && (
        <AudioRecorder 
          onRecordingComplete={handleRecordingComplete}
          isTranscribing={isTranscribing}
        />
      )}
      
      {selectedFile && (
        <div className="selected-file-display">
          <div className="file-info">
            <div className="file-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="file-details">
              <h4 className="file-name">{selectedFile.name}</h4>
              <div className="file-meta">
                <span className="file-size">{formatFileSize(selectedFile.size)}</span>
                {selectedFile.duration && (
                  <span className="file-duration">{formatDuration(selectedFile.duration)}</span>
                )}
              </div>
            </div>
            {!isTranscribing && (
              <button 
                type="button" 
                className="change-file-btn titlebar-no-drag"
                onClick={() => {
                  onFileSelect(null);
                  setActiveTab('file');
                }}
              >
                Change File
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload;