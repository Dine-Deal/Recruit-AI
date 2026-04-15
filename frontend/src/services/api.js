/**
 * services/api.js — All backend API calls.
 */
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30 * 1000, // 30s is plenty — calls now return immediately (job pattern)
})

/**
 * Start the screening pipeline.
 * Returns immediately with { job_id, status: "pending" }.
 * Poll getJobStatus(job_id) until status === "done" | "error".
 * @param {FormData} formData
 * @returns {Promise<{ job_id: string, status: string }>}
export async function runPipeline(formData) {
  const res = await api.post('/run-pipeline', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 10 * 60 * 1000, // 10 mins: Waking a Render instance and uploading files can exceed 30s
  })
  return res.data
}

/**
 * Poll for job result.
 * @param {string} jobId
 * @returns {Promise<{ job_id, status, result?, error? }>}
 */
export async function getJobStatus(jobId) {
  const res = await api.get(`/job-status/${jobId}`)
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
