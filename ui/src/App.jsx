import React from 'react'
import Scene from './components/Scene'
import Players from './components/Players'

export default function App() {
  return (
    <div className="app-root">
      <div className="left-panel-react">
        <h3>Players</h3>
        <Players />
      </div>
      <div className="main-view">
        <Scene />
      </div>
    </div>
  )
}
