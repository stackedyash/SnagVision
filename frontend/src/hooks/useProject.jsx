import { createContext, useContext, useState, useEffect } from 'react'
import { getProjects } from '../utils/api'

const ProjectCtx = createContext(null)

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getProjects().then(({ data }) => {
      setProjects(data)

      // localStorage se last selected project restore karo
      const savedId = localStorage.getItem('siteiq_project_id')
      const found = data.find(p => p.id === savedId)

      // saved mila toh woh, warna pehla project
      setSelectedProject(found || data[0] || null)
    }).finally(() => setLoading(false))
  }, [])

  const switchProject = (projectId) => {
    const p = projects.find(p => p.id === projectId)
    if (!p) return
    setSelectedProject(p)
    localStorage.setItem('siteiq_project_id', projectId)
  }

  return (
    <ProjectCtx.Provider value={{ projects, selectedProject, switchProject, loading }}>
      {children}
    </ProjectCtx.Provider>
  )
}

export const useProject = () => useContext(ProjectCtx)