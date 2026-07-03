import { useState, useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import toast from 'react-hot-toast'
// ── SiteContext integration ── pull floor plan + hotspots from Site Capture
import { useSite } from '../hooks/SiteContext'

// ─── Constants ────────────────────────────────────────────────────────────────
const DOT_R      = 3   // tiny — matches SiteSetup markers
const MINIMAP_W  = 260
const MINIMAP_H  = 180
const DB_NAME    = 'siteiq_panorama'
const DB_VERSION = 1
const STORE_IMG  = 'images'        // IndexedDB store — blobs
const LS_KEY_HS  = 'siteiq_hs'    // localStorage — hotspot metadata
const LS_KEY_FP  = 'siteiq_fp_id' // localStorage — floor plan image key

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_IMG)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}
async function idbSet(key, blob) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMG, 'readwrite')
    tx.objectStore(STORE_IMG).put(blob, key)
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}
async function idbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_IMG, 'readonly').objectStore(STORE_IMG).get(key)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}
async function idbDel(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMG, 'readwrite')
    tx.objectStore(STORE_IMG).delete(key)
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

// ─── UID ─────────────────────────────────────────────────────────────────────
let _uid = Date.now()
const uid = () => String(++_uid)

// ─── Confirmation dialog ──────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: 28, width: 380, maxWidth: '90vw' }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>🗑️</div>
        <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 15,
          color: 'var(--text-1)', marginBottom: 8 }}>Delete hotspot?</div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 24, lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onConfirm} style={{
            flex: 1, background: '#EF4444', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
          }}>Yes, delete permanently</button>
          <button onClick={onCancel} className="btn-ghost" style={{ flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PanoramaViewer() {
  // ── Pull Site Capture data from global context ─────────────────────────────
  const {
    floorPlanUrl:  siteFpUrl,      // floor plan image URL from SiteCapture page
    hotspots:      siteHotspots,   // [{id, x_pct, y_pct}] from SiteCapture page
    capturedImages: siteCaptured,  // {hotspot_id: objectURL} from SiteCapture page
    ready:         siteReady,
  } = useSite()

  // Three.js refs
  const mountRef    = useRef(null)
  const rendererRef = useRef(null)
  const sceneRef    = useRef(null)
  const cameraRef   = useRef(null)
  const meshRef     = useRef(null)
  const frameRef    = useRef(null)
  const isDragging  = useRef(false)
  const lastMouse   = useRef({ x: 0, y: 0 })
  const yaw         = useRef(0)
  const pitch       = useRef(0)

  // Mini-map refs
  const mmCanvasRef = useRef(null)
  const mmImgRef    = useRef(null)

  // State
  const [hotspots,    setHotspots]    = useState([])
  const [activeId,    setActiveId]    = useState(null)
  const [panoSrc,     setPanoSrc]     = useState(null)
  const [floorLoaded, setFloorLoaded] = useState(false)
  const [adminMode,   setAdminMode]   = useState(true)
  const [hint,        setHint]        = useState(true)
  const [modal,       setModal]       = useState(null)      // { x, y }
  const [modalFile,   setModalFile]   = useState(null)
  const [modalLabel,  setModalLabel]  = useState('')
  const [confirmDel,  setConfirmDel]  = useState(null)      // hotspot to delete
  const [dotTooltip,  setDotTooltip]  = useState(null)      // { id, screenX, screenY }
  const [restoring,   setRestoring]   = useState(true)
  // Mini-map zoom & resize state
  const [mmZoom,  setMmZoom]  = useState(1)          // canvas zoom level
  const [mmSize,  setMmSize]  = useState({ w: 260, h: 180 })  // panel size
  const mmResizing = useRef(false)
  const mmResizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 })

  const floorFileRef = useRef(null)
  const panoFileRef  = useRef(null)

  // ── RESTORE on mount ─────────────────────────────────────────────────────
  // Priority order:
  //  1. SiteCapture hotspots (from global SiteContext — capturedImages)
  //  2. PanoramaViewer's own manually pinned hotspots (own IndexedDB)
  //  3. Default panorama uploaded via "Load panorama" button
  useEffect(() => {
    if (!siteReady) return   // wait for SiteContext to finish its own restore

    async function restore() {
      try {
        // ── SOURCE A: SiteCapture hotspots ─────────────────────────────────
        // Convert {id, x_pct, y_pct} → mini-map canvas pixel coordinates
        const siteHsList = (siteHotspots || [])
          .filter(h => siteCaptured?.[h.id])   // only show captured ones
          .map(h => ({
            id:        h.id,
            // Convert percentages to minimap canvas pixel coordinates
            x: h.x_pct * MINIMAP_W,
            y: h.y_pct * MINIMAP_H,
            label:     `P${siteHotspots.indexOf(h) + 1}`,
            image_url: siteCaptured[h.id] || null,
            fromSite:  true,
          }))

        // ── SOURCE B: PanoramaViewer own hotspots (own localStorage) ───────
        const raw  = localStorage.getItem(LS_KEY_HS)
        const meta = raw ? JSON.parse(raw) : []
        const ownHsList = await Promise.all(meta.map(async h => {
          const blob = await idbGet(h.id).catch(() => null)
          return { ...h, image_url: blob ? URL.createObjectURL(blob) : null }
        }))

        // Merge: Site capture hotspots take priority, then own
        const merged = [...siteHsList, ...ownHsList.filter(h => !h.fromSite)]
        setHotspots(merged)

        // ── Floor plan: prefer SiteContext floor plan ───────────────────────
        if (siteFpUrl) {
          const img = new Image()
          img.onload = () => { mmImgRef.current = img; setFloorLoaded(true) }
          img.src = siteFpUrl
        } else {
          const fpBlob = await idbGet('__floorplan__').catch(() => null)
          if (fpBlob) {
            const img = new Image()
            img.onload = () => { mmImgRef.current = img; setFloorLoaded(true) }
            img.src = URL.createObjectURL(fpBlob)
          }
        }

        // ── Auto-load first captured hotspot (so viewer is never blank) ────
        const firstWithImage = merged.find(h => h.image_url)
        if (firstWithImage) {
          setActiveId(firstWithImage.id)
          setPanoSrc(firstWithImage.image_url)
          setHint(false)
        } else {
          // Fallback: default panorama from own "Load panorama" button
          const defBlob = await idbGet('__default_pano__').catch(() => null)
          if (defBlob) { setPanoSrc(URL.createObjectURL(defBlob)); setHint(false) }
        }
      } catch (e) {
        console.warn('[PanoramaViewer] restore error:', e)
      } finally {
        setRestoring(false)
      }
    }
    restore()
  }, [siteReady, siteHotspots, siteCaptured, siteFpUrl])

  // ── Persist hotspot metadata to localStorage ───────────────────────────────
  const persistMeta = useCallback((list) => {
    const meta = list.map(({ id, x, y, label }) => ({ id, x, y, label }))
    localStorage.setItem(LS_KEY_HS, JSON.stringify(meta))
  }, [])

  // ── Three.js init ──────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return
    const W = mount.clientWidth || 900
    const H = mount.clientHeight || 500
    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(75, W / H, 0.1, 1000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    renderer.setClearColor(0x0d0f14)
    mount.appendChild(renderer.domElement)
    sceneRef.current = scene; cameraRef.current = camera; rendererRef.current = renderer
    const geo = new THREE.SphereGeometry(500, 60, 40)
    // FIX: Use BackSide instead of scale(-1,1,1) - more reliable for inside-sphere viewing
    const mat  = new THREE.MeshBasicMaterial({ color: 0x1a1d26, side: THREE.BackSide })
    const mesh = new THREE.Mesh(geo, mat)
    scene.add(mesh)
    meshRef.current = mesh
    console.log('[PanoramaViewer] Three.js init complete, mesh ready')
    const animate = () => { frameRef.current = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
    })
    ro.observe(mount)
    return () => {
      ro.disconnect(); cancelAnimationFrame(frameRef.current)
      renderer.dispose(); if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [])

  // Load panorama texture - fully debugged
  const loadPanorama = useCallback((url) => {
    if (!url) return
    console.log('[PanoramaViewer] loadPanorama called with url:', url.slice(0, 60))

    const doLoad = (attempt = 1) => {
      if (!meshRef.current) {
        if (attempt > 20) { console.error('[PanoramaViewer] mesh never ready after 20 retries'); return }
        console.log('[PanoramaViewer] mesh not ready, retry', attempt)
        setTimeout(() => doLoad(attempt + 1), 150)
        return
      }
      console.log('[PanoramaViewer] starting TextureLoader.load, attempt', attempt)
      const loader = new THREE.TextureLoader()
      loader.load(
        url,
        (tex) => {
          console.log('[PanoramaViewer] texture loaded OK:', tex.image?.width, 'x', tex.image?.height)
          tex.needsUpdate = true
          const mat = meshRef.current.material
          // BackSide sphere — no need for special mapping, UV works perfectly
          mat.map = tex
          mat.color.set(0xffffff)
          mat.needsUpdate = true
          console.log('[PanoramaViewer] material updated, calling setHint(false)')
          setHint(false)
          toast.success('Panorama loaded!', { duration: 1500 })
        },
        (progress) => {
          if (progress.total > 0)
            console.log('[PanoramaViewer] loading:', Math.round(progress.loaded/progress.total*100) + '%')
        },
        (err) => {
          console.error('[PanoramaViewer] texture FAILED:', err)
          toast.error('Image load failed — check console')
        }
      )
    }
    doLoad()
  }, [])

  useEffect(() => {
    if (panoSrc) {
      console.log('[PanoramaViewer] panoSrc changed, calling loadPanorama')
      loadPanorama(panoSrc)
    }
  }, [panoSrc, loadPanorama])

  // ── Mouse drag ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = rendererRef.current?.domElement; if (!el) return
    const onDown = e => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY } }
    const onMove = e => {
      if (!isDragging.current) return
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }
      yaw.current   -= dx * 0.3; pitch.current -= dy * 0.3
      pitch.current  = Math.max(-85, Math.min(85, pitch.current))
      cameraRef.current.rotation.order = 'YXZ'
      cameraRef.current.rotation.y = THREE.MathUtils.degToRad(yaw.current)
      cameraRef.current.rotation.x = THREE.MathUtils.degToRad(pitch.current)
    }
    const onUp = () => { isDragging.current = false }
    const onTouchStart = e => { const t = e.touches[0]; isDragging.current = true; lastMouse.current = { x: t.clientX, y: t.clientY } }
    const onTouchMove  = e => { const t = e.touches[0]; onMove({ clientX: t.clientX, clientY: t.clientY }) }
    el.addEventListener('mousedown',  onDown);  el.addEventListener('mousemove',  onMove)
    el.addEventListener('mouseup',    onUp);    el.addEventListener('mouseleave', onUp)
    el.addEventListener('touchstart', onTouchStart); el.addEventListener('touchmove', onTouchMove); el.addEventListener('touchend', onUp)
    return () => {
      el.removeEventListener('mousedown',  onDown);  el.removeEventListener('mousemove',  onMove)
      el.removeEventListener('mouseup',    onUp);    el.removeEventListener('mouseleave', onUp)
      el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onUp)
    }
  }, [])

  // ── Draw mini-map ──────────────────────────────────────────────────────────
  const drawMiniMap = useCallback(() => {
    const canvas = mmCanvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H)
    ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H)
    if (mmImgRef.current) {
      ctx.globalAlpha = 0.75; ctx.drawImage(mmImgRef.current, 0, 0, MINIMAP_W, MINIMAP_H); ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = '#1a1d26'; ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H)
      ctx.fillStyle = '#2a2f40'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('Set up Site Capture to', MINIMAP_W / 2, MINIMAP_H / 2 - 8)
      ctx.fillText('auto-populate this map', MINIMAP_W / 2, MINIMAP_H / 2 + 8)
    }
    hotspots.forEach(h => {
      const isActive   = h.id === activeId
      const isCaptured = !!h.image_url
      // Color: indigo=active, green=captured(has 360 image), yellow=pending
      const color = isActive   ? '#6366F1'
                  : isCaptured ? '#22C55E'
                  : '#F5C842'

      // Minimal shadow only for active dot
      ctx.shadowColor = color
      ctx.shadowBlur  = isActive ? 6 : 0

      // Dot — no pulse ring, no label, clean minimal marker
      ctx.beginPath(); ctx.arc(h.x, h.y, DOT_R, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()

      // Thin white border only on active
      if (isActive) {
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1; ctx.stroke()
      }
      ctx.shadowBlur = 0
    })
  }, [hotspots, activeId])

  useEffect(() => { drawMiniMap() }, [drawMiniMap])

  // ── SMART DELETE with fallback ─────────────────────────────────────────────
  const doDelete = useCallback(async (hsId) => {
    setHotspots(prev => {
      const next = prev.filter(h => h.id !== hsId)
      persistMeta(next)

      // Smart fallback: if deleting active, switch to next available
      if (hsId === activeId) {
        const nextHs = next.find(h => h.image_url)
        if (nextHs) {
          setActiveId(nextHs.id)
          setPanoSrc(nextHs.image_url)
          toast(`Switched to "${nextHs.label}"`, { icon: '↩️' })
        } else {
          // No hotspots left — reset viewer to blank state
          setActiveId(null)
          setPanoSrc(null)
          setHint(true)
          if (meshRef.current) {
            meshRef.current.material.map = null
            meshRef.current.material.color.set(0x1a1d26)
            meshRef.current.material.needsUpdate = true
          }
          toast('All hotspots removed — viewer reset', { icon: '🔄' })
        }
      }
      return next
    })
    // Wipe from IndexedDB
    await idbDel(hsId).catch(() => {})
    setConfirmDel(null)
    setDotTooltip(null)
    toast.success('Hotspot deleted permanently')
  }, [activeId, persistMeta])

  // ── Mini-map click ─────────────────────────────────────────────────────────
  const handleMiniMapClick = useCallback((e) => {
    const canvas = mmCanvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const scaleX = MINIMAP_W / rect.width
    const scaleY = MINIMAP_H / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top)  * scaleY

    // Hit-test existing dot
    const hit = hotspots.find(h => Math.hypot(h.x - x, h.y - y) <= DOT_R + 6)
    if (hit) {
      if (adminMode && !hit.fromSite) {
        // Admin mode on OWN hotspots: show delete/view tooltip
        const dotScreenX = rect.left + (hit.x / scaleX)
        const dotScreenY = rect.top  + (hit.y / scaleY)
        setDotTooltip({ id: hit.id, label: hit.label, screenX: dotScreenX, screenY: dotScreenY })
      } else {
        // Navigate/view: works for Site Capture hotspots AND own hotspots
        if (hit.image_url) {
          setActiveId(hit.id)
          setPanoSrc(hit.image_url)
          setDotTooltip(null)
          toast.success(
            hit.fromSite
              ? `Loading ${hit.label} from Site Capture`
              : `Viewing: ${hit.label}`,
            { icon: '🔭', duration: 1500 }
          )
        } else {
          toast(`No 360° image linked to this point`, { icon: '⚠️' })
        }
        setDotTooltip(null)
      }
      return
    }

    setDotTooltip(null)
    if (adminMode) { setModal({ x, y }); setModalFile(null); setModalLabel('') }
  }, [hotspots, adminMode])

  // Close tooltip on outside click
  useEffect(() => {
    const handler = () => setDotTooltip(null)
    window.addEventListener('click', handler, true)
    return () => window.removeEventListener('click', handler, true)
  }, [])

  // ── Floor plan upload ──────────────────────────────────────────────────────
  const handleFloorUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return
    // Save to IndexedDB
    await idbSet('__floorplan__', file).catch(() => {})
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { mmImgRef.current = img; setFloorLoaded(true); drawMiniMap() }
    img.src = url
    toast.success('Floor plan saved permanently')
  }

  // ── Default panorama upload ────────────────────────────────────────────────
  const handleDefaultPano = async (e) => {
    const file = e.target.files[0]; if (!file) return
    console.log('[PanoramaViewer] pano selected:', file.name, file.type, file.size)
    const url = URL.createObjectURL(file)
    setPanoSrc(url)
    try { await idbSet('__default_pano__', file) } catch(err) { console.warn('idb save failed:', err) }
  }

  // ── Modal: pin new hotspot ─────────────────────────────────────────────────
  const handleModalSave = async () => {
    if (!modalFile && !panoSrc) { toast.error('Upload a 360° image for this hotspot'); return }
    const id  = uid()
    const lbl = modalLabel || `P${hotspots.length + 1}`
    let image_url = null

    if (modalFile) {
      // Save image blob to IndexedDB
      await idbSet(id, modalFile).catch(() => {})
      image_url = URL.createObjectURL(modalFile)
    } else {
      // Reuse current panorama — fetch blob from current object URL
      try {
        const res  = await fetch(panoSrc)
        const blob = await res.blob()
        await idbSet(id, blob)
        image_url = panoSrc
      } catch { image_url = panoSrc }
    }

    const hs = { id, x: modal.x, y: modal.y, label: lbl, image_url }
    setHotspots(prev => {
      const next = [...prev, hs]
      persistMeta(next)
      return next
    })
    setActiveId(id); setPanoSrc(image_url); setModal(null)
    toast.success(`Hotspot "${lbl}" pinned & saved`, { icon: '📍' })
  }

  // ── Activate a hotspot ────────────────────────────────────────────────────
  const activateHotspot = (hs) => {
    setActiveId(hs.id)
    if (hs.image_url) { setPanoSrc(hs.image_url); setHint(false) }
    else toast(`No panorama linked to "${hs.label}"`, { icon: '⚠️' })
    setDotTooltip(null)
  }

  return (
    <div style={{ padding: 28, maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: 'Space Grotesk', fontWeight: 700, marginBottom: 4 }}>360° Panorama Viewer</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
            Drag to look around · Click mini-map dots to navigate ·
            {adminMode ? ' Admin: click map to pin, click dot to delete' : ' Navigation mode'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Admin mode</span>
            <div onClick={() => { setAdminMode(v => !v); setDotTooltip(null) }} style={{
              width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
              background: adminMode ? 'var(--amber)' : 'var(--border)', position: 'relative', transition: 'background .2s',
            }}>
              <div style={{ position: 'absolute', top: 3, left: adminMode ? 18 : 3, width: 14, height: 14,
                borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
            </div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => panoFileRef.current?.click()}>
            🖼 Load panorama
          </button>
          <input ref={panoFileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onClick={e => { e.target.value = '' }}
            onChange={handleDefaultPano} />
        </div>
      </div>

      {/* ── Main viewer ── */}
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden',
        border: '1px solid var(--border)', background: '#0d0f14', height: 520 }}>

        <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: panoSrc ? 'grab' : 'default' }} />

        {/* Restoring overlay - shown while IndexedDB loads, THREE.js already inits behind it */}
        {restoring && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,15,20,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, border: '2.5px solid var(--border)',
              borderTopColor: 'var(--amber)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Restoring saved state…</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Hint overlay */}
        {hint && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(13,15,20,0.8)', pointerEvents: 'none' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>🔭</div>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: 18, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
              No panorama loaded
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
              Load a 360° image or pin a hotspot to begin
            </div>
            <button className="btn-primary" style={{ pointerEvents: 'all' }} onClick={() => panoFileRef.current?.click()}>
              Upload 360° image
            </button>
          </div>
        )}

        {/* Active badge */}
        {activeId && (() => {
          const hs = hotspots.find(h => h.id === activeId)
          return hs ? (
            <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(13,15,20,0.85)',
              border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', backdropFilter: 'blur(6px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{hs.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                {hs.fromSite ? 'From Site Capture' : `(${Math.round(hs.x)}, ${Math.round(hs.y)})`}
              </div>
            </div>
          ) : null
        })()}

        {/* ── Mini-map overlay — resizable + zoomable ── */}
        <div
          style={{
            position: 'absolute', bottom: 20, right: 20,
            width:  mmSize.w,
            height: 'auto',
            borderRadius: 12,
            overflow: 'visible',
            border: '1.5px solid rgba(255,255,255,0.15)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            userSelect: 'none',
            minWidth: 160, maxWidth: 520,
          }}
        >
          {/* ── Header: title + legend + zoom controls ── */}
          <div style={{
            background: 'rgba(13,15,20,0.94)',
            padding: '6px 10px',
            borderRadius: '10px 10px 0 0',
            display: 'flex', alignItems: 'center', gap: 6,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            {/* Title */}
            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.7)',
              letterSpacing: '.06em', flex: 1 }}>FLOOR PLAN</span>

            {/* Legend */}
            {[['#22C55E','Active'],['#F5C842','Saved']].map(([col,lbl]) => (
              <span key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 9, color: col }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%',
                  background: col, display: 'inline-block' }} />
                {lbl}
              </span>
            ))}

            {/* Zoom controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 1,
              background: 'rgba(255,255,255,0.08)', borderRadius: 6,
              padding: '1px 2px', marginLeft: 4 }}>
              <button
                title="Zoom out"
                onClick={() => setMmZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '2px 5px',
                  borderRadius: 4, transition: 'background .15s' }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >−</button>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)',
                minWidth: 28, textAlign: 'center' }}>
                {Math.round(mmZoom * 100)}%
              </span>
              <button
                title="Zoom in"
                onClick={() => setMmZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '2px 5px',
                  borderRadius: 4, transition: 'background .15s' }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >+</button>
              <button
                title="Reset zoom"
                onClick={() => setMmZoom(1)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                  cursor: 'pointer', fontSize: 9, lineHeight: 1, padding: '2px 5px',
                  borderRadius: 4 }}
              >↺</button>
            </div>
          </div>

          {/* ── Canvas wrapper with overflow+transform for zoom ── */}
          <div style={{
            overflow: 'hidden',
            background: '#0a0c10',
            lineHeight: 0,
            // height follows zoom so panel doesn't stretch infinitely
            height: mmSize.h * mmZoom,
            maxHeight: 420,
            position: 'relative',
          }}>
            <canvas
              ref={mmCanvasRef}
              width={MINIMAP_W}
              height={MINIMAP_H}
              onClick={handleMiniMapClick}
              style={{
                display: 'block',
                width:  mmSize.w,
                height: mmSize.h,
                cursor: adminMode ? 'crosshair' : 'pointer',
                transformOrigin: '0 0',
                transform: `scale(${mmZoom})`,
              }}
            />
          </div>

          {/* ── Footer: hint + upload button ── */}
          <div style={{
            background: 'rgba(13,15,20,0.94)',
            padding: '5px 10px',
            borderRadius: '0 0 10px 10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
              {adminMode ? 'Click to add · Dot to delete' : 'Click dot to navigate'}
            </span>
            <button onClick={() => floorFileRef.current?.click()}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 9, color: 'var(--amber)', fontWeight: 600 }}>
              {floorLoaded ? 'Change' : siteFpUrl ? '✓ Synced' : '↑ Upload'}
            </button>
            <input ref={floorFileRef} type="file" accept="image/*"
              style={{ display: 'none' }} onChange={handleFloorUpload} />
          </div>

          {/* ── Resize handle (bottom-left corner) ── */}
          <div
            title="Drag to resize"
            onMouseDown={e => {
              e.preventDefault()
              mmResizing.current = true
              mmResizeStart.current = { mx: e.clientX, my: e.clientY, w: mmSize.w, h: mmSize.h }
              const onMove = (ev) => {
                if (!mmResizing.current) return
                const dw = mmResizeStart.current.mx - ev.clientX   // drag left = wider
                const dh = mmResizeStart.current.my - ev.clientY   // drag up  = taller
                setMmSize({
                  w: Math.max(160, Math.min(520, mmResizeStart.current.w + dw)),
                  h: Math.max(120, Math.min(400, mmResizeStart.current.h + dh)),
                })
              }
              const onUp = () => { mmResizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
            style={{
              position: 'absolute', bottom: -1, left: -1,
              width: 16, height: 16,
              cursor: 'nwse-resize',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start',
              padding: 2,
            }}
          >
            {/* Visual grip dots */}
            <svg width="10" height="10" viewBox="0 0 10 10">
              {[[2,8],[5,8],[8,8],[5,5],[8,5],[8,2]].map(([x,y],i) => (
                <circle key={i} cx={x} cy={y} r="1.2" fill="rgba(255,255,255,0.35)" />
              ))}
            </svg>
          </div>

          {/* Dot tooltip */}
          {dotTooltip && (
            <div onClick={e => e.stopPropagation()} style={{
              position: 'fixed', left: dotTooltip.screenX - 70, top: dotTooltip.screenY - 70,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 14px', zIndex: 1500,
              boxShadow: '0 8px 24px rgba(0,0,0,0.7)', minWidth: 140,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
                📍 {dotTooltip.label}
              </div>
              <button onClick={() => {
                const hs = hotspots.find(h => h.id === dotTooltip.id)
                activateHotspot(hs)
              }} style={{ display: 'block', width: '100%', background: 'var(--bg-hover)',
                border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                cursor: 'pointer', fontSize: 12, color: 'var(--text-1)', marginBottom: 6 }}>
                🔭 View panorama
              </button>
              <button onClick={() => {
                const hs = hotspots.find(h => h.id === dotTooltip.id)
                setConfirmDel(hs); setDotTooltip(null)
              }} style={{ display: 'block', width: '100%', background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '6px 10px',
                cursor: 'pointer', fontSize: 12, color: '#F87171' }}>
                🗑️ Delete hotspot
              </button>
            </div>
          )}
        </div>

        {hotspots.length > 0 && (
          <div style={{ position: 'absolute', bottom: 20, left: 20, background: 'rgba(13,15,20,0.8)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: 'var(--text-2)' }}>
            📍 {hotspots.length} hotspot{hotspots.length !== 1 ? 's' : ''} · Auto-saved
          </div>
        )}
      </div>

      {/* ── Hotspot cards grid ── */}
      {hotspots.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            Panorama hotspots
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-3)', marginLeft: 8 }}>
              · All data saved in browser memory
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
            {hotspots.map(h => {
              const isActive = h.id === activeId
              return (
                <div key={h.id} style={{ position: 'relative' }}>
                  {/* Delete button (always visible on card) */}
                  <button onClick={e => { e.stopPropagation(); setConfirmDel(h) }} style={{
                    position: 'absolute', top: 8, right: 8, zIndex: 10,
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#F87171', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .15s',
                  }} title="Delete hotspot">🗑</button>

                  <div onClick={() => activateHotspot(h)} style={{
                    background: isActive ? 'var(--amber-glow)' : 'var(--bg-hover)',
                    border: `1px solid ${isActive ? 'var(--amber-dim)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all .15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        background: isActive ? '#22C55E' : '#EF4444',
                        boxShadow: isActive ? '0 0 8px #22C55E' : 'none' }} />
                      <span style={{ fontSize: 13, fontWeight: 600,
                        color: isActive ? 'var(--amber)' : 'var(--text-1)', paddingRight: 20 }}>
                        {h.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      ({Math.round(h.x)}, {Math.round(h.y)})
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2, color: h.image_url ? '#4ADE80' : 'var(--text-3)' }}>
                      {h.image_url ? '✓ Panorama saved' : '⚠ No panorama'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── New hotspot modal ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 28, width: 420, maxWidth: '95vw', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
              width: 80, height: 2, background: 'linear-gradient(90deg, transparent, var(--amber), transparent)' }} />
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17, marginBottom: 6 }}>📍 New hotspot</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>
              Position: ({Math.round(modal.x)}, {Math.round(modal.y)})
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="label">Label</label>
              <input maxLength={6} placeholder={`P${hotspots.length + 1}`}
                value={modalLabel} onChange={e => setModalLabel(e.target.value.toUpperCase())}
                style={{ marginTop: 4 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="label">360° image (saved permanently)</label>
              <input
                type="file"
                accept="image/*"
                key={modal ? modal.x + '_' + modal.y : 'closed'}
                onClick={e => { e.target.value = '' }}
                onChange={e => {
                  const f = e.target.files[0]
                  if (f) { console.log('[Modal] file selected:', f.name, f.size); setModalFile(f) }
                }}
                style={{ marginTop: 4, fontSize: 12, color: 'var(--text-2)', width: '100%',
                  background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }} />
              {modalFile && <div style={{ fontSize: 11, color: '#4ADE80', marginTop: 6 }}>✓ {modalFile.name}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.6 }}>
                Image will be saved in browser storage. If none uploaded, current panorama is used.
              </div>
            </div>
            {modalFile && (
              <div style={{ marginBottom: 16, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', height: 80 }}>
                <img src={URL.createObjectURL(modalFile)} alt="preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" onClick={handleModalSave} style={{ flex: 1 }}>Pin & save</button>
              <button className="btn-ghost" onClick={() => setModal(null)} style={{ flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete dialog ── */}
      {confirmDel && (
        <ConfirmDialog
          message={`This will permanently delete hotspot "${confirmDel.label}" and its linked 360° image from browser memory. This cannot be undone.`}
          onConfirm={() => doDelete(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}
