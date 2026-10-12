import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Keycloak from 'keycloak-js';
import './style.css';

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'chris-ikuzo',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'frontend'
});

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [profile, setProfile] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [filter, setFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dueAfter, setDueAfter] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [page, setPage] = useState(1);
  const [taskPagination, setTaskPagination] = useState({ page: 1, total_pages: 0, total: 0 });
  const refreshSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const api = useCallback(async (path, options = {}) => {
    await keycloak.updateToken(30);
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keycloak.token}`,
        ...options.headers
      }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || data.error || `Request failed (${response.status})`);
    }
    return response.status === 204 ? null : response.json();
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setError('');
    try {
      const taskFilters = new URLSearchParams({ page: String(page), limit: '20' });
      if (filter) taskFilters.set('status', filter);
      if (priorityFilter) taskFilters.set('priority', priorityFilter);
      if (projectFilter) taskFilters.set('project_id', projectFilter);
      if (assigneeFilter) taskFilters.set('assignee_id', assigneeFilter);
      if (search) taskFilters.set('search', search);
      if (dueAfter) taskFilters.set('due_after', `${dueAfter}T00:00:00.000Z`);
      if (dueBefore) taskFilters.set('due_before', `${dueBefore}T23:59:59.999Z`);
      const [me, projectResult, taskResult, stats] = await Promise.all([
        api('/api/me'),
        api('/api/projects?limit=100'),
        api(`/api/tasks?${taskFilters.toString()}`),
        api('/api/dashboard')
      ]);
      if (sequence !== refreshSequence.current) return;
      setProfile(me);
      setProjects(projectResult.data);
      setTasks(taskResult.data);
      setTaskPagination(taskResult.pagination);
      setDashboard(stats);
    } catch (err) {
      if (sequence === refreshSequence.current) setError(err.message);
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [api, filter, priorityFilter, projectFilter, assigneeFilter, search, dueAfter, dueBefore, page]);

  useEffect(() => {
    keycloak.init({ onLoad: 'login-required', pkceMethod: 'S256', checkLoginIframe: false })
      .then((valid) => {
        setAuthenticated(valid);
      })
      .catch((err) => {
        setError(`Sign-in failed: ${err.message}`);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (authenticated) refresh();
  }, [authenticated, refresh]);

  const roleLabel = useMemo(() => (profile?.roles || []).join(', ') || 'Member', [profile]);
  const canCreateProjects = (profile?.roles || []).some((role) => ['PROJECT_MANAGER', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(role));
  const canManageProjects = (profile?.roles || []).some((role) => ['ORG_ADMIN', 'SUPER_ADMIN'].includes(role));
  const canDeleteTasks = (profile?.roles || []).some((role) => ['PROJECT_MANAGER', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(role));

  async function createTask(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/tasks', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          project_id: form.get('project_id'),
          title: form.get('title'),
          description: form.get('description'),
          status: 'TODO',
          priority: form.get('priority')
        })
      });
      event.currentTarget.reset();
      setNotice('Task created.');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateStatus(task) {
    const next = task.status === 'TODO' ? 'IN_PROGRESS' : task.status === 'IN_PROGRESS' ? 'DONE' : 'TODO';
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: next, version: task.version })
      });
      setNotice('Task updated.');
      await refresh();
    } catch (err) {
      setError(err.message);
      if (err.message.includes('CONFLICT')) await refresh();
    }
  }

  async function editTask(task) {
    const title = window.prompt('Edit task title', task.title);
    if (title === null || !title.trim()) return;
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: title.trim(), version: task.version })
      });
      setNotice('Task updated.');
      await refresh();
    } catch (err) {
      setError(err.message);
      if (err.message.includes('CONFLICT')) await refresh();
    }
  }

  async function createProject(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), description: form.get('description') })
      });
      event.currentTarget.reset();
      setNotice('Project created.');
      await refresh();
    } catch (err) {
      setError(err.message);
    }

    async function removeTask(task) {
      if (!window.confirm(`Delete "${task.title}"?`)) return;
      try {
        await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
        setNotice('Task deleted.');
        await refresh();
      } catch (err) {
        setError(err.message);
      }
    }

    async function toggleProject(project) {
      try {
        await api(`/api/projects/${project.id}`, {
          method: 'PUT',
          body: JSON.stringify({ status: project.status === 'active' ? 'archived' : 'active' })
        });
        setNotice(`Project ${project.status === 'active' ? 'archived' : 'restored'}.`);
        await refresh();
      } catch (err) {
        setError(err.message);
      }
    }
  }

  if (!authenticated && loading) return <main className="center-state">Connecting securely to Keycloak…</main>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">taskline<span>.</span></a>
        <div className="account">
          <div><strong>{profile?.username || 'Signed-in user'}</strong><small>{roleLabel}</small></div>
          <button className="quiet-button" onClick={() => keycloak.logout({ redirectUri: window.location.origin })}>Log out</button>
        </div>
      </header>
      <main className="content">
        <section className="welcome">
          <div><p className="eyebrow">WORKSPACE</p><h1>Good work starts here.</h1>
            <p className="muted">Your organization’s projects, tasks, and momentum.</p></div>
          <button className="refresh-button" onClick={refresh}>↻ Refresh</button>
        </section>
        {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
        {notice && <div className="alert success" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}

        {dashboard && <section className="metrics">
          <Metric label="Projects" value={dashboard.projects} />
          <Metric label="Total tasks" value={dashboard.tasks.total} />
          <Metric label="Completed" value={dashboard.tasks.completed} />
          <Metric label="Overdue" value={dashboard.tasks.overdue} accent />
          <article className="metric completion"><span>Completion rate</span><strong>{dashboard.tasks.completion_rate}%</strong>
            <div className="progress"><i style={{ width: `${dashboard.tasks.completion_rate}%` }} /></div></article>
        </section>}

        <div className="columns">
          <section className="panel task-panel">
            <div className="panel-heading"><div><p className="eyebrow">ACTION LIST</p><h2>Tasks</h2></div>
            </div>
            <div className="filter-grid">
              <input aria-label="Search tasks" placeholder="Search tasks…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
              <select aria-label="Filter tasks by status" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
                <option value="">All statuses</option><option value="TODO">To do</option>
                <option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option>
              </select>
              <select aria-label="Filter tasks by priority" value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); setPage(1); }}>
                <option value="">All priorities</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
              </select>
              <select aria-label="Filter tasks by project" value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setPage(1); }}>
                <option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <input aria-label="Filter tasks by assignee ID" placeholder="Assignee ID" value={assigneeFilter} onChange={(event) => { setAssigneeFilter(event.target.value); setPage(1); }} />
              <label>Due after<input type="date" value={dueAfter} onChange={(event) => { setDueAfter(event.target.value); setPage(1); }} /></label>
              <label>Due before<input type="date" value={dueBefore} onChange={(event) => { setDueBefore(event.target.value); setPage(1); }} /></label>
            </div>
            {loading ? <p className="muted empty">Loading tasks…</p> : tasks.length === 0
              ? <p className="muted empty">No tasks yet. Create one to get started.</p>
              : <div className="task-list">{tasks.map((task) => <article className="task-row" key={task.id}>
                <button className={`status-dot ${task.status.toLowerCase()}`} aria-label={`Cycle status for ${task.title}`} onClick={() => updateStatus(task)} />
                <div className="task-copy"><h3>{task.title}</h3><p>{projects.find((project) => project.id === task.project_id)?.name || 'Project'} · {task.status.replace('_', ' ')}</p></div>
                <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                <button className="row-action" onClick={() => editTask(task)} aria-label={`Edit ${task.title}`}>Edit</button>
                {canDeleteTasks && <button className="row-action danger-action" onClick={() => removeTask(task)} aria-label={`Delete ${task.title}`}>×</button>}
              </article>)}</div>}
            {!loading && taskPagination.total_pages > 0 && <nav className="pagination" aria-label="Task pages">
              <span>{taskPagination.total} tasks · page {taskPagination.page} of {taskPagination.total_pages}</span>
              <div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
                <button disabled={page >= taskPagination.total_pages} onClick={() => setPage((value) => value + 1)}>Next</button></div>
            </nav>}
            <form className="inline-form" onSubmit={createTask}>
              <h3>New task</h3>
              <label>Title<input name="title" required maxLength="255" placeholder="What needs to get done?" /></label>
              <div className="form-row">
                <label>Project<select name="project_id" required defaultValue="">
                  <option value="" disabled>Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select></label>
                <label>Priority<select name="priority" defaultValue="MEDIUM"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label>
              </div>
              <label>Description<textarea name="description" rows="2" maxLength="2000" placeholder="Optional details" /></label>
              <button className="primary-button" disabled={!projects.length}>Add task</button>
            </form>
          </section>

          <aside className="side-column">
            <section className="panel">
              <div className="panel-heading"><div><p className="eyebrow">YOUR PORTFOLIO</p><h2>Projects</h2></div><span className="count-pill">{projects.length}</span></div>
              {projects.length ? <div className="project-list">{projects.map((project) => <div className="project-item" key={project.id}>
                <span className="project-mark">{project.name.slice(0, 1).toUpperCase()}</span><div><strong>{project.name}</strong><small>{project.status}</small></div>
                {canManageProjects && <button className="row-action" onClick={() => toggleProject(project)}>{project.status === 'active' ? 'Archive' : 'Restore'}</button>}
              </div>)}</div> : <p className="muted empty">No projects are available.</p>}
              {canCreateProjects && <ProjectForm onSubmit={createProject} />}
            </section>
            {dashboard && <section className="panel chart-panel"><p className="eyebrow">TASK BREAKDOWN</p><h2>By status</h2>
              <Breakdown values={dashboard.by_status} total={dashboard.tasks.total} />
              <h2 className="chart-subheading">By priority</h2>
              <Breakdown values={dashboard.by_priority} total={dashboard.tasks.total} />
            </section>}
          </aside>
        </div>
        {dashboard && <section className="panel trend-panel">
          <div className="panel-heading"><div><p className="eyebrow">LAST 30 DAYS</p><h2>Task activity</h2></div>
            <div className="legend"><span><i className="created-key" />Created</span><span><i className="completed-key" />Completed</span></div>
          </div>
          <div className="trend-chart" role="img" aria-label="Daily tasks created and completed over the last 30 days">
            {dashboard.daily_trend.map((item) => {
              const peak = Math.max(1, ...dashboard.daily_trend.flatMap((day) => [day.created, day.completed]));
              return <div className="trend-day" key={item.date} title={`${item.date}: ${item.created} created, ${item.completed} completed`}>
                <i className="created-bar" style={{ height: `${Math.max(item.created ? 5 : 0, (item.created / peak) * 100)}%` }} />
                <i className="completed-bar" style={{ height: `${Math.max(item.completed ? 5 : 0, (item.completed / peak) * 100)}%` }} />
              </div>;
            })}
          </div>
          <div className="trend-labels"><span>{dashboard.daily_trend[0]?.date}</span><span>{dashboard.daily_trend.at(-1)?.date}</span></div>
        </section>}
        <footer>Private to your organization · Authentication provided by Keycloak</footer>
      </main>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return <article className={`metric ${accent ? 'metric-accent' : ''}`}><span>{label}</span><strong>{value}</strong></article>;
}

function Breakdown({ values, total }) {
  return Object.entries(values).map(([name, value]) => {
    const percent = total ? (value / total) * 100 : 0;
    return <div className="bar-row" key={name}><div><span>{name.replace('_', ' ')}</span><b>{value}</b></div><div className="bar"><i style={{ width: `${percent}%` }} /></div></div>;
  });
}

function ProjectForm({ onSubmit }) {
  return <form className="project-form" onSubmit={onSubmit}>
    <h3>Create project</h3>
    <label>Name<input name="name" required maxLength="200" placeholder="Project name" /></label>
    <label>Description<input name="description" maxLength="4000" placeholder="Optional description" /></label>
    <button className="secondary-button">Add project</button>
  </form>;
}

createRoot(document.getElementById('root')).render(<App />);
