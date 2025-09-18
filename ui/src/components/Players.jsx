import React, { useEffect, useState } from 'react'
import * as playersLib from '../lib/players'

export default function Players() {
  const [players, setPlayers] = useState([])

  useEffect(() => {
    function refresh() {
      const arr = []
      for (const [id, p] of playersLib.players.entries()) {
        arr.push({ id, name: p.name, color: p.color, pos: (p.targetPos ? `${Math.round(p.targetPos.x)}, ${Math.round(p.targetPos.y)}, ${Math.round(p.targetPos.z)}` : '-') })
      }
      setPlayers(arr)
    }

    playersLib.onPlayersChanged(refresh)
    refresh()
    return () => { /* cleanup if playersLib supports unsubscribe later */ }
  }, [])

  return (
    <div>
      {players.length === 0 ? <div style={{color:'#999'}}>No players connected</div> : players.map(p => (
        <div key={p.id} className="player-item" style={{padding:'6px'}}>
          <div style={{display:'flex', alignItems:'center'}}>
            <div style={{width:12, height:12, backgroundColor:p.color, marginRight:8}}></div>
            <div style={{color:'#fff'}}>{p.name} <small style={{color:'#999', marginLeft:6}}>{p.pos}</small></div>
          </div>
          <button onClick={() => { playersLib.centerGridOnPlayer && playersLib.centerGridOnPlayer(p.id) }}>Center</button>
        </div>
      ))}
    </div>
  )
}
