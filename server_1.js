// ═══════════════════════════════════════════════════════════════════
//  heyaHub — UNIFIED BACKEND SERVER
//  Compatible with: condo_portal.html  AND  condo_manager.html
//
//  SETUP:
//    npm init -y
//    npm install express better-sqlite3 cors multer
//    node server_1.js
//
//  API runs at: http://localhost:3000
//
//  Demo accounts:
//    Worker:  WRK-0001 / password123
//    Manager: manager@seaview.com / manager123
// ═══════════════════════════════════════════════════════════════════

const express  = require('express');
const Database = require('better-sqlite3');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/uploads',   express.static(path.join(__dirname, 'uploads')));
app.use('/documents', express.static(path.join(__dirname, 'documents')));
app.use(express.static(__dirname));

['uploads', 'documents'].forEach(function (dir) {
  var absDir = path.join(__dirname, dir);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
});

var docStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, 'documents')); },
  filename:    function (req, file, cb) {
    cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
var upload = multer({ storage: docStorage, limits: { fileSize: 20 * 1024 * 1024 } });


// ═══════════════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════════════
const db = new Database(path.join(__dirname, 'condo_portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS workers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT    NOT NULL UNIQUE,
    full_name   TEXT    NOT NULL,
    password    TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS condo_managers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    condo_name   TEXT NOT NULL,
    manager_name TEXT,
    email        TEXT NOT NULL UNIQUE,
    phone        TEXT NOT NULL DEFAULT '',
    password     TEXT NOT NULL DEFAULT 'manager123',
    role         TEXT NOT NULL DEFAULT 'Property Manager',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    title              TEXT    NOT NULL,
    meta               TEXT,
    assigned_to        INTEGER REFERENCES workers(id),
    task_date          TEXT    NOT NULL DEFAULT (date('now')),
    created_by_manager INTEGER REFERENCES condo_managers(id),
    week_start         TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id     INTEGER NOT NULL REFERENCES workers(id),
    manager_id    INTEGER NOT NULL REFERENCES condo_managers(id),
    visit_type    TEXT    NOT NULL DEFAULT 'first_visit',
    checkin_time  TEXT,
    checkout_time TEXT,
    gps_lat       TEXT,
    gps_lng       TEXT,
    photo_path    TEXT,
    reference_no  TEXT    NOT NULL UNIQUE,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_completions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL REFERENCES attendance_records(id),
    task_id       INTEGER NOT NULL DEFAULT 0,
    title         TEXT    NOT NULL,
    meta          TEXT,
    completed     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(attendance_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS attendance_documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL REFERENCES attendance_records(id),
    doc_type      TEXT    NOT NULL,
    file_name     TEXT    NOT NULL,
    file_path     TEXT    NOT NULL,
    uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Manager reviews on attendance records
  CREATE TABLE IF NOT EXISTS attendance_reviews (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL UNIQUE REFERENCES attendance_records(id),
    manager_id    INTEGER NOT NULL REFERENCES condo_managers(id),
    rating        INTEGER NOT NULL DEFAULT 0,
    comment       TEXT    NOT NULL DEFAULT '',
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_id INTEGER NOT NULL REFERENCES condo_managers(id),
    type       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    data       TEXT,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add 'role' column to existing condo_managers tables that pre-date this version
try {
  db.exec("ALTER TABLE condo_managers ADD COLUMN role TEXT NOT NULL DEFAULT 'Property Manager'");
} catch (e) { /* column already exists — ignore */ }

// Add reviews table if upgrading from older schema (idempotent)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS attendance_reviews (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL UNIQUE REFERENCES attendance_records(id),
    manager_id    INTEGER NOT NULL REFERENCES condo_managers(id),
    rating        INTEGER NOT NULL DEFAULT 0,
    comment       TEXT    NOT NULL DEFAULT '',
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
} catch (e) { /* already exists */ }


// ── Seed data ─────────────────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) AS n FROM condo_managers').get().n === 0) {
  db.prepare(`INSERT INTO condo_managers (condo_name, manager_name, email, phone, password, role)
              VALUES (?, ?, ?, ?, ?, ?)`
  ).run('Seaview Residences', 'Ms Lim Hui Ying', 'manager@seaview.com', '+6562345678', 'manager123', 'Property Manager');
  console.log('  Seeded demo manager: manager@seaview.com / manager123');
}

if (db.prepare('SELECT COUNT(*) AS n FROM workers').get().n === 0) {
  db.prepare(`INSERT INTO workers (employee_id, full_name, password) VALUES (?, ?, ?)`
  ).run('WRK-0001', 'Ahmad bin Razali', 'password123');
  console.log('  Seeded demo worker: WRK-0001 / password123');
}

if (db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n === 0) {
  var ins = db.prepare(`INSERT INTO tasks (title, meta, task_date) VALUES (?, ?, date('now'))`);
  [
    ['Inspect water pump — Block A',        '09:00-10:00 · Level B2'],
    ['Replace hallway lights — Levels 3-5', '10:30-12:00 · Block B'],
    ['ACMV filter cleaning — gym unit',     '13:00-14:30 · Recreational deck'],
    ['Pest control check — bin centre',     '15:00-15:45 · Basement'],
    ['Monthly safety walkthrough',          '16:00-17:00 · All blocks'],
  ].forEach(function (r) { ins.run(r[0], r[1]); });
  console.log('  Seeded 5 sample tasks.');
}


// ═══════════════════════════════════════════════════════════════════
//  SSE — LIVE PUSH TO MANAGER DASHBOARDS
// ═══════════════════════════════════════════════════════════════════
var sseClients = {};

function pushToManager(managerId, eventData) {
  var clients = sseClients[managerId] || [];
  var payload = 'data: ' + JSON.stringify(eventData) + '\n\n';
  clients.forEach(function (res) {
    try { res.write(payload); } catch (e) {}
  });
}

// IMPORTANT: defined BEFORE /api/notifications/:id/read so Express
// doesn't treat "stream" or "read-all" as an :id parameter.
app.get('/api/notifications/stream', function (req, res) {
  var managerId = req.query.managerId;
  if (!managerId) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  var heartbeat = setInterval(function () {
    try { res.write(': heartbeat\n\n'); } catch (e) {}
  }, 25000);

  if (!sseClients[managerId]) sseClients[managerId] = [];
  sseClients[managerId].push(res);

  var unread = db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE manager_id=? AND is_read=0'
  ).get(managerId);
  res.write('data: ' + JSON.stringify({ type: 'connected', unreadCount: unread.n }) + '\n\n');

  req.on('close', function () {
    clearInterval(heartbeat);
    sseClients[managerId] = (sseClients[managerId] || []).filter(function (c) { return c !== res; });
  });
});


// ═══════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════

// ── Worker login (condo_portal.html) ──
app.post('/api/login', function (req, res) {
  var employeeId = (req.body.employeeId || '').trim();
  var password   = req.body.password   || '';
  if (!employeeId || !password)
    return res.status(400).json({ error: 'Missing fields.' });

  var worker = db.prepare(
    'SELECT id, full_name, employee_id FROM workers WHERE employee_id=? AND password=?'
  ).get(employeeId, password);
  if (!worker) return res.status(401).json({ error: 'Invalid employee ID or password.' });

  res.json({ workerId: worker.id, fullName: worker.full_name, employeeId: worker.employee_id });
});

// ── Worker register (condo_portal.html) ──
app.post('/api/workers', function (req, res) {
  var employeeId = (req.body.employeeId || '').trim();
  var fullName   = (req.body.fullName   || '').trim();
  var password   = req.body.password    || '';
  if (!employeeId || !fullName || !password)
    return res.status(400).json({ error: 'Missing fields.' });
  try {
    var result = db.prepare(
      'INSERT INTO workers (employee_id, full_name, password) VALUES (?,?,?)'
    ).run(employeeId, fullName, password);
    res.json({ id: result.lastInsertRowid, employeeId, fullName });
  } catch (e) {
    res.status(409).json({ error: 'Employee ID already exists.' });
  }
});

// ── Manager login (condo_manager.html) ──
app.post('/api/manager/login', function (req, res) {
  var email    = (req.body.email    || '').trim();
  var password = req.body.password  || '';
  if (!email || !password)
    return res.status(400).json({ error: 'Missing fields.' });

  var mgr = db.prepare(
    `SELECT id, manager_name, condo_name, email, phone, role
     FROM condo_managers WHERE email=? AND password=?`
  ).get(email, password);
  if (!mgr) return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({
    managerId:   mgr.id,
    managerName: mgr.manager_name,
    condoName:   mgr.condo_name,
    email:       mgr.email,
    phone:       mgr.phone,
    role:        mgr.role
  });
});

// ── Manager register (condo_manager.html) ──
// This endpoint was MISSING from the original server.
app.post('/api/manager/register', function (req, res) {
  var managerName = (req.body.managerName || '').trim();
  var email       = (req.body.email       || '').trim();
  var password    = req.body.password     || '';
  var condoName   = (req.body.condoName   || '').trim();
  var role        = (req.body.role        || 'Property Manager').trim();

  if (!managerName || !email || !password || !condoName)
    return res.status(400).json({ error: 'Missing required fields.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    var result = db.prepare(
      `INSERT INTO condo_managers (manager_name, email, password, condo_name, role, phone)
       VALUES (?,?,?,?,?,?)`
    ).run(managerName, email, password, condoName, role, '');
    res.json({
      managerId:   result.lastInsertRowid,
      managerName, email, condoName, role
    });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'An account with this email already exists.' });
    res.status(500).json({ error: 'Server error.' });
  }
});


// ═══════════════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════════════

app.get('/api/tasks', function (req, res) {
  var date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(db.prepare(
    'SELECT id, title, meta, task_date, assigned_to FROM tasks WHERE task_date=? ORDER BY id ASC'
  ).all(date));
});

app.get('/api/tasks/range', function (req, res) {
  var from = req.query.from, to = req.query.to;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required.' });
  res.json(db.prepare(
    'SELECT * FROM tasks WHERE task_date >= ? AND task_date <= ? ORDER BY task_date ASC, id ASC'
  ).all(from, to));
});

app.post('/api/tasks', function (req, res) {
  var title      = req.body.title;
  var meta       = req.body.meta       || '';
  var managerId  = req.body.managerId  || null;
  var assignedTo = req.body.assignedTo || null;
  var dates      = req.body.dates;
  if (!dates && req.body.date) dates = [req.body.date];
  if (!title)                  return res.status(400).json({ error: 'title is required.' });
  if (!dates || !dates.length) return res.status(400).json({ error: 'date or dates[] required.' });

  var weekStart = dates.length > 1 ? dates[0] : null;
  var stmt = db.prepare(
    `INSERT INTO tasks (title, meta, task_date, created_by_manager, assigned_to, week_start)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  var ids = [];
  db.transaction(function () {
    dates.forEach(function (d) {
      var r = stmt.run(title, meta, d, managerId, assignedTo, weekStart);
      ids.push(r.lastInsertRowid);
    });
  })();
  if (managerId) pushToManager(managerId, { type: 'tasks_updated' });
  res.json({ success: true, ids, count: ids.length });
});

app.patch('/api/tasks/:id', function (req, res) {
  var fields = [], params = [];
  if (req.body.title      !== undefined) { fields.push('title=?');       params.push(req.body.title); }
  if (req.body.meta       !== undefined) { fields.push('meta=?');        params.push(req.body.meta); }
  if (req.body.task_date  !== undefined) { fields.push('task_date=?');   params.push(req.body.task_date); }
  if (req.body.assignedTo !== undefined) { fields.push('assigned_to=?'); params.push(req.body.assignedTo); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  db.prepare('UPDATE tasks SET ' + fields.join(',') + ' WHERE id=?').run(...params);
  res.json({ success: true });
});

app.delete('/api/tasks/:id', function (req, res) {
  db.prepare('DELETE FROM task_completions WHERE task_id=?').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ success: true });
});


// ═══════════════════════════════════════════════════════════════════
//  ATTENDANCE
// ═══════════════════════════════════════════════════════════════════

// ── Submit new attendance record (condo_portal.html) ──
app.post('/api/attendance', function (req, res) {
  var worker    = req.body.worker;
  var checkin   = req.body.checkin;
  var taskList  = req.body.tasks;
  var manager   = req.body.manager;
  var visitType = req.body.visitType || 'first_visit';

  if (!worker || !checkin || !manager)
    return res.status(400).json({ error: 'Missing required fields.' });

  // Find or create worker
  var workerRow = db.prepare('SELECT id, full_name FROM workers WHERE employee_id=?').get(worker.employeeId);
  if (!workerRow) {
    var wr = db.prepare('INSERT INTO workers (employee_id, full_name, password) VALUES (?,?,?)')
               .run(worker.employeeId, worker.name || worker.employeeId, 'changeme');
    workerRow = { id: wr.lastInsertRowid, full_name: worker.name || worker.employeeId };
  }

  // Find or create manager
  var mgrRow = db.prepare('SELECT id FROM condo_managers WHERE email=?').get(manager.email);
  if (!mgrRow) {
    var mr = db.prepare(
      `INSERT INTO condo_managers (condo_name, manager_name, email, phone, password)
       VALUES (?,?,?,?,?)`
    ).run(manager.condo || 'Unknown', manager.name || '', manager.email, manager.phone || '', 'manager123');
    mgrRow = { id: mr.lastInsertRowid };
  }

  // Save photo
  var photoPath = null;
  if (checkin.photoData) {
    var base64   = checkin.photoData.replace(/^data:image\/\w+;base64,/, '');
    var fileName = 'photo_' + Date.now() + '.jpg';
    photoPath    = path.join('uploads', fileName);
    fs.writeFileSync(path.join(__dirname, photoPath), Buffer.from(base64, 'base64'));
  }

  var refNo = 'ATT-' + Date.now().toString(36).toUpperCase();

  var attResult = db.prepare(`
    INSERT INTO attendance_records
      (worker_id, manager_id, visit_type, gps_lat, gps_lng, photo_path, reference_no)
    VALUES (?,?,?,?,?,?,?)
  `).run(workerRow.id, mgrRow.id, visitType,
          checkin.gpsLat || null, checkin.gpsLng || null, photoPath, refNo);
  var attendanceId = attResult.lastInsertRowid;

  // Insert task completions
  var completedTasks = [];
  if (Array.isArray(taskList)) {
    var insComp = db.prepare(
      `INSERT OR IGNORE INTO task_completions
         (attendance_id, task_id, title, meta, completed)
       VALUES (?,?,?,?,?)`
    );
    taskList.forEach(function (t) {
      var taskRow = t.id ? db.prepare('SELECT id, title, meta FROM tasks WHERE id=?').get(t.id) : null;
      var title   = (taskRow && taskRow.title) || t.title || '';
      var meta    = (taskRow && taskRow.meta)  || t.meta  || '';
      var taskId  = taskRow ? taskRow.id : (t.id || 0);
      try {
        insComp.run(attendanceId, taskId, title, meta, t.completed ? 1 : 0);
      } catch (e) {
        // Fallback if task_id=0 UNIQUE conflict — insert without UNIQUE constraint enforcement
        db.prepare(`INSERT INTO task_completions (attendance_id, task_id, title, meta, completed)
                    VALUES (?,?,?,?,?)`).run(attendanceId, taskId, title, meta, t.completed ? 1 : 0);
      }
      if (t.completed) completedTasks.push(title);
    });
  }

  // Notification
  var notifTitle = workerRow.full_name + ' checked in';
  var notifBody  = 'At ' + (manager.condo || 'unknown condo') + '. ' +
                   completedTasks.length + ' task(s) completed.';
  var notifDataObj = {
    attendanceId, referenceNo: refNo,
    workerName: workerRow.full_name, condoName: manager.condo,
    photoPath, completedTasks,
    gpsLat: checkin.gpsLat, gpsLng: checkin.gpsLng, visitType
  };

  var notifResult = db.prepare(
    'INSERT INTO notifications (manager_id, type, title, body, data) VALUES (?,?,?,?,?)'
  ).run(mgrRow.id, 'new_checkin', notifTitle, notifBody, JSON.stringify(notifDataObj));

  pushToManager(mgrRow.id, {
    type: 'new_checkin',
    notifId: notifResult.lastInsertRowid,
    title: notifTitle, body: notifBody,
    data: notifDataObj, createdAt: new Date().toISOString()
  });

  res.json({ success: true, referenceNo: refNo, attendanceId });
});

// ── Clock-in timestamp (condo_portal.html clicks "Clock In") ──
app.post('/api/attendance/:id/checkin', function (req, res) {
  var row = db.prepare('SELECT id, manager_id, worker_id FROM attendance_records WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found.' });

  var now = new Date().toISOString();
  db.prepare('UPDATE attendance_records SET checkin_time=? WHERE id=?').run(now, row.id);

  var worker     = db.prepare('SELECT full_name FROM workers WHERE id=?').get(row.worker_id);
  var notifTitle = (worker ? worker.full_name : 'Worker') + ' checked in on site';
  var notifBody  = 'Check-in time recorded: ' + new Date(now).toLocaleTimeString('en-SG');
  var notifData  = JSON.stringify({ attendanceId: row.id });

  var notifResult = db.prepare(
    'INSERT INTO notifications (manager_id, type, title, body, data) VALUES (?,?,?,?,?)'
  ).run(row.manager_id, 'checkin_time', notifTitle, notifBody, notifData);

  pushToManager(row.manager_id, {
    type: 'checkin_time',
    notifId: notifResult.lastInsertRowid,
    title: notifTitle, body: notifBody,
    data: { attendanceId: row.id }, createdAt: now
  });

  res.json({ success: true, checkin_time: now });
});

// ── Clock-out timestamp (condo_portal.html clicks "Clock Out") ──
app.post('/api/attendance/:id/checkout', function (req, res) {
  var row = db.prepare('SELECT id, manager_id, worker_id FROM attendance_records WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found.' });

  var now = new Date().toISOString();
  db.prepare('UPDATE attendance_records SET checkout_time=? WHERE id=?').run(now, row.id);

  var taskList = req.body.tasks;
  var completedCount = 0;
  var totalCount = 0;
  if (Array.isArray(taskList)) {
    var upsertComp = db.prepare(
      `INSERT INTO task_completions
         (attendance_id, task_id, title, meta, completed)
       VALUES (?,?,?,?,?)
       ON CONFLICT(attendance_id, task_id) DO UPDATE SET
         title=excluded.title,
         meta=excluded.meta,
         completed=excluded.completed`
    );
    taskList.forEach(function (t) {
      var taskRow = t.id ? db.prepare('SELECT id, title, meta FROM tasks WHERE id=?').get(t.id) : null;
      var title   = (taskRow && taskRow.title) || t.title || '';
      var meta    = (taskRow && taskRow.meta)  || t.meta  || '';
      var taskId  = taskRow ? taskRow.id : (t.id || 0);
      var done    = t.completed ? 1 : 0;
      if (done) completedCount++;
      totalCount++;
      upsertComp.run(row.id, taskId, title, meta, done);
    });
  }

  var worker     = db.prepare('SELECT full_name FROM workers WHERE id=?').get(row.worker_id);
  var notifTitle = (worker ? worker.full_name : 'Worker') + ' checked out';
  var pct = totalCount ? Math.round((completedCount / totalCount) * 100) : null;
  var notifBody  = 'Checkout time recorded: ' + new Date(now).toLocaleTimeString('en-SG') +
                   (pct !== null ? '. Tasks completed: ' + pct + '%.' : '');
  var notifData  = JSON.stringify({ attendanceId: row.id, taskProgress: { completed: completedCount, total: totalCount, pct: pct } });

  var notifResult = db.prepare(
    'INSERT INTO notifications (manager_id, type, title, body, data) VALUES (?,?,?,?,?)'
  ).run(row.manager_id, 'checkout_time', notifTitle, notifBody, notifData);

  pushToManager(row.manager_id, {
    type: 'checkout_time',
    notifId: notifResult.lastInsertRowid,
    title: notifTitle, body: notifBody,
    data: { attendanceId: row.id, taskProgress: { completed: completedCount, total: totalCount, pct: pct } }, createdAt: now
  });

  res.json({ success: true, checkout_time: now });
});

// ── Get all attendance records (manager dashboard list) ──
app.get('/api/attendance', function (req, res) {
  var query = `
    SELECT
      ar.id, ar.reference_no, ar.visit_type,
      ar.checkin_time, ar.checkout_time,
      ar.gps_lat, ar.gps_lng, ar.photo_path,
      ar.created_at,
      w.full_name   AS worker_name,
      w.employee_id,
      cm.condo_name,
      cm.manager_name,
      cm.email      AS manager_email,
      cm.phone      AS manager_phone,
      (SELECT COUNT(*) FROM task_completions tc WHERE tc.attendance_id=ar.id) AS task_total,
      (SELECT COUNT(*) FROM task_completions tc WHERE tc.attendance_id=ar.id AND tc.completed=1) AS task_done
    FROM attendance_records ar
    JOIN workers        w  ON w.id  = ar.worker_id
    JOIN condo_managers cm ON cm.id = ar.manager_id
    WHERE 1=1
  `;
  var params = [];
  if (req.query.managerId) { query += ' AND ar.manager_id=?'; params.push(req.query.managerId); }
  if (req.query.workerId)  { query += ' AND ar.worker_id=?';  params.push(req.query.workerId); }
  if (req.query.date)      { query += ' AND date(ar.created_at)=?'; params.push(req.query.date); }
  query += ' ORDER BY ar.created_at DESC LIMIT 200';
  res.json(db.prepare(query).all(...params));
});

// ── Get single attendance record by ID (condo_manager.html modal) ──
// This endpoint was MISSING from the original server.
// The manager portal always fetches a fresh record when opening the modal,
// so clock-in/out times are never stale.
app.get('/api/attendance/:id', function (req, res) {
  var row = db.prepare(`
    SELECT
      ar.id, ar.reference_no, ar.visit_type,
      ar.checkin_time, ar.checkout_time,
      ar.gps_lat, ar.gps_lng, ar.photo_path,
      ar.created_at,
      w.full_name   AS worker_name,
      w.employee_id,
      cm.condo_name,
      cm.manager_name,
      cm.email      AS manager_email,
      cm.phone      AS manager_phone,
      (SELECT COUNT(*) FROM task_completions tc WHERE tc.attendance_id=ar.id) AS task_total,
      (SELECT COUNT(*) FROM task_completions tc WHERE tc.attendance_id=ar.id AND tc.completed=1) AS task_done
    FROM attendance_records ar
    JOIN workers        w  ON w.id  = ar.worker_id
    JOIN condo_managers cm ON cm.id = ar.manager_id
    WHERE ar.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Attendance record not found.' });
  res.json(row);
});

// ── Get tasks for a specific attendance record (modal) ──
app.get('/api/attendance/:id/tasks', function (req, res) {
  res.json(db.prepare(
    'SELECT task_id AS id, title, meta, completed FROM task_completions WHERE attendance_id=?'
  ).all(req.params.id));
});

// ── Get documents for a specific attendance record (modal) ──
app.get('/api/attendance/:id/documents', function (req, res) {
  res.json(db.prepare(
    'SELECT id, doc_type, file_name, file_path, uploaded_at FROM attendance_documents WHERE attendance_id=?'
  ).all(req.params.id));
});

// ── Upload document (condo_portal.html docs page) ──
app.post('/api/attendance/:id/documents', upload.single('file'), function (req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  var docType = req.body.docType || 'other';
  db.prepare(
    'INSERT INTO attendance_documents (attendance_id, doc_type, file_name, file_path) VALUES (?,?,?,?)'
  ).run(req.params.id, docType, req.file.originalname, req.file.path);
  res.json({ success: true, fileName: req.file.originalname });
});

// ── Save / update manager review (condo_manager.html modal) ──
// This endpoint was MISSING from the original server.
// Accepts { rating: 0-5, comment: "..." }
// Uses UPSERT so repeated saves overwrite the previous review gracefully.
app.post('/api/attendance/:id/review', function (req, res) {
  var attendanceId = req.params.id;
  var rating  = parseInt(req.body.rating  || 0, 10);
  var comment = (req.body.comment || '').trim();

  var rec = db.prepare('SELECT id, manager_id FROM attendance_records WHERE id=?').get(attendanceId);
  if (!rec) return res.status(404).json({ error: 'Attendance record not found.' });

  // Validate rating
  if (rating < 0 || rating > 5) rating = 0;

  db.prepare(`
    INSERT INTO attendance_reviews (attendance_id, manager_id, rating, comment, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(attendance_id) DO UPDATE SET
      rating     = excluded.rating,
      comment    = excluded.comment,
      updated_at = excluded.updated_at
  `).run(attendanceId, rec.manager_id, rating, comment);

  res.json({ success: true, attendanceId, rating, comment });
});

// ── Get review for an attendance record ──
// Useful for pre-populating the review box when re-opening the modal.
app.get('/api/attendance/:id/review', function (req, res) {
  var review = db.prepare(
    'SELECT rating, comment, updated_at FROM attendance_reviews WHERE attendance_id=?'
  ).get(req.params.id);
  res.json(review || { rating: 0, comment: '', updated_at: null });
});

// ── Worker stats ──
app.get('/api/workers/:id/stats', function (req, res) {
  var stats = db.prepare(`
    SELECT COUNT(DISTINCT cm.condo_name) AS condoCount
    FROM attendance_records ar
    JOIN condo_managers cm ON cm.id = ar.manager_id
    WHERE ar.worker_id = ?
  `).get(req.params.id);

  var condoCount = stats ? stats.condoCount : 0;
  res.json({
    initialization: 50,
    incentiveTotal: condoCount * 50,
    condoCount
  });
});


// ── No-show report (condo_portal.html) ──
app.post('/api/noshow', function (req, res) {
  var condoId    = req.body.condoId    || null;
  var condoName  = (req.body.condoName || '').trim();
  var workerId   = req.body.workerId   || null;
  var employeeId = (req.body.employeeId|| '').trim();
  var comment    = (req.body.comment   || '').trim();
  console.log('[no-show] worker=' + employeeId + ' condo=' + condoName + ' comment=' + comment);
  res.json({ success: true });
});


// ═══════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════

// Get all notifications (manager dashboard)
app.get('/api/notifications', function (req, res) {
  var managerId = req.query.managerId;
  if (!managerId) return res.status(400).json({ error: 'managerId required.' });
  var rows = db.prepare(
    'SELECT * FROM notifications WHERE manager_id=? ORDER BY created_at DESC LIMIT 100'
  ).all(managerId);
  rows = rows.map(function (r) { r.data = r.data ? JSON.parse(r.data) : null; return r; });
  res.json(rows);
});

// Mark ALL read (condo_manager.html "Mark all read" button)
// Must be defined BEFORE /:id/read — see SSE note above.
app.patch('/api/notifications/read-all', function (req, res) {
  var managerId = req.body.managerId;
  if (!managerId) return res.status(400).json({ error: 'managerId required.' });
  db.prepare('UPDATE notifications SET is_read=1 WHERE manager_id=?').run(managerId);
  res.json({ success: true });
});

// Mark single notification as read (condo_manager.html clicks a notification)
app.patch('/api/notifications/:id/read', function (req, res) {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});


// ═══════════════════════════════════════════════════════════════════
//  WORKERS & MANAGERS (listing / admin)
// ═══════════════════════════════════════════════════════════════════

app.get('/api/workers', function (req, res) {
  res.json(db.prepare(
    'SELECT id, employee_id, full_name, created_at FROM workers ORDER BY created_at DESC'
  ).all());
});

app.get('/api/managers', function (req, res) {
  res.json(db.prepare(
    'SELECT id, condo_name, manager_name, email, phone, role, created_at FROM condo_managers ORDER BY created_at DESC'
  ).all());
});


// ═══════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════
app.listen(PORT, function () {
  console.log('');
  console.log('  ✓ heyaHub server running at  http://localhost:' + PORT);
  console.log('  ✓ Worker portal   →  http://localhost:' + PORT + '/condo_portal.html');
  console.log('  ✓ Manager portal  →  http://localhost:' + PORT + '/condo_manger.html');
  console.log('');
  console.log('  API endpoints:');
  console.log('    POST  /api/login                       Worker sign-in');
  console.log('    POST  /api/workers                     Worker registration');
  console.log('    POST  /api/manager/login               Manager sign-in');
  console.log('    POST  /api/manager/register            Manager registration');
  console.log('    POST  /api/attendance                  Submit attendance record');
  console.log('    POST  /api/attendance/:id/checkin      Record clock-in time');
  console.log('    POST  /api/attendance/:id/checkout     Record clock-out time');
  console.log('    GET   /api/attendance                  List all records (manager)');
  console.log('    GET   /api/attendance/:id              Single record (modal fresh fetch)');
  console.log('    GET   /api/attendance/:id/tasks        Task completions for modal');
  console.log('    GET   /api/attendance/:id/documents    Uploaded docs for modal');
  console.log('    POST  /api/attendance/:id/documents    Upload a document');
  console.log('    POST  /api/attendance/:id/review       Save/update manager review');
  console.log('    GET   /api/attendance/:id/review       Load saved review');
  console.log('    GET   /api/notifications               List notifications');
  console.log('    GET   /api/notifications/stream        SSE live push');
  console.log('    PATCH /api/notifications/read-all      Mark all read');
  console.log('    PATCH /api/notifications/:id/read      Mark one read');
  console.log('    GET   /api/workers                     List all workers');
  console.log('    GET   /api/workers/:id/stats           Worker incentive stats');
  console.log('    GET   /api/managers                    List all managers');
  console.log('    GET   /api/tasks                       Tasks for a date');
  console.log('    POST  /api/tasks                       Create task(s)');
  console.log('    PATCH /api/tasks/:id                   Update task');
  console.log('    DELETE /api/tasks/:id                  Delete task');
  console.log('    POST  /api/noshow                      Worker no-show report');
  console.log('');
  console.log('  Demo accounts:');
  console.log('    Worker:  WRK-0001 / password123');
  console.log('    Manager: manager@seaview.com / manager123');
  console.log('');
});
