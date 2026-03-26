import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

function getToken() { return localStorage.getItem("ats_token"); }
function setToken(t) { localStorage.setItem("ats_token", t); }
function clearToken() { localStorage.removeItem("ats_token"); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  if (res.status === 204) return null;
  return res.json();
}

// ── Score bar ──────────────────────────────────────────────────────────────
function ScoreBar({ value = 0 }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .4s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 38 }}>{pct}/100</span>
    </div>
  );
}

// ── Skill pills ────────────────────────────────────────────────────────────
function SkillPills({ skills = [], max = 5 }) {
  const [all, setAll] = useState(false);
  const show = all ? skills : skills.slice(0, max);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {show.map(s => (
        <span key={s} style={{ background: "#eff6ff", color: "#1d4ed8", fontSize: 11, padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>{s}</span>
      ))}
      {skills.length > max && (
        <button onClick={() => setAll(v => !v)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 12, fontSize: 11, padding: "2px 8px", cursor: "pointer", color: "#6b7280" }}>
          {all ? "less" : `+${skills.length - max}`}
        </button>
      )}
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      if (mode === "login") {
        const form = new URLSearchParams({ username: email, password });
        const res = await fetch(`${API}/auth/token`, { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!res.ok) throw new Error("Invalid credentials");
        setToken((await res.json()).access_token); onLogin();
      } else {
        await apiFetch("/auth/register", { method: "POST", body: JSON.stringify({ email, password, full_name: name }) });
        setMode("login"); setError("Account created — sign in now.");
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const inp = { width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 14, boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4 };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 400, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>🤖 AI-ATS</h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 24px" }}>{mode === "login" ? "Sign in to your workspace" : "Create your recruiter account"}</p>
        <form onSubmit={submit}>
          {mode === "register" && <>
            <label style={lbl}>Full name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} required />
          </>}
          <label style={lbl}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} required />
          <label style={lbl}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inp, marginBottom: 20 }} required />
          {error && <p style={{ color: mode === "register" && error.includes("created") ? "#16a34a" : "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: "100%", padding: 11, background: loading ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 13, color: "#6b7280", textAlign: "center" }}>
          {mode === "login" ? "No account? " : "Already have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Candidate detail modal ─────────────────────────────────────────────────
function CandidateModal({ c, onClose }) {
  if (!c) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 580, maxHeight: "90vh", overflow: "auto", padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{c.name || "Unknown"}</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>{c.email}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[["Phone", c.phone], ["Experience", c.experience_years ? `${c.experience_years} yrs` : "—"], ["Education", c.education], ["Rank", `#${c.rank || "—"}`]].map(([l, v]) => (
            <div key={l} style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 14, color: "#0f172a", marginTop: 2, fontWeight: 500 }}>{v || "—"}</div>
            </div>
          ))}
        </div>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Match Scores</h3>
        {[["Semantic match", c.semantic_score, "How well resume matches the JD"], ["Skill match", c.skill_score, "Required skills overlap"], ["Experience match", c.experience_score, "Years of experience vs minimum"], ["Final score", c.final_score, "70% semantic + 20% skill + 10% experience"]].map(([l, v, h]) => (
          <div key={l} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: "#374151", fontWeight: l === "Final score" ? 700 : 400 }}>{l}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{Math.round((v || 0) * 100)}/100</span>
            </div>
            <ScoreBar value={v || 0} />
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{h}</div>
          </div>
        ))}
        {c.skills?.length > 0 && <>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 8 }}>Skills</h3>
          <SkillPills skills={c.skills} max={20} />
        </>}
        {c.certifications?.length > 0 && <>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 8 }}>Certifications</h3>
          {c.certifications.map((cert, i) => <p key={i} style={{ margin: "2px 0", fontSize: 13 }}>• {cert}</p>)}
        </>}
      </div>
    </div>
  );
}

