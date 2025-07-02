# WhisperTranscript

A desktop application for audio transcription using OpenAI Whisper, built with Electron and React.

## Features

- 🎵 Support for multiple audio formats (MP3, WAV, M4A, AAC, OGG, FLAC, WMA)
- 🖥️ Cross-platform desktop application (Windows, macOS, Linux)
- 🎯 Clean and intuitive user interface
- 📝 Real-time transcription progress
- 💾 Save transcriptions to text files
- 📋 Copy transcriptions to clipboard
- 🌙 Dark mode support

## Development Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd WhisperTranscript
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

This will start both the React development server and the Electron application.

### Available Scripts

- `npm start` - Start Electron in production mode
- `npm run dev` - Start development mode with hot reload
- `npm run build` - Build the React app for production
- `npm run dist` - Build and package the application for distribution
- `npm run pack` - Package the application without creating installers
- `npm test` - Run the test suite

## Building for Production

### Build the application:
```bash
npm run build
```

### Create distributables:
```bash
npm run dist
```

This will create platform-specific installers in the `dist` folder:
- **macOS**: `.dmg` file
- **Windows**: `.exe` installer
- **Linux**: `.AppImage` file

## Project Structure

```
WhisperTranscript/
├── public/                 # Static files
├── src/
│   ├── components/         # React components
│   ├── main/              # Electron main process
│   ├── styles/            # CSS files
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Utility functions
│   ├── App.js             # Main React component
│   └── index.js           # React entry point
├── package.json           # Dependencies and scripts
└── README.md             # This file
```

## Technology Stack

- **Electron** - Desktop application framework
- **React** - User interface library
- **Node.js** - Backend runtime
- **OpenAI Whisper** - Audio transcription (to be integrated)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Roadmap

- [ ] OpenAI Whisper integration
- [ ] Batch processing support
- [ ] Custom transcription models
- [ ] Export to multiple formats
- [ ] Audio playback controls
- [ ] Transcription editing capabilities

## Support

If you encounter any issues or have questions, please open an issue on GitHub.