import React, { useState } from 'react'
import CandidateCard from './CandidateCard'
import { getResumeDownloadUrl } from '../services/api'

const styles = {
  wrap: {},
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text)',
  },
  meta: {
    fontSize: 13,
    color: 'var(--text-2)',
  },
  viewToggle: {
    display: 'flex',
    gap: 2,
    background: 'var(--surface-2)',
    borderRadius: 8,
    padding: 3,
  },
  viewBtn: (active) => ({
    padding: '5px 12px',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-2)',
    cursor: 'pointer',
    boxShadow: active ? 'var(--shadow)' : 'none',
    transition: 'all 0.15s',
  }),
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  tableWrap: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    background: 'var(--surface-2)',
    fontWeight: 600,
    fontSize: 11,
    color: 'var(--text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  td: (i) => ({
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    background: i % 2 === 0 ? 'var(--surface)' : '#fafbfc',
    verticalAlign: 'top',
  }),
  rankCell: (rank) => ({
    fontWeight: 700,
    fontSize: 15,
    color: rank <= 3 ? ['#f59e0b', '#94a3b8', '#cd7f32'][rank - 1] : 'var(--text-2)',
    textAlign: 'center',
  }),
  scoreCell: (score) => ({
    fontWeight: 700,
    color: score >= 0.7 ? 'var(--success)' : score >= 0.5 ? 'var(--warn)' : 'var(--danger)',
  }),
  skillPill: {
    display: 'inline-block',
    padding: '1px 8px',
    background: 'var(--surface-2)',
    borderRadius: 10,
    fontSize: 11,
    marginRight: 4,
    marginBottom: 2,
  },
  dlBtn: {
    padding: '4px 10px',
    border: '1px solid var(--accent)',
    borderRadius: 6,
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    fontWeight: 500,
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
    whiteSpace: 'nowrap',
  },
}

export default function CandidateTable({ candidates, totalProcessed }) {
  const [view, setView] = useState('cards')

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Top {candidates.length} Candidates</div>
          <div style={styles.meta}>{totalProcessed} resumes processed · ranked by ATS score</div>
        </div>
        <div style={styles.viewToggle}>
          <button style={styles.viewBtn(view === 'cards')} onClick={() => setView('cards')}>Cards</button>
          <button style={styles.viewBtn(view === 'table')} onClick={() => setView('table')}>Table</button>
        </div>
      </div>

      {view === 'cards' && (
        <div style={styles.cards}>
          {candidates.map(c => <CandidateCard key={c.file_name + c.rank} candidate={c} />)}
        </div>
      )}

      {view === 'table' && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Rank', 'Name', 'Email', 'Phone', 'Exp (yrs)', 'Skills', 'Score', 'Resume'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <tr key={c.file_name + c.rank}>
                  <td style={{ ...styles.td(i), ...styles.rankCell(c.rank) }}>{c.rank}</td>
                  <td style={styles.td(i)}><strong>{c.name || '—'}</strong></td>
                  <td style={styles.td(i)}>{c.email || '—'}</td>
                  <td style={styles.td(i)}>{c.phone || '—'}</td>
                  <td style={styles.td(i)}>{c.experience_years != null ? c.experience_years : '—'}</td>
                  <td style={styles.td(i)}>
                    {c.skills.slice(0, 5).map(s => (
                      <span key={s} style={styles.skillPill}>{s}</span>
                    ))}
                    {c.skills.length > 5 && <span style={{ fontSize: 11, color: 'var(--text-2)' }}>+{c.skills.length - 5}</span>}
                  </td>
                  <td style={{ ...styles.td(i), ...styles.scoreCell(c.final_score) }}>
                    {(c.final_score * 100).toFixed(1)}%
                  </td>
                  <td style={styles.td(i)}>
                    <a
                      href={getResumeDownloadUrl(c.file_name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.dlBtn}
                    >
                      ⬇ Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
