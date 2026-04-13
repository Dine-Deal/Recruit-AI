import React, { useState } from 'react'
import { getResumeDownloadUrl } from '../services/api'

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#cd7f32', '#6366f1', '#10b981']
const RANK_LABELS = ['🥇', '🥈', '🥉', '4th', '5th']

function ScoreBar({ label, value, color }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <span style={{ fontWeight: 600, color }}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${value * 100}%`,
          background: color,
          borderRadius: 3,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  )
}

const styles = {
  card: (expanded) => ({
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    boxShadow: expanded ? 'var(--shadow-lg)' : 'var(--shadow)',
    transition: 'box-shadow 0.2s',
  }),
  header: {
    display: 'grid',
    gridTemplateColumns: '44px 1fr auto',
    alignItems: 'center',
    gap: 14,
    padding: '16px 20px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  rankBadge: (rank) => ({
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: `${RANK_COLORS[(rank - 1) % RANK_COLORS.length]}22`,
    border: `2px solid ${RANK_COLORS[(rank - 1) % RANK_COLORS.length]}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: rank <= 3 ? 20 : 13,
    fontWeight: 700,
    color: RANK_COLORS[(rank - 1) % RANK_COLORS.length],
    flexShrink: 0,
  }),
  name: {
    fontWeight: 600,
    fontSize: 15,
    color: 'var(--text)',
  },
  meta: {
    fontSize: 12,
    color: 'var(--text-2)',
    marginTop: 2,
  },
  finalScore: (score) => ({
    textAlign: 'right',
  }),
  scoreNum: (score) => ({
    fontSize: 22,
    fontWeight: 700,
    color: score >= 0.7 ? 'var(--success)' : score >= 0.5 ? 'var(--warn)' : 'var(--danger)',
  }),
  scoreLabel: {
    fontSize: 11,
    color: 'var(--text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  body: {
    padding: '0 20px 20px',
    borderTop: '1px solid var(--border)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
    marginTop: 16,
  },
  section: {},
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  },
  value: {
    fontSize: 14,
    color: 'var(--text)',
  },
  skillsWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 4,
  },
  skill: {
    padding: '2px 10px',
    borderRadius: 20,
    background: 'var(--surface-2)',
    fontSize: 12,
    color: 'var(--text)',
    border: '1px solid var(--border)',
  },
  downloadBtn: {
    marginTop: 16,
    padding: '8px 18px',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s',
    textDecoration: 'none',
  },
  chevron: (expanded) => ({
    fontSize: 12,
    color: 'var(--text-2)',
    transition: 'transform 0.2s',
    transform: expanded ? 'rotate(180deg)' : 'none',
    marginLeft: 8,
  }),
}

export default function CandidateCard({ candidate }) {
  const [expanded, setExpanded] = useState(false)
  const { rank, name, email, phone, skills = [], experience_years,
    education, previous_companies = [], certifications = [],
    semantic_score, skill_score, experience_score, final_score, file_name } = candidate

  const displayName = name || 'Unknown Candidate'
  const metaParts = []
  if (email) metaParts.push(email)
  if (phone) metaParts.push(phone)
  if (experience_years != null) metaParts.push(`${experience_years}y exp`)

  return (
    <div style={styles.card(expanded)}>
      <div style={styles.header} onClick={() => setExpanded(v => !v)}>
        <div style={styles.rankBadge(rank)}>
          {rank <= 3 ? RANK_LABELS[rank - 1] : rank}
        </div>

        <div>
          <div style={styles.name}>{displayName}</div>
          <div style={styles.meta}>{metaParts.join(' · ')}</div>
        </div>

        <div style={styles.finalScore(final_score)}>
          <div style={styles.scoreNum(final_score)}>{(final_score * 100).toFixed(1)}%</div>
          <div style={styles.scoreLabel}>Match Score</div>
          <span style={styles.chevron(expanded)}>▼</span>
        </div>
      </div>

      {expanded && (
        <div style={styles.body}>
          {/* Score breakdown */}
          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <ScoreBar label="Semantic Match" value={semantic_score} color="#6366f1" />
            <ScoreBar label="Skill Match" value={skill_score} color="#0ea5e9" />
            <ScoreBar label="Experience Match" value={experience_score} color="#10b981" />
          </div>

          <div style={styles.grid}>
            {/* Skills */}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={styles.sectionLabel}>Skills ({skills.length})</div>
              <div style={styles.skillsWrap}>
                {skills.length > 0
                  ? skills.map(s => <span key={s} style={styles.skill}>{s}</span>)
                  : <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Not detected</span>
                }
              </div>
            </div>

            {/* Education */}
            <div>
              <div style={styles.sectionLabel}>Education</div>
              <div style={styles.value}>{education || '—'}</div>
            </div>

            {/* Companies */}
            <div>
              <div style={styles.sectionLabel}>Companies</div>
              <div style={styles.value}>
                {previous_companies.length > 0 ? previous_companies.join(', ') : '—'}
              </div>
            </div>

            {/* Certifications */}
            {certifications.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={styles.sectionLabel}>Certifications</div>
                <div style={styles.skillsWrap}>
                  {certifications.map(c => <span key={c} style={{ ...styles.skill, background: 'var(--success-light)', borderColor: '#bbf7d0', color: 'var(--success)' }}>{c}</span>)}
                </div>
              </div>
            )}
          </div>

          {/* Download */}
          <div>
            <a
              href={getResumeDownloadUrl(file_name)}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.downloadBtn}
            >
              ⬇ Download Resume
            </a>
            <span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 10 }}>{file_name}</span>
          </div>
        </div>
      )}
    </div>
  )
}
