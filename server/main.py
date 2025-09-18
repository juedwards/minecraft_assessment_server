"""Entrypoint that wires up servers previously in app.py"""
import asyncio
import logging
import threading
import os
import signal
import sys
from .state import ensure_data_directory
from .http import run_http_server
from .minecraft_ws import handle_minecraft_client
from .web_ws import handle_web_client
import websockets
import socket
from .chunk_cache import ChunkCache
from .chunk_processor import ChunkProcessor
from .optimized_renderer import OptimizedRenderer
from .chunk_storage import ChunkStorage

logger = logging.getLogger(__name__)

# Global shutdown event
shutdown_event = asyncio.Event()


def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"🛑 Received signal {signum}, initiating graceful shutdown...")
    shutdown_event.set()


async def main():
    """Main server entry point with performance optimizations"""
    logger.info("Starting optimized Minecraft assessment server...")
    
    # Set up signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, signal_handler)
    
    # Initialize performance components with GPU support
    chunk_storage = ChunkStorage()
    
    # Adjust cache size based on available memory
    import psutil
    available_memory_gb = psutil.virtual_memory().available / (1024**3)
    cache_size = min(10000, int(2000 + available_memory_gb * 500))  # Scale with memory
    
    chunk_cache = ChunkCache(max_size=cache_size, compression_level=6, storage=chunk_storage)
    
    # Increase batch size for better GPU utilization
    batch_size = 100 if os.environ.get('CUDA_VISIBLE_DEVICES') is not None else 10
    chunk_processor = ChunkProcessor(batch_size=batch_size)
    
    renderer = OptimizedRenderer(chunk_cache, chunk_processor)
    
    # Log system capabilities
    logger.info(f"💻 System: {psutil.cpu_count()} CPUs, {available_memory_gb:.1f} GB available RAM")
    logger.info(f"📦 Cache size: {cache_size} chunks")
    if hasattr(chunk_processor, 'GPU_AVAILABLE') and chunk_processor.GPU_AVAILABLE:
        logger.info("🎮 GPU acceleration enabled")
    else:
        logger.info("💻 Using CPU processing (install cupy for GPU acceleration)")
    
    # Start processor
    await chunk_processor.start()
    
    # Inject renderer into web_ws handler for streaming
    from . import web_ws
    web_ws.handle_web_client.renderer = renderer
    
    # Keep track of servers for cleanup
    minecraft_server = None
    web_server = None
    
    try:
        logger.info('=' * 60)
        logger.info('🎮 Minecraft 3D Live Tracker with AI Assessment (refactored)')
        logger.info('=' * 60)
        ensure_data_directory()
        
        # Log storage stats
        map_bounds = await chunk_storage.get_map_bounds()
        if map_bounds.get('total_chunks', 0) > 0:
            logger.info(f"📊 Loaded {map_bounds['total_chunks']} chunks from storage")
            logger.info(f"🗺️  Map bounds: {map_bounds['min']} to {map_bounds['max']}")
        
        http_thread = threading.Thread(target=run_http_server, daemon=True)
        http_thread.start()
        minecraft_server = await websockets.serve(handle_minecraft_client, '0.0.0.0', int(os.getenv('MINECRAFT_PORT', '19131')))
        web_server = await websockets.serve(handle_web_client, '0.0.0.0', int(os.getenv('WS_PORT', '8081')))
        logger.info('✅ Servers started successfully!')
        
        # Start background chunk loader
        await renderer.start_background_loader()
        
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
        logger.info(f"🗃️  Chunk data stored in: {chunk_storage.data_dir}")
        logger.info("📍 Press Ctrl+C to gracefully shutdown the server")
        
        # Add cache statistics endpoint
        async def get_performance_stats():
            return await renderer.get_render_stats()
        
        # Wait for shutdown signal
        await shutdown_event.wait()
        
        logger.info("👋 Starting graceful shutdown...")
            
    except Exception as e:
        logger.error(f"❌ Server error: {e}", exc_info=True)
        raise
    
    finally:
        logger.info("🧹 Cleaning up resources...")
        
        # Close websocket servers
        if minecraft_server:
            logger.info("  • Closing Minecraft WebSocket server...")
            minecraft_server.close()
            await minecraft_server.wait_closed()
        
        if web_server:
            logger.info("  • Closing Web WebSocket server...")
            web_server.close()
            await web_server.wait_closed()
        
        # Save final metadata
        logger.info("  • Saving chunk metadata...")
        await chunk_storage.save_metadata()
        logger.info(f"  • Saved metadata for {len(chunk_storage.chunk_index)} chunks")
        
        # Get final stats before shutdown
        stats = await renderer.get_render_stats()
        cache_stats = stats.get('cache', {})
        logger.info(f"  • Cache stats: {cache_stats.get('size', 0)} chunks in memory, "
                   f"{cache_stats.get('hit_rate', 0):.1%} hit rate")
        
        # Cleanup processor
        logger.info("  • Stopping chunk processor...")
        await chunk_processor.stop()
        
        logger.info("✅ Server shutdown complete")


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
        # This is handled by our signal handler
        pass
