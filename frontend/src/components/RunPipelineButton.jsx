import React from 'react'

const styles = {
  btn: (loading) => ({
    width: '100%',
    padding: '14px 24px',
    borderRadius: 10,
    border: 'none',
    background: loading ? '#93c5fd' : 'var(--accent)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: '0.02em',
    cursor: loading ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    transition: 'background 0.15s, transform 0.1s',
    boxShadow: loading ? 'none' : '0 4px 14px rgba(37,99,235,0.35)',
    transform: loading ? 'none' : undefined,
  }),
  spinner: {
    width: 18,
    height: 18,
    border: '2px solid rgba(255,255,255,0.4)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
}

export default function RunPipelineButton({ onClick, loading, disabled }) {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <button
        style={styles.btn(loading)}
        onClick={onClick}
        disabled={loading || disabled}
      >
        {loading ? (
          <>
            <div style={styles.spinner} />
            Running Pipeline…
          </>
        ) : (
          <>⚡ Run Pipeline</>
        )}
      </button>
    </>
  )
}
