import React, { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const apiBase = '/api'

// Socket.IO connection management (no GUI changes)
let socket = null
let socketReady = null

function disconnectSocket() {
  try {
    if (socket) {
      socket.removeAllListeners && socket.removeAllListeners()
      socket.disconnect && socket.disconnect()
    }
  } catch (_) {}
  socket = null
  socketReady = null
}

function getSocket() {
  if (!socketReady) {
    socketReady = new Promise((resolve, reject) => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null
      socket = io('http://localhost:3001', {
        withCredentials: true,
        transports: ['polling', 'websocket'],
        timeout: 20000,
        autoConnect: false,
        reconnection: true,
        auth: token ? { token } : undefined
      })
      socket.on('connect', () => resolve(socket))
      socket.on('connect_error', (e) => reject(e))
      try { socket.connect() } catch (_) {}
      if (typeof window !== 'undefined' && !window.__socketUnloadBound) {
        window.addEventListener('beforeunload', () => {
          try { socket && socket.close && socket.close() } catch (_) {}
        })
        window.__socketUnloadBound = true
      }
    })
  }
  return socketReady
}

function socketEmit(event, payload) {
  return getSocket().then((s) => new Promise((resolve, reject) => {
    // pass token via auth and cookies
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null
    if (token) s.auth = { token }
    const finalPayload = (payload && typeof payload === 'object')
      ? (token ? { ...payload, token } : payload)
      : (token ? { token } : payload)
    s.emit(event, finalPayload, (res) => {
      if (!res) return reject(new Error('No response'))
      if (res.error) return reject(new Error(res.error))
      resolve(res)
    })
  }))
}

// Drop-in replacement to preserve GUI and call sites
function fetchJson(url, options = {}) {
  // Auth endpoints
  if (url.endsWith('/auth/login')) {
    const body = options.body ? JSON.parse(options.body) : {}
    return socketEmit('auth:login', body).then((res) => {
      if (res.token) localStorage.setItem('authToken', res.token)
      return { user: res.user }
    })
  }
  if (url.endsWith('/auth/register')) {
    const body = options.body ? JSON.parse(options.body) : {}
    return socketEmit('auth:register', body).then((res) => {
      if (res.token) localStorage.setItem('authToken', res.token)
      return { user: res.user }
    })
  }
  if (url.endsWith('/auth/logout')) {
    return socketEmit('auth:logout', {}).then(() => {
      localStorage.removeItem('authToken')
      disconnectSocket()
      return { message: 'Logout successful' }
    })
  }
  if (url.endsWith('/auth/me')) {
    return socketEmit('auth:me', {}).then((res) => ({ user: res.user }))
  }

  // Tasks endpoints
  if (url.includes('/tasks?')) {
    const status = new URLSearchParams(url.split('?')[1]).get('status') || 'all'
    return socketEmit('tasks:get', { status })
  }
  if (/\/tasks\/$/.test(url) || url.endsWith('/tasks')) {
    const body = options.body ? JSON.parse(options.body) : {}
    return socketEmit('tasks:create', body)
  }
  if (/\/tasks\/(\d+)$/.test(url) && options.method === 'PUT') {
    const id = parseInt(url.match(/\/(\d+)$/)[1])
    const body = options.body ? JSON.parse(options.body) : {}
    return socketEmit('tasks:update', { id, ...body })
  }
  if (/\/tasks\/(\d+)$/.test(url) && options.method === 'DELETE') {
    const id = parseInt(url.match(/\/(\d+)$/)[1])
    return socketEmit('tasks:delete', { id }).then(() => ({ success: true }))
  }
  if (/\/attachments\/(\d+)$/.test(url) && options.method === 'DELETE') {
    const id = parseInt(url.match(/\/(\d+)$/)[1])
    return socketEmit('attachments:delete', { id }).then(() => ({ success: true }))
  }

  // Fallback to HTTP for file uploads
  return fetch(url, {
    ...options,
    credentials: 'include'
  }).then(async r => {
    if (!r.ok) {
      const errorData = await r.json().catch(() => ({}));
      const errorMessage = errorData.error || 'Request failed';
      if (url.includes('/auth/') && r.status === 401) throw new Error(errorMessage)
      if (r.status === 401) throw new Error('AUTH_REQUIRED')
      throw new Error(errorMessage)
    }
    return r.json();
  })
}

