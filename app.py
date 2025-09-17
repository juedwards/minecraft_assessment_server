# Launcher for refactored server
import logging
import asyncio
import os
import sys
import argparse
import signal
from pathlib import Path
import json

# Preserve previous environment loader
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

# Configure logging level from CLI or environment
parser = argparse.ArgumentParser(add_help=False)
parser.add_argument('--level', '-l', default=os.getenv('LOG_LEVEL', 'INFO'), help='Logging level (DEBUG, INFO, WARNING, ERROR)')
args, _ = parser.parse_known_args()
level_name = (args.level or 'INFO').upper()
level = getattr(logging, level_name, logging.INFO)
logging.basicConfig(level=level, format='%(asctime)s - %(message)s')

# Ensure root logger and all handlers use the selected level (some libraries preconfigure handlers)
root_logger = logging.getLogger()
root_logger.setLevel(level)
for handler in root_logger.handlers:
    try:
        handler.setLevel(level)
    except Exception:
        pass

logger = logging.getLogger(__name__)

# Global shutdown event
shutdown_event = None

# Data handling configuration
DATA_DIR = Path(__file__).parent / 'data'
CACHE_DIR = DATA_DIR / 'cache'
SESSIONS_DIR = DATA_DIR / 'sessions'
TEMP_DIR = DATA_DIR / 'temp'

def initialize_data_directories():
    """Create necessary data directories and set up file handling"""
    directories = [DATA_DIR, CACHE_DIR, SESSIONS_DIR, TEMP_DIR]
    
    for directory in directories:
        try:
            directory.mkdir(parents=True, exist_ok=True)
            logger.debug(f"Ensured directory exists: {directory}")
        except Exception as e:
            logger.error(f"Failed to create directory {directory}: {e}")
            raise

    # Create a .gitignore in data directory to exclude large files
    gitignore_path = DATA_DIR / '.gitignore'
    if not gitignore_path.exists():
        gitignore_content = """# Ignore all files in data directory except this file
*
!.gitignore
!README.md
"""
        gitignore_path.write_text(gitignore_content)
        logger.debug("Created .gitignore in data directory")
    
    # Create README for data directory
    readme_path = DATA_DIR / 'README.md'
    if not readme_path.exists():
        readme_content = """# Data Directory

This directory contains:
- `/sessions/` - Player session data files
- `/cache/` - Temporary cached data for performance
- `/temp/` - Temporary files that can be safely deleted

## Data Management
- Session files are automatically rotated when they exceed 100MB
- Cache is cleared on server restart
- Temp files are cleaned up after 24 hours
"""
        readme_path.write_text(readme_content)
        logger.debug("Created README.md in data directory")

def cleanup_temp_files():
    """Clean up old temporary files"""
    import time
    current_time = time.time()
    
    try:
        for file_path in TEMP_DIR.glob('*'):
            if file_path.is_file():
                file_age = current_time - file_path.stat().st_mtime
                # Delete files older than 24 hours
                if file_age > 86400:  # 24 hours in seconds
                    file_path.unlink()
                    logger.debug(f"Deleted old temp file: {file_path}")
    except Exception as e:
        logger.warning(f"Error during temp file cleanup: {e}")

def configure_performance_settings():
    """Configure performance-related settings"""
    # Set environment variables for better async performance
    if 'UV_THREADPOOL_SIZE' not in os.environ:
        os.environ['UV_THREADPOOL_SIZE'] = str(max(4, os.cpu_count() or 4))
    
    # Configure garbage collection for better performance with large data
    import gc
    gc.set_threshold(100000, 50, 50)  # Adjust GC thresholds for large data handling
    
    # Enable optimizations for JSON handling
    try:
        import ujson
        # Monkey patch json module to use ujson for better performance
        sys.modules['json'] = ujson
        logger.debug("Using ujson for improved JSON performance")
    except ImportError:
        logger.debug("ujson not available, using standard json module")

# Global shutdown event
shutdown_event = None

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    global shutdown_event
    if shutdown_event:
        logger.info("\nReceived interrupt signal, shutting down gracefully...")
        shutdown_event.set()
    else:
        # Fallback if shutdown_event is not set
        sys.exit(0)

async def run_with_shutdown():
    """Run the main server with graceful shutdown support"""
    global shutdown_event
    shutdown_event = asyncio.Event()
    
    # Initialize data handling
    initialize_data_directories()
    cleanup_temp_files()
    configure_performance_settings()
    
    # Pass data directories to main
    os.environ['DATA_DIR'] = str(DATA_DIR)
    os.environ['CACHE_DIR'] = str(CACHE_DIR)
    os.environ['SESSIONS_DIR'] = str(SESSIONS_DIR)
    os.environ['TEMP_DIR'] = str(TEMP_DIR)
    
    # Import and create the main task
    from server.main import main
    main_task = asyncio.create_task(main())
    shutdown_task = asyncio.create_task(shutdown_event.wait())
    
    # Wait for either main to complete or shutdown signal
    done, pending = await asyncio.wait(
        [main_task, shutdown_task],
        return_when=asyncio.FIRST_COMPLETED
    )
    
    # Cancel any pending tasks
    for task in pending:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    
    # Check if main task had an exception
    for task in done:
        if task == main_task and task.exception():
            raise task.exception()
    
    logger.info("Server shutdown complete")

if __name__ == '__main__':
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    if sys.platform != "win32":
        signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        asyncio.run(run_with_shutdown())
    except KeyboardInterrupt:
        # This should not happen with proper signal handling, but just in case
        logger.info("\nServer stopped by user")
    except Exception as e:
        logging.error(f'Error starting server: {e}')
        raise
    finally:
        # Clean exit
        sys.exit(0)