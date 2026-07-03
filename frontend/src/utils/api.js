import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('siteiq_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export default api

// ─── Auth ────────────────────────────────────────────────────────────────────
export const login = (email, password) =>
  api.post('/auth/login', { email, password })
export const register = (data) => api.post('/auth/register', data)

// ─── Projects ────────────────────────────────────────────────────────────────
export const getProjects = () => api.get('/projects')
export const createProject = (data) => api.post('/projects', data)
export const getDashboard = (id) => api.get(`/projects/${id}/dashboard`)
export const getFloors = (id) => api.get(`/projects/${id}/floors`)
export const addFloor = (id, data) => api.post(`/projects/${id}/floors`, data)
export const addUnit = (floorId, data) => api.post(`/projects/floors/${floorId}/units`, data)
export const getUnits = (floorId) => api.get(`/projects/floors/${floorId}/units`)
export const addRoom = (unitId, data) => api.post(`/projects/units/${unitId}/rooms`, data)
export const getRooms = (unitId) => api.get(`/projects/units/${unitId}/rooms`)

// ─── Uploads & Analysis ─────────────────────────────────────────────────────
export const uploadMedia = (formData) =>
  api.post('/uploads', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const getRoomUploads = (roomId) => api.get(`/uploads/room/${roomId}`)
export const getRoomAnalysis = (roomId) => api.get(`/analysis/room/${roomId}/latest`)
export const getChangeDetection = (roomId) => api.get(`/analysis/room/${roomId}/change-detection`)
