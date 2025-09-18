import asyncio
import zlib
import pickle
import numpy as np
from typing import Dict, Optional, Tuple, Any
from collections import OrderedDict
import logging

logger = logging.getLogger(__name__)


class ChunkCache:
    """High-performance LRU cache for chunk data with compression and persistent storage backing"""
    
    def __init__(self, max_size: int = 1000, compression_level: int = 6, storage=None):
        self.max_size = max_size
        self.compression_level = compression_level
        self.storage = storage  # ChunkStorage instance
        self.cache: OrderedDict[Tuple[int, int, int], bytes] = OrderedDict()
        self.hit_count = 0
        self.miss_count = 0
        self.lock = asyncio.Lock()
    
    async def get(self, x: int, y: int, z: int) -> Optional[np.ndarray]:
        """Get chunk data from cache or storage"""
        key = (x, y, z)
        async with self.lock:
            if key in self.cache:
                self.hit_count += 1
                # Move to end (most recently used)
                self.cache.move_to_end(key)
                compressed_data = self.cache[key]
                # Decompress
                decompressed = zlib.decompress(compressed_data)
                return pickle.loads(decompressed)
            else:
                self.miss_count += 1
        
        # Try loading from storage if we have it
        if self.storage:
            data = await self.storage.load(x, y, z)
            if data is not None:
                # Add to cache
                await self.put(x, y, z, data, save_to_storage=False)
                return data
        
        return None
    
    async def put(self, x: int, y: int, z: int, data: np.ndarray, save_to_storage: bool = True) -> None:
        """Store chunk data in cache and optionally in persistent storage"""
        key = (x, y, z)
        
        # Save to persistent storage first
        if save_to_storage and self.storage:
            await self.storage.save(x, y, z, data)
        
        async with self.lock:
            # Compress data
            serialized = pickle.dumps(data)
            compressed = zlib.compress(serialized, level=self.compression_level)
            
            # Add to cache
            self.cache[key] = compressed
            self.cache.move_to_end(key)
            
            # Evict oldest if necessary (but data remains in storage)
            if len(self.cache) > self.max_size:
                evicted_key = self.cache.popitem(last=False)[0]
                logger.debug(f"Evicted chunk {evicted_key} from cache (still in storage)")
    
    async def prefetch(self, center_x: int, center_y: int, center_z: int, radius: int = 2) -> None:
        """Pre-fetch chunks around a center position from storage"""
        if not self.storage:
            return
            
        tasks = []
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                for dz in range(-radius, radius + 1):
                    x, y, z = center_x + dx, center_y + dy, center_z + dz
                    if not await self.exists_in_cache(x, y, z):
                        # Load from storage if it exists there
                        if await self.storage.exists(x, y, z):
                            tasks.append(self.get(x, y, z))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    async def exists_in_cache(self, x: int, y: int, z: int) -> bool:
        """Check if chunk exists in cache"""
        async with self.lock:
            return (x, y, z) in self.cache
    
    async def exists(self, x: int, y: int, z: int) -> bool:
        """Check if chunk exists in cache or storage"""
        if await self.exists_in_cache(x, y, z):
            return True
        if self.storage:
            return await self.storage.exists(x, y, z)
        return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        total_requests = self.hit_count + self.miss_count
        hit_rate = self.hit_count / total_requests if total_requests > 0 else 0
        
        return {
            "size": len(self.cache),
            "max_size": self.max_size,
            "hit_count": self.hit_count,
            "miss_count": self.miss_count,
            "hit_rate": hit_rate,
            "memory_usage_mb": sum(len(v) for v in self.cache.values()) / (1024 * 1024)
        }
