/**
 * services/api.js — All backend API calls.
 */
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({ baseURL: BASE_URL })

/**
 * Run the screening pipeline.
 * @param {FormData} formData - Built by Home.jsx with all pipeline inputs
 * @returns {Promise<PipelineResponse>}
 */
export async function runPipeline(formData) {
  const res = await api.post('/run-pipeline', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

/**
 * Get a download URL for a resume file.
 */
export function getResumeDownloadUrl(filename) {
  return `${BASE_URL}/download-resume/${encodeURIComponent(filename)}`
}

/**
 * Health check
 */
export async function checkHealth() {
  const res = await api.get('/health')
  return res.data
}
