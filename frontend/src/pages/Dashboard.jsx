import { useEffect, useState } from 'react'
import { getDashboard } from '../utils/api'
import { useProject } from '../hooks/useProject'
import { ProgressBar, StatusBadge, MetricCard, Spinner, Empty, SectionTitle } from '../components/UI'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

const weeklyMock = [
  { week: 'W1', pct: 30 }, { week: 'W2', pct: 45 },
  { week: 'W3', pct: 60 }, { week: 'W4', pct: 75 },
  { week: 'W5', pct: 83 }, { week: 'Now', pct: null },
]

// ── Custom light-theme tooltip ─────────────────────────────────────────────
const LightTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E5E5E5',
      borderRadius: 8, padding: '8px 14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ fontSize: 11, color: '#666666', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111111' }}>
        {payload[0].value}%
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { selectedProject } = useProject()
  const [dashboard, setDashboard] = useState(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!selectedProject) return
    setLoading(true)
    getDashboard(selectedProject.id)
      .then(({ data }) => setDashboard(data))
      .finally(() => setLoading(false))
  }, [selectedProject])

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>
  if (!dashboard) return (
    <div style={{ padding: 32 }}>
      <Empty message="No project data" hint="Create a project to get started → Projects" />
    </div>
  )

  const overall      = Math.round(dashboard.overall_pct || 0)
  const floorChart   = dashboard.floors?.map(f => ({
    name: `F${f.floor_number}`,
    pct:  Math.round(f.pct),
  })) || []

  return (
    <div style={{ padding: '28px', maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex',
        alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 2 }}>{dashboard.project_name}</h1>
          <p style={{ fontSize: 13, color: '#666666' }}>Executive overview</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: '#E8F5E9', border: '1px solid #A5D6A7',
          borderRadius: 20, padding: '5px 12px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#2E7D32' }} />
          <span style={{ fontSize: 12, color: '#2E7D32', fontWeight: 500 }}>Live</span>
        </div>
      </div>

      {/* Metric row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        <MetricCard label="Overall progress" value={`${overall}%`}
          sub="Across all floors" accent />
        <MetricCard label="Active delays" value={dashboard.active_delays || 0}
          sub="Rooms stalled or rework"
          subColor={(dashboard.active_delays || 0) > 0 ? '#C62828' : '#2E7D32'} icon="⚠" />
        <MetricCard label="Total floors" value={dashboard.floors?.length || 0}
          sub="Monitored" icon="⊟" />
        <MetricCard label="Est. completion" value={dashboard.est_completion || 'TBD'}
          sub="Based on current pace" icon="◷" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

        {/* Line chart */}
        <div className="card">
          <SectionTitle>Weekly progress trend</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={weeklyMock}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#666666' }}
                axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#666666' }}
                axisLine={false} tickLine={false} />
              <Tooltip content={<LightTooltip />} />
              <Line
                type="monotone" dataKey="pct"
                stroke="#D32F2F" strokeWidth={2.5}
                dot={{ r: 4, fill: '#D32F2F', stroke: '#FFFFFF', strokeWidth: 2 }}
                connectNulls={false}
                activeDot={{ r: 6, fill: '#D32F2F' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Bar chart */}
        <div className="card">
          <SectionTitle>Floor-wise progress</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={floorChart} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#666666' }}
                axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#666666' }}
                axisLine={false} tickLine={false} />
              <Tooltip content={<LightTooltip />} />
              <Bar dataKey="pct" fill="#111111" radius={[4, 4, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Floor table */}
      <div className="card">
        <SectionTitle>Floor breakdown</SectionTitle>
        <table className="data-table">
          <thead>
            <tr>
              {['Floor', 'Units', 'Progress', 'Status'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dashboard.floors?.map(f => (
              <tr key={f.floor_id}>
                <td style={{ fontWeight: 600 }}>Floor {f.floor_number}</td>
                <td style={{ color: '#666666' }}>{f.units?.length || 0} units</td>
                <td style={{ minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ProgressBar pct={f.pct} height={5} className="" />
                    <span style={{ fontSize: 12, color: '#444444',
                      fontWeight: 600, minWidth: 32 }}>
                      {Math.round(f.pct)}%
                    </span>
                  </div>
                </td>
                <td><StatusBadge pct={f.pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
