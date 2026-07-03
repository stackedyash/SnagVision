/**
 * SiteSetup.jsx  —  Layout Setup Module (v3)
 *
 * Changes from v2:
 *  1. Gate: no project selected → redirect screen, not blank page
 *  2. Floor dropdown (generated from project.floors count)
 *  3. Project selector REMOVED from this page (comes from global sidebar)
 *  4. PDF + image upload support
 *  5. Zoom (scroll wheel) + Pan (drag) on floor plan canvas
 *  6. Hotspot size 4px, glow, white border, hover scale
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSite } from '../hooks/SiteContext'
import toast from 'react-hot-toast'

// ─── Hotspot visual constants ──────────────────────────────────────────────────
const DOT_R       = 4      // base radius in CSS px (at zoom=1)
const HIT_PAD     = 12     // click hit area padding around dot

// ─── Room options ──────────────────────────────────────────────────────────────
const ROOM_OPTIONS = [
  'Bathroom','Living Room','Bedroom','Kitchen','Bar Room',
  'Dining Room','Corridor','Lobby','Reception','Staircase',
  'Balcony','Store Room','Utility Room','Gym','Conference Room',
]

// ─── Helper: convert PDF page → data URL via canvas ───────────────────────────
async function pdfToDataUrl(file) {
  // Dynamic import so PDF.js is only loaded when needed
  const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const ab  = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise
  const page = await pdf.getPage(1)
  const vp   = page.getViewport({ scale: 2 })
  const c    = document.createElement('canvas')
  c.width    = vp.width
  c.height   = vp.height
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
  return c.toDataURL('image/png')
}

export default function SiteSetup() {
  const navigate = useNavigate()
  const {
    ready, selectedProject,
    floorPlanUrl, hotspots,
    uploadFloorPlan, addHotspot, removeHotspot, saveLayout,
  } = useSite()

  // ── Selected floor ────────────────────────────────────────────────────────
  const [selectedFloor, setSelectedFloor] = useState(1)

  // ── Canvas transform (zoom + pan) ────────────────────────────────────────
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const isPanning   = useRef(false)
  const panStart    = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  const wrapRef     = useRef(null)    // outer clipping div
  const innerRef    = useRef(null)    // transformed div

  // ── Misc UI state ─────────────────────────────────────────────────────────
  const [saved,       setSaved]       = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [contextMenu, setContextMenu] = useState(null)   // {x,y,hotspotId,roomId,roomName}
  const [pendingDot,  setPendingDot]  = useState(null)   // {x_pct,y_pct} waiting for modal
  const [roomForm,    setRoomForm]    = useState({ roomId: '', roomName: '' })
  const [hoveredId,   setHoveredId]   = useState(null)
  const fileRef = useRef(null)

  // Reset transform when floor plan changes
  useEffect(() => { setTransform({ x: 0, y: 0, scale: 1 }) }, [floorPlanUrl])

  // Reset floor to 1 when project changes
  useEffect(() => { setSelectedFloor(1); setSaved(false) }, [selectedProject?.id])

  // Close context menu on outside click
  useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // ── Floor plan upload (image OR pdf) ─────────────────────────────────────
  const handleFloorUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return
    setUploading(true)
    try {
      if (file.type === 'application/pdf') {
        const dataUrl = await pdfToDataUrl(file)
        const res  = await fetch(dataUrl)
        const blob = await res.blob()
        const pngFile = new File([blob], file.name.replace('.pdf', '.png'), { type: 'image/png' })
        await uploadFloorPlan(pngFile)
        toast.success('PDF converted & uploaded')
      } else {
        await uploadFloorPlan(file)
        toast.success('Floor plan uploaded')
      }
      setSaved(false)
    } catch (err) {
      toast.error('Upload failed — ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast.error('Only images or PDF allowed'); return
    }
    // Reuse same handler via synthetic event-like object
    await handleFloorUpload({ target: { files: [file], value: '' } })
  }

  // ── Zoom: mouse wheel ─────────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const wrap = wrapRef.current; if (!wrap) return
    const rect  = wrap.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const delta  = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setTransform(prev => {
      const newScale = Math.min(8, Math.max(0.3, prev.scale * delta))
      // Keep the point under cursor stationary
      const newX = mouseX - (mouseX - prev.x) * (newScale / prev.scale)
      const newY = mouseY - (mouseY - prev.y) * (newScale / prev.scale)
      return { scale: newScale, x: newX, y: newY }
    })
  }, [])

  useEffect(() => {
    const el = wrapRef.current; if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Pan: mouse drag ───────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    // Only pan if not clicking a hotspot
    if (e.target.dataset.hotspot) return
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y }
    e.currentTarget.style.cursor = 'grabbing'
  }
  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.mx
    const dy = e.clientY - panStart.current.my
    setTransform(prev => ({ ...prev, x: panStart.current.tx + dx, y: panStart.current.ty + dy }))
  }, [])
  const handleMouseUp = (e) => {
    isPanning.current = false
    if (wrapRef.current) wrapRef.current.style.cursor = floorPlanUrl ? 'crosshair' : 'default'
  }

  // ── Map click → open room metadata modal ─────────────────────────────────
  const handleMapClick = useCallback((e) => {
    if (!floorPlanUrl || isPanning.current) return
    if (e.target.dataset.hotspot) return   // clicked a hotspot, not map
    if (contextMenu) { setContextMenu(null); return }

    const inner = innerRef.current; if (!inner) return
    const rect  = inner.getBoundingClientRect()
    const x_pct = (e.clientX - rect.left) / rect.width
    const y_pct = (e.clientY - rect.top)  / rect.height

    // Hit-test: ignore if clicking near existing dot
    const hit = hotspots.some(h => {
      const px = h.x_pct * rect.width
      const py = h.y_pct * rect.height
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      return Math.hypot(px - cx, py - cy) <= (DOT_R * transform.scale) + HIT_PAD
    })
    if (hit) return

    setPendingDot({ x_pct, y_pct })
    setRoomForm({ roomId: '', roomName: '' })
  }, [floorPlanUrl, hotspots, contextMenu, transform.scale])

  // ── Save dot after modal ──────────────────────────────────────────────────
  const handleRoomModalSave = () => {
    if (!roomForm.roomId.trim())   { toast.error('Room ID is required');   return }
    if (!roomForm.roomName.trim()) { toast.error('Room Name is required'); return }
    addHotspot(pendingDot.x_pct, pendingDot.y_pct, {
      roomId:   roomForm.roomId.trim(),
      roomName: roomForm.roomName.trim(),
      floor:    selectedFloor,
    })
    setPendingDot(null)
    setSaved(false)
    toast.success(`${roomForm.roomId} pinned on Floor ${selectedFloor}`)
  }

  // ── Right-click dot → context menu ───────────────────────────────────────
  const handleDotContextMenu = (e, hs) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, hotspotId: hs.id,
      roomId: hs.roomId, roomName: hs.roomName })
  }

  // ── Save layout ───────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!floorPlanUrl) { toast.error('Upload a floor plan first'); return }
    const ok = saveLayout()
    if (ok) { setSaved(true); toast.success(`Floor plan saved — ${hotspots.length} hotspot${hotspots.length !== 1 ? 's' : ''}`) }
  }

  const floorOptions = Array.from({ length: selectedProject?.floors || 1 }, (_, i) => i + 1)
  const filteredHotspots = hotspots.filter(h => !h.floor || h.floor === selectedFloor)

  if (!ready) return <Loader />

  // ── GATE: no project selected ─────────────────────────────────────────────
  if (!selectedProject) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '70vh', gap: 16 }}>
        <div style={{ fontSize: 52 }}>🏗️</div>
        <h2 style={{ fontFamily: 'Space Grotesk', fontSize: 20, fontWeight: 700,
          color: 'var(--text-1)' }}>No active project</h2>
        <p style={{ fontSize: 14, color: 'var(--text-3)', textAlign: 'center', maxWidth: 360 }}>
          Select a project from the <strong>Active Project</strong> dropdown in the sidebar
          before setting up a floor plan.
        </p>
        <button className="btn-primary" onClick={() => navigate('/projects')}>
          Go to Projects →
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 28px', maxWidth: 1300 }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 20, fontWeight: 700,
              color: 'var(--text-1)' }}>Layout Setup</h1>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)',
              background: 'var(--accent-light)', border: '1px solid var(--accent-mid)',
              borderRadius: 20, padding: '3px 10px' }}>
              {selectedProject.name}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
            Choose a floor · Upload floor plan · Click to map hotspots · Save
          </p>
        </div>

        {/* Floor selector + save */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
              whiteSpace: 'nowrap' }}>Floor:</label>
            <select
              value={selectedFloor}
              onChange={e => { setSelectedFloor(Number(e.target.value)); setSaved(false) }}
              style={{ width: 'auto', minWidth: 110, fontWeight: 600 }}
            >
              {floorOptions.map(f => (
                <option key={f} value={f}>Floor {f}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary" onClick={handleSave}
            disabled={!floorPlanUrl} style={{ opacity: !floorPlanUrl ? 0.4 : 1 }}>
            💾 Save Floor Plan
          </button>
          {saved && (
            <button className="btn-ghost" onClick={() => navigate('/site-capture')}
              style={{ borderColor: '#22C55E', color: '#2E7D32' }}>
              → Capture Mode
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14, alignItems: 'start' }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Upload card */}
          <div className="card">
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 13,
              marginBottom: 12, color: 'var(--text-1)' }}>
              Floor plan — Floor {selectedFloor}
            </div>
            <button
              className={floorPlanUrl ? 'btn-ghost' : 'btn-primary'}
              onClick={() => fileRef.current?.click()}
              style={{ width: '100%', fontSize: 12 }}
              disabled={uploading}
            >
              {uploading ? '⏳ Processing…' : floorPlanUrl ? '🔄 Replace' : '📁 Upload'}
            </button>
            <input ref={fileRef} type="file" accept="image/*,.pdf"
              style={{ display: 'none' }} onClick={e => e.target.value = ''}
              onChange={handleFloorUpload} />
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 6, textAlign: 'center' }}>
              PNG · JPG · PDF supported
            </div>
          </div>

          {/* Zoom controls */}
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 12,
              marginBottom: 10, color: 'var(--text-2)' }}>Zoom & Pan</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <button className="btn-ghost" style={{ flex: 1, padding: '6px', fontSize: 14 }}
                onClick={() => setTransform(t => ({ ...t, scale: Math.max(0.3, t.scale / 1.25) }))}>−</button>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600,
                color: 'var(--text-1)' }}>{Math.round(transform.scale * 100)}%</span>
              <button className="btn-ghost" style={{ flex: 1, padding: '6px', fontSize: 14 }}
                onClick={() => setTransform(t => ({ ...t, scale: Math.min(8, t.scale * 1.25) }))}>+</button>
            </div>
            <button className="btn-ghost" style={{ width: '100%', fontSize: 11 }}
              onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}>
              ↺ Reset view
            </button>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 8, lineHeight: 1.7 }}>
              🖱 Scroll to zoom<br />
              🖐 Drag to pan
            </div>
          </div>

          {/* Hotspot list */}
          <div className="card" style={{ padding: '14px' }}>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 13,
              marginBottom: 10, color: 'var(--text-1)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Hotspots</span>
              <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-3)' }}>
                {filteredHotspots.length} on F{selectedFloor}
              </span>
            </div>
            {filteredHotspots.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-4)', textAlign: 'center', padding: '12px 0' }}>
                Click the floor plan to add hotspots
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5,
                maxHeight: 300, overflowY: 'auto' }}>
                {filteredHotspots.map(h => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', background: 'var(--bg-hover)', borderRadius: 8,
                    border: '1px solid var(--border-dim)' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: '#F5C842', boxShadow: '0 0 5px #F5C842' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.roomId}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{h.roomName}</div>
                    </div>
                    <button onClick={() => { removeHotspot(h.id); setSaved(false) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-4)', fontSize: 13, padding: '2px', lineHeight: 1 }}
                      title="Delete">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick instructions */}
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.9 }}>
              <div>1. Choose a floor from the dropdown</div>
              <div>2. Upload or drag-and-drop the floor plan</div>
              <div>3. Scroll to zoom · drag to pan</div>
              <div>4. Click map → enter Room ID &amp; Name</div>
              <div>5. Right-click a dot to delete</div>
              <div>6. Hit <strong style={{ color: 'var(--accent, #D32F2F)' }}>Save Floor Plan</strong></div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Zoomable / pannable floor plan ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>

          {/* Toolbar */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#F5C842',
                boxShadow: '0 0 6px #F5C842aa' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                Floor {selectedFloor} · Mapping mode
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
              {Math.round(transform.scale * 100)}% zoom
            </span>
          </div>

          {/* Canvas viewport */}
          <div
            ref={wrapRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            style={{
              position: 'relative',
              overflow: 'hidden',
              minHeight: 520,
              background: '#f4f3f0',
              backgroundImage: 'radial-gradient(#d0cfc9 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              cursor: floorPlanUrl ? 'crosshair' : 'default',
              userSelect: 'none',
            }}
          >
            {floorPlanUrl ? (
              /* Transformed inner container */
              <div
                ref={innerRef}
                onClick={handleMapClick}
                style={{
                  position: 'absolute',
                  top: 0, left: 0,
                  transformOrigin: '0 0',
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  willChange: 'transform',
                  lineHeight: 0,
                }}
              >
                <img
                  src={floorPlanUrl}
                  alt="floor plan"
                  draggable={false}
                  style={{ display: 'block', maxWidth: '100%', userSelect: 'none', pointerEvents: 'none' }}
                />

                {/* Hotspot dots — percentage-based, scale-invariant */}
                {filteredHotspots.map(h => (
                  <HotspotDot
                    key={h.id}
                    hotspot={h}
                    hovered={hoveredId === h.id}
                    zoom={transform.scale}
                    onContextMenu={handleDotContextMenu}
                    onHover={setHoveredId}
                  />
                ))}
              </div>
            ) : (
              /* Empty state */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', minHeight: 520, gap: 14, color: 'var(--text-3)' }}>
                <div style={{ fontSize: 56 }}>🗺️</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)' }}>
                  No floor plan uploaded
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                  Upload an image or PDF using the sidebar, or drag &amp; drop here
                </div>
                <button className="btn-primary" style={{ marginTop: 4 }}
                  onClick={() => fileRef.current?.click()}>
                  Upload floor plan
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Room metadata modal ── */}
      {pendingDot && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, backdropFilter: 'blur(3px)' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 26, width: 380, maxWidth: '94vw',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
              width: 60, height: 2,
              background: 'linear-gradient(90deg, transparent, #D32F2F, transparent)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: '#FFEBEE',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
                📍
              </div>
              <div>
                <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 15,
                  color: 'var(--text-1)' }}>New hotspot — Floor {selectedFloor}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                  ({(pendingDot.x_pct * 100).toFixed(1)}%, {(pendingDot.y_pct * 100).toFixed(1)}%)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">Room ID <span style={{ color: '#D32F2F' }}>*</span></label>
                <input
                  autoFocus
                  placeholder="e.g. R-101, B-202"
                  value={roomForm.roomId}
                  onChange={e => setRoomForm(f => ({ ...f, roomId: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleRoomModalSave(); if (e.key === 'Escape') setPendingDot(null) }}
                  style={{ marginTop: 5 }}
                />
              </div>
              <div>
                <label className="label">Room Name <span style={{ color: '#D32F2F' }}>*</span></label>
                <select
                  value={roomForm.roomName}
                  onChange={e => setRoomForm(f => ({ ...f, roomName: e.target.value }))}
                  style={{ marginTop: 5 }}
                >
                  <option value="">Select room type…</option>
                  {ROOM_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="__other__">Other…</option>
                </select>
                {roomForm.roomName === '__other__' && (
                  <input autoFocus placeholder="Enter room name" style={{ marginTop: 8 }}
                    onChange={e => setRoomForm(f => ({ ...f, roomName: e.target.value }))} />
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <button className="btn-primary" onClick={handleRoomModalSave} style={{ flex: 1 }}>
                Pin hotspot
              </button>
              <button className="btn-ghost" onClick={() => setPendingDot(null)} style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Right-click context menu ── */}
      {contextMenu && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', left: contextMenu.x, top: contextMenu.y,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 9, padding: 4, zIndex: 1100,
          boxShadow: '0 6px 20px rgba(0,0,0,0.12)', minWidth: 160,
        }}>
          <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid var(--border-dim)',
            marginBottom: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>
              {contextMenu.roomId}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{contextMenu.roomName}</div>
          </div>
          <button onClick={async () => {
            await removeHotspot(contextMenu.hotspotId)
            setContextMenu(null); setSaved(false)
          }} style={{ display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', background: 'none', border: 'none', padding: '8px 12px',
            cursor: 'pointer', color: '#C62828', fontSize: 13, borderRadius: 6 }}
            onMouseOver={e => e.currentTarget.style.background = '#FFEBEE'}
            onMouseOut={e => e.currentTarget.style.background = 'none'}>
            🗑️ Delete hotspot
          </button>
        </div>
      )}
    </div>
  )
}

// ─── HotspotDot ──────────────────────────────────────────────────────────────
// Percentage-positioned, zoom-aware, hover scale animation
export function HotspotDot({ hotspot, captured, active, hovered, zoom = 1,
  interactive = true, onContextMenu, onClick, onHover }) {

  // Keep visual size stable across zoom levels
  const visualR  = DOT_R / (zoom || 1)   // px in the transformed space = constant screen size
  const visualD  = visualR * 2
  const hitArea  = (DOT_R + HIT_PAD) / (zoom || 1) * 2

  const color = active   ? '#6366F1'
              : captured ? '#22C55E'
              : '#F5C842'
  const border = active   ? '#4338CA'
               : captured ? '#15803D'
               : '#B8920A'

  return (
    <div
      data-hotspot="1"
      title={[hotspot.roomId, hotspot.roomName].filter(Boolean).join(' — ')}
      onClick={e => { e.stopPropagation(); onClick?.(hotspot) }}
      onContextMenu={e => onContextMenu?.(e, hotspot)}
      onMouseEnter={() => onHover?.(hotspot.id)}
      onMouseLeave={() => onHover?.(null)}
      style={{
        position:  'absolute',
        left:      `${hotspot.x_pct * 100}%`,
        top:       `${hotspot.y_pct * 100}%`,
        width:      hitArea,
        height:     hitArea,
        transform: 'translate(-50%, -50%)',
        cursor:    interactive ? 'pointer' : 'default',
        zIndex:    20,
        display:   'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Visual dot — stays ~8px on screen regardless of zoom */}
      <div style={{
        width:        visualD,
        height:       visualD,
        borderRadius: '50%',
        background:   color,
        border:       `${1.5 / (zoom || 1)}px solid #FFFFFF`,
        boxShadow:    hovered || active
          ? `0 0 0 ${3 / (zoom||1)}px ${color}55, 0 0 ${8 / (zoom||1)}px ${color}`
          : `0 0 0 ${1.5 / (zoom||1)}px ${color}44, 0 0 ${4 / (zoom||1)}px ${color}88`,
        transition:   'transform .15s ease, box-shadow .15s ease',
        transform:    hovered || active ? 'scale(1.5)' : 'scale(1)',
        pointerEvents: 'none',   // hit area handled by parent
      }} />

      {/* Captured checkmark */}
      {captured && !active && (
        <div style={{ position: 'absolute', top: 0, right: 0,
          width: 6 / (zoom||1), height: 6 / (zoom||1), borderRadius: '50%',
          background: '#22C55E', border: `1px solid #fff`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 4 / (zoom||1), color: '#fff', fontWeight: 900 }}>✓</div>
      )}
    </div>
  )
}

// ─── Loader ──────────────────────────────────────────────────────────────────
function Loader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 400, flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 26, height: 26, border: '2.5px solid #E5E5E5',
        borderTopColor: '#D32F2F', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <div style={{ fontSize: 13, color: '#666' }}>Loading…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
