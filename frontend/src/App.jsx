import { useState, useEffect, useCallback } from "react";

const API = "http://localhost:8000";

function getToken() { return localStorage.getItem("ats_token"); }
function setToken(t) { localStorage.setItem("ats_token", t); }
function clearToken() { localStorage.removeItem("ats_token"); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Score bar ────────────────────────────────────────────────────────────────
function ScoreBar({ value = 0 }) {
  // value is 0.0–1.0 internally; display as 0–100
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 40 }}>{pct}/100</span>
    </div>
  );
}

// ── Skill pills ───────────────────────────────────────────────────────────────
function SkillPills({ skills = [], max = 6 }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? skills : skills.slice(0, max);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {visible.map(s => (
        <span key={s} style={{ background: "#eff6ff", color: "#1d4ed8", fontSize: 11, padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>{s}</span>
      ))}
      {skills.length > max && (
        <button onClick={() => setShowAll(v => !v)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 12, fontSize: 11, padding: "2px 8px", cursor: "pointer", color: "#6b7280" }}>
          {showAll ? "less" : `+${skills.length - max}`}
        </button>
      )}
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const form = new URLSearchParams({ username: email, password });
      const res = await fetch(`${API}/auth/token`, {
        method: "POST", body: form,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error("Invalid credentials");
      const data = await res.json();
      setToken(data.access_token);
      onLogin();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 380, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>AI-ATS</h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 28px" }}>Recruiter Portal</p>
        <form onSubmit={submit}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4 }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 14, boxSizing: "border-box" }} />
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 20, boxSizing: "border-box" }} />
          {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: 11, background: loading ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13, color: "#6b7280", textAlign: "center" }}>
          No account?{" "}
          <a href="#" onClick={async (e) => {
            e.preventDefault();
            const email = prompt("Your email:");
            const password = prompt("Choose a password:");
            const name = prompt("Your full name:");
            if (!email || !password) return;
            try {
              await apiFetch("/auth/register", { method: "POST", body: JSON.stringify({ email, password, full_name: name }) });
              alert("Account created! You can now sign in.");
            } catch (err) { alert("Error: " + err.message); }
          }} style={{ color: "#2563eb", fontWeight: 600 }}>Register</a>
        </p>
      </div>
    </div>
  );
}

