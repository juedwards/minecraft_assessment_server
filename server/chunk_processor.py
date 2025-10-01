import asyncio
import numpy as np
from typing import List, Dict, Tuple, Optional, Any, Set
from collections import defaultdict
import time
import logging
from concurrent.futures import ThreadPoolExecutor
import os
import psutil
import json
import pickle
import gzip
from pathlib import Path

# Set up logger first
logger = logging.getLogger(__name__)

# Try to import GPU acceleration libraries
try:
    import cupy as cp
    GPU_AVAILABLE = True
    logger.info("GPU acceleration available via CuPy")
except ImportError:
    cp = None
    GPU_AVAILABLE = False
    logger.info("GPU acceleration not available, using CPU")


class ChunkProcessor:
    """Async chunk processor with GPU acceleration and optimized memory usage"""
    
    def __init__(self, batch_size: int = 50, max_workers: int = None, world_name: str = "default"):
        # GPU availability for this instance
        self.gpu_available = GPU_AVAILABLE
        
        # Increase batch size for better performance
        self.batch_size = batch_size if not self.gpu_available else batch_size * 20
        
        # Auto-detect optimal worker count
        if max_workers is None:
            max_workers = min(32, (os.cpu_count() or 1) * 2)
        
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.pending_requests: Dict[Tuple[int, int, int], List[asyncio.Future]] = defaultdict(list)
        self.processing_lock = asyncio.Lock()
        self.batch_queue: asyncio.Queue = asyncio.Queue()
        self.processing_task: Optional[asyncio.Task] = None
        
        # Memory management - optimize for massive worlds
        self.memory_info = psutil.virtual_memory()
        self.max_memory_percent = 0.90  # Use up to 90% of available RAM
        self.chunk_size = 16
        
        # Persistent chunk storage for detailed maps
        self.chunk_cache: Dict[Tuple[int, int, int], np.ndarray] = {}
        self.chunk_metadata: Dict[Tuple[int, int, int], Dict[str, Any]] = {}
        
        # Disk persistence for unlimited world size
        self.world_name = world_name
        self.world_path = Path(f"worlds/{world_name}")
        self.world_path.mkdir(parents=True, exist_ok=True)
        self.chunks_on_disk: Set[Tuple[int, int, int]] = set()
        self._load_world_index()
        
        # Memory management with disk swapping
        self.max_memory_chunks = int((self.memory_info.total * self.max_memory_percent) / (self.chunk_size ** 3 * 4))
        self.chunk_access_time: Dict[Tuple[int, int, int], float] = {}
        
        # Enhanced terrain generation parameters
        self.biome_scale = 0.001  # Large scale biomes
        self.detail_octaves = 5  # More terrain detail
        self.resource_density = {
            'coal': 0.05,
            'iron': 0.03,
            'gold': 0.01,
            'diamond': 0.005,
            'emerald': 0.002,
            'redstone': 0.02,
            'lapis': 0.015
        }
        
        # GPU memory management
        if self.gpu_available:
            self._setup_gpu()

    def _setup_gpu(self):
        """Setup GPU for optimal performance (robust / optional features)."""
        if not self.gpu_available:
            return
        try:
            # Memory pool limit (ignore if fails) - push GPU harder
            try:
                mempool = cp.get_default_memory_pool()
                mempool.set_limit(size=8 * 1024**3)  # 8GB limit for more chunks
            except Exception as e:
                logger.debug(f"Skipping memory pool tuning: {e}")
            # Optional cache config
            try:
                rt = cp.cuda.runtime
                if (hasattr(rt, "deviceSetCacheConfig") and hasattr(rt, "funcCache") and
                        hasattr(rt.funcCache, "PreferShared")):
                    try:
                        rt.deviceSetCacheConfig(rt.funcCache.PreferShared)
                        logger.debug("Set GPU cache config to PreferShared")
                    except Exception as e:
                        logger.debug(f"deviceSetCacheConfig failed: {e}")
                else:
                    logger.debug("deviceSetCacheConfig not supported in this CuPy runtime")
            except Exception as e:
                logger.debug(f"Runtime cache config access failed: {e}")
            # Device info (best-effort)
            try:
                rt = cp.cuda.runtime
                device_id = rt.getDevice() if hasattr(rt, "getDevice") else "?"
                if hasattr(rt, "memGetInfo"):
                    free_b, total_b = rt.memGetInfo()
                    logger.info(f"GPU device {device_id}, memory {total_b / 1024**3:.2f} GB")
            except Exception as e:
                logger.debug(f"Skipping GPU info query: {e}")
        except Exception as e:
            logger.warning(f"GPU setup failed, falling back to CPU: {e}")
            # Mark GPU as unavailable for this instance
            self.gpu_available = False

    def _load_world_index(self):
        """Load the index of chunks stored on disk"""
        index_file = self.world_path / "chunk_index.json"
        if index_file.exists():
            with open(index_file, 'r') as f:
                data = json.load(f)
                self.chunks_on_disk = set(tuple(coord) for coord in data['chunks'])
                logger.info(f"Loaded world with {len(self.chunks_on_disk)} chunks on disk")

    def _save_world_index(self):
        """Save the index of chunks stored on disk"""
        index_file = self.world_path / "chunk_index.json"
        with open(index_file, 'w') as f:
            json.dump({
                'chunks': list(self.chunks_on_disk),
                'world_name': self.world_name,
                'chunk_size': self.chunk_size
            }, f)

    def _save_chunk_to_disk(self, key: Tuple[int, int, int], chunk: np.ndarray):
        """Save chunk to disk with compression"""
        x, y, z = key
        chunk_file = self.world_path / f"chunk_{x}_{y}_{z}.npz"
        with gzip.open(chunk_file, 'wb') as f:
            np.savez_compressed(f, chunk=chunk, metadata=self.chunk_metadata.get(key, {}))
        self.chunks_on_disk.add(key)

    def _load_chunk_from_disk(self, key: Tuple[int, int, int]) -> Optional[np.ndarray]:
        """Load chunk from disk"""
        x, y, z = key
        chunk_file = self.world_path / f"chunk_{x}_{y}_{z}.npz"
        if chunk_file.exists():
            try:
                with gzip.open(chunk_file, 'rb') as f:
                    data = np.load(f, allow_pickle=True)
                    chunk = data['chunk']
                    if 'metadata' in data:
                        self.chunk_metadata[key] = data['metadata'].item()
                    return chunk
            except Exception as e:
                logger.error(f"Failed to load chunk {key} from disk: {e}")
        return None

    async def start(self):
        """Start the batch processor"""
        if self.processing_task is None:
            self.processing_task = asyncio.create_task(self._process_batches())
    
    async def stop(self):
        """Stop the batch processor"""
        if self.processing_task:
            self.processing_task.cancel()
            await asyncio.gather(self.processing_task, return_exceptions=True)
            self.processing_task = None
        self.executor.shutdown(wait=True)
    
    async def process_chunk(self, x: int, y: int, z: int) -> np.ndarray:
        """Request chunk processing with persistent caching and disk storage"""
        key = (x, y, z)
        
        # Update access time
        self.chunk_access_time[key] = time.time()
        
        # Check memory cache first
        if key in self.chunk_cache:
            return self.chunk_cache[key]
        
        # Check disk cache
        if key in self.chunks_on_disk:
            chunk = await asyncio.get_event_loop().run_in_executor(
                self.executor, self._load_chunk_from_disk, key
            )
            if chunk is not None:
                self._cache_chunk(key, chunk)
                return chunk
        
        future = asyncio.Future()
        
        async with self.processing_lock:
            self.pending_requests[key].append(future)
            
            # Check if we should trigger a batch
            total_pending = sum(len(futures) for futures in self.pending_requests.values())
            if total_pending >= self.batch_size:
                await self._create_batch()
        
        result = await future
        
        # Cache the result for persistent storage
        self._cache_chunk(key, result)
        
        return result
    
    async def _create_batch(self):
        """Create a batch of chunks to process"""
        batch = []
        
        for coord, futures in list(self.pending_requests.items()):
            if futures:
                batch.append((coord, futures))
                if len(batch) >= self.batch_size:
                    break
        
        # Remove batched items
        for coord, _ in batch:
            del self.pending_requests[coord]
        
        if batch:
            await self.batch_queue.put(batch)
    
    async def _process_batches(self):
        """Process batches of chunks"""
        while True:
            try:
                batch = await self.batch_queue.get()
                start_time = time.time()
                
                # Process batch in parallel
                coords = [coord for coord, _ in batch]
                
                # Run CPU-intensive processing in thread pool
                loop = asyncio.get_event_loop()
                results = await loop.run_in_executor(
                    self.executor,
                    self._process_chunk_batch,
                    coords
                )
                
                # Deliver results
                for i, (coord, futures) in enumerate(batch):
                    result = results[i]
                    for future in futures:
                        if not future.done():
                            future.set_result(result)
                
                process_time = time.time() - start_time
                logger.debug(f"Processed batch of {len(batch)} chunks in {process_time:.3f}s")
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing batch: {e}")
                # Set error on all futures
                for _, futures in batch:
                    for future in futures:
                        if not future.done():
                            future.set_exception(e)
    
    def _process_chunk_batch(self, coords: List[Tuple[int, int, int]]) -> List[np.ndarray]:
        """Process multiple chunks in parallel with GPU acceleration"""
        if self.gpu_available:
            try:
                return self._process_chunk_batch_gpu(coords)
            except Exception as e:
                logger.warning(f"GPU batch processing failed, falling back to CPU: {e}")
        return self._process_chunk_batch_cpu(coords)
    
    def _process_chunk_batch_gpu(self, coords: List[Tuple[int, int, int]]) -> List[np.ndarray]:
        """Process chunks on GPU for massive performance boost"""
        results = []
        
        num_chunks = len(coords)
        chunk_data_gpu = cp.zeros((num_chunks, self.chunk_size, self.chunk_size, self.chunk_size), dtype=cp.uint8)
        
        for idx, (x, y, z) in enumerate(coords):
            # Create coordinate grids on GPU
            i_coords = cp.arange(self.chunk_size)
            j_coords = cp.arange(self.chunk_size)
            k_coords = cp.arange(self.chunk_size)
            ii, jj, kk = cp.meshgrid(i_coords, j_coords, k_coords, indexing='ij')
            
            world_x = x * self.chunk_size + ii
            world_y = y * self.chunk_size + jj
            world_z = z * self.chunk_size + kk
            
            # Multi-octave noise for terrain
            height_map = cp.zeros_like(world_x, dtype=cp.float32)
            amplitude = 64.0
            frequency = 0.01
            
            for octave in range(self.detail_octaves):
                height_map += (
                    cp.sin(world_x * frequency) * amplitude +
                    cp.cos(world_z * frequency) * amplitude +
                    cp.sin((world_x + world_z) * frequency * 0.5) * amplitude * 0.5
                )
                amplitude *= 0.5
                frequency *= 2.0
            
            height_map += 64
            
            # Biome variation
            biome_noise = cp.sin(world_x * self.biome_scale) * cp.cos(world_z * self.biome_scale)
            height_map += biome_noise * 16
            
            # Generate terrain
            chunk_gpu = cp.zeros_like(world_y, dtype=cp.uint8)
            chunk_gpu[world_y < 1] = 7  # Bedrock
            
            stone_mask = (world_y >= 1) & (world_y < height_map - 5)
            chunk_gpu[stone_mask] = 1
            
            dirt_mask = (world_y >= height_map - 5) & (world_y < height_map)
            chunk_gpu[dirt_mask] = 2
            
            grass_mask = (world_y >= height_map) & (world_y < height_map + 1)
            chunk_gpu[grass_mask] = 3
            
            # Generate all ore types
            if cp.any(stone_mask):
                # Coal
                coal_mask = (world_y > 5) & (world_y < 100) & stone_mask & (cp.random.random(chunk_gpu.shape) < self.resource_density['coal'])
                chunk_gpu[coal_mask] = 16
                
                # Iron
                iron_mask = (world_y > 5) & (world_y < 64) & stone_mask & (cp.random.random(chunk_gpu.shape) < self.resource_density['iron'])
                chunk_gpu[iron_mask] = 15
                
                # Gold
                gold_mask = (world_y > 5) & (world_y < 32) & stone_mask & (cp.random.random(chunk_gpu.shape) < self.resource_density['gold'])
                chunk_gpu[gold_mask] = 14
                
                # Diamond
                diamond_mask = (world_y > 1) & (world_y < 16) & stone_mask & (cp.random.random(chunk_gpu.shape) < self.resource_density['diamond'])
                chunk_gpu[diamond_mask] = 56
            
            # Caves
            cave_noise1 = cp.sin(world_x * 0.1) * cp.cos(world_y * 0.1) * cp.sin(world_z * 0.1)
            cave_noise2 = cp.cos(world_x * 0.08) * cp.sin(world_y * 0.08) * cp.cos(world_z * 0.08)
            cave_mask = (cp.abs(cave_noise1 + cave_noise2) < 0.1) & (world_y > 5) & (world_y < height_map - 5)
            chunk_gpu[cave_mask] = 0
            
            chunk_data_gpu[idx] = chunk_gpu
            results.append(cp.asnumpy(chunk_gpu))
        
        # Free GPU memory
        try:
            cp.get_default_memory_pool().free_all_blocks()
        except Exception:
            pass
        
        return results
    
    def _process_chunk_batch_cpu(self, coords: List[Tuple[int, int, int]]) -> List[np.ndarray]:
        """Process chunks on CPU with optimized memory usage"""
        results = []
        available_memory = psutil.virtual_memory().available
        chunk_memory = self.chunk_size ** 3 * np.dtype(np.uint8).itemsize
        max_chunks_in_memory = int((available_memory * self.max_memory_percent) / chunk_memory)
        logger.debug(f"Processing {len(coords)} chunks, max in memory: {max_chunks_in_memory}")
        for i in range(0, len(coords), max_chunks_in_memory):
            batch = coords[i:i + max_chunks_in_memory]
            batch_size = len(batch)
            chunk_batch = np.zeros((batch_size, self.chunk_size, self.chunk_size, self.chunk_size), dtype=np.uint8)
            for idx, (x, y, z) in enumerate(batch):
                chunk_batch[idx] = self._generate_optimized_chunk_cpu(x, y, z)
            results.extend(chunk_batch)
        return results
    
    def _generate_optimized_chunk_cpu(self, x: int, y: int, z: int) -> np.ndarray:
        """Generate chunk data with enhanced terrain and resources"""
        chunk = np.zeros((self.chunk_size, self.chunk_size, self.chunk_size), dtype=np.uint8)
        
        # Create coordinate grids
        i_coords = np.arange(self.chunk_size)
        j_coords = np.arange(self.chunk_size)
        k_coords = np.arange(self.chunk_size)
        ii, jj, kk = np.meshgrid(i_coords, j_coords, k_coords, indexing='ij')
        
        # World coordinates
        world_x = x * self.chunk_size + ii
        world_y = y * self.chunk_size + jj
        world_z = z * self.chunk_size + kk
        
        # Multi-octave noise for realistic terrain
        height_map = np.zeros_like(world_x, dtype=np.float32)
        amplitude = 64.0
        frequency = 0.01
        
        for octave in range(self.detail_octaves):
            height_map += (
                np.sin(world_x * frequency) * amplitude +
                np.cos(world_z * frequency) * amplitude +
                np.sin((world_x + world_z) * frequency * 0.5) * amplitude * 0.5
            )
            amplitude *= 0.5
            frequency *= 2.0
        
        height_map += 64  # Base height
        
        # Biome variation
        biome_noise = np.sin(world_x * self.biome_scale) * np.cos(world_z * self.biome_scale)
        height_map += biome_noise * 16
        
        # Generate terrain layers
        chunk[world_y < 1] = 7  # Bedrock
        
        # Deep stone layer
        stone_mask = (world_y >= 1) & (world_y < height_map - 5)
        chunk[stone_mask] = 1
        
        # Dirt layer
        dirt_mask = (world_y >= height_map - 5) & (world_y < height_map)
        chunk[dirt_mask] = 2
        
        # Grass/sand on top based on biome
        grass_mask = (world_y >= height_map) & (world_y < height_map + 1)
        chunk[grass_mask] = 3
        
        # Generate ores with realistic distribution
        if stone_mask.any():
            # Coal - most common, higher levels
            coal_height = (world_y > 5) & (world_y < 100) & stone_mask
            coal_noise = np.random.random(chunk.shape) < self.resource_density['coal']
            chunk[coal_height & coal_noise] = 16  # Coal ore
            
            # Iron - common, mid levels
            iron_height = (world_y > 5) & (world_y < 64) & stone_mask
            iron_noise = np.random.random(chunk.shape) < self.resource_density['iron']
            chunk[iron_height & iron_noise] = 15  # Iron ore
            
            # Gold - rare, low levels
            gold_height = (world_y > 5) & (world_y < 32) & stone_mask
            gold_noise = np.random.random(chunk.shape) < self.resource_density['gold']
            chunk[gold_height & gold_noise] = 14  # Gold ore
            
            # Diamond - very rare, deep levels
            diamond_height = (world_y > 1) & (world_y < 16) & stone_mask
            diamond_noise = np.random.random(chunk.shape) < self.resource_density['diamond']
            chunk[diamond_height & diamond_noise] = 56  # Diamond ore
            
            # Redstone - deep levels
            redstone_height = (world_y > 1) & (world_y < 16) & stone_mask
            redstone_noise = np.random.random(chunk.shape) < self.resource_density['redstone']
            chunk[redstone_height & redstone_noise] = 73  # Redstone ore
            
            # Lapis - mid levels
            lapis_height = (world_y > 10) & (world_y < 40) & stone_mask
            lapis_noise = np.random.random(chunk.shape) < self.resource_density['lapis']
            chunk[lapis_height & lapis_noise] = 21  # Lapis ore
        
        # Add caves (3D noise for realistic cave systems)
        cave_noise1 = np.sin(world_x * 0.1) * np.cos(world_y * 0.1) * np.sin(world_z * 0.1)
        cave_noise2 = np.cos(world_x * 0.08) * np.sin(world_y * 0.08) * np.cos(world_z * 0.08)
        cave_mask = (np.abs(cave_noise1 + cave_noise2) < 0.1) & (world_y > 5) & (world_y < height_map - 5)
        chunk[cave_mask] = 0  # Air in caves
        
        # Store metadata
        self.chunk_metadata[(x, y, z)] = {
            'generated_at': time.time(),
            'biome': 'plains' if biome_noise.mean() > 0 else 'desert',
            'has_ores': bool(chunk[chunk > 10].any())
        }
        
        return chunk
    
    def _cache_chunk(self, key: Tuple[int, int, int], chunk: np.ndarray):
        """Cache chunk with automatic disk swapping for unlimited world size"""
        # Check memory limit
        if len(self.chunk_cache) >= self.max_memory_chunks:
            # Find oldest accessed chunks to swap to disk
            sorted_chunks = sorted(self.chunk_access_time.items(), key=lambda x: x[1])
            chunks_to_swap = sorted_chunks[:len(sorted_chunks) // 4]  # Swap 25% of oldest chunks
            
            for chunk_key, _ in chunks_to_swap:
                if chunk_key in self.chunk_cache:
                    # Save to disk before removing from memory
                    self._save_chunk_to_disk(chunk_key, self.chunk_cache[chunk_key])
                    del self.chunk_cache[chunk_key]
                    del self.chunk_access_time[chunk_key]
            
            self._save_world_index()
            logger.info(f"Swapped {len(chunks_to_swap)} chunks to disk, memory cache: {len(self.chunk_cache)}")
        
        # Store chunk in memory
        self.chunk_cache[key] = chunk.copy()
        
        # Save to disk periodically for persistence
        if len(self.chunk_cache) % 50 == 0:
            self._save_chunk_to_disk(key, chunk)
            self._save_world_index()

    def get_world_stats(self) -> Dict[str, Any]:
        """Get comprehensive statistics about the stored world"""
        memory_chunks = len(self.chunk_cache)
        disk_chunks = len(self.chunks_on_disk)
        total_chunks = memory_chunks + disk_chunks
        
        memory_bytes = memory_chunks * (self.chunk_size ** 3)
        memory_mb = memory_bytes / (1024 * 1024)
        memory_gb = memory_mb / 1024
        
        # Calculate world bounds from both memory and disk
        all_coords = list(self.chunk_cache.keys()) + list(self.chunks_on_disk)
        
        if all_coords:
            min_x = min(coord[0] for coord in all_coords)
            max_x = max(coord[0] for coord in all_coords)
            min_y = min(coord[1] for coord in all_coords)
            max_y = max(coord[1] for coord in all_coords)
            min_z = min(coord[2] for coord in all_coords)
            max_z = max(coord[2] for coord in all_coords)
            
            world_size_x = (max_x - min_x + 1) * self.chunk_size
            world_size_y = (max_y - min_y + 1) * self.chunk_size
            world_size_z = (max_z - min_z + 1) * self.chunk_size
        else:
            min_x = max_x = min_y = max_y = min_z = max_z = 0
            world_size_x = world_size_y = world_size_z = 0
        
        return {
            'chunk_count': total_chunks,
            'memory_chunks': memory_chunks,
            'disk_chunks': disk_chunks,
            'memory_mb': memory_mb,
            'memory_gb': memory_gb,
            'world_bounds': {
                'min': (min_x, min_y, min_z),
                'max': (max_x, max_y, max_z)
            },
            'world_size_blocks': (world_size_x, world_size_y, world_size_z),
            'chunk_size': self.chunk_size,
            'world_name': self.world_name,
            'gpu_enabled': self.gpu_available
        }

    async def pregenerate_area(self, center_x: int, center_z: int, radius_chunks: int):
        """Pregenerate chunks in a radius for faster loading"""
        tasks = []
        for dx in range(-radius_chunks, radius_chunks + 1):
            for dz in range(-radius_chunks, radius_chunks + 1):
                for dy in range(-4, 12):  # Y levels from -64 to 192
                    if dx * dx + dz * dz <= radius_chunks * radius_chunks:
                        tasks.append(self.process_chunk(center_x + dx, dy, center_z + dz))
        
        # Process in batches to avoid overwhelming the system
        batch_size = 100
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i:i + batch_size]
            await asyncio.gather(*batch)
            logger.info(f"Pregenerated {min(i + batch_size, len(tasks))}/{len(tasks)} chunks")

    async def save_all_chunks(self):
        """Save all chunks in memory to disk"""
        for key, chunk in self.chunk_cache.items():
            self._save_chunk_to_disk(key, chunk)
        self._save_world_index()
        logger.info(f"Saved {len(self.chunk_cache)} chunks to disk")
