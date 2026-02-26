import { useState, useEffect } from 'react';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Load todos from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('todos');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Convert string dates back to Date objects
        const todosWithDates = parsed.map((todo: any) => ({
          ...todo,
          createdAt: new Date(todo.createdAt)
        }));
        setTodos(todosWithDates);
      } catch (e) {
        console.error('Failed to parse todos from localStorage', e);
      }
    }
  }, []);

  // Save todos to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('todos', JSON.stringify(todos));
  }, [todos]);

  const addTodo = () => {
    if (newTodo.trim() === '') return;
    
    const newTodoItem: Todo = {
      id: Date.now().toString(),
      text: newTodo.trim(),
      completed: false,
      createdAt: new Date()
    };
    
    setTodos([newTodoItem, ...todos]);
    setNewTodo('');
  };

  const deleteTodo = (id: string) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  const toggleTodo = (id: string) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const startEditing = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    if (editText.trim() === '') return;
    
    setTodos(todos.map(todo => 
      todo.id === editingId ? { ...todo, text: editText.trim() } : todo
    ));
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const filteredTodos = todos.filter(todo => {
    if (filter === 'active') return !todo.completed;
    if (filter === 'completed') return todo.completed;
    return true;
  });

  const activeCount = todos.filter(todo => !todo.completed).length;
  const completedCount = todos.length - activeCount;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (editingId) {
        saveEdit();
      } else {
        addTodo();
      }
    }
  };

  return (
    <div className="app">
      <div className="header">
        <h1>✨ Todo List</h1>
        <p className="subtitle">Organize your tasks with style</p>
      </div>
      
      <div className="todo-container">
        {/* Add Todo Form */}
        <div className="add-todo">
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What needs to be done?"
            className="todo-input"
          />
          <button onClick={addTodo} className="add-btn">
            ➕ Add
          </button>
        </div>

        {/* Filter Controls */}
        <div className="filter-controls">
          <button 
            onClick={() => setFilter('all')}
            className={filter === 'all' ? 'active' : ''}
          >
            All
          </button>
          <button 
            onClick={() => setFilter('active')}
            className={filter === 'active' ? 'active' : ''}
          >
            Active
          </button>
          <button 
            onClick={() => setFilter('completed')}
            className={filter === 'completed' ? 'active' : ''}
          >
            Completed
          </button>
        </div>

        {/* Todo List */}
        <div className="todo-list">
          {filteredTodos.length === 0 ? (
            <div className="empty-state">
              <p>{filter === 'all' ? 'No todos yet!' : 
                  filter === 'active' ? 'No active todos!' : 
                  'No completed todos!'}</p>
              <p className="hint">Add your first task to get started</p>
            </div>
          ) : (
            filteredTodos.map((todo) => (
              <div 
                key={todo.id} 
                className={`todo-item ${todo.completed ? 'completed' : ''} ${editingId === todo.id ? 'editing' : ''}`}
                style={{
                  animation: 'fadeIn 0.3s ease-out',
                  transition: 'all 0.2s ease'
                }}
              >
                {editingId === todo.id ? (
                  <div className="edit-form">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                      className="edit-input"
                    />
                    <div className="edit-actions">
                      <button onClick={saveEdit} className="save-btn">✓</button>
                      <button onClick={cancelEdit} className="cancel-btn">✕</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="todo-content">
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => toggleTodo(todo.id)}
                        className="todo-checkbox"
                      />
                      <span className="todo-text">{todo.text}</span>
                      <span className="todo-date">
                        {todo.createdAt.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="todo-actions">
                      <button 
                        onClick={() => startEditing(todo)}
                        className="edit-btn"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => deleteTodo(todo.id)}
                        className="delete-btn"
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Stats and Clear Completed */}
        <div className="stats">
          <div className="stats-info">
            <span className="active-count">{activeCount} active</span>
            <span className="completed-count">{completedCount} completed</span>
            <span className="total-count">{todos.length} total</span>
          </div>
          {completedCount > 0 && (
            <button 
              onClick={() => setTodos(todos.filter(todo => !todo.completed))}
              className="clear-completed"
            >
              Clear Completed
            </button>
          )}
        </div>
      </div>

      <footer className="app-footer">
        <p>✨ Built with React & Vite | Data persists in localStorage</p>
      </footer>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        .app {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 2rem;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .header {
          text-align: center;
          margin-bottom: 2rem;
        }
        
        .header h1 {
          color: white;
          font-weight: 700;
          font-size: 2.5rem;
          margin-bottom: 0.5rem;
          text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .subtitle {
          color: rgba(255,255,255,0.85);
          font-size: 1.1rem;
          font-weight: 400;
        }
        
        .todo-container {
          max-width: 600px;
          margin: 0 auto;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
          padding: 2rem;
          backdrop-filter: blur(10px);
        }
        
        .add-todo {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
        }
        
        .todo-input {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 1rem;
          transition: all 0.2s ease;
          outline: none;
        }
        
        .todo-input:focus {
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
        }
        
        .add-btn {
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);
        }
        
        .add-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        .filter-controls {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
        }
        
        .filter-controls button {
          padding: 0.5rem 1rem;
          background: white;
          border: 2px solid #e0e0e0;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        
        .filter-controls button.active {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          border-color: transparent;
        }
        
        .filter-controls button:hover:not(.active) {
          border-color: #667eea;
        }
        
        .todo-list {
          margin-bottom: 1.5rem;
        }
        
        .todo-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          margin-bottom: 0.75rem;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.05);
          border: 1px solid #f0f0f0;
          transition: all 0.2s ease;
          animation: fadeIn 0.3s ease-out;
        }
        
        .todo-item:hover:not(.editing) {
          transform: translateX(4px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        
        .todo-item.completed {
          opacity: 0.7;
        }
        
        .todo-content {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 1;
        }
        
        .todo-checkbox {
          width: 1.25rem;
          height: 1.25rem;
          cursor: pointer;
        }
        
        .todo-text {
          flex: 1;
          font-size: 1rem;
          color: #333;
        }
        
        .todo-item.completed .todo-text {
          text-decoration: line-through;
          color: #666;
        }
        
        .todo-date {
          font-size: 0.75rem;
          color: #999;
          font-weight: 300;
        }
        
        .todo-actions {
          display: flex;
          gap: 0.5rem;
        }
        
        .edit-btn, .delete-btn {
          background: none;
          border: none;
          width: 28px;
          height: 28px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        
        .edit-btn:hover {
          background: #f0f8ff;
          color: #667eea;
        }
        
        .delete-btn:hover {
          background: #fff0f0;
          color: #ff6b6b;
        }
        
        .edit-form {
          display: flex;
          width: 100%;
          gap: 0.5rem;
        }
        
        .edit-input {
          flex: 1;
          padding: 0.5rem 0.75rem;
          border: 2px solid #667eea;
          border-radius: 6px;
          font-size: 0.9rem;
          outline: none;
        }
        
        .edit-actions {
          display: flex;
          gap: 0.25rem;
        }
        
        .save-btn, .cancel-btn {
          width: 24px;
          height: 24px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          font-size: 0.7rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .save-btn {
          background: #4CAF50;
          color: white;
        }
        
        .cancel-btn {
          background: #f44336;
          color: white;
        }
        
        .stats {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 1rem;
          border-top: 1px solid #eee;
        }
        
        .stats-info {
          display: flex;
          gap: 1rem;
          font-size: 0.85rem;
          color: #666;
        }
        
        .clear-completed {
          padding: 0.5rem 1rem;
          background: #ff6b6b;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        
        .clear-completed:hover {
          background: #ff5252;
          transform: translateY(-1px);
        }
        
        .empty-state {
          text-align: center;
          padding: 2rem 1rem;
          color: #666;
        }
        
        .empty-state .hint {
          font-size: 0.85rem;
          color: #999;
          margin-top: 0.5rem;
        }
        
        .app-footer {
          text-align: center;
          margin-top: 2rem;
          color: rgba(255,255,255,0.7);
          font-size: 0.85rem;
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @media (max-width: 600px) {
          .app {
            padding: 1rem;
          }
          
          .todo-container {
            padding: 1.5rem;
          }
          
          .header h1 {
            font-size: 2rem;
          }
          
          .add-todo {
            flex-direction: column;
          }
          
          .stats {
            flex-direction: column;
            gap: 0.5rem;
            text-align: center;
          }
        }
      `}</style>
    </div>
  );
}

export default App;
