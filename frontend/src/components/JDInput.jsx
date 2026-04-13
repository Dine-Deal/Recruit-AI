import React, { useRef, useState } from 'react'

const styles = {
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px',
    boxShadow: 'var(--shadow)',
  },
  label: {
    display: 'block',
    fontWeight: 600,
    fontSize: 13,
    color: 'var(--text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 12,
  },
  tabs: {
    display: 'flex',
    gap: 2,
    background: 'var(--surface-2)',
    borderRadius: 8,
    padding: 3,
    marginBottom: 16,
    width: 'fit-content',
  },
  tab: (active) => ({
    padding: '6px 18px',
    border: 'none',
    borderRadius: 6,
    fontWeight: 500,
    fontSize: 13,
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-2)',
    boxShadow: active ? 'var(--shadow)' : 'none',
    transition: 'all 0.15s',
  }),
  dropzone: (dragging) => ({
    border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)',
    background: dragging ? 'var(--accent-light)' : 'var(--surface-2)',
    padding: '32px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s',
  }),
  fileIcon: {
    fontSize: 32,
    marginBottom: 8,
    display: 'block',
  },
  dropText: {
    color: 'var(--text-2)',
    marginBottom: 6,
    fontSize: 14,
  },
  browse: {
    color: 'var(--accent)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  filePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    borderRadius: 20,
    padding: '4px 12px',
    fontSize: 13,
    fontWeight: 500,
    marginTop: 8,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    minHeight: 160,
    padding: '12px 14px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    resize: 'vertical',
    fontSize: 14,
    color: 'var(--text)',
    background: 'var(--surface)',
    lineHeight: 1.6,
    transition: 'border-color 0.15s',
  },
}

export default function JDInput({ value, onChange }) {
  const [mode, setMode] = useState('text') // 'text' | 'file'
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef()

  const handleFile = (file) => {
    if (!file) return
    const allowed = ['.pdf', '.docx', '.txt']
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!allowed.includes(ext)) {
      alert('Please upload a PDF, DOCX, or TXT file.')
      return
    }
    onChange({ type: 'file', file })
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div style={styles.card}>
      <span style={styles.label}>📋 Job Description</span>

      <div style={styles.tabs}>
        <button style={styles.tab(mode === 'text')} onClick={() => { setMode('text'); onChange({ type: 'text', text: '' }) }}>
          Paste Text
        </button>
        <button style={styles.tab(mode === 'file')} onClick={() => { setMode('file'); onChange({ type: 'file', file: null }) }}>
          Upload File
        </button>
      </div>

      {mode === 'text' ? (
        <textarea
          style={styles.textarea}
          placeholder="Paste the full job description here — skills, requirements, responsibilities..."
          value={value.text || ''}
          onChange={(e) => onChange({ type: 'text', text: e.target.value })}
        />
      ) : (
        <div>
          <div
            style={styles.dropzone(dragging)}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span style={styles.fileIcon}>📄</span>
            <p style={styles.dropText}>
              Drag & drop your JD file here, or{' '}
              <span style={styles.browse}>browse</span>
            </p>
            <p style={{ color: 'var(--text-2)', fontSize: 12 }}>PDF, DOCX, TXT — max 10MB</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
          {value.file && (
            <div style={styles.filePill}>
              📎 {value.file.name}
              <button style={styles.removeBtn} onClick={() => onChange({ type: 'file', file: null })}>×</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