// ── Pipeline panel ────────────────────────────────────────────────────────────
function PipelinePanel({ roles }) {
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [selectedRole, setSelectedRole] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try { setPipelineStatus(await apiFetch("/pipeline/status")); } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const run = async () => {
    setLoading(true);
    try {
      const query = selectedRole ? `?role=${selectedRole}` : "";
      await apiFetch(`/pipeline/run${query}`, { method: "POST" });
      await fetchStatus();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>Pipeline Control</h2>
        {pipelineStatus?.running && (
          <span style={{ background: "#fef3c7", color: "#92400e", fontSize: 12, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>● Running</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, flex: 1 }}>
          <option value="">All roles</option>
          {roles.map(r => <option key={r.id} value={r.folder_name}>{r.role_name}</option>)}
        </select>
        <button onClick={run} disabled={loading || pipelineStatus?.running}
          style={{ padding: "9px 20px", background: (loading || pipelineStatus?.running) ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          {pipelineStatus?.running ? "Running…" : "▶ Run Pipeline"}
        </button>
        <button
          onClick={async () => {
            try {
              const res = await fetch(`${API}/reports/download`, {
                headers: { Authorization: `Bearer ${getToken()}` }
              });
              if (!res.ok) {
                const err = await res.json();
                alert(err.detail || "Report not ready. Run the pipeline first.");
                return;
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "Candidate_Ranking.xlsx";
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) { alert("Download failed: " + e.message); }
          }}
          style={{ padding: "9px 16px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          ↓ Excel Report
        </button>
      </div>
      {pipelineStatus?.last_run && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
            Last run: {new Date(pipelineStatus.last_run).toLocaleString()}
          </div>
          {pipelineStatus.last_result && typeof pipelineStatus.last_result === "object" ? (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {[
                ["Roles scanned", pipelineStatus.last_result.roles, "#2563eb"],
                ["Resumes processed", pipelineStatus.last_result.processed, "#16a34a"],
                ["Skipped (duplicate)", pipelineStatus.last_result.skipped, "#f59e0b"],
                ["Errors", pipelineStatus.last_result.errors, "#dc2626"],
              ].map(([label, val, color]) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{val ?? 0}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#374151", margin: 0 }}>{String(pipelineStatus.last_result)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Candidate modal ───────────────────────────────────────────────────────────
function CandidateModal({ candidate: c, onClose }) {
  if (!c) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{c.name || "Unknown"}</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>{c.email}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[["Phone", c.phone], ["Experience", c.experience_years ? `${c.experience_years} yrs` : "—"], ["Education", c.education], ["Rank", `#${c.rank || "—"}`]].map(([label, val]) => (
            <div key={label} style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: 14, color: "#0f172a", marginTop: 2, fontWeight: 500 }}>{val || "—"}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Match Scores (out of 100)</h3>
          {[
            ["Semantic similarity", c.semantic_score, "Measures how closely the resume content matches the job description"],
            ["Skill match", c.skill_score, "Overlap between candidate skills and required skills"],
            ["Experience match", c.experience_score, "Years of experience vs minimum required"],
            ["Final score", c.final_score, "Weighted: 70% semantic + 20% skill + 10% experience"],
          ].map(([label, val, hint]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: "#374151", fontWeight: label === "Final score" ? 600 : 400 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: (val||0) >= 0.75 ? "#16a34a" : (val||0) >= 0.5 ? "#d97706" : "#dc2626" }}>
                  {Math.round((val||0)*100)}/100
                </span>
              </div>
              <ScoreBar value={val || 0} />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{hint}</div>
            </div>
          ))}
        </div>
        {c.skills?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Skills</h3>
            <SkillPills skills={c.skills} max={20} />
          </div>
        )}
        {c.certifications?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Certifications</h3>
            {c.certifications.map((cert, i) => <p key={i} style={{ margin: "2px 0", fontSize: 13, color: "#374151" }}>• {cert}</p>)}
          </div>
        )}
        <a href={`${API}/candidates/${c.id}/download`} download
          style={{ display: "inline-block", marginTop: 8, padding: "10px 20px", background: "#2563eb", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
          ↓ Download Resume
        </a>
      </div>
    </div>
  );
}

// ── Candidates table ──────────────────────────────────────────────────────────
function CandidatesTable({ roleId }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ minScore: 0, minExp: 0, skills: "" });
  const [selected, setSelected] = useState(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (roleId) params.append("role_id", roleId);
      if (filters.minScore > 0) params.append("min_score", filters.minScore);
      if (filters.minExp > 0) params.append("min_experience", filters.minExp);
      if (filters.skills) params.append("skills", filters.skills);
      const data = await apiFetch(`/candidates/?${params}`);
      setCandidates(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [roleId, filters]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  const headerStyle = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" };
  const cellStyle = { padding: "12px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#374151", verticalAlign: "middle" };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Min score (%)</label>
          <input type="number" min={0} max={100} value={Math.round(filters.minScore * 100)}
            onChange={e => setFilters(f => ({ ...f, minScore: e.target.value / 100 }))}
            style={{ width: 80, padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Min exp (yrs)</label>
          <input type="number" min={0} step={0.5} value={filters.minExp}
            onChange={e => setFilters(f => ({ ...f, minExp: e.target.value }))}
            style={{ width: 80, padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Skills filter</label>
          <input type="text" placeholder="e.g. Python, FastAPI" value={filters.skills}
            onChange={e => setFilters(f => ({ ...f, skills: e.target.value }))}
            style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button onClick={fetchCandidates}
            style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Apply</button>
        </div>
      </div>
      {loading ? (
        <p style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Loading candidates…</p>
      ) : candidates.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <p style={{ color: "#9ca3af", marginBottom: 8 }}>No candidates yet.</p>
          <p style={{ color: "#6b7280", fontSize: 13 }}>Drop resumes into <code>Applications\AI_Engineer\</code> then click Run Pipeline.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #e5e7eb" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["#", "Name", "Email", "Skills", "Exp (yrs)", "Score /100", "Actions"].map(h => <th key={h} style={headerStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <tr key={c.id}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={cellStyle}>
                    {c.rank <= 3
                      ? <span style={{ fontSize: 16 }}>{["🥇", "🥈", "🥉"][c.rank - 1]}</span>
                      : <span style={{ color: "#9ca3af" }}>{c.rank || i + 1}</span>}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600, color: "#0f172a" }}>{c.name || "—"}</td>
                  <td style={{ ...cellStyle, color: "#2563eb" }}>{c.email || "—"}</td>
                  <td style={cellStyle}><SkillPills skills={c.skills || []} max={3} /></td>
                  <td style={cellStyle}>{c.experience_years ? `${c.experience_years}y` : "—"}</td>
                  <td style={{ ...cellStyle, minWidth: 120 }}><ScoreBar value={c.final_score || 0} /></td>
                  <td style={cellStyle}>
                    <button onClick={() => setSelected(c)}
                      style={{ padding: "5px 12px", background: "#f0f9ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <CandidateModal candidate={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── JD Editor — FIXED: no duplicate creation ─────────────────────────────────
function JDEditor({ roles, onSave }) {
  const [editingId, setEditingId] = useState(null); // null = closed, "new" = create, uuid = edit
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const openCreate = () => {
    setEditingId("new");
    setForm({ role_name: "", folder_name: "", job_description: "", must_have_skills: "", good_to_have_skills: "", minimum_experience: 0, status: "Active" });
  };

  const openEdit = (role) => {
    setEditingId(role.id); // ← use the actual role UUID
    setForm({
      ...role,
      must_have_skills: (role.must_have_skills || []).join(", "),
      good_to_have_skills: (role.good_to_have_skills || []).join(", "),
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        must_have_skills: form.must_have_skills ? form.must_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        good_to_have_skills: form.good_to_have_skills ? form.good_to_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        minimum_experience: parseInt(form.minimum_experience) || 0,
      };

      if (editingId === "new") {
        // CREATE — POST /roles/
        await apiFetch("/roles/", { method: "POST", body: JSON.stringify(payload) });
      } else {
        // UPDATE — PUT /roles/{id}  ← FIXED: uses actual role UUID
        await apiFetch(`/roles/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      }

      setEditingId(null);
      onSave();
    } catch (e) {
      alert("Error: " + e.message);
    } finally { setSaving(false); }
  };

  const deleteRole = async (role) => {
    if (!confirm(`Delete "${role.role_name}"? This will also delete all its candidates.`)) return;
    setDeleting(role.id);
    try {
      await apiFetch(`/roles/${role.id}`, { method: "DELETE" });
      onSave();
    } catch (e) { alert("Error: " + e.message); }
    finally { setDeleting(null); }
  };

  const inputStyle = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 12 };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Job Descriptions</h2>
        <button onClick={openCreate}
          style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + New Role
        </button>
      </div>

      {roles.length === 0 && (
        <p style={{ color: "#9ca3af", textAlign: "center", padding: 32 }}>No roles yet. Click "+ New Role" to create one.</p>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {roles.map(r => (
          <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: "#0f172a" }}>{r.role_name}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                Folder: <code style={{ background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>{r.folder_name}</code>
                {" · "}Min exp: {r.minimum_experience}y
              </div>
              {r.must_have_skills?.length > 0 && (
                <div style={{ marginTop: 6 }}><SkillPills skills={r.must_have_skills} max={6} /></div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 16 }}>
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, background: r.status === "Active" ? "#dcfce7" : "#f3f4f6", color: r.status === "Active" ? "#166534" : "#6b7280" }}>
                {r.status}
              </span>
              <button onClick={() => openEdit(r)}
                style={{ padding: "6px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                Edit
              </button>
              <button onClick={() => deleteRole(r)} disabled={deleting === r.id}
                style={{ padding: "6px 14px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#dc2626" }}>
                {deleting === r.id ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit modal */}
      {editingId !== null && (
        <div onClick={() => setEditingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 32, maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>
              {editingId === "new" ? "Create New Role" : `Edit: ${form.role_name}`}
            </h3>
            {[
              ["Role name *", "role_name", "text"],
              ["Folder name * (default subfolder under Applications\\)", "folder_name", "text"],
              ["Must-have skills (comma-separated)", "must_have_skills", "text"],
              ["Good-to-have skills (comma-separated)", "good_to_have_skills", "text"],
              ["Minimum experience (years)", "minimum_experience", "number"],
            ].map(([label, key, type]) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input
                  type={type}
                  value={form[key] ?? ""}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  style={inputStyle}
                  readOnly={editingId !== "new" && key === "folder_name"}
                />
              </div>
            ))}
            <div>
              <label style={labelStyle}>Custom folder path (optional)</label>
              <input
                type="text"
                placeholder={`Default: Applications\\${form.folder_name || "Role_Name"} — or enter full path e.g. C:\\Resumes\\AI_Engineer`}
                value={form.custom_folder_path ?? ""}
                onChange={e => setForm(f => ({ ...f, custom_folder_path: e.target.value }))}
                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
              />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: -8, marginBottom: 12 }}>
                Leave blank to use the default Applications\ folder. Set a full Windows path to point to any folder on your machine.
              </div>
            </div>
            <label style={labelStyle}>Job description (used for semantic matching)</label>
            <textarea rows={6} value={form.job_description || ""}
              onChange={e => setForm(f => ({ ...f, job_description: e.target.value }))}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            <label style={labelStyle}>Status</label>
            <select value={form.status || "Active"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ ...inputStyle }}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setEditingId(null)}
                style={{ padding: "10px 20px", background: "#f3f4f6", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving}
                style={{ padding: "10px 24px", background: saving ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {saving ? "Saving…" : editingId === "new" ? "Create Role" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload panel ──────────────────────────────────────────────────────────────
function UploadPanel({ roles }) {
  const [file, setFile] = useState(null);
  const [roleFolder, setRoleFolder] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const upload = async () => {
    if (!file || !roleFolder) { alert("Please select a file and a role."); return; }
    setUploading(true); setMessage("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("role_folder", roleFolder);
      await apiFetch("/upload/resume", { method: "POST", body: fd, headers: {} });
      setMessage(`✅ "${file.name}" uploaded to ${roleFolder}`);
      setFile(null);
    } catch (e) { setMessage("❌ " + e.message); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb", marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 16 }}>Upload Resume</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Resume file (PDF or DOCX)</label>
          <input type="file" accept=".pdf,.docx,.doc" onChange={e => setFile(e.target.files[0])}
            style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Job role</label>
          <select value={roleFolder} onChange={e => setRoleFolder(e.target.value)}
            style={{ width: "100%", padding: "9px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}>
            <option value="">Select role…</option>
            {roles.map(r => <option key={r.id} value={r.folder_name}>{r.role_name}</option>)}
          </select>
        </div>
        <button onClick={upload} disabled={uploading}
          style={{ padding: "9px 20px", background: uploading ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {message && <p style={{ marginTop: 12, fontSize: 13, color: message.startsWith("✅") ? "#16a34a" : "#dc2626" }}>{message}</p>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState("candidates");
  const [roles, setRoles] = useState([]);
  const [activeRole, setActiveRole] = useState(null);

  const fetchRoles = useCallback(async () => {
    if (!getToken()) return;
    try { setRoles(await apiFetch("/roles/") || []); } catch {}
  }, []);

  useEffect(() => { if (authed) fetchRoles(); }, [authed, fetchRoles]);

  const logout = () => { clearToken(); setAuthed(false); };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const navBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} style={{
      padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
      background: tab === key ? "#eff6ff" : "transparent", color: tab === key ? "#2563eb" : "#374151",
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", display: "flex", alignItems: "center", height: 56, gap: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a", marginRight: 24 }}>🤖 AI-ATS</div>
        {[["candidates", "Candidates"], ["jobs", "Job Roles"], ["upload", "Upload"], ["pipeline", "Pipeline"]].map(([k, l]) => navBtn(k, l))}
        <div style={{ flex: 1 }} />
        <button onClick={logout} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "transparent", color: "#ef4444" }}>Sign out</button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>

        {tab === "pipeline" && (
          <>
            <PipelinePanel roles={roles} />
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 16 }}>Role Summary</h2>
              {roles.length === 0
                ? <p style={{ color: "#9ca3af" }}>No roles yet. Go to Job Roles tab to create one.</p>
                : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                    {roles.map(r => (
                      <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{r.role_name}</div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{r.folder_name}</div>
                        <div style={{ fontSize: 11, marginTop: 8, color: r.status === "Active" ? "#16a34a" : "#9ca3af", fontWeight: 600 }}>{r.status}</div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </>
        )}

        {tab === "jobs" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
            <JDEditor roles={roles} onSave={fetchRoles} />
          </div>
        )}

        {tab === "upload" && (
          <UploadPanel roles={roles} />
        )}

        {tab === "candidates" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>Ranked Candidates</h2>
              <select value={activeRole || ""} onChange={e => setActiveRole(e.target.value || null)}
                style={{ padding: "7px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 }}>
                <option value="">All roles</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}</option>)}
              </select>
            </div>
            <CandidatesTable roleId={activeRole} />
          </div>
        )}

      </div>
    </div>
  );
}