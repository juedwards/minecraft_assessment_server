import asyncio
import json
import os
import zlib
import numpy as np
import pickle
from typing import Dict, Optional, Tuple, Set
from pathlib import Path
import logging
import aiofiles
from datetime import datetime

logger = logging.getLogger(__name__)


class ChunkStorage:
    """Persistent storage for chunk data to build up complete maps"""
    
    def __init__(self, data_dir: str = None):
        self.data_dir = Path(data_dir or os.getenv('DATA_DIR', 'data')) / 'chunks'
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_file = self.data_dir / 'metadata.json'
        self.chunk_index: Dict[Tuple[int, int, int], Dict] = {}
        self.write_lock = asyncio.Lock()
        self._load_metadata()
    
    def _load_metadata(self):
        """Load chunk metadata from disk"""
        try:
            if self.metadata_file.exists():
                with open(self.metadata_file, 'r') as f:
                    data = json.load(f)
                    # Convert string keys back to tuples
                    self.chunk_index = {
                        tuple(map(int, k.split(','))): v 
                        for k, v in data.items()
                    }
                logger.info(f"Loaded metadata for {len(self.chunk_index)} chunks")
        except Exception as e:
            logger.error(f"Error loading chunk metadata: {e}")
            self.chunk_index = {}
    
    async def save_metadata(self):
        """Save chunk metadata to disk"""
        async with self.write_lock:
            try:
                # Convert tuple keys to strings for JSON
                data = {
                    f"{x},{y},{z}": meta 
                    for (x, y, z), meta in self.chunk_index.items()
                }
                async with aiofiles.open(self.metadata_file, 'w') as f:
                    await f.write(json.dumps(data, indent=2))
            except Exception as e:
                logger.error(f"Error saving chunk metadata: {e}")
    
    def _get_chunk_path(self, x: int, y: int, z: int) -> Path:
        """Get file path for a chunk"""
        # Organize chunks by region for better file system performance
        region_x = x // 32
        region_z = z // 32
        region_dir = self.data_dir / f"r.{region_x}.{region_z}"
        region_dir.mkdir(exist_ok=True)
        return region_dir / f"c.{x}.{y}.{z}.dat"
    
    async def exists(self, x: int, y: int, z: int) -> bool:
        """Check if chunk exists in storage"""
        return (x, y, z) in self.chunk_index
    
    async def load(self, x: int, y: int, z: int) -> Optional[np.ndarray]:
        """Load chunk from persistent storage"""
        if not await self.exists(x, y, z):
            return None
        
        chunk_path = self._get_chunk_path(x, y, z)
        try:
            async with aiofiles.open(chunk_path, 'rb') as f:
                compressed_data = await f.read()
                decompressed = zlib.decompress(compressed_data)
                return pickle.loads(decompressed)
        except Exception as e:
            logger.error(f"Error loading chunk {x},{y},{z}: {e}")
            return None
    
    async def save(self, x: int, y: int, z: int, data: np.ndarray):
        """Save chunk to persistent storage"""
        chunk_path = self._get_chunk_path(x, y, z)
        
        try:
            # Compress data
            serialized = pickle.dumps(data)
            compressed = zlib.compress(serialized, level=6)
            
            # Write to disk
            async with aiofiles.open(chunk_path, 'wb') as f:
                await f.write(compressed)
            
            # Update metadata
            self.chunk_index[(x, y, z)] = {
                'timestamp': datetime.utcnow().isoformat(),
                'size': len(compressed),
                'blocks': int(np.count_nonzero(data))
            }
            
            # Save metadata periodically (every 10 chunks)
            if len(self.chunk_index) % 10 == 0:
                await self.save_metadata()
                
        except Exception as e:
            logger.error(f"Error saving chunk {x},{y},{z}: {e}")
    
    async def get_all_chunks(self) -> Set[Tuple[int, int, int]]:
        """Get coordinates of all stored chunks"""
        return set(self.chunk_index.keys())
    
    async def get_map_bounds(self) -> Dict:
        """Get the bounds of the stored map"""
        if not self.chunk_index:
            return {'min': [0, 0, 0], 'max': [0, 0, 0]}
        
        coords = list(self.chunk_index.keys())
        x_coords = [c[0] for c in coords]
        y_coords = [c[1] for c in coords]
        z_coords = [c[2] for c in coords]
        
        return {
            'min': [min(x_coords), min(y_coords), min(z_coords)],
            'max': [max(x_coords), max(y_coords), max(z_coords)],
            'total_chunks': len(coords),
            'total_blocks': sum(meta.get('blocks', 0) for meta in self.chunk_index.values())
        }
