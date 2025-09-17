# Launcher for refactored server
import logging
import asyncio
import os
import sys
import argparse

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

if __name__ == '__main__':
    try:
        from server.main import main
        asyncio.run(main())
    except Exception as e:
        logging.error(f'Error starting server: {e}')
        raise