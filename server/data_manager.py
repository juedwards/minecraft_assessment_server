import asyncio
import json
import gzip
import logging
import time
from pathlib import Path
from typing import Dict, List, Any, Optional
from collections import deque
from datetime import datetime
import aiofiles
import os

logger = logging.getLogger(__name__)

class DataManager:
    """Manages data storage and retrieval with performance optimizations"""
    
    def __init__(self, data_dir: str, cache_size: int = 1000):
        self.data_dir = Path(data_dir)
        self.cache_dir = Path(os.environ.get('CACHE_DIR', self.data_dir / 'cache'))
        self.sessions_dir = Path(os.environ.get('SESSIONS_DIR', self.data_dir / 'sessions'))
        self.temp_dir = Path(os.environ.get('TEMP_DIR', self.data_dir / 'temp'))
        
        # In-memory cache for recent data
        self.cache = {}
        self.cache_queue = deque(maxlen=cache_size)
        self.cache_size = cache_size
        
        # Write buffer to batch writes
        self.write_buffer = []
        self.write_lock = asyncio.Lock()
        self.last_flush = time.time()
        self.flush_interval = 5.0  # Flush every 5 seconds
        self.max_buffer_size = 100  # Flush after 100 items
        
        # File rotation settings
        self.max_file_size = 100 * 1024 * 1024  # 100MB
        self.current_session_file = None
        self.current_file_size = 0
        
        # Background tasks
        self.flush_task = None
        self.cleanup_task = None

    async def start(self):
        """Start background tasks for data management"""
        self.flush_task = asyncio.create_task(self._periodic_flush())
        self.cleanup_task = asyncio.create_task(self._periodic_cleanup())
        logger.info("Data manager started")

    async def stop(self):
        """Stop background tasks and flush remaining data"""
        if self.flush_task:
            self.flush_task.cancel()
        if self.cleanup_task:
            self.cleanup_task.cancel()
        
        # Final flush
        await self.flush_buffer()
        logger.info("Data manager stopped")

    async def store_event(self, event_type: str, data: Dict[str, Any]):
        """Store an event with automatic batching and caching"""
        event = {
            'type': event_type,
            'timestamp': datetime.utcnow().isoformat(),
            'data': data
        }
        
        # Add to cache for quick retrieval
        cache_key = f"{event_type}:{time.time()}"
        self._add_to_cache(cache_key, event)
        
        # Add to write buffer
        async with self.write_lock:
            self.write_buffer.append(event)
            
            # Check if we need to flush
            if len(self.write_buffer) >= self.max_buffer_size:
                await self.flush_buffer()

    async def flush_buffer(self):
        """Flush write buffer to disk"""
        async with self.write_lock:
            if not self.write_buffer:
                return
            
            # Get current session file
            session_file = await self._get_session_file()
            
            try:
                # Write data in compressed format for large datasets
                async with aiofiles.open(session_file, 'ab') as f:
                    for event in self.write_buffer:
                        line = json.dumps(event) + '\n'
                        compressed = gzip.compress(line.encode('utf-8'))
                        await f.write(len(compressed).to_bytes(4, 'big'))
                        await f.write(compressed)
                        self.current_file_size += len(compressed) + 4
                
                logger.debug(f"Flushed {len(self.write_buffer)} events to {session_file}")
                self.write_buffer.clear()
                self.last_flush = time.time()
                
            except Exception as e:
                logger.error(f"Error flushing buffer: {e}")

    async def get_recent_events(self, event_type: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get recent events from cache"""
        events = []
        
        # First check cache
        for key in reversed(self.cache_queue):
            if key in self.cache:
                event = self.cache[key]
                if event_type is None or event.get('type') == event_type:
                    events.append(event)
                    if len(events) >= limit:
                        break
        
        return events

    async def get_session_data(self, session_id: str, compressed: bool = True) -> List[Dict]:
        """Read session data from disk"""
        session_file = self.sessions_dir / f"{session_id}.dat"
        
        if not session_file.exists():
            return []
        
        events = []
        try:
            async with aiofiles.open(session_file, 'rb') as f:
                while True:
                    # Read length header
                    length_bytes = await f.read(4)
                    if not length_bytes:
                        break
                    
                    length = int.from_bytes(length_bytes, 'big')
                    compressed_data = await f.read(length)
                    
                    if compressed:
                        decompressed = gzip.decompress(compressed_data)
                        event = json.loads(decompressed.decode('utf-8'))
                        events.append(event)
                    
        except Exception as e:
            logger.error(f"Error reading session data: {e}")
        
        return events

    async def export_session(self, session_id: str, output_path: Path):
        """Export session data to JSON file"""
        events = await self.get_session_data(session_id)
        
        try:
            async with aiofiles.open(output_path, 'w') as f:
                await f.write(json.dumps({
                    'session_id': session_id,
                    'export_time': datetime.utcnow().isoformat(),
                    'event_count': len(events),
                    'events': events
                }, indent=2))
            
            logger.info(f"Exported session {session_id} to {output_path}")
            
        except Exception as e:
            logger.error(f"Error exporting session: {e}")

    def _add_to_cache(self, key: str, data: Dict):
        """Add data to cache with LRU eviction"""
        if key in self.cache:
            # Move to end (most recent)
            self.cache_queue.remove(key)
        
        self.cache[key] = data
        self.cache_queue.append(key)
        
        # Evict oldest if cache is full
        while len(self.cache) > self.cache_size:
            oldest_key = self.cache_queue.popleft()
            if oldest_key in self.cache:
                del self.cache[oldest_key]

    async def _get_session_file(self) -> Path:
        """Get current session file, rotating if necessary"""
        if self.current_session_file is None or self.current_file_size > self.max_file_size:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            self.current_session_file = self.sessions_dir / f"session_{timestamp}.dat"
            self.current_file_size = 0
            logger.info(f"Started new session file: {self.current_session_file}")
        
        return self.current_session_file

    async def _periodic_flush(self):
        """Periodically flush write buffer"""
        while True:
            try:
                await asyncio.sleep(self.flush_interval)
                
                # Check if buffer needs flushing
                if self.write_buffer and (time.time() - self.last_flush) > self.flush_interval:
                    await self.flush_buffer()
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic flush: {e}")

    async def _periodic_cleanup(self):
        """Periodically clean up old files"""
        while True:
            try:
                await asyncio.sleep(3600)  # Run every hour
                
                # Clean up old temp files
                await self._cleanup_old_files(self.temp_dir, max_age_hours=24)
                
                # Clean up old cache files
                await self._cleanup_old_files(self.cache_dir, max_age_hours=1)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic cleanup: {e}")

    async def _cleanup_old_files(self, directory: Path, max_age_hours: int):
        """Clean up files older than specified hours"""
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600
        
        for file_path in directory.glob('*'):
            if file_path.is_file():
                try:
                    file_age = current_time - file_path.stat().st_mtime
                    if file_age > max_age_seconds:
                        file_path.unlink()
                        logger.debug(f"Deleted old file: {file_path}")
                except Exception as e:
                    logger.warning(f"Error deleting file {file_path}: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """Get data manager statistics"""
        return {
            'cache_size': len(self.cache),
            'buffer_size': len(self.write_buffer),
            'current_file_size': self.current_file_size,
            'session_file': str(self.current_session_file) if self.current_session_file else None,
            'last_flush': datetime.fromtimestamp(self.last_flush).isoformat()
        }
