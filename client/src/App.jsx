import React, { useEffect, useState } from 'react'

const apiBase = '/api'

function fetchJson(url, options) {
  return fetch(url, options).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed')
    return r.json()
  })
}

function badgeText(status) {
  if (status === 'pending') return 'Pending'
  if (status === 'in-progress') return 'In Progress'
  if (status === 'completed') return 'Completed'
  return status
}

function App() {
  const [tasks, setTasks] = useState([])
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const data = await fetchJson(`${apiBase}/tasks?status=${encodeURIComponent(status)}`)
      setTasks(data)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [status])

  const TaskCard = ({ t }) => {
    const delTask = async () => {
      if (!confirm('Delete task?')) return
      const res = await fetch(`${apiBase}/tasks/${t.id}`, { method: 'DELETE' })
      if (res.status === 204) load(); else alert('Deletion error')
    }

    return (
      <article className={`task-card status-${t.status}`}>
        <header className="task-header" style={{marginBottom: '0.75rem'}}>
          <h3 style={{flex:1}}>{t.title}</h3>
          <button aria-label="Delete task" title="Delete" className="delete-x" onClick={delTask}>×</button>
        </header>

        <div className="task-meta" style={{justifyContent: 'space-between'}}>
          <span className={`status-badge status-${t.status}`}>{badgeText(t.status)}</span>
          {t.dueDate ? <span className="due-date">Due: {t.dueDate}</span> : null}
        </div>

        <div className="task-content">
          {t.description ? (
            <p className="task-description" style={{display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden'}}>
              {t.description}
            </p>
          ) : null}

          {t.attachments?.length ? (
            <div className="attachments">
              <h4>Attachments</h4>
              <ul style={{display:'flex',flexWrap:'wrap',gap:'0.5rem'}}>
                {t.attachments.map(a => (
                  <li key={a.id}>
                    <a href={a.url} target="_blank" rel="noreferrer">{a.originalName || a.filename}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <footer className="task-actions" style={{marginTop:'1rem', justifyContent:'space-between'}}>
            <div>
              <button className="btn btn-edit" onClick={()=>setEditingTask(t)}>Edit</button>
            </div>
          </footer>
        </div>
      </article>
    )
  }

  const EditModal = ({ task, onClose }) => {
    const [local, setLocal] = useState({
      title: task.title,
      description: task.description || '',
      status: task.status,
      dueDate: task.dueDate || ''
    })
    const [attachments, setAttachments] = useState(task.attachments || [])

    const save = async () => {
      try {
        await fetchJson(`${apiBase}/tasks/${task.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: local.title,
            description: local.description,
            status: local.status,
            dueDate: local.dueDate || null
          })
        })
        onClose();
        load();
      } catch (e) { alert(e.message) }
    }

    const uploadFiles = async (files) => {
      if (!files || files.length === 0) return
      for (const file of Array.from(files)) {
        const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`
        const temp = { id: tempId, filename: file.name, originalName: file.name, url: '#', uploading: true }
        setAttachments(prev => [...prev, temp])

        const fd = new FormData();
        fd.append('attachment', file)
        try {
          const res = await fetch(`${apiBase}/tasks/${task.id}/attachments`, { method: 'POST', body: fd })
          if (res.ok) {
            const created = await res.json().catch(()=>null)
            if (created) {
              setAttachments(prev => prev.map(a => a.id === tempId ? {
                id: created.id,
                filename: created.filename,
                originalName: created.originalName,
                filePath: created.filePath,
                url: created.url
              } : a))
            } else {
              setAttachments(prev => prev.filter(a => a.id !== tempId))
            }
          } else {
            alert(`File upload error: ${file.name}`)
            setAttachments(prev => prev.filter(a => a.id !== tempId))
          }
        } catch (e) {
          alert(`File upload error: ${file.name}`)
          setAttachments(prev => prev.filter(a => a.id !== tempId))
        }
      }
    }

    const delAttachment = async (id) => {
      const r = await fetch(`${apiBase}/attachments/${id}`, { method:'DELETE' })
      if (r.status===204) { setAttachments(prev => prev.filter(a => a.id !== id)); } else alert('Deletion error')
    }

    return (
      <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) onClose() }}>
        <div className="modal">
          <div className="modal-header">
            <h3>Edit Task</h3>
            <button aria-label="Close" className="delete-x" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <form className="inline" onSubmit={(e)=>{e.preventDefault(); save()}}>
              <input value={local.title} onChange={e=>setLocal(v=>({...v, title: e.target.value}))} />
              <input type="date" value={local.dueDate} onChange={e=>setLocal(v=>({...v, dueDate: e.target.value}))} />
              <select value={local.status} onChange={e=>setLocal(v=>({...v, status: e.target.value}))}>
                <option value="pending">pending</option>
                <option value="in-progress">in-progress</option>
                <option value="completed">completed</option>
              </select>
              <input value={local.description} onChange={e=>setLocal(v=>({...v, description: e.target.value}))} style={{minWidth:220}} />
            </form>

            <div className="attachments">
              <h4>Attachments</h4>
              <ul style={{display:'flex',flexWrap:'wrap',gap:'0.5rem'}}>
                {attachments?.length ? attachments.map(a => (
                  <li key={a.id} style={{display:'flex', alignItems:'center', gap:6}}>
                    <a href={a.url} target="_blank" rel="noreferrer">{a.originalName || a.filename}</a>
                    {a.uploading ? <span className="uploading">(uploading…)</span> : (
                      <button aria-label="Delete file" title="Delete" className="delete-x" onClick={()=>delAttachment(a.id)}>×</button>
                    )}
                  </li>
                )) : <li><span className="muted">No attachments</span></li>}
              </ul>
              <form className="inline" onSubmit={(e)=>{e.preventDefault()}}>
                <input type="file" multiple onChange={e=> { uploadFiles(e.target.files); e.target.value=''; }} />
              </form>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-edit" onClick={save}>Save</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  const CreateModal = ({ onClose }) => {
    const [local, setLocal] = useState({ title: '', description: '', status: 'pending', dueDate: '' })
    const [files, setFiles] = useState([])
    const [fileInputKey, setFileInputKey] = useState(0)

    const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx))

    const addFiles = (newFiles) => {
      if (newFiles && newFiles.length > 0) {
        setFiles(prev => [...prev, ...Array.from(newFiles)])
        setFileInputKey(prev => prev + 1)
      }
    }

    const create = async () => {
      try {
        const created = await fetchJson(`${apiBase}/tasks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: local.title,
            description: local.description,
            status: local.status,
            dueDate: local.dueDate || null
          })
        })
        
        // Upload files after task creation
        if (files && files.length) {
          for (const file of files) {
            const fd = new FormData();
            fd.append('attachment', file)
            await fetch(`${apiBase}/tasks/${created.id}/attachments`, { method: 'POST', body: fd })
          }
        }
        
        onClose();
        load();
      } catch (e) { alert(e.message) }
    }

    return (
      <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) onClose() }}>
        <div className="modal">
          <div className="modal-header">
            <h3>Create Task</h3>
            <button aria-label="Close" className="delete-x" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <form className="inline" onSubmit={(e)=>{e.preventDefault(); create()}}>
              <input placeholder="Title" value={local.title} onChange={e=>setLocal(v=>({...v, title: e.target.value}))} />
              <input type="date" value={local.dueDate} onChange={e=>setLocal(v=>({...v, dueDate: e.target.value}))} />
              <select value={local.status} onChange={e=>setLocal(v=>({...v, status: e.target.value}))}>
                <option value="pending">pending</option>
                <option value="in-progress">in-progress</option>
                <option value="completed">completed</option>
              </select>
              <input placeholder="Description" value={local.description} onChange={e=>setLocal(v=>({...v, description: e.target.value}))} style={{minWidth:220}} />
            </form>
            <div className="attachments">
              <h4>Attachments</h4>
              <input 
                key={fileInputKey}
                type="file" 
                multiple 
                onChange={e=> { 
                  addFiles(e.target.files); 
                }} 
              />
              {files && files.length ? (
                <ul style={{display:'flex',flexWrap:'wrap',gap:'0.5rem', marginTop:8}}>
                  {files.map((f, idx) => (
                    <li key={idx} className="chip">
                      <span>{f.name}</span>
                      <button className="delete-x" title="Remove" aria-label="Remove" onClick={()=>removeFile(idx)}>×</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={create}>Create</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <header>
        <h1>📋 Task Manager</h1>
        <nav>
          <div className="header-toolbar">
            <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>Add</button>
            <select className="header-filter" value={status} onChange={e=>setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            <a href="#" onClick={(e)=>{e.preventDefault(); load()}}>Refresh</a>
          </div>
        </nav>
      </header>

      <main>
        <div className="container">
          <section style={{flex:'1 1 auto'}}>
            <div className="tasks">
              <h2>Tasks ({tasks.length})</h2>
              {loading ? <div className="no-tasks"><p>Loading...</p></div> : (
                tasks.length === 0 ? (
                  <div className="no-tasks"><p>No tasks found.</p></div>
                ) : (
                  <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:'1rem'}}>
                    {tasks.map(t => <TaskCard key={t.id} t={t} />)}
                  </div>
                )
              )}
            </div>
          </section>
        </div>
      </main>

      <footer>
        <p>&copy; 2025 Task Manager by Rita</p>
      </footer>

      {editingTask && <EditModal task={editingTask} onClose={()=>setEditingTask(null)} />}
      {showCreate && <CreateModal onClose={()=>setShowCreate(false)} />}
    </>
  )
}

export default App
