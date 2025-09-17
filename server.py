import signal
import sys
import asyncio
import logging
from aiohttp import web
import weakref

# Store active websocket connections
active_websockets = weakref.WeakSet()

# Shutdown event
shutdown_event = asyncio.Event()

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    # Add to active connections
    active_websockets.add(ws)
    
    try:
        async for msg in ws:
            # ...existing code...
            pass
    finally:
        # Remove from active connections when done
        active_websockets.discard(ws)
    
    return ws

async def shutdown_handler(app):
    """Clean shutdown of all connections"""
    logging.info("Shutting down server...")
    
    # Close all active websocket connections
    for ws in list(active_websockets):
        try:
            await ws.close(code=1001, message=b'Server shutting down')
        except Exception as e:
            logging.error(f"Error closing websocket: {e}")
    
    # Wait a bit for connections to close
    await asyncio.sleep(0.5)
    
    logging.info("Server shutdown complete")

def signal_handler(sig, frame):
    """Handle Ctrl+C signal"""
    logging.info("\nReceived interrupt signal, shutting down gracefully...")
    shutdown_event.set()
    
    # If using asyncio event loop
    loop = asyncio.get_event_loop()
    if loop.is_running():
        loop.stop()

async def init_app():
    app = web.Application()
    
    # ...existing code...
    
    # Add shutdown handler
    app.on_shutdown.append(shutdown_handler)
    
    return app

def main():
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Create and run the app
    app = asyncio.get_event_loop().run_until_complete(init_app())
    
    try:
        web.run_app(
            app,
            host='0.0.0.0',
            port=8080,
            handle_signals=True,  # Let aiohttp handle signals
            shutdown_timeout=10   # Give 10 seconds for graceful shutdown
        )
    except KeyboardInterrupt:
        logging.info("Server stopped by user")
    finally:
        logging.info("Server closed")
        sys.exit(0)

if __name__ == '__main__':
    main()