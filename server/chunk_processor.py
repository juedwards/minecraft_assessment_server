import asyncio
import numpy as np
from typing import List, Dict, Tuple, Optional, Any
from collections import defaultdict
import time
import logging
from concurrent.futures import ThreadPoolExecutor
import os
import psutil

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
    
    def __init__(self, batch_size: int = 50, max_workers: int = None):
        # Increase batch size for GPU processing
        self.batch_size = batch_size if not GPU_AVAILABLE else batch_size * 5
        
        # Auto-detect optimal worker count
        if max_workers is None:
            max_workers = min(32, (os.cpu_count() or 1) * 2)
        
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.pending_requests: Dict[Tuple[int, int, int], List[asyncio.Future]] = defaultdict(list)
        self.processing_lock = asyncio.Lock()
        self.batch_queue: asyncio.Queue = asyncio.Queue()
        self.processing_task: Optional[asyncio.Task] = None
        
        # Memory management
        self.memory_info = psutil.virtual_memory()
        self.max_memory_percent = 0.7  # Use up to 70% of available RAM
        self.chunk_size = 16
        
        # GPU memory management
        if GPU_AVAILABLE:
            self._setup_gpu()
    
    def _setup_gpu(self):
        """Setup GPU for optimal performance"""
        if GPU_AVAILABLE:
            # Set memory pool for better performance
            mempool = cp.get_default_memory_pool()
            mempool.set_limit(size=4 * 1024**3)  # 4GB limit
            
            # Enable GPU persistent mode if available
            cp.cuda.runtime.deviceSetCacheConfig(cp.cuda.runtime.funcCache.PreferShared)
            
            logger.info(f"GPU device: {cp.cuda.runtime.getDevice()}")
            logger.info(f"GPU memory: {cp.cuda.runtime.memGetInfo()[1] / 1024**3:.2f} GB")
    
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
        """Request chunk processing (batched)"""
        future = asyncio.Future()
        
        async with self.processing_lock:
            key = (x, y, z)
            self.pending_requests[key].append(future)
            
            # Check if we should trigger a batch
            total_pending = sum(len(futures) for futures in self.pending_requests.values())
            if total_pending >= self.batch_size:
                await self._create_batch()
        
        return await future
    
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
        if GPU_AVAILABLE:
            return self._process_chunk_batch_gpu(coords)
        else:
            return self._process_chunk_batch_cpu(coords)
    
    def _process_chunk_batch_gpu(self, coords: List[Tuple[int, int, int]]) -> List[np.ndarray]:
        """Process chunks on GPU for massive performance boost"""
        results = []
        
        # Process chunks in larger batches on GPU
        batch_coords = cp.array(coords, dtype=cp.float32)
        
        # Allocate GPU memory for all chunks at once
        num_chunks = len(coords)
        chunk_data_gpu = cp.zeros((num_chunks, self.chunk_size, self.chunk_size, self.chunk_size), dtype=cp.uint8)
        
        # Vectorized terrain generation on GPU
        for idx, (x, y, z) in enumerate(coords):
            # Generate height map on GPU
            i_coords = cp.arange(self.chunk_size)
            j_coords = cp.arange(self.chunk_size)
            k_coords = cp.arange(self.chunk_size)
            
            # Create mesh grid
            ii, jj, kk = cp.meshgrid(i_coords, j_coords, k_coords, indexing='ij')
            
            # Calculate world coordinates
            world_x = x * self.chunk_size + ii
            world_y = y * self.chunk_size + jj
            world_z = z * self.chunk_size + kk
            
            # Complex terrain generation using GPU
            height_map = (
                cp.sin(world_x * 0.01) * 32 +
                cp.cos(world_z * 0.01) * 32 +
                cp.sin(world_x * 0.05) * 8 +
                cp.cos(world_z * 0.05) * 8 +
                64
            )
            
            # Generate terrain layers
            chunk_gpu = cp.zeros_like(world_y, dtype=cp.uint8)
            
            # Bedrock layer
            chunk_gpu[world_y < 5] = 7
            
            # Stone layer
            stone_mask = (world_y >= 5) & (world_y < height_map - 5)
            chunk_gpu[stone_mask] = 1
            
            # Dirt layer
            dirt_mask = (world_y >= height_map - 5) & (world_y < height_map)
            chunk_gpu[dirt_mask] = 2
            
            # Grass layer
            grass_mask = (world_y >= height_map) & (world_y < height_map + 1)
            chunk_gpu[grass_mask] = 3
            
            # Add some ore veins
            ore_noise = cp.random.random(chunk_gpu.shape) < 0.01
            ore_mask = stone_mask & ore_noise
            chunk_gpu[ore_mask] = 4  # Iron ore
            
            chunk_data_gpu[idx] = chunk_gpu
            
            # Transfer back to CPU
            results.append(cp.asnumpy(chunk_gpu))
        
        # Clear GPU memory
        mempool = cp.get_default_memory_pool()
        mempool.free_all_blocks()
        
        return results
    
    def _process_chunk_batch_cpu(self, coords: List[Tuple[int, int, int]]) -> List[np.ndarray]:
        """Process chunks on CPU with optimized memory usage"""
        results = []
        
        # Check available memory
        available_memory = psutil.virtual_memory().available
        chunk_memory = self.chunk_size ** 3 * np.dtype(np.uint8).itemsize
        max_chunks_in_memory = int((available_memory * self.max_memory_percent) / chunk_memory)
        
        logger.debug(f"Processing {len(coords)} chunks, max in memory: {max_chunks_in_memory}")
        
        # Process in batches that fit in memory
        for i in range(0, len(coords), max_chunks_in_memory):
            batch = coords[i:i + max_chunks_in_memory]
            
            # Pre-allocate arrays for batch
            batch_size = len(batch)
            chunk_batch = np.zeros((batch_size, self.chunk_size, self.chunk_size, self.chunk_size), dtype=np.uint8)
            
            # Vectorized operations for entire batch
            for idx, (x, y, z) in enumerate(batch):
                chunk_batch[idx] = self._generate_optimized_chunk_cpu(x, y, z)
            
            results.extend(chunk_batch)
        
        return results
    
    def _generate_optimized_chunk_cpu(self, x: int, y: int, z: int) -> np.ndarray:
        """Generate chunk data on CPU with vectorized operations"""
        # Pre-allocate array
        chunk = np.zeros((self.chunk_size, self.chunk_size, self.chunk_size), dtype=np.uint8)
        
        # Create coordinate grids
        i_coords = np.arange(self.chunk_size)
        j_coords = np.arange(self.chunk_size)
        k_coords = np.arange(self.chunk_size)
        
        ii, jj, kk = np.meshgrid(i_coords, j_coords, k_coords, indexing='ij')
        
        # Calculate world coordinates
        world_x = x * self.chunk_size + ii
        world_y = y * self.chunk_size + jj
        world_z = z * self.chunk_size + kk
        
        # Vectorized height map calculation
        height_map = (
            np.sin(world_x * 0.01, dtype=np.float32) * 32 +
            np.cos(world_z * 0.01, dtype=np.float32) * 32 +
            np.sin(world_x * 0.05, dtype=np.float32) * 8 +
            np.cos(world_z * 0.05, dtype=np.float32) * 8 +
            64
        ).astype(np.float32)
        
        # Vectorized terrain generation
        # Bedrock
        chunk[world_y < 5] = 7
        
        # Stone
        stone_mask = (world_y >= 5) & (world_y < height_map - 5)
        chunk[stone_mask] = 1
        
        # Dirt
        dirt_mask = (world_y >= height_map - 5) & (world_y < height_map)
        chunk[dirt_mask] = 2
        
        # Grass
        grass_mask = (world_y >= height_map) & (world_y < height_map + 1)
        chunk[grass_mask] = 3
        
        return chunk
    
    def _generate_optimized_chunk(self, x: int, y: int, z: int) -> np.ndarray:
        """Generate or load chunk data efficiently"""
        if GPU_AVAILABLE:
            # Process single chunk on GPU
            result = self._process_chunk_batch_gpu([(x, y, z)])[0]
            return result
        else:
            return self._generate_optimized_chunk_cpu(x, y, z)
