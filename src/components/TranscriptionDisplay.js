import React, { useState, useRef } from 'react';
import './TranscriptionDisplay.css';

const TranscriptionDisplay = ({ transcription, isTranscribing, progress }) => {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef(null);

  const handleCopy = async () => {
    if (transcription) {
      try {
        await navigator.clipboard.writeText(transcription);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
        // Fallback for older browsers
        if (textareaRef.current) {
          textareaRef.current.select();
          document.execCommand('copy');
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }
    }
  };

  const handleSave = async () => {
    if (transcription && window.electronAPI) {
      try {
        const result = await window.electronAPI.showSaveDialog({
          title: 'Save Transcription',
          defaultPath: 'transcription.txt',
          filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.canceled && result.filePath) {
          // This will be implemented when we add file system operations
          // await window.electronAPI.writeFile(result.filePath, transcription);
          console.log('Save functionality will be implemented in a later task');
        }
      } catch (err) {
        console.error('Failed to save file: ', err);
      }
    }
  };

  const wordCount = transcription ? transcription.trim().split(/\s+/).length : 0;
  const charCount = transcription ? transcription.length : 0;

  return (
    <div className="transcription-display">
      <div className="transcription-header">
        <h3>Transcription</h3>
        {isTranscribing && (
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <span className="progress-text">{Math.round(progress)}%</span>
          </div>
        )}
      </div>

      <div className="transcription-content">
        {isTranscribing ? (
          <div className="transcribing-placeholder">
            <div className="loading-spinner"></div>
            <p>Transcribing audio...</p>
            <small>This may take a few moments depending on the file size</small>
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className="transcription-text"
              value={transcription}
              readOnly
              placeholder="Transcription will appear here..."
              rows={12}
            />
            
            {transcription && (
              <div className="transcription-actions">
                <div className="text-stats">
                  <span className="stat">
                    <strong>{wordCount}</strong> words
                  </span>
                  <span className="stat">
                    <strong>{charCount}</strong> characters
                  </span>
                </div>
                
                <div className="action-buttons">
                  <button 
                    className="copy-btn"
                    onClick={handleCopy}
                    disabled={!transcription}
                  >
                    {copied ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <polyline points="20,6 9,17 4,12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" fill="none"/>
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                  
                  <button 
                    className="save-btn"
                    onClick={handleSave}
                    disabled={!transcription}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2" fill="none"/>
                      <polyline points="17,21 17,13 7,13 7,21" stroke="currentColor" strokeWidth="2" fill="none"/>
                      <polyline points="7,3 7,8 15,8" stroke="currentColor" strokeWidth="2" fill="none"/>
                    </svg>
                    Save
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TranscriptionDisplay;