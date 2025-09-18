import asyncio
import numpy as np
from typing import Dict, List, Tuple, Optional, Set, Any
import logging
from dataclasses import dataclass
from .chunk_cache import ChunkCache
from .chunk_processor import ChunkProcessor

logger = logging.getLogger(__name__)


@dataclass
class ViewerState:
    """State of the 3D viewer"""
    position: Tuple[float, float, float]
    view_distance: int
    last_chunk_position: Optional[Tuple[int, int, int]] = None


class OptimizedRenderer:
    """Optimized renderer for 3D chunk data with full map support"""
    
    def __init__(self, cache: ChunkCache, processor: ChunkProcessor):
        self.cache = cache
        self.processor = processor
        self.visible_chunks: Set[Tuple[int, int, int]] = set()
        self.viewer_state = ViewerState(position=(0, 0, 0), view_distance=8)
        self.update_lock = asyncio.Lock()
    
    async def update_viewer_position(self, x: float, y: float, z: float) -> Dict[str, Any]:
        """Update viewer position and return visible chunks"""
        self.viewer_state.position = (x, y, z)
        
        # Calculate chunk position
        chunk_x = int(x // 16)
        chunk_y = int(y // 16)
        chunk_z = int(z // 16)
        
        # Check if we moved to a new chunk
        if self.viewer_state.last_chunk_position != (chunk_x, chunk_y, chunk_z):
            self.viewer_state.last_chunk_position = (chunk_x, chunk_y, chunk_z)
            
            # Trigger prefetch for nearby chunks
            asyncio.create_task(
                self.cache.prefetch(chunk_x, chunk_y, chunk_z, radius=self.viewer_state.view_distance // 2)
            )
        
        # Get visible chunks
        visible_data = await self._get_visible_chunks(chunk_x, chunk_y, chunk_z)
        
        return {
            "position": self.viewer_state.position,
            "chunk_position": (chunk_x, chunk_y, chunk_z),
            "visible_chunks": len(visible_data),
            "chunks": visible_data
        }
    
    async def get_full_map(self, limit: int = 1000) -> Dict[str, Any]:
        """Get all stored chunks for full map view"""
        if not self.cache.storage:
            return {"error": "No storage configured"}
        
        all_chunks = await self.cache.storage.get_all_chunks()
        map_bounds = await self.cache.storage.get_map_bounds()
        
        # Load chunks (up to limit)
        chunks_data = []
        chunk_coords = list(all_chunks)[:limit]
        
        tasks = []
        for x, y, z in chunk_coords:
            tasks.append(self._fetch_chunk_data(x, y, z))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Error loading chunk for full map: {result}")
                continue
            if result is not None:
                chunks_data.append(result)
        
        return {
            "bounds": map_bounds,
            "total_chunks": len(all_chunks),
            "loaded_chunks": len(chunks_data),
            "chunks": chunks_data
        }
    
    async def _get_visible_chunks(self, center_x: int, center_y: int, center_z: int) -> List[Dict[str, Any]]:
        """Get all visible chunks around the viewer"""
        view_dist = self.viewer_state.view_distance
        chunks_data = []
        tasks = []
        
        # Calculate visible chunk coordinates
        new_visible = set()
        
        for dx in range(-view_dist, view_dist + 1):
            for dy in range(-view_dist // 2, view_dist // 2 + 1):  # Less vertical range
                for dz in range(-view_dist, view_dist + 1):
                    # Simple distance check
                    if dx*dx + dy*dy*4 + dz*dz <= view_dist*view_dist:
                        chunk_coord = (center_x + dx, center_y + dy, center_z + dz)
                        new_visible.add(chunk_coord)
        
        # Update visible chunks set
        async with self.update_lock:
            self.visible_chunks = new_visible
        
        # Fetch chunk data
        for x, y, z in new_visible:
            tasks.append(self._fetch_chunk_data(x, y, z))
        
        # Process in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Error fetching chunk: {result}")
                continue
            if result is not None:
                chunks_data.append(result)
        
        return chunks_data
    
    async def _fetch_chunk_data(self, x: int, y: int, z: int) -> Optional[Dict[str, Any]]:
        """Fetch single chunk data with caching"""
        # Try cache first (which also checks storage)
        chunk_data = await self.cache.get(x, y, z)
        
        if chunk_data is None:
            # Process new chunk
            chunk_data = await self.processor.process_chunk(x, y, z)
            
            # Store in cache and persistent storage
            await self.cache.put(x, y, z, chunk_data)
        
        # Convert to render format
        return self._prepare_render_data(x, y, z, chunk_data)
    
    def _prepare_render_data(self, x: int, y: int, z: int, data: np.ndarray) -> Dict[str, Any]:
        """Prepare chunk data for rendering"""
        # Optimize data for rendering
        # Only send non-empty blocks and use run-length encoding
        
        non_empty = np.argwhere(data > 0)
        
        if len(non_empty) == 0:
            return None
        
        # Group consecutive blocks for efficient transmission
        blocks = []
        for idx in non_empty:
            blocks.append({
                "pos": idx.tolist(),
                "type": int(data[tuple(idx)])
            })
        
        return {
            "position": [x, y, z],
            "blocks": blocks,
            "count": len(blocks)
        }
    
    async def get_render_stats(self) -> Dict[str, Any]:
        """Get rendering statistics"""
        cache_stats = self.cache.get_stats()
        storage_stats = {}
        
        if self.cache.storage:
            bounds = await self.cache.storage.get_map_bounds()
            all_chunks = await self.cache.storage.get_all_chunks()
            storage_stats = {
                "stored_chunks": len(all_chunks),
                "map_bounds": bounds
            }
        
        return {
            "viewer_position": self.viewer_state.position,
            "view_distance": self.viewer_state.view_distance,
            "visible_chunks": len(self.visible_chunks),
            "cache": cache_stats,
            "storage": storage_stats
        }
