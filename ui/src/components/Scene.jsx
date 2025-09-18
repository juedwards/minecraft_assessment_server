import React, { useRef, useEffect } from 'react'
import { createScene, getScene } from '../lib/scene'

export default function Scene() {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { scene, camera, renderer, controls } = createScene({ container })

    // Basic animation loop
    let mounted = true
    function animate() {
      if (!mounted) return
      requestAnimationFrame(animate)
      try { controls.update() } catch (e) {}
      try { renderer.render(scene, camera) } catch (e) {}
    }
    animate()

    // Cleanup
    return () => {
      mounted = false
      try { if (renderer && renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement) } catch (e) {}
    }
  }, [])

  return (
    <div className="scene-container" ref={containerRef}></div>
  )
}
