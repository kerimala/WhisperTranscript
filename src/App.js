import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import './styles/theme.css';
import './styles/App.css';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import TranscriptionDisplay from './components/TranscriptionDisplay';
import StatusBar from './components/StatusBar';
import Settings from './components/Settings';

function App() {
  const [appVersion, setAppVersion] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

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
        setTranscription(result.transcription?.text || result.text);
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
      // Check if API key is configured
      const apiKeyStatus = await window.electronAPI.whisper.checkApiKeyStatus();
      if (!apiKeyStatus.configured || !apiKeyStatus.valid) {
        throw new Error('OpenAI API key is not configured or invalid. Please set your API key in the settings.');
      }

      let audioInput;
      
      // Handle different file types
      if (selectedFile.path) {
        // This is an uploaded file with a path
        audioInput = selectedFile.path;
      } else if (selectedFile instanceof File) {
        // This is a recorded File object - convert to serializable format
        const arrayBuffer = await selectedFile.arrayBuffer();
        audioInput = {
          name: selectedFile.name,
          type: selectedFile.type,
          size: selectedFile.size,
          arrayBuffer: Array.from(new Uint8Array(arrayBuffer))
        };
      } else {
        throw new Error('Invalid file format');
      }

      // Call the Whisper API through IPC
      const result = await window.electronAPI.whisper.transcribeAudio(audioInput, {
        model: 'whisper-1',
        response_format: 'json',
        temperature: 0
      });

      if (result.success) {
        // The transcription result will be handled by the onTranscriptionComplete event listener
        console.log('Transcription request sent successfully');
      } else {
        throw new Error(result.error?.userMessage || result.error?.message || 'Transcription failed');
      }
    } catch (err) {
      console.error('Transcription error:', err);
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

  const handleOpenSettings = () => {
    setShowSettings(true);
  };

  const handleCloseSettings = () => {
    setShowSettings(false);
  };

  return (
    <ThemeProvider>
      <div className="App">
        <Header version={appVersion} onOpenSettings={handleOpenSettings} />
        
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
        <Settings 
          isOpen={showSettings} 
          onClose={handleCloseSettings} 
        />
      </div>
    </ThemeProvider>
  );
}

export default App;