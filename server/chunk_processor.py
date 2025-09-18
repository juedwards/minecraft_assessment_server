import asyncio
import numpy as np
from typing import List, Dict, Tuple, Optional, Any
from collections import defaultdict
import time
import logging
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)


class ChunkProcessor:
    """Async chunk processor with batching and parallel processing"""
    
    def __init__(self, batch_size: int = 10, max_workers: int = 4):
        self.batch_size = batch_size
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.pending_requests: Dict[Tuple[int, int, int], List[asyncio.Future]] = defaultdict(list)
        self.processing_lock = asyncio.Lock()
        self.batch_queue: asyncio.Queue = asyncio.Queue()
        self.processing_task: Optional[asyncio.Task] = None
    
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
        """Process multiple chunks in parallel (CPU-bound operation)"""
        results = []
        
        for x, y, z in coords:
            # Optimize chunk data generation/processing
            chunk_data = self._generate_optimized_chunk(x, y, z)
            results.append(chunk_data)
        
        return results
    
    def _generate_optimized_chunk(self, x: int, y: int, z: int) -> np.ndarray:
        """Generate or load chunk data efficiently"""
        # Use numpy for efficient array operations
        # This is a placeholder - replace with actual chunk generation/loading
        chunk_size = 16
        
        # Pre-allocate array
        chunk = np.zeros((chunk_size, chunk_size, chunk_size), dtype=np.uint8)
        
        # Vectorized operations for chunk generation
        # Example: simple terrain generation
        height_map = np.sin(x * 0.1) * 8 + np.cos(z * 0.1) * 8 + 64
        
        for i in range(chunk_size):
            for j in range(chunk_size):
                world_y = y * chunk_size + j
                if world_y < height_map:
                    chunk[i, j, :] = 1  # Stone
                elif world_y < height_map + 3:
                    chunk[i, j, :] = 2  # Dirt
                elif world_y == int(height_map + 3):
                    chunk[i, j, :] = 3  # Grass
        
        return chunk
