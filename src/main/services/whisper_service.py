#!/usr/bin/env python3
"""
Local Whisper Transcription Service
Provides local audio transcription using OpenAI's Whisper library
"""

import os
import sys
import json
import argparse
import tempfile
import logging
import signal
import time
import threading
from pathlib import Path
from typing import Optional, Dict, Any
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    import whisper
except ImportError:
    print("Error: OpenAI Whisper library not found. Please install it with: pip install openai-whisper")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class WhisperLocalService:
    """
    Local Whisper transcription service
    """
    
    def __init__(self, model_name: str = "base"):
        """
        Initialize the Whisper service
        
        Args:
            model_name: Whisper model to use (tiny, base, small, medium, large)
        """
        self.model_name = model_name
        self.model = None
        self.supported_formats = [
            '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.webm'
        ]
        
    def load_model(self) -> bool:
        """
        Load the Whisper model
        
        Returns:
            bool: True if model loaded successfully, False otherwise
        """
        try:
            logger.info(f"Loading Whisper model: {self.model_name}")
            self.model = whisper.load_model(self.model_name)
            logger.info(f"Model {self.model_name} loaded successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to load model {self.model_name}: {str(e)}")
            return False
    
    def transcribe_audio(self, audio_path: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Transcribe audio file
        
        Args:
            audio_path: Path to the audio file
            options: Transcription options
            
        Returns:
            Dict containing transcription result
        """
        if not self.model:
            if not self.load_model():
                return {
                    "success": False,
                    "error": "Failed to load Whisper model"
                }
        
        if not os.path.exists(audio_path):
            return {
                "success": False,
                "error": f"Audio file not found: {audio_path}"
            }
        
        # Validate file format
        file_ext = Path(audio_path).suffix.lower()
        if file_ext not in self.supported_formats:
            return {
                "success": False,
                "error": f"Unsupported audio format: {file_ext}"
            }
        
        try:
            # Set default options
            transcribe_options = {
                "language": None,  # Auto-detect
                "task": "transcribe",  # or "translate"
                "temperature": 0.0,
                "best_of": 1,
                "beam_size": 1,
                "patience": 1.0,
                "length_penalty": 1.0,
                "suppress_tokens": "-1",
                "initial_prompt": None,
                "condition_on_previous_text": True,
                "fp16": True,
                "compression_ratio_threshold": 2.4,
                "logprob_threshold": -1.0,
                "no_speech_threshold": 0.6
            }
            
            # Update with provided options
            if options:
                transcribe_options.update(options)
            
            logger.info(f"Starting transcription of: {audio_path}")
            
            # Perform transcription
            result = self.model.transcribe(
                audio_path,
                **transcribe_options
            )
            
            # Format response
            response = {
                "success": True,
                "text": result["text"].strip(),
                "language": result.get("language"),
                "segments": result.get("segments", []),
                "model": self.model_name,
                "options": transcribe_options
            }
            
            logger.info(f"Transcription completed successfully. Text length: {len(response['text'])} characters")
            return response
            
        except Exception as e:
            logger.error(f"Transcription failed: {str(e)}")
            return {
                "success": False,
                "error": f"Transcription failed: {str(e)}"
            }
    
    def get_available_models(self) -> Dict[str, Any]:
        """
        Get list of available Whisper models
        
        Returns:
            Dict containing available models and their info
        """
        models = {
            "tiny": {"size": "~39 MB", "speed": "~32x", "accuracy": "Low"},
            "base": {"size": "~74 MB", "speed": "~16x", "accuracy": "Medium"},
            "small": {"size": "~244 MB", "speed": "~6x", "accuracy": "Good"},
            "medium": {"size": "~769 MB", "speed": "~2x", "accuracy": "Better"},
            "large": {"size": "~1550 MB", "speed": "~1x", "accuracy": "Best"}
        }
        
        return {
            "success": True,
            "models": models,
            "current_model": self.model_name
        }
    
    def change_model(self, model_name: str) -> Dict[str, Any]:
        """
        Change the current Whisper model
        
        Args:
            model_name: Name of the model to switch to
            
        Returns:
            Dict containing operation result
        """
        available_models = ["tiny", "base", "small", "medium", "large"]
        
        if model_name not in available_models:
            return {
                "success": False,
                "error": f"Invalid model name. Available models: {', '.join(available_models)}"
            }
        
        try:
            self.model_name = model_name
            self.model = None  # Force reload on next transcription
            logger.info(f"Model changed to: {model_name}")
            
            return {
                "success": True,
                "message": f"Model changed to {model_name}. Will be loaded on next transcription."
            }
        except Exception as e:
            logger.error(f"Failed to change model: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to change model: {str(e)}"
            }
    
    def test_service(self) -> Dict[str, Any]:
        """
        Test if the service is working properly
        
        Returns:
            Dict containing test result
        """
        try:
            if not self.model:
                if not self.load_model():
                    return {
                        "success": False,
                        "error": "Failed to load model for testing"
                    }
            
            return {
                "success": True,
                "message": f"Service is ready with model '{self.model_name}'",
                "model": self.model_name
            }
        except Exception as e:
            logger.error(f"Service test failed: {str(e)}")
            return {
                "success": False,
                "error": f"Service test failed: {str(e)}"
            }

class WhisperDaemonHandler(BaseHTTPRequestHandler):
    """
    HTTP request handler for daemon mode
    """
    
    def __init__(self, *args, whisper_service=None, **kwargs):
        self.whisper_service = whisper_service
        super().__init__(*args, **kwargs)
    
    def do_POST(self):
        """Handle POST requests"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))
            
            command = request_data.get('command')
            
            if command == 'transcribe':
                audio_path = request_data.get('audio_path')
                options = request_data.get('options', {})
                result = self.whisper_service.transcribe_audio(audio_path, options)
            elif command == 'test':
                result = self.whisper_service.test_service()
            elif command == 'models':
                result = self.whisper_service.get_available_models()
            elif command == 'change_model':
                model_name = request_data.get('model_name')
                result = self.whisper_service.change_model(model_name)
            else:
                result = {
                    "success": False,
                    "error": f"Unknown command: {command}"
                }
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
            
        except Exception as e:
            logger.error(f"Request handling error: {str(e)}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            error_response = {
                "success": False,
                "error": f"Request handling error: {str(e)}"
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def do_GET(self):
        """Handle GET requests"""
        try:
            parsed_url = urlparse(self.path)
            
            if parsed_url.path == '/health':
                result = self.whisper_service.test_service()
            elif parsed_url.path == '/models':
                result = self.whisper_service.get_available_models()
            else:
                result = {
                    "success": False,
                    "error": "Unknown endpoint"
                }
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
            
        except Exception as e:
            logger.error(f"GET request error: {str(e)}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            error_response = {
                "success": False,
                "error": f"GET request error: {str(e)}"
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def log_message(self, format, *args):
        """Override to use our logger"""
        logger.info(f"{self.address_string()} - {format % args}")

class WhisperDaemon:
    """
    Daemon mode for Whisper service
    """
    
    def __init__(self, model_name="base", port=8765):
        self.model_name = model_name
        self.port = port
        self.whisper_service = WhisperLocalService(model_name)
        self.server = None
        self.running = False
        
        # Set up signal handlers
        signal.signal(signal.SIGTERM, self.signal_handler)
        signal.signal(signal.SIGINT, self.signal_handler)
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, shutting down...")
        self.stop()
    
    def start(self):
        """Start the daemon server"""
        try:
            logger.info(f"Starting Whisper daemon on port {self.port}...")
            
            # Pre-load the model
            logger.info("Pre-loading Whisper model...")
            if not self.whisper_service.load_model():
                logger.error("Failed to pre-load model")
                return False
            
            # Create handler with service instance
            def handler(*args, **kwargs):
                return WhisperDaemonHandler(*args, whisper_service=self.whisper_service, **kwargs)
            
            self.server = HTTPServer(('localhost', self.port), handler)
            self.running = True
            
            logger.info(f"Whisper daemon started successfully on port {self.port}")
            logger.info(f"Model: {self.model_name}")
            logger.info("Ready to accept requests...")
            
            # Start server in a separate thread
            server_thread = threading.Thread(target=self.server.serve_forever)
            server_thread.daemon = True
            server_thread.start()
            
            # Keep main thread alive
            while self.running:
                time.sleep(1)
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to start daemon: {str(e)}")
            return False
    
    def stop(self):
        """Stop the daemon server"""
        self.running = False
        if self.server:
            logger.info("Stopping daemon server...")
            self.server.shutdown()
            self.server.server_close()
            logger.info("Daemon stopped")

def main():
    """
    Command line interface for the Whisper service
    """
    parser = argparse.ArgumentParser(description="Local Whisper Transcription Service")
    parser.add_argument("command", choices=["transcribe", "models", "test", "daemon"], help="Command to execute")
    parser.add_argument("--audio", "-a", help="Path to audio file (for transcribe command)")
    parser.add_argument("--model", "-m", default="base", help="Whisper model to use (default: base)")
    parser.add_argument("--language", "-l", help="Language code (auto-detect if not specified)")
    parser.add_argument("--output", "-o", help="Output file path (JSON format)")
    parser.add_argument("--port", "-p", type=int, default=8765, help="Port for daemon mode (default: 8765)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    if args.command == "daemon":
        # Start daemon mode
        daemon = WhisperDaemon(model_name=args.model, port=args.port)
        daemon.start()
    
    elif args.command == "test":
        # Test service functionality
        service = WhisperLocalService(model_name=args.model)
        result = service.test_service()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    else:
        # Initialize service for other commands
        service = WhisperLocalService(model_name=args.model)
        
        if args.command == "transcribe":
            if not args.audio:
                print("Error: --audio argument is required for transcribe command")
                sys.exit(1)
            
            options = {}
            if args.language:
                options["language"] = args.language
            
            result = service.transcribe_audio(args.audio, options)
            
            if args.output:
                with open(args.output, 'w', encoding='utf-8') as f:
                    json.dump(result, f, indent=2, ensure_ascii=False)
                print(f"Result saved to: {args.output}")
            else:
                print(json.dumps(result, indent=2, ensure_ascii=False))
        
        elif args.command == "models":
            result = service.get_available_models()
            print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()