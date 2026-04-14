import React, { useState } from 'react'
import JDInput from '../components/JDInput'
import ResumeSourceInput from '../components/ResumeSourceInput'
import RunPipelineButton from '../components/RunPipelineButton'
import CandidateTable from '../components/CandidateTable'
import { runPipeline } from '../services/api'

const styles = {
  header: {
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    padding: '0 40px',
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  logo: {
    fontWeight: 700,
    fontSize: 17,
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
    background: 'var(--accent-light)',
    color: 'var(--accent)',
  },
  main: {
    maxWidth: 900,
    margin: '0 auto',
    padding: '40px 24px 80px',
  },
  hero: {
    textAlign: 'center',
    marginBottom: 36,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 8,
  },
  heroSub: {
    fontSize: 15,
    color: 'var(--text-2)',
    maxWidth: 520,
    margin: '0 auto',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '14px 18px',
    color: 'var(--danger)',
    fontSize: 14,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  resultsSection: {
    marginTop: 44,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 28,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  dividerLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 24px',
    color: 'var(--text-2)',
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  loadingOverlay: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '36px 24px',
    textAlign: 'center',
    boxShadow: 'var(--shadow)',
  },
  loadingSpinner: {
    width: 40,
    height: 40,
    border: '3px solid var(--border)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 16px',
  },
  statsBar: {
    display: 'flex',
    gap: 20,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '14px 20px',
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  statVal: {
    fontWeight: 700,
    fontSize: 18,
    color: 'var(--text)',
  },
  statLbl: {
    fontSize: 11,
    color: 'var(--text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
}

function validate(jd, source) {
  if (jd.type === 'text' && !(jd.text || '').trim()) return 'Please paste a job description or upload a JD file.'
  if (jd.type === 'file' && !jd.file) return 'Please upload a JD file or paste text.'
  if (source.mode === 'local' && (!source.localFiles || source.localFiles.length === 0)) return 'Please select a local folder containing resumes.'
  const odMode = source.onedriveMode || 'link'
  if (source.mode === 'onedrive' && odMode === 'link' && !(source.onedriveLinks || '').trim())
    return 'Please paste at least one OneDrive share link.'
  if (source.mode === 'onedrive' && odMode === 'api' && !(source.onedriveApiFolder || '').trim())
    return 'Please enter a OneDrive folder path.'
  return null
}

export default function Home() {
  const [jd, setJd] = useState({ type: 'text', text: '' })
  // ALL keys pre-initialised as empty strings so .trim() never hits undefined
  const [source, setSource] = useState({
    mode: 'local',
    localPath: '',
    onedriveMode: 'link',
    onedriveLinks: '',
    onedriveApiFolder: '',
    mustHave: '',
    goodToHave: '',
    minExperience: '',
  })

  // Safe setter — always merges over full defaults so no key ever becomes undefined
  const SOURCE_DEFAULTS = {
    mode: 'local', localFiles: [], onedriveMode: 'link',
    onedriveLinks: '', onedriveApiFolder: '',
    mustHave: '', goodToHave: '', minExperience: '',
  }
  const setSourceSafe = (patch) =>
    setSource(prev => ({ ...SOURCE_DEFAULTS, ...prev, ...patch }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const handleRun = async () => {
    const err = validate(jd, source)
    if (err) { setError(err); return }
    setError(null)
    setLoading(true)
    setResult(null)

    try {
      const fd = new FormData()

      // JD — ensure we always send something
      if (jd.type === 'file' && jd.file) {
        fd.append('jd_file', jd.file)
      } else {
        fd.append('jd_text', (jd.text || '').trim())
      }

      // Safely extract all source fields (never undefined)
      const localPath        = (source.localPath        || '').trim()
      const onedriveLinks    = (source.onedriveLinks    || '').trim()
      const onedriveApiFolder= (source.onedriveApiFolder|| '').trim()
      const mustHave         = (source.mustHave         || '').trim()
      const goodToHave       = (source.goodToHave       || '').trim()
      const odMode           = source.onedriveMode || 'link'

      if (source.mode === 'local') {
        fd.append('source_type', 'local')
        if (source.localFiles && source.localFiles.length > 0) {
          source.localFiles.forEach(file => {
            fd.append('resume_files', file)
          })
        }
      } else if (odMode === 'link') {
        fd.append('source_type', 'onedrive_link')
        fd.append('onedrive_links', onedriveLinks)
      } else {
        fd.append('source_type', 'onedrive_api')
        fd.append('onedrive_folder', onedriveApiFolder)
      }

      if (mustHave)  fd.append('must_have_skills',    mustHave)
      if (goodToHave) fd.append('good_to_have_skills', goodToHave)
      if (source.minExperience) fd.append('minimum_experience', source.minExperience)

      const data = await runPipeline(fd)
      setResult(data)
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Pipeline failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const topScore = result?.candidates?.[0]?.final_score
  const avgScore = result?.candidates?.length
    ? (result.candidates.reduce((s, c) => s + c.final_score, 0) / result.candidates.length).toFixed(2)
    : null

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <header style={styles.header}>
        <div style={styles.logo}>
          🤖 Recruit AI
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.hero}>
          <h1 style={styles.heroTitle}>AI-Powered Resume Screening</h1>
          <p style={styles.heroSub}>
            Upload a Job Description, point to your resume folder, and get the top 5 most relevant candidates ranked instantly.
          </p>
        </div>

        <div style={styles.form}>
          <JDInput value={jd} onChange={setJd} />
          <ResumeSourceInput value={source} onChange={setSourceSafe} />

          {error && (
            <div style={styles.errorBox}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <RunPipelineButton onClick={handleRun} loading={loading} disabled={loading} />
        </div>

        {/* Results */}
        {(loading || result) && (
          <div style={styles.resultsSection}>
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerLabel}>Results</span>
              <div style={styles.dividerLine} />
            </div>

            {loading && (
              <div style={styles.loadingOverlay}>
                <div style={styles.loadingSpinner} />
                <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Processing Resumes…</p>
                <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
                  Parsing → Embedding → Scoring → Ranking
                </p>
              </div>
            )}

            {!loading && result && result.candidates?.length > 0 && (
              <>
                {/* Stats bar */}
                <div style={styles.statsBar}>
                  <div style={styles.statItem}>
                    <span style={styles.statVal}>{result.total_processed}</span>
                    <span style={styles.statLbl}>Resumes Processed</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statVal}>{result.candidates.length}</span>
                    <span style={styles.statLbl}>Top Candidates</span>
                  </div>
                  {topScore != null && (
                    <div style={styles.statItem}>
                      <span style={{ ...styles.statVal, color: 'var(--success)' }}>{(topScore * 100).toFixed(1)}%</span>
                      <span style={styles.statLbl}>Best Match</span>
                    </div>
                  )}
                  {avgScore != null && (
                    <div style={styles.statItem}>
                      <span style={styles.statVal}>{(avgScore * 100).toFixed(1)}%</span>
                      <span style={styles.statLbl}>Avg Score</span>
                    </div>
                  )}
                </div>

                <CandidateTable
                  candidates={result.candidates}
                  totalProcessed={result.total_processed}
                />
              </>
            )}

            {!loading && result && result.candidates?.length === 0 && (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>📭</div>
                <p style={{ fontWeight: 600, marginBottom: 6 }}>No candidates found</p>
                <p style={{ fontSize: 13 }}>Check that the folder contains PDF or DOCX resume files.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}
