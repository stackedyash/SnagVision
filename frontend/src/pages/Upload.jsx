import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { getProjects, getFloors, getUnits, getRooms, uploadMedia } from '../utils/api'
import { useAuth } from '../hooks/useAuth'

export default function Upload() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [floors, setFloors] = useState([])
  const [units, setUnits] = useState([])
  const [rooms, setRooms] = useState([])
  const [form, setForm] = useState({ projectId: '', floorId: '', unitId: '', roomId: '', notes: '' })
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])

  useEffect(() => {
    getProjects().then(({ data }) => { setProjects(data); if (data[0]) setForm(f => ({ ...f, projectId: data[0].id })) })
  }, [])
  useEffect(() => {
    if (!form.projectId) return
    getFloors(form.projectId).then(({ data }) => { setFloors(data); if (data[0]) setForm(f => ({ ...f, floorId: data[0].id })) })
  }, [form.projectId])
  useEffect(() => {
    if (!form.floorId) return
    getUnits(form.floorId).then(({ data }) => { setUnits(data); if (data[0]) setForm(f => ({ ...f, unitId: data[0].id })) })
  }, [form.floorId])
  useEffect(() => {
    if (!form.unitId) return
    getRooms(form.unitId).then(({ data }) => { setRooms(data); if (data[0]) setForm(f => ({ ...f, roomId: data[0].id })) })
  }, [form.unitId])

  const onDrop = useCallback((accepted) => setFiles(p => [...p, ...accepted]), [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [], 'video/*': [] }, multiple: true })

  const removeFile = (i) => setFiles(f => f.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (!form.roomId) { toast.error('Select a room'); return }
    if (!files.length) { toast.error('Add at least one photo'); return }
    setUploading(true)
    const res = []
    for (const file of files) {
      try {
        const fd = new FormData()
        fd.append('file', file); fd.append('room_id', form.roomId)
        fd.append('supervisor_id', user?.id || 'demo'); fd.append('notes', form.notes)
        const { data } = await uploadMedia(fd)
        res.push({ name: file.name, status: 'ok', id: data.id })
        toast.success(`${file.name} uploaded`)
      } catch {
        res.push({ name: file.name, status: 'error' })
        toast.error(`Failed: ${file.name}`)
      }
    }
    setResults(res); setFiles([]); setUploading(false)
  }

  return (
    <div style={{ padding: 28, maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontFamily: 'Space Grotesk', fontWeight: 700, marginBottom: 4 }}>Upload site media</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Photos and videos are analysed by Gemini 2.5 Flash automatically.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Metadata */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Site metadata</div>

          <div>
            <label className="label">Project</label>
            <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="label">Floor</label>
              <select value={form.floorId} onChange={e => setForm({ ...form, floorId: e.target.value })}>
                {floors.map(f => <option key={f.id} value={f.id}>Floor {f.floor_number}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Unit</label>
              <select value={form.unitId} onChange={e => setForm({ ...form, unitId: e.target.value })}>
                {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Room</label>
            <select value={form.roomId} onChange={e => setForm({ ...form, roomId: e.target.value })}>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Site notes</label>
            <textarea rows={3} style={{ resize: 'none' }} placeholder="What work was done? Any issues observed..."
              value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        {/* Upload */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Upload files</div>

          <div {...getRootProps()} className={`dropzone${isDragActive ? ' active' : ''}`}>
            <input {...getInputProps()} />
            <div style={{ fontSize: 28, marginBottom: 10 }}>📷</div>
            <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, color: 'var(--text-1)', marginBottom: 4 }}>
              {isDragActive ? 'Drop here...' : 'Drag photos, videos, 360° scans'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>JPG, PNG, MP4, MOV · Max 20 MB</div>
          </div>

          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--bg-hover)', borderRadius: 8, padding: '7px 10px' }}>
                  <span style={{ fontSize: 14 }}>🖼</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', marginRight: 6 }}>{(f.size/1024).toFixed(0)} KB</span>
                  <button onClick={() => removeFile(i)} style={{
                    background: 'none', border: 'none', color: 'var(--text-3)',
                    cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2,
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <button onClick={handleSubmit} className="btn-primary" disabled={uploading || !files.length} style={{ marginTop: 'auto' }}>
            {uploading ? 'Uploading...' : `Upload & Analyse${files.length ? ` (${files.length})` : ''}`}
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Upload results</div>
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 0', borderBottom: i < results.length-1 ? '1px solid var(--border-dim)' : 'none' }}>
              <span style={{ fontSize: 15 }}>{r.status === 'ok' ? '✅' : '❌'}</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>{r.name}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: r.status === 'ok' ? '#4ADE80' : '#F87171' }}>
                {r.status === 'ok' ? 'AI analysis queued' : 'Failed'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
