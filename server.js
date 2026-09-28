const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(UPLOAD_DIR, {recursive:true});

const db = new Database(path.join(DATA_DIR,'nova.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 slug TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
 client_id INTEGER PRIMARY KEY,
 home_photo TEXT DEFAULT '',
 theme TEXT DEFAULT 'burgundy',
 intro_title TEXT DEFAULT 'Open when…',
 intro_subtitle TEXT DEFAULT 'a little piece of my heart, waiting for you.',
 intro_text TEXT DEFAULT 'I made these little letters for the moments when you need me, even when I’m not right beside you.',
 recipient TEXT DEFAULT 'YOUR LOVE',
 sender TEXT DEFAULT 'YOUR NAME',
 song_url TEXT DEFAULT '',
 song_file TEXT DEFAULT '',
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS letters (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0,
 icon TEXT DEFAULT '♡',
 title TEXT NOT NULL,
 body TEXT DEFAULT '',
 cover_photo TEXT DEFAULT '',
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS letter_photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 letter_id INTEGER NOT NULL,
 file_path TEXT NOT NULL,
 FOREIGN KEY(letter_id) REFERENCES letters(id) ON DELETE CASCADE
);
`);
try { db.exec("ALTER TABLE settings ADD COLUMN song_file TEXT DEFAULT ''"); } catch (_) {}

app.set('view engine','ejs');
app.set('views', path.join(__dirname,'views'));
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
app.use(session({
 secret: process.env.SESSION_SECRET || 'change-this-in-production',
 resave:false,
 saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*24*7}
}));

const storage = multer.diskStorage({
 destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
 filename:(req,file,cb)=>{
   const ext=path.extname(file.originalname).toLowerCase();
   cb(null, crypto.randomBytes(10).toString('hex')+'-'+Date.now()+ext);
 }
});
const upload=multer({storage, limits:{fileSize:50*1024*1024}});

function slugify(s){
 return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'love';
}
function uniqueSlug(name){
 let s=slugify(name), n=s, i=2;
 while(db.prepare('SELECT id FROM clients WHERE slug=?').get(n)){ n=s+'-'+i++; }
 return n;
}
function requireAdmin(req,res,next){ if(!req.session.adminId) return res.redirect('/admin/login'); next(); }
function requireClient(req,res,next){ if(!req.session.clientId) return res.redirect('/login'); next(); }

app.get('/',(req,res)=>{
 if(req.session.adminId) return res.redirect('/admin');
 if(req.session.clientId) return res.redirect('/editor');
 res.render('home');
});
app.get('/setup',(req,res)=>{
 const exists=db.prepare('SELECT id FROM admins LIMIT 1').get();
 if(exists) return res.redirect('/admin/login');
 res.render('setup',{error:null});
});
app.post('/setup',(req,res)=>{
 const {username,password}=req.body;
 if(!username || !password || password.length<6) return res.render('setup',{error:'Username and password are required. Password must be at least 6 characters.'});
 try{
   const hash=bcrypt.hashSync(password,10);
   db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username.trim(),hash);
   res.redirect('/admin/login');
 }catch(e){res.render('setup',{error:'Could not create admin. Try another username.'});}
});

app.get('/admin/login',(req,res)=>res.render('admin-login',{error:null}));
app.post('/admin/login',(req,res)=>{
 const a=db.prepare('SELECT * FROM admins WHERE username=?').get(req.body.username);
 if(!a || !bcrypt.compareSync(req.body.password,a.password_hash)) return res.render('admin-login',{error:'Incorrect username or password.'});
 req.session.adminId=a.id; res.redirect('/admin');
});
app.post('/admin/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

app.get('/admin',requireAdmin,(req,res)=>{
 const clients=db.prepare('SELECT id,name,username,slug,created_at FROM clients ORDER BY id DESC').all();
 res.render('admin',{clients});
});
app.post('/admin/clients',requireAdmin,(req,res)=>{
 const {name,username,password}=req.body;
 if(!name||!username||!password) return res.redirect('/admin?error=missing');
 try{
  const slug=uniqueSlug(name);
  const hash=bcrypt.hashSync(password,10);
  const info=db.prepare('INSERT INTO clients(slug,name,username,password_hash) VALUES(?,?,?,?)').run(name.trim(),username.trim(),hash);
  db.prepare('INSERT INTO settings(client_id) VALUES(?)').run(info.lastInsertRowid);
  // starter letters, editable/deletable by customer
  const starters=[
   ['✦',"You're sad",''],
   ['♡',"You miss me",''],
   ['☼',"You're angry with me",''],
   ['☾',"You can't sleep",''],
   ['✦','You need motivation',''],
   ['♡','You want to feel loved',''],
   ['☼','You need a smile',''],
   ['✧','You need to remember us','']
  ];
  const ins=db.prepare('INSERT INTO letters(client_id,sort_order,icon,title,body) VALUES(?,?,?,?,?)');
  starters.forEach((x,i)=>ins.run(info.lastInsertRowid,i,...x));
  res.redirect('/admin');
 }catch(e){res.redirect('/admin?error=exists');}
});
app.post('/admin/clients/:id/delete',requireAdmin,(req,res)=>{
 const c=db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
 if(c){ db.prepare('DELETE FROM letter_photos WHERE letter_id IN (SELECT id FROM letters WHERE client_id=?)').run(c.id);
 db.prepare('DELETE FROM letters WHERE client_id=?').run(c.id);
 db.prepare('DELETE FROM settings WHERE client_id=?').run(c.id);
 db.prepare('DELETE FROM clients WHERE id=?').run(c.id); }
 res.redirect('/admin');
});

app.get('/login',(req,res)=>res.render('client-login',{error:null}));
app.post('/login',(req,res)=>{
 const c=db.prepare('SELECT * FROM clients WHERE username=?').get(req.body.username);
 if(!c || !bcrypt.compareSync(req.body.password,c.password_hash)) return res.render('client-login',{error:'Incorrect username or password.'});
 req.session.clientId=c.id; res.redirect('/editor');
});
app.post('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

function getClientData(id){
 const c=db.prepare('SELECT id,name,username,slug FROM clients WHERE id=?').get(id);
 const settings=db.prepare('SELECT * FROM settings WHERE client_id=?').get(id);
 const letters=db.prepare('SELECT * FROM letters WHERE client_id=? ORDER BY sort_order,id').all(id);
 letters.forEach(l=>l.photos=db.prepare('SELECT * FROM letter_photos WHERE letter_id=?').all(l.id));
 return {client:c,settings,letters};
}
app.get('/editor',requireClient,(req,res)=>{
 res.render('editor',{...getClientData(req.session.clientId),query:req.query});
});
const settingsUpload=upload.fields([{name:'home_photo',maxCount:1},{name:'song_file',maxCount:1}]);
app.post('/editor/settings',requireClient,settingsUpload,(req,res)=>{
 const id=req.session.clientId;
 const old=db.prepare('SELECT home_photo FROM settings WHERE client_id=?').get(id);
 const home=req.files?.home_photo?.[0]?('/uploads/'+req.files.home_photo[0].filename):(old?.home_photo||'');
 const fields=['theme','intro_title','intro_subtitle','intro_text','recipient','sender','song_url'];
 const vals=fields.map(k=>req.body[k]||'');
 const oldSong=db.prepare('SELECT song_file FROM settings WHERE client_id=?').get(id);
 const song=req.files && req.files.song_file ? ('/uploads/'+req.files.song_file[0].filename) : (oldSong?.song_file||'');
 db.prepare(`UPDATE settings SET home_photo=?, theme=?, intro_title=?, intro_subtitle=?, intro_text=?, recipient=?, sender=?, song_url=?, song_file=? WHERE client_id=?`)
 .run(home,...vals,song,id);
 res.redirect('/editor?saved=1');
});
app.post('/editor/letters/add',requireClient,(req,res)=>{
 const id=req.session.clientId;
 const max=db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM letters WHERE client_id=?').get(id).m;
 db.prepare('INSERT INTO letters(client_id,sort_order,title,body,icon) VALUES(?,?,?,?,?)').run(id,max+1,req.body.title||'Open when…',req.body.body||'',req.body.icon||'♡');
 res.redirect('/editor');
});
app.post('/editor/letters/:id/save',requireClient,upload.array('photos',20),(req,res)=>{
 const letter=db.prepare('SELECT * FROM letters WHERE id=? AND client_id=?').get(req.params.id,req.session.clientId);
 if(!letter) return res.redirect('/editor');
 const cover=req.file && req.file.length ? null : null;
 const files=req.files||[];
 let coverPath=letter.cover_photo||'';
 if(files[0] && req.body.use_first_as_cover==='on') coverPath='/uploads/'+files[0].filename;
 db.prepare('UPDATE letters SET title=?,body=?,icon=?,cover_photo=? WHERE id=? AND client_id=?')
  .run(req.body.title||letter.title,req.body.body||'',req.body.icon||'♡',coverPath,letter.id,req.session.clientId);
 const ins=db.prepare('INSERT INTO letter_photos(letter_id,file_path) VALUES(?,?)');
 files.forEach(f=>ins.run(letter.id,'/uploads/'+f.filename));
 res.redirect('/editor?saved=1');
});
app.post('/editor/letters/:id/delete',requireClient,(req,res)=>{
 const l=db.prepare('SELECT * FROM letters WHERE id=? AND client_id=?').get(req.params.id,req.session.clientId);
 if(l){db.prepare('DELETE FROM letter_photos WHERE letter_id=?').run(l.id);db.prepare('DELETE FROM letters WHERE id=?').run(l.id);}
 res.redirect('/editor');
});

app.get('/open/:slug',(req,res)=>{
 const c=db.prepare('SELECT id,name,slug FROM clients WHERE slug=?').get(req.params.slug);
 if(!c) return res.status(404).render('not-found');
 res.render('public-site',getClientData(c.id));
});

app.listen(PORT,()=>console.log(`Nova Studio running on http://localhost:${PORT}`));