// ── Top 5 role block ───────────────────────────────────────────────────────
function Top5Block({ roleName, candidates, onView }) {
  const medals = ["🥇", "🥈", "🥉", "4th", "5th"];
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ background: "#1e40af", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{roleName}</div>
          <div style={{ color: "#93c5fd", fontSize: 12 }}>Top {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ background: "#1d4ed8", padding: "3px 12px", borderRadius: 20, color: "#bfdbfe", fontSize: 12, fontWeight: 600 }}>
          Best: {Math.round((candidates[0]?.final_score || 0) * 100)}/100
        </div>
      </div>
      {candidates.map((c, i) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "12px 18px", gap: 12, borderBottom: i < candidates.length - 1 ? "1px solid #f3f4f6" : "none", background: i === 0 ? "#fffbeb" : "#fff" }}>
          <div style={{ fontSize: i < 3 ? 20 : 13, minWidth: 28, textAlign: "center", fontWeight: 700, color: "#6b7280" }}>{medals[i]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{c.name || "Unknown"}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{c.email}{c.experience_years ? ` · ${c.experience_years}y exp` : ""}</div>
            {c.skills?.length > 0 && <div style={{ marginTop: 4 }}><SkillPills skills={c.skills} max={4} /></div>}
          </div>
          <div style={{ minWidth: 110 }}><ScoreBar value={c.final_score || 0} /></div>
          <button onClick={() => onView(c)} style={{ padding: "5px 14px", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
            View
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Pipeline page ──────────────────────────────────────────────────────────
function PipelinePage({ roles, onRolesChange }) {
  const [jdText, setJdText]               = useState("");
  const [jdFile, setJdFile]               = useState(null);
  const [resumeFiles, setResumeFiles]     = useState([]);
  const [folderName, setFolderName]       = useState("");
  const [running, setRunning]             = useState(false);
  const [status, setStatus]               = useState(null);
  const [top5, setTop5]                   = useState({});
  const [viewCandidate, setViewCandidate] = useState(null);
  const pollRef = useRef(null);

  // Load cached top5 on mount
  useEffect(() => {
    try { setTop5(JSON.parse(localStorage.getItem("ats_top5") || "{}")); } catch {}
  }, []);

  const fetchTop5 = useCallback(async () => {
    const result = {};
    for (const r of roles) {
      const data = await apiFetch(`/candidates/?limit=5&role_id=${r.id}`);
      if (data?.length) result[r.role_name] = data;
    }
    setTop5(prev => {
      const merged = { ...prev, ...result };
      try { localStorage.setItem("ats_top5", JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, [roles]);

  const pollStatus = useCallback(async () => {
    try {
      const s = await apiFetch("/pipeline/status");
      setStatus(s);
      if (!s.running) {
        clearInterval(pollRef.current);
        setRunning(false);
        await fetchTop5();
      }
    } catch {}
  }, [fetchTop5]);

  const run = async () => {
    if (resumeFiles.length === 0) { alert("Please select a resume folder first."); return; }
    setRunning(true);
    try {
      // Build FormData — send all resume files + optional JD text
      const fd = new FormData();

      // Attach JD
      if (jdFile) {
        fd.append("jd_file", jdFile);
      } else if (jdText) {
        fd.append("jd_text", jdText);
      }

      // Attach all resume files
      resumeFiles.forEach(f => fd.append("files", f));

      const res = await fetch(`${API}/pipeline/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) { const t = await res.text(); throw new Error(t); }

      pollRef.current = setInterval(pollStatus, 3000);
    } catch (e) {
      alert(e.message);
      setRunning(false);
    }
  };

  const box    = { background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb", marginBottom: 16 };
  const badge  = n => ({ width: 26, height: 26, borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 });
  const iStyle = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, boxSizing: "border-box" };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* ── Step 1: Job Description ───────────────────────────── */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={badge(1)}>1</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Job Description</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Upload a JD document or paste the text — used for AI matching</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Upload JD (PDF, DOCX, or TXT)</label>
            <input type="file" accept=".pdf,.docx,.txt"
              onChange={e => { setJdFile(e.target.files[0]); setJdText(""); }}
              style={{ ...iStyle, padding: "7px 10px" }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
            <span style={{ fontSize: 12, color: "#9ca3af", paddingBottom: 10 }}>or</span>
          </div>
        </div>

        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Paste JD text</label>
        <textarea rows={5} value={jdText} onChange={e => { setJdText(e.target.value); setJdFile(null); }}
          placeholder="Paste the full job description here. The AI uses this to rank candidates by relevance..."
          style={{ ...iStyle, resize: "vertical", fontFamily: "inherit" }} />

        {(jdFile || jdText) && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
            ✓ {jdFile ? `File: ${jdFile.name}` : `Text: ${jdText.length} characters`}
          </div>
        )}
      </div>

      {/* ── Step 2: Resume Folder ─────────────────────────────── */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={badge(2)}>2</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Resume Folder</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Select the folder containing resumes — works with local, OneDrive, or Google Drive synced folders
            </div>
          </div>
        </div>

        <label style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
          border: `2px dashed ${resumeFiles.length > 0 ? "#86efac" : "#93c5fd"}`,
          borderRadius: 8, cursor: "pointer",
          background: resumeFiles.length > 0 ? "#f0fdf4" : "#f0f9ff"
        }}>
          <input
            type="file"
            // @ts-ignore
            webkitdirectory=""
            multiple
            accept=".pdf,.docx,.doc"
            style={{ display: "none" }}
            onChange={e => {
              const files = Array.from(e.target.files).filter(f =>
                /\.(pdf|docx|doc)$/i.test(f.name)
              );
              setResumeFiles(files);
              if (files.length > 0) {
                const parts = (files[0].webkitRelativePath || files[0].name).split("/");
                setFolderName(parts[0] || "Selected folder");
              }
            }}
          />
          <span style={{ fontSize: 28 }}>📂</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: resumeFiles.length > 0 ? "#166534" : "#1d4ed8" }}>
              {resumeFiles.length > 0 ? `📁 ${folderName}` : "Click to select resume folder"}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
              {resumeFiles.length > 0
                ? `${resumeFiles.length} resume${resumeFiles.length !== 1 ? "s" : ""} found (PDF / DOCX)`
                : "All PDF and DOCX files inside the folder will be processed"}
            </div>
          </div>
        </label>

        {resumeFiles.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Files to process ({resumeFiles.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 110, overflowY: "auto" }}>
              {resumeFiles.map((f, i) => (
                <span key={i} style={{
                  background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0",
                  borderRadius: 20, fontSize: 11, padding: "2px 10px", fontWeight: 500
                }}>
                  📄 {f.name}
                </span>
              ))}
            </div>
            <button
              onClick={() => { setResumeFiles([]); setFolderName(""); }}
              style={{ marginTop: 8, background: "none", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 6, fontSize: 11, padding: "3px 10px", cursor: "pointer" }}
            >
              ✕ Clear selection
            </button>
          </div>
        )}
      </div>

      {/* ── Run button ───────────────────────────────────────────── */}
      <div style={{ ...box, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button onClick={run} disabled={running}
          style={{ padding: "12px 32px", background: running ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: running ? "not-allowed" : "pointer" }}>
          {running ? "⟳ Running pipeline…" : "▶ Run Pipeline"}
        </button>

        {running && <span style={{ fontSize: 13, color: "#6b7280" }}>Processing resumes… this may take a minute.</span>}

        {status?.last_run && !running && (
          <div style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            {[["Processed", status.last_result?.processed, "#16a34a"], ["Skipped", status.last_result?.skipped, "#d97706"], ["Errors", status.last_result?.errors, "#dc2626"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{v ?? 0}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginLeft: running ? 0 : "auto" }}>
          <button onClick={async () => {
            try {
              const res = await fetch(`${API}/reports/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
              if (!res.ok) { alert("No report yet. Run pipeline first."); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "Candidate_Ranking.xlsx"; a.click();
              URL.revokeObjectURL(url);
            } catch (e) { alert("Download failed: " + e.message); }
          }} style={{ padding: "9px 16px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            ↓ Excel Report
          </button>
        </div>
      </div>

      {/* ── Top 5 results ────────────────────────────────────────── */}
      {Object.keys(top5).length > 0 && (
        <div style={box}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                Top 5 Candidates — All Roles ({Object.keys(top5).length})
              </h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>Results from last pipeline run</p>
            </div>
            <button onClick={fetchTop5}
              style={{ padding: "7px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
              ↻ Refresh
            </button>
          </div>
          {Object.keys(top5).sort().map(roleName => (
            <Top5Block key={roleName} roleName={roleName} candidates={top5[roleName] || []} onView={setViewCandidate} />
          ))}
        </div>
      )}

      {Object.keys(top5).length === 0 && !running && (
        <div style={{ ...box, textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No results yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add a JD, select your resume folder, and click Run Pipeline</div>
        </div>
      )}

      {viewCandidate && <CandidateModal c={viewCandidate} onClose={() => setViewCandidate(null)} />}
    </div>
  );
}

// ── Job Roles page ─────────────────────────────────────────────────────────
function JobRolesPage({ roles, onSave }) {
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(null);

  const openCreate = () => { setEditingId("new"); setForm({ role_name: "", job_description: "", must_have_skills: "", good_to_have_skills: "", minimum_experience: 0, status: "Active" }); };
  const openEdit   = r => { setEditingId(r.id); setForm({ ...r, must_have_skills: (r.must_have_skills || []).join(", "), good_to_have_skills: (r.good_to_have_skills || []).join(", ") }); };

  const save = async () => {
    if (!form.role_name?.trim()) { alert("Role name is required."); return; }
    setSaving(true);
    try {
      const p = {
        ...form,
        folder_name: form.role_name.trim().replace(/\s+/g, "_"),
        must_have_skills: form.must_have_skills ? form.must_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        good_to_have_skills: form.good_to_have_skills ? form.good_to_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        minimum_experience: parseInt(form.minimum_experience) || 0
      };
      if (editingId === "new") await apiFetch("/roles/", { method: "POST", body: JSON.stringify(p) });
      else await apiFetch(`/roles/${editingId}`, { method: "PUT", body: JSON.stringify(p) });
      setEditingId(null); onSave();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const del = async r => {
    if (!confirm(`Delete "${r.role_name}"? Candidates are preserved.`)) return;
    setDeleting(r.id);
    try { await apiFetch(`/roles/${r.id}`, { method: "DELETE" }); onSave(); }
    catch (e) { alert(e.message); }
    finally { setDeleting(null); }
  };

  const iS = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 12 };
  const lS = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Job Roles</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>Manage roles, skills, and JD for AI matching</p>
        </div>
        <button onClick={openCreate} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add Role</button>
      </div>

      {roles.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", background: "#f8fafc", borderRadius: 10, border: "1px dashed #e5e7eb" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
          <p style={{ color: "#374151", fontWeight: 600, marginBottom: 4 }}>No roles yet</p>
          <p style={{ color: "#9ca3af", fontSize: 13 }}>Click "+ Add Role" to configure your first job role</p>
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {roles.map(r => (
          <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{r.role_name}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600, background: r.status === "Active" ? "#dcfce7" : "#f3f4f6", color: r.status === "Active" ? "#166534" : "#6b7280" }}>{r.status}</span>
                </div>
                {r.must_have_skills?.length > 0 && <SkillPills skills={r.must_have_skills} max={6} />}
                {r.minimum_experience > 0 && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Min exp: {r.minimum_experience}y</div>}
              </div>
              <div style={{ display: "flex", gap: 8, marginLeft: 16, flexShrink: 0 }}>
                <button onClick={() => openEdit(r)} style={{ padding: "6px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Edit</button>
                <button onClick={() => del(r)} disabled={deleting === r.id} style={{ padding: "6px 14px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#dc2626" }}>
                  {deleting === r.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editingId !== null && (
        <div onClick={() => setEditingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 32, maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>{editingId === "new" ? "Add New Role" : `Edit: ${form.role_name}`}</h3>

            <label style={lS}>Role name *</label>
            <input value={form.role_name ?? ""} onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))} style={iS} placeholder="e.g. AI Engineer" />

            <label style={lS}>Must-have skills <span style={{ fontWeight: 400, color: "#9ca3af" }}>(comma-separated)</span></label>
            <input value={form.must_have_skills ?? ""} onChange={e => setForm(f => ({ ...f, must_have_skills: e.target.value }))} style={iS} placeholder="Python, FastAPI, LLM, Docker" />

            <label style={lS}>Good-to-have skills <span style={{ fontWeight: 400, color: "#9ca3af" }}>(comma-separated)</span></label>
            <input value={form.good_to_have_skills ?? ""} onChange={e => setForm(f => ({ ...f, good_to_have_skills: e.target.value }))} style={iS} placeholder="AWS, Kubernetes, RAG" />

            <label style={lS}>Minimum experience (years)</label>
            <input type="number" min={0} step={0.5} value={form.minimum_experience ?? 0} onChange={e => setForm(f => ({ ...f, minimum_experience: e.target.value }))} style={iS} />

            <label style={lS}>Job description <span style={{ fontWeight: 400, color: "#9ca3af" }}>(AI semantic matching)</span></label>
            <textarea rows={5} value={form.job_description || ""} onChange={e => setForm(f => ({ ...f, job_description: e.target.value }))} style={{ ...iS, resize: "vertical", fontFamily: "inherit" }} placeholder="Paste the full job description here." />

            <label style={lS}>Status</label>
            <select value={form.status || "Active"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ ...iS }}>
              <option>Active</option><option>Inactive</option>
            </select>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setEditingId(null)} style={{ padding: "10px 20px", background: "#f3f4f6", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: "10px 24px", background: saving ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {saving ? "Saving…" : editingId === "new" ? "Add Role" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab]       = useState("pipeline");
  const [roles, setRoles]   = useState([]);

  const fetchRoles = useCallback(async () => {
    if (!getToken()) return;
    try { setRoles(await apiFetch("/roles/") || []); } catch {}
  }, []);

  useEffect(() => { if (authed) fetchRoles(); }, [authed, fetchRoles]);

  const logout = () => { clearToken(); setAuthed(false); };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const navBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: tab === key ? "#eff6ff" : "transparent", color: tab === key ? "#2563eb" : "#374151" }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", display: "flex", alignItems: "center", height: 56, gap: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a", marginRight: 20 }}>🤖 AI-ATS</div>
        {[["pipeline", "Pipeline"], ["jobs", "Job Roles"]].map(([k, l]) => navBtn(k, l))}
        <div style={{ flex: 1 }} />
        <button onClick={logout} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "transparent", color: "#ef4444" }}>Sign out</button>
      </div>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        {tab === "pipeline" && <PipelinePage roles={roles} onRolesChange={fetchRoles} />}
        {tab === "jobs" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
            <JobRolesPage roles={roles} onSave={fetchRoles} />
          </div>
        )}
      </div>
    </div>
  );
}