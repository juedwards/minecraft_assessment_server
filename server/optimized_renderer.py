import asyncio
import numpy as np
from typing import Dict, List, Tuple, Optional, Set, Any
import logging
from dataclasses import dataclass
from .chunk_cache import ChunkCache
from .chunk_processor import ChunkProcessor
import psutil

logger = logging.getLogger(__name__)


@dataclass
class ViewerState:
    """State of the 3D viewer"""
    position: Tuple[float, float, float]
    view_distance: int
    last_chunk_position: Optional[Tuple[int, int, int]] = None


class OptimizedRenderer:
    """Optimized renderer for 3D chunk data with GPU support"""
    
    def __init__(self, cache: ChunkCache, processor: ChunkProcessor):
        self.cache = cache
        self.processor = processor
        self.visible_chunks: Set[Tuple[int, int, int]] = set()
        
        # Adjust view distance based on available resources
        if hasattr(processor, 'GPU_AVAILABLE') and processor.GPU_AVAILABLE:
            default_view_distance = 32  # Much larger view distance with GPU
        else:
            # Calculate based on available memory
            available_memory_gb = psutil.virtual_memory().available / (1024**3)
            default_view_distance = min(16, int(8 + available_memory_gb / 2))
        
        self.viewer_state = ViewerState(position=(0, 0, 0), view_distance=default_view_distance)
        self.update_lock = asyncio.Lock()
        # Track all loaded chunks for persistent rendering
        self.loaded_chunks: Set[Tuple[int, int, int]] = set()
        # Queue for new chunks to send to viewer
        self.new_chunks_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        # Surface optimization - prioritize surface chunks
        self.surface_y_range = (60, 80)  # Typical surface height range
    
    async def start_background_loader(self):
        """Start background task to load all stored chunks"""
        asyncio.create_task(self._load_all_chunks_background())
    
    async def _load_all_chunks_background(self):
        """Background task to progressively load all stored chunks with surface priority"""
        if not self.cache.storage:
            return
            
        try:
            all_chunks = await self.cache.storage.get_all_chunks()
            logger.info(f"Starting to load {len(all_chunks)} stored chunks in background")
            
            # Sort chunks by distance from surface for better initial view
            surface_chunks = []
            other_chunks = []
            
            for x, y, z in all_chunks:
                if self.surface_y_range[0] <= y * 16 <= self.surface_y_range[1]:
                    surface_chunks.append((x, y, z))
                else:
                    other_chunks.append((x, y, z))
            
            # Load surface chunks first
            logger.info(f"Loading {len(surface_chunks)} surface chunks first")
            
            for chunk_coord in surface_chunks + other_chunks:
                if chunk_coord not in self.loaded_chunks:
                    # Load chunk data
                    x, y, z = chunk_coord
                    chunk_data = await self._fetch_chunk_data(x, y, z)
                    if chunk_data:
                        self.loaded_chunks.add(chunk_coord)
                        try:
                            await self.new_chunks_queue.put(chunk_data)
                        except asyncio.QueueFull:
                            # Queue is full, skip this chunk for now
                            pass
                        # Smaller delay for better performance
                        await asyncio.sleep(0.001)
                        
            logger.info(f"Finished loading all {len(self.loaded_chunks)} stored chunks")
        except Exception as e:
            logger.error(f"Error in background chunk loader: {e}")
    
    async def update_viewer_position(self, x: float, y: float, z: float) -> Dict[str, Any]:
        """Update viewer position with expanded view for surface visibility"""
        self.viewer_state.position = (x, y, z)
        
        # Calculate chunk position
        chunk_x = int(x // 16)
        chunk_y = int(y // 16)
        chunk_z = int(z // 16)
        
        # Check if we moved to a new chunk
        if self.viewer_state.last_chunk_position != (chunk_x, chunk_y, chunk_z):
            self.viewer_state.last_chunk_position = (chunk_x, chunk_y, chunk_z)
            
            # Trigger prefetch for nearby chunks with extended radius
            prefetch_radius = min(self.viewer_state.view_distance, 16)
            asyncio.create_task(
                self.cache.prefetch(chunk_x, chunk_y, chunk_z, radius=prefetch_radius)
            )
        
        # Get newly visible chunks with surface priority
        new_visible = await self._get_new_visible_chunks_surface_priority(chunk_x, chunk_y, chunk_z)
        
        # Process any new chunks in parallel
        if new_visible:
            tasks = []
            for coord in new_visible:
                if coord not in self.loaded_chunks:
                    x, y, z = coord
                    tasks.append(self._fetch_and_queue_chunk(x, y, z))
            
            if tasks:
                # Process in batches to avoid overwhelming the system
                batch_size = 50
                for i in range(0, len(tasks), batch_size):
                    batch = tasks[i:i + batch_size]
                    await asyncio.gather(*batch, return_exceptions=True)
        
        # Return viewer state with info about loaded chunks
        return {
            "position": self.viewer_state.position,
            "chunk_position": (chunk_x, chunk_y, chunk_z),
            "view_distance": self.viewer_state.view_distance,
            "total_loaded_chunks": len(self.loaded_chunks),
            "new_chunks": len(new_visible),
            "gpu_enabled": getattr(self.processor, 'GPU_AVAILABLE', False)
        }
    
    async def _fetch_and_queue_chunk(self, x: int, y: int, z: int):
        """Fetch chunk and add to queue"""
        chunk_data = await self._fetch_chunk_data(x, y, z)
        if chunk_data:
            self.loaded_chunks.add((x, y, z))
            try:
                await self.new_chunks_queue.put(chunk_data)
            except asyncio.QueueFull:
                pass
    
    async def _get_new_visible_chunks_surface_priority(self, center_x: int, center_y: int, center_z: int) -> Set[Tuple[int, int, int]]:
        """Get newly visible chunks with priority on surface chunks"""
        view_dist = self.viewer_state.view_distance
        new_visible = set()
        
        # Expand vertical range to see more surface
        vertical_multiplier = 0.3  # Reduced vertical distance for performance
        
        for dx in range(-view_dist, view_dist + 1):
            for dz in range(-view_dist, view_dist + 1):
                # Check horizontal distance
                if dx*dx + dz*dz <= view_dist*view_dist:
                    # Add multiple vertical layers with focus on surface
                    for dy in range(int(-view_dist * vertical_multiplier), int(view_dist * vertical_multiplier) + 1):
                        world_y = (center_y + dy) * 16
                        
                        # Prioritize surface chunks
                        if self.surface_y_range[0] <= world_y <= self.surface_y_range[1]:
                            chunk_coord = (center_x + dx, center_y + dy, center_z + dz)
                            new_visible.add(chunk_coord)
                        elif abs(dy) <= view_dist // 4:  # Still include some non-surface chunks
                            chunk_coord = (center_x + dx, center_y + dy, center_z + dz)
                            new_visible.add(chunk_coord)
        
        return new_visible
    
    async def get_new_chunks(self, timeout: float = 0.1) -> List[Dict[str, Any]]:
        """Get newly loaded chunks from the queue"""
        new_chunks = []
        try:
            # Get all available chunks without blocking too long
            while True:
                chunk = await asyncio.wait_for(self.new_chunks_queue.get(), timeout=timeout)
                new_chunks.append(chunk)
                timeout = 0.01  # Shorter timeout for subsequent chunks
        except asyncio.TimeoutError:
            pass
        return new_chunks
    
    async def get_all_loaded_chunks(self) -> Dict[str, Any]:
        """Get all currently loaded chunks"""
        chunks_data = []
        
        # Fetch all loaded chunks
        for coord in self.loaded_chunks:
            x, y, z = coord
            # Try cache first
            chunk_data = await self.cache.get(x, y, z)
            if chunk_data is not None:
                render_data = self._prepare_render_data(x, y, z, chunk_data)
                if render_data:
                    chunks_data.append(render_data)
        
        map_bounds = {}
        if self.cache.storage:
            map_bounds = await self.cache.storage.get_map_bounds()
        
        return {
            "bounds": map_bounds,
            "total_chunks": len(self.loaded_chunks),
            "chunks": chunks_data
        }
    
    async def _get_new_visible_chunks(self, center_x: int, center_y: int, center_z: int) -> Set[Tuple[int, int, int]]:
        """Get newly visible chunk coordinates around the viewer"""
        view_dist = self.viewer_state.view_distance
        new_visible = set()
        
        for dx in range(-view_dist, view_dist + 1):
            for dy in range(-view_dist // 2, view_dist // 2 + 1):  # Less vertical range
                for dz in range(-view_dist, view_dist + 1):
                    # Simple distance check
                    if dx*dx + dy*dy*4 + dz*dz <= view_dist*view_dist:
                        chunk_coord = (center_x + dx, center_y + dy, center_z + dz)
                        new_visible.add(chunk_coord)
        
        return new_visible
    
    async def _fetch_chunk_data(self, x: int, y: int, z: int) -> Optional[Dict[str, Any]]:
        """Fetch single chunk data with caching"""
        # Try cache first (which also checks storage)
        chunk_data = await self.cache.get(x, y, z)
        
        if chunk_data is None:
            # Process new chunk only if in visible range
            if (x, y, z) in await self._get_new_visible_chunks(
                self.viewer_state.last_chunk_position[0] if self.viewer_state.last_chunk_position else 0,
                self.viewer_state.last_chunk_position[1] if self.viewer_state.last_chunk_position else 0,
                self.viewer_state.last_chunk_position[2] if self.viewer_state.last_chunk_position else 0
            ):
                chunk_data = await self.processor.process_chunk(x, y, z)
                
                # Store in cache and persistent storage
                await self.cache.put(x, y, z, chunk_data)
            else:
                return None
        
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
                "loaded_chunks": len(self.loaded_chunks),
                "map_bounds": bounds,
                "queue_size": self.new_chunks_queue.qsize()
            }
        gpu_enabled = getattr(self.processor, 'GPU_AVAILABLE', False)
        
        return {
            "viewer_position": self.viewer_state.position,
            "view_distance": self.viewer_state.view_distance,
            "visible_chunks": len(self.visible_chunks),
            "total_loaded_chunks": len(self.loaded_chunks),
            "cache": cache_stats,
            "storage": storage_stats,
            "gpu_enabled": gpu_enabled
        }
    
    async def set_view_distance(self, distance: int) -> Dict[str, Any]:
        """Dynamically adjust view distance"""
        max_distance = 64 if getattr(self.processor, 'GPU_AVAILABLE', False) else 32
        self.viewer_state.view_distance = min(distance, max_distance)
        
        return {
            "view_distance": self.viewer_state.view_distance,
            "max_view_distance": max_distance,
            "gpu_enabled": getattr(self.processor, 'GPU_AVAILABLE', False)
        }
