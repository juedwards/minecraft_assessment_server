import asyncio
import signal
import sys
import logging
import websockets
from contextlib import suppress

# Global server and connections
server = None
connected_clients = set()
shutdown_event = asyncio.Event()

async def handle_client(websocket, path):
    """Handle websocket connections"""
    connected_clients.add(websocket)
    try:
        async for message in websocket:
            # ...existing code...
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)

async def shutdown_server():
    """Gracefully shutdown the server"""
    logging.info("Starting graceful shutdown...")
    
    # Set shutdown event
    shutdown_event.set()
    
    # Close all client connections
    if connected_clients:
        logging.info(f"Closing {len(connected_clients)} active connections...")
        close_tasks = [
            asyncio.create_task(client.close(code=1001, reason="Server shutting down"))
            for client in connected_clients.copy()
        ]
        # Wait for all connections to close
        await asyncio.gather(*close_tasks, return_exceptions=True)
    
    # Stop accepting new connections
    if server:
        server.close()
        await server.wait_closed()
    
    logging.info("Shutdown complete")

def signal_handler(loop):
    """Handle shutdown signals"""
    logging.info("\nReceived shutdown signal")
    
    # Schedule shutdown
    asyncio.create_task(shutdown_server())
    
    # Stop the loop after shutdown
    loop.call_later(2, loop.stop)

async def main():
    global server
    
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    
    # Get event loop
    loop = asyncio.get_running_loop()
    
    # Register signal handlers
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: signal_handler(loop))
    
    try:
        # Start websocket server
        server = await websockets.serve(
            handle_client,
            "localhost",
            8765,
            process_request=None,
            ping_interval=20,
            ping_timeout=10
        )
        
        logging.info("Server started on ws://localhost:8765")
        logging.info("Press Ctrl+C to stop the server")
        
        # Wait for shutdown
        await shutdown_event.wait()
        
    except Exception as e:
        logging.error(f"Server error: {e}")
    finally:
        await shutdown_server()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Server stopped")
    finally:
        logging.info("Cleanup complete")
        sys.exit(0)