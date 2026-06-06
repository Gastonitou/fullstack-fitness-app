const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'data.json');

// ====== JSON DATABASE ======
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [], nextUserId: 1, workouts: [], progress: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
if (!fs.existsSync(DB_PATH)) saveDB(loadDB());

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'fitness-app-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht eingeloggt' });
  next();
}

// ====== AUTH (same as weather app) ======
app.post('/api/register', (req, res) => {
  const db = loadDB();
  const { username, email, password } = req.body;
  if (!username || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Ungültige Eingabe' });
  if (db.users.find(u => u.username === username || u.email === email))
    return res.status(409).json({ error: 'Benutzername oder Email existiert bereits' });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  const user = { id: db.nextUserId++, username, email, password: salt + ':' + hash, created_at: new Date().toISOString() };
  db.users.push(user);
  saveDB(db);
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, user: { id: user.id, username, email } });
});

app.post('/api/login', (req, res) => {
  const db = loadDB();
  const { username, password } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
  const [salt, hash] = user.password.split(':');
  const check = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  if (hash !== check) return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, user: { id: user.id, username, email: user.email } });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', (req, res) => {
  if (req.session.userId) res.json({ loggedIn: true, user: { id: req.session.userId, username: req.session.username } });
  else res.json({ loggedIn: false });
});

// ====== WORKOUTS ======
const DEFAULT_WORKOUTS = [
  { id: 1, name: 'Bankdrücken', category: 'Push', sets: 4, reps: '10-12', icon: '🏋️' },
  { id: 2, name: 'Schulterdrücken', category: 'Push', sets: 3, reps: '10-12', icon: '🏋️' },
  { id: 3, name: 'Klimmzüge', category: 'Pull', sets: 3, reps: '8-10', icon: '💪' },
  { id: 4, name: 'Rudern', category: 'Pull', sets: 4, reps: '10-12', icon: '💪' },
  { id: 5, name: 'Kniebeugen', category: 'Beine', sets: 4, reps: '10-12', icon: '🦵' },
  { id: 6, name: 'Kreuzheben', category: 'Beine', sets: 3, reps: '8-10', icon: '🦵' },
  { id: 7, name: 'Bizeps Curls', category: 'Arme', sets: 3, reps: '12-15', icon: '💪' },
  { id: 8, name: 'Trizeps Dips', category: 'Arme', sets: 3, reps: '12-15', icon: '💪' },
  { id: 9, name: 'Planks', category: 'Core', sets: 3, reps: '60s', icon: '🔥' },
  { id: 10, name: 'Crunches', category: 'Core', sets: 3, reps: '20', icon: '🔥' },
  { id: 11, name: 'Laufband', category: 'Cardio', sets: 1, reps: '20min', icon: '🏃' },
  { id: 12, name: 'Jump Rope', category: 'Cardio', sets: 3, reps: '3min', icon: '🏃' },
];

// Get all exercises
app.get('/api/exercises', (req, res) => {
  res.json(DEFAULT_WORKOUTS);
});

// ====== USER WORKOUT PLANS ======
app.get('/api/workouts', requireAuth, (req, res) => {
  const db = loadDB();
  const plans = db.workouts.filter(w => w.userId === req.session.userId);
  res.json(plans);
});

app.post('/api/workouts', requireAuth, (req, res) => {
  const db = loadDB();
  const { name, exercises } = req.body;
  const plan = {
    id: Date.now(),
    userId: req.session.userId,
    name: name || 'Mein Workout',
    exercises: exercises || [],
    created_at: new Date().toISOString()
  };
  db.workouts.push(plan);
  saveDB(db);
  res.json(plan);
});

app.delete('/api/workouts/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.workouts = db.workouts.filter(w => !(w.id == req.params.id && w.userId === req.session.userId));
  saveDB(db);
  res.json({ success: true });
});

// ====== PROGRESS / TRACKING ======
app.get('/api/progress', requireAuth, (req, res) => {
  const db = loadDB();
  const entries = db.progress.filter(p => p.userId === req.session.userId);
  res.json(entries);
});

app.post('/api/progress', requireAuth, (req, res) => {
  const db = loadDB();
  const { exerciseId, sets, reps, weight, notes } = req.body;
  const entry = {
    id: Date.now(),
    userId: req.session.userId,
    exerciseId: exerciseId || 0,
    sets: sets || 0,
    reps: reps || 0,
    weight: weight || 0,
    notes: notes || '',
    date: new Date().toISOString().split('T')[0]
  };
  db.progress.push(entry);
  saveDB(db);
  res.json(entry);
});

// ====== STATS ======
app.get('/api/stats', requireAuth, (req, res) => {
  const db = loadDB();
  const entries = db.progress.filter(p => p.userId === req.session.userId);
  
  // Count unique training days
  const days = new Set(entries.map(e => e.date));
  
  // Current streak
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    if (days.has(ds)) streak++;
    else if (i > 0) break;
  }

  res.json({
    totalWorkouts: entries.length,
    trainingDays: days.size,
    streak: streak,
    thisMonth: [...days].filter(d => d.startsWith(today.toISOString().split('T')[0].substring(0, 7))).length
  });
});

// ====== ZITATE ======
app.get('/api/quote', (req, res) => {
  const quotes = [
    { text: "Der Schmerz von heute ist die Stärke von morgen.", author: "David Goggins" },
    { text: "Du bist nicht müde. Du hast aufgegeben.", author: "David Goggins" },
    { text: "Stay hard!", author: "David Goggins" },
    { text: "Discipline over motivation.", author: "Jocko Willink" },
    { text: "No excuses. No limits. No quitting.", author: "@workoutmotivation" },
    { text: "Es geht nicht darum wer anfängt, sondern wer dran bleibt.", author: "Unbekannt" },
    { text: "Dein Körper kann alles schaffen. Dein Kopf muss mitspielen.", author: "Unbekannt" },
    { text: "Mach es möglich. Jeden Tag.", author: "@workoutmotivation" },
    { text: "Trainier hart oder geh nach Hause.", author: "Unbekannt" },
    { text: "Der einzige leichte Tag war gestern.", author: "Navy SEALs" },
  ];
  res.json(quotes[Math.floor(Math.random() * quotes.length)]);
});

// ====== START ======
app.listen(PORT, () => {
  console.log(`✅ Fullstack Fitness läuft auf http://localhost:${PORT}`);
  console.log(`📁 Daten: ${DB_PATH}`);
});
