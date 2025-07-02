import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import './styles/theme.css';
import './styles/App.css';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import TranscriptionDisplay from './components/TranscriptionDisplay';
import StatusBar from './components/StatusBar';

function App() {
  const [appVersion, setAppVersion] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Get app version from Electron
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(version => {
        setAppVersion(version);
      });

      // Set up event listeners for transcription events
      const removeProgressListener = window.electronAPI.onTranscriptionProgress((event, progress) => {
        setTranscriptionProgress(progress);
      });

      const removeCompleteListener = window.electronAPI.onTranscriptionComplete((event, result) => {
        setTranscription(result.text);
        setIsTranscribing(false);
        setTranscriptionProgress(0);
        setError(null);
      });

      const removeErrorListener = window.electronAPI.onTranscriptionError((event, error) => {
        setError(error.message);
        setIsTranscribing(false);
        setTranscriptionProgress(0);
      });

      // Cleanup listeners on unmount
      return () => {
        removeProgressListener();
        removeCompleteListener();
        removeErrorListener();
      };
    }
  }, []);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    if (file) {
      setTranscription('');
      setError(null);
    }
  };

  const handleTranscribe = async () => {
    if (!selectedFile) return;

    setIsTranscribing(true);
    setTranscriptionProgress(0);
    setError(null);

    try {
      // This will be implemented when we add the transcription functionality
      // await window.electronAPI.transcribeAudio(selectedFile.path);
      
      // For now, simulate transcription
      setTimeout(() => {
        setTranscription('This is a placeholder transcription. The actual Whisper integration will be implemented in a later task.');
        setIsTranscribing(false);
        setTranscriptionProgress(0);
      }, 2000);
    } catch (err) {
      setError(err.message);
      setIsTranscribing(false);
      setTranscriptionProgress(0);
    }
  };

  const handleClearTranscription = () => {
    setTranscription('');
    setSelectedFile(null);
    setError(null);
  };

  return (
    <ThemeProvider>
      <div className="App">
        <Header version={appVersion} />
        
        <main className="main-content">
          <div className="upload-section card">
            <FileUpload 
              onFileSelect={handleFileSelect}
              selectedFile={selectedFile}
              isTranscribing={isTranscribing}
            />
            
            {selectedFile && (
              <div className="action-buttons">
                <button 
                  className="transcribe-btn btn-primary focus-visible"
                  onClick={handleTranscribe}
                  disabled={isTranscribing}
                >
                  {isTranscribing ? 'Transcribing...' : 'Start Transcription'}
                </button>
                
                {transcription && (
                  <button 
                    className="clear-btn btn-secondary focus-visible"
                    onClick={handleClearTranscription}
                    disabled={isTranscribing}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="error-message fade-in">
              <strong>Error:</strong> {error}
            </div>
          )}

          {(transcription || isTranscribing) && (
            <TranscriptionDisplay 
              transcription={transcription}
              isTranscribing={isTranscribing}
              progress={transcriptionProgress}
            />
          )}
        </main>

        <StatusBar 
          selectedFile={selectedFile}
          isTranscribing={isTranscribing}
          progress={transcriptionProgress}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;