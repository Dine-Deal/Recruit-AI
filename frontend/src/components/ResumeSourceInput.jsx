import React from 'react'

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
    marginBottom: 20,
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
    cursor: 'pointer',
  }),
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-2)',
    marginBottom: 4,
    display: 'block',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 14,
    color: 'var(--text)',
    background: 'var(--surface)',
    transition: 'border-color 0.15s',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-2)',
    marginTop: 4,
  },
  infoBox: {
    background: 'var(--accent-light)',
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 13,
    color: '#1e40af',
    marginBottom: 16,
  },
  subTabs: {
    display: 'flex',
    gap: 2,
    marginBottom: 16,
  },
  subTab: (active) => ({
    padding: '5px 14px',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 20,
    fontWeight: 500,
    fontSize: 12,
    background: active ? 'var(--accent-light)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-2)',
    transition: 'all 0.15s',
    cursor: 'pointer',
  }),
}

const SOURCE_TABS = [
  { id: 'local', label: '🗂 Local Folder' },
  { id: 'onedrive', label: '☁️ OneDrive' },
]

const ONEDRIVE_SUBTABS = [
  { id: 'link', label: 'Share Links' },
  { id: 'api', label: 'Graph API' },
]

export default function ResumeSourceInput({ value, onChange }) {
  const mode = value.mode || 'local'
  const onedriveMode = value.onedriveMode || 'link'

  const set = (patch) => onChange({ ...value, ...patch })

  return (
    <div style={styles.card}>
      <span style={styles.label}>📁 Resume Source</span>

      <div style={styles.tabs}>
        {SOURCE_TABS.map(t => (
          <button
            key={t.id}
            style={styles.tab(mode === t.id)}
            onClick={() => set({ mode: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'local' && (
        <div style={styles.fieldGroup}>
          <div>
            <span style={styles.fieldLabel}>Folder Path</span>
            <input
              style={styles.input}
              placeholder="e.g. /Users/you/resumes  or  C:\Resumes\SWE"
              value={value.localPath || ''}
              onChange={(e) => set({ localPath: e.target.value })}
            />
            <p style={styles.hint}>Absolute path to a local folder containing PDF/DOCX resumes</p>
          </div>
        </div>
      )}

      {mode === 'onedrive' && (
        <div>
          <div style={styles.subTabs}>
            {ONEDRIVE_SUBTABS.map(t => (
              <button
                key={t.id}
                style={styles.subTab(onedriveMode === t.id)}
                onClick={() => set({ onedriveMode: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>

          {onedriveMode === 'link' && (
            <div style={styles.fieldGroup}>
              <div style={styles.infoBox}>
                💡 Paste one or more OneDrive public share links (comma-separated). Files will be downloaded to a temporary cache before processing.
              </div>
              <div>
                <span style={styles.fieldLabel}>OneDrive Share Links</span>
                <textarea
                  style={{ ...styles.input, minHeight: 80, resize: 'vertical' }}
                  placeholder="https://1drv.ms/b/..., https://1drv.ms/b/..."
                  value={value.onedriveLinks || ''}
                  onChange={(e) => set({ onedriveLinks: e.target.value })}
                />
                <p style={styles.hint}>Comma-separated public share links (PDF or DOCX)</p>
              </div>
            </div>
          )}

          {onedriveMode === 'api' && (
            <div style={styles.fieldGroup}>
              <div style={styles.infoBox}>
                🔐 Requires <strong>MS_TENANT_ID</strong>, <strong>MS_CLIENT_ID</strong>, <strong>MS_CLIENT_SECRET</strong>, and <strong>MS_USER_EMAIL</strong> set in backend <code>.env</code>.
              </div>
              <div>
                <span style={styles.fieldLabel}>OneDrive Folder Path</span>
                <input
                  style={styles.input}
                  placeholder="e.g. Resumes/SWE  (relative to OneDrive root)"
                  value={value.onedriveApiFolder || ''}
                  onChange={(e) => set({ onedriveApiFolder: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Optional Skill Hints section intentionally removed */}
    </div>
  )
}