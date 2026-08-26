import React, { useEffect, useState } from 'react';
import { taskApi } from '../api/client.js';

const COLUMNS = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function Board() {
  const user = JSON.parse(sessionStorage.getItem('user') || 'null');
  // In a real app, teamId would come from a team-picker/route param.
  const [teamId, setTeamId] = useState(sessionStorage.getItem('teamId') || '');
  const [tasks, setTasks] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState(null);

  async function loadTasks() {
    if (!teamId) return;
    try {
      const { tasks } = await taskApi.list(teamId);
      setTasks(tasks);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadTasks(); }, [teamId]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim() || !teamId) return;
    try {
      await taskApi.create({ teamId, title: newTitle.trim() });
      setNewTitle('');
      loadTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  async function moveTask(task, newStatus) {
    try {
      await taskApi.update(task.id, { status: newStatus });
      loadTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="board">
      <div className="board-toolbar">
        <span>Signed in as {user?.displayName || 'unknown'}</span>
        <input
          placeholder="Team ID"
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
            sessionStorage.setItem('teamId', e.target.value);
          }}
        />
        <form onSubmit={handleCreate}>
          <input placeholder="New task title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button type="submit">Add task</button>
        </form>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="board-columns">
        {COLUMNS.map((col) => (
          <div className="board-column" key={col.key}>
            <h3>{col.label}</h3>
            {tasks.filter((t) => t.status === col.key).map((task) => (
              <div className="task-card" key={task.id}>
                <p className="task-title">{task.title}</p>
                {task.due_date && <p className="task-due">Due {task.due_date}</p>}
                <div className="task-actions">
                  {COLUMNS.filter((c) => c.key !== task.status).map((c) => (
                    <button key={c.key} onClick={() => moveTask(task, c.key)}>
                      → {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