function badgeText(status) {
  if (status === 'pending') return 'Pending'
  if (status === 'in-progress') return 'In Progress'
  if (status === 'completed') return 'Completed'
  return status
}

function validateFile(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'application/zip', 'application/x-rar-compressed'
  ];
  
  if (file.size > maxSize) {
    throw new Error(`File "${file.name}" is too large. Maximum size is 5MB.`);
  }
  
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`File type "${file.type}" is not allowed. Only images, PDFs, documents, and archives are allowed.`);
  }
  
  return true;
}

function validateFiles(files) {
  if (files.length > 10) {
    throw new Error('Too many files. Maximum 10 files per upload.');
  }
  
  for (const file of files) {
    validateFile(file);
  }
  
  return true;
}

function App() {
  const [tasks, setTasks] = useState([])
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  
  // Authentication state
  const [user, setUser] = useState(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)

  // Authentication functions
  const checkAuth = async () => {
    try {
      const data = await fetchJson(`${apiBase}/auth/me`)
      setUser(data.user)
      return true
    } catch (e) {
      setUser(null)
      return false
    }
  }

  const login = async (username, password) => {
    setAuthLoading(true)
    try {
      const data = await fetchJson(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      setUser(data.user)
      setShowLogin(false)
      setError('')
      return true
    } catch (e) {
   
      throw e
    } finally {
      setAuthLoading(false)
    }
  }

  const register = async (username, email, password) => {
    setAuthLoading(true)
    try {
      const data = await fetchJson(`${apiBase}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      })
      setUser(data.user)
      setShowRegister(false)
      setError('')
      return true
    } catch (e) {
  
      throw e
    } finally {
      setAuthLoading(false)
    }
  }

  const logout = async () => {
    try {
      await fetchJson(`${apiBase}/auth/logout`, { method: 'POST' })
      setUser(null)
      setTasks([])
    } catch (e) {
      console.error('Logout error:', e)
    }
  }

  const load = async () => {
    if (!user) return
    setLoading(true); setError('')
    try {
      const data = await fetchJson(`${apiBase}/tasks?status=${encodeURIComponent(status)}`)
      setTasks(data)
    } catch (e) { 
      if (e.message === 'AUTH_REQUIRED') {
        setUser(null)
        setShowLogin(true)
      } else {
        setError(e.message)
      }
    }
    finally { setLoading(false) }
  }

  useEffect(() => { 
    checkAuth().then(isAuthenticated => {
      if (isAuthenticated) {
        load()
      } else {
        setShowLogin(true)
      }
    })
  }, [])

  useEffect(() => { load() }, [status, user])

  const TaskCard = ({ t }) => {
    const delTask = async () => {
      if (!confirm('Delete task?')) return
      try {
        await fetchJson(`${apiBase}/tasks/${t.id}`, { method: 'DELETE' })
        load()
      } catch (e) {
        if (e.message === 'AUTH_REQUIRED') {
          setUser(null)
          setShowLogin(true)
        } else {
          alert('Failed to delete task: ' + e.message)
        }
      }
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
    const [editError, setEditError] = useState('')

    const save = async () => {
      setEditError('')
      
      // Validation
      if (!local.title.trim()) {
        setEditError('Title is required');
        return;
      }
      
      if (local.title.length > 255) {
        setEditError('Title must be 255 characters or less');
        return;
      }
      
      if (local.description.length > 10000) {
        setEditError('Description must be 10,000 characters or less');
        return;
      }
      
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
      } catch (e) { 
        setEditError(e.message)
      }
    }

    const uploadFiles = async (files) => {
      if (!files || files.length === 0) return
      
      try {
        validateFiles(Array.from(files));
        setEditError('') // Clear any previous errors
      } catch (error) {
        setEditError(error.message);
        return;
      }
      
      for (const file of Array.from(files)) {
        const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`
        const temp = { id: tempId, filename: file.name, originalName: file.name, url: '#', uploading: true }
        setAttachments(prev => [...prev, temp])

        const fd = new FormData();
        fd.append('attachment', file)
        try {
          const token = typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null
          const res = await fetch(`${apiBase}/tasks/${task.id}/attachments`, { 
            method: 'POST', 
            body: fd,
            credentials: 'include',
            headers: token ? { 'Authorization': `Bearer ${token}` } : undefined
          })
          if (res.ok) {
            const payload = await res.json().catch(()=>null)
            const items = Array.isArray(payload) ? payload : (payload ? [payload] : [])
            if (items.length) {
              const created = items[0]
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
            const errorData = await res.json().catch(() => ({}));
            setEditError(`File upload error: ${errorData.error || file.name}`)
            setAttachments(prev => prev.filter(a => a.id !== tempId))
          }
        } catch (e) {
          setEditError(`File upload error: ${e.message}`)
          setAttachments(prev => prev.filter(a => a.id !== tempId))
        }
      }
    }

    const delAttachment = async (id) => {
      try {
        await fetchJson(`${apiBase}/attachments/${id}`, { method: 'DELETE' })
        setAttachments(prev => prev.filter(a => a.id !== id))
        setEditError('') // Clear any previous errors
      } catch (e) {
        if (e.message === 'AUTH_REQUIRED') {
          setUser(null)
          setShowLogin(true)
        } else {
          setEditError('Failed to delete attachment: ' + e.message)
        }
      }
    }

    return (
      <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) onClose() }}>
        <div className="modal">
          <div className="modal-header">
            <h3>Edit Task</h3>
            <button aria-label="Close" className="delete-x" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            {editError && <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#ffe6e6', border: '1px solid #ff0000', borderRadius: '4px' }}>{editError}</div>}
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

  const LoginModal = ({ onClose }) => {
    const [formData, setFormData] = useState({ username: '', password: '' })
    const [loginError, setLoginError] = useState('')

    const handleSubmit = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      setLoginError('')
      
      // Basic validation
      if (!formData.username || !formData.password) {
        setLoginError('Please enter both username and password')
        return
      }
      
      try {
        const success = await login(formData.username, formData.password)
        if (success) {
          onClose()
        }
      } catch (e) {
        setLoginError(e.message || 'Invalid username or password')
        // Clear only password, keep username
        setFormData(prev => ({ ...prev, password: '' }))
      }
    }

    return (
      <div className="modal-backdrop" onClick={(e) => { 
        e.preventDefault()
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose() 
      }}>
        <div className="modal" onClick={(e) => { e.stopPropagation() }}>
          <div className="modal-header">
            <h3>Login</h3>
            <button aria-label="Close" className="delete-x" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <input
                  type="text"
                  placeholder="Username"
                  value={formData.username}
                  onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.75rem', marginBottom: '0.5rem' }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={formData.password}
                  onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.75rem' }}
                />
              </div>
              {loginError && <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#ffe6e6', border: '1px solid #ff0000', borderRadius: '4px', position: 'relative', zIndex: 1001 }}>{loginError}</div>}
              
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={authLoading}>
                  {authLoading ? 'Logging in...' : 'Login'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowRegister(true); onClose() }}>
                  Register
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  const RegisterModal = ({ onClose }) => {
    const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' })
    const [registerError, setRegisterError] = useState('')

    const handleSubmit = async (e) => {
      e.preventDefault()
      e.stopPropagation()
      setRegisterError('')
      
      // Frontend validation
      if (!formData.username || !formData.email || !formData.password || !formData.confirmPassword) {
        setRegisterError('Please fill in all fields')
        return
      }
      
      if (formData.username.length < 3 || formData.username.length > 50) {
        setRegisterError('Username must be 3-50 characters')
        return
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        setRegisterError('Please enter a valid email address')
        return
      }
      
      if (formData.password.length < 6) {
        setRegisterError('Password must be at least 6 characters')
        return
      }
      
      if (formData.password !== formData.confirmPassword) {
        setRegisterError('Passwords do not match')
        // Clear only passwords, keep username and email
        setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }))
        return
      }
      
      try {
        const success = await register(formData.username, formData.email, formData.password)
        if (success) {
          onClose()
        }
      } catch (e) {
        setRegisterError(e.message || 'Registration failed')
        // Keep username and email, clear passwords
        setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }))
      }
    }

    return (
      <div className="modal-backdrop" onClick={(e) => { 
        e.preventDefault()
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose() 
      }}>
        <div className="modal" onClick={(e) => { e.stopPropagation() }}>
          <div className="modal-header">
            <h3>Register</h3>
            <button aria-label="Close" className="delete-x" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <input
                  type="text"
                  placeholder="Username"
                  value={formData.username}
                  onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.75rem', marginBottom: '0.5rem' }}
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={formData.email}
                  onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.75rem', marginBottom: '0.5rem' }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={formData.password}
                  onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.75rem', marginBottom: '0.5rem' }}
                />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={formData.confirmPassword}
                  onChange={e => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.75rem' }}
                />
              </div>
              {registerError && <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#ffe6e6', border: '1px solid #ff0000', borderRadius: '4px', position: 'relative', zIndex: 1001 }}>{registerError}</div>}
              
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={authLoading}>
                  {authLoading ? 'Registering...' : 'Register'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowLogin(true); onClose() }}>
                  Login
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  const CreateModal = ({ onClose }) => {
    const [local, setLocal] = useState({ title: '', description: '', status: 'pending', dueDate: '' })
    const [files, setFiles] = useState([])
    const [fileInputKey, setFileInputKey] = useState(0)
    const [createError, setCreateError] = useState('')

    const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx))

    const addFiles = (newFiles) => {
      if (newFiles && newFiles.length > 0) {
        try {
          validateFiles(Array.from(newFiles));
          setFiles(prev => [...prev, ...Array.from(newFiles)])
          setFileInputKey(prev => prev + 1)
          setCreateError('') // Clear any previous errors
        } catch (error) {
          setCreateError(error.message);
        }
      }
    }

    const create = async () => {
      setCreateError('')
      
      // Validation
      if (!local.title.trim()) {
        setCreateError('Title is required');
        return;
      }
      
      if (local.title.length > 255) {
        setCreateError('Title must be 255 characters or less');
        return;
      }
      
      if (local.description.length > 10000) {
        setCreateError('Description must be 10,000 characters or less');
        return;
      }
      
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
            await fetch(`${apiBase}/tasks/${created.id}/attachments`, { 
              method: 'POST', 
              body: fd,
              credentials: 'include',
              headers: (()=>{ const t = localStorage.getItem('authToken'); return t ? { 'Authorization': `Bearer ${t}` } : {} })()
            })
          }
        }
        
        onClose();
        load();
      } catch (e) { 
        setCreateError(e.message)
      }
    }

    return (
      <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) onClose() }}>
        <div className="modal">
          <div className="modal-header">
            <h3>Create Task</h3>
            <button aria-label="Close" className="delete-x" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            {createError && <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#ffe6e6', border: '1px solid #ff0000', borderRadius: '4px' }}>{createError}</div>}
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
            {user ? (
              <>
                <span style={{ marginRight: '1rem' }}>Welcome, {user.username}!</span>
                <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>Add</button>
                <select className="header-filter" value={status} onChange={e=>setStatus(e.target.value)}>
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
                <a href="#" onClick={(e)=>{e.preventDefault(); load()}}>Refresh</a>
                <button className="btn btn-secondary" onClick={logout}>Logout</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => setShowLogin(true)}>Login</button>
                <button className="btn btn-secondary" onClick={() => setShowRegister(true)}>Register</button>
              </>
            )}
          </div>
        </nav>
      </header>

      <main>
        <div className="container">
          <section style={{flex:'1 1 auto'}}>
            {user ? (
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
            ) : (
              <div className="welcome-message" style={{textAlign: 'center', padding: '2rem'}}>
                <h2>Welcome to Task Manager</h2>
                <p>Please login or register to manage your tasks.</p>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer>
        <p>&copy; 2025 Task Manager by Rita</p>
      </footer>

      {editingTask && <EditModal task={editingTask} onClose={()=>setEditingTask(null)} />}
      {showCreate && <CreateModal onClose={()=>setShowCreate(false)} />}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} />}
    </>
  )
}

export default App
