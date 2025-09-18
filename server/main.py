"""Entrypoint that wires up servers previously in app.py"""
import asyncio
import logging
import threading
import os
from .state import ensure_data_directory
from .http import run_http_server
from .minecraft_ws import handle_minecraft_client
from .web_ws import handle_web_client
import websockets
import socket

logger = logging.getLogger(__name__)


async def main():
    logger.info('=' * 60)
    logger.info('🎮 Minecraft 3D Live Tracker with AI Assessment (refactored)')
    logger.info('=' * 60)
    ensure_data_directory()
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    minecraft_server = await websockets.serve(handle_minecraft_client, '0.0.0.0', int(os.getenv('MINECRAFT_PORT', '19131')))
    web_server = await websockets.serve(handle_web_client, '0.0.0.0', int(os.getenv('WS_PORT', '8081')))
    logger.info('✅ Servers started successfully!')
    # Resolve an external IP or hostname to show to users — prefer explicit env var if provided
    def get_external_ip():
        # Allow override
        env_ip = os.getenv('EXTERNAL_IP') or os.getenv('SERVER_HOST')
        if env_ip:
            return env_ip
        try:
            # Use UDP trick to determine outbound IP on machines with network access
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                return s.getsockname()[0]
        except Exception:
            return 'localhost'

    external_ip = get_external_ip()
    logger.info(f"📡 Minecraft: Connect with /connect {external_ip}:{os.getenv('MINECRAFT_PORT', '19131')}")
    logger.info(f"🌐 3D Viewer: Open http://{external_ip}:{os.getenv('HTTP_PORT', '8080')} in your browser")
    logger.info('🤖 AI: Click "Analyze Players with AI" button')
    logger.info(f"💾 JSON files saved to: {os.getenv('DATA_DIR', 'data')}/ directory")
    await asyncio.Future()


if __name__ == '__main__':
    try:
        import dotenv
        dotenv.load_dotenv()
    except Exception:
        pass
    # Only configure basic logging here if no handlers are present.
    # The launcher (app.py) configures logging and should control level via --level / LOG_LEVEL.
    root = logging.getLogger()
    if not root.handlers:
        level = getattr(logging, os.getenv('LOG_LEVEL', 'INFO').upper(), logging.INFO)
        logging.basicConfig(level=level, format='%(asctime)s - %(message)s')
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info('👋 Server stopped')
