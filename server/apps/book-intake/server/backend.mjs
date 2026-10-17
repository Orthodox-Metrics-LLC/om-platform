import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, readdirSync, unlinkSync, chmodSync } from 'node:fs';
import JSZip from 'jszip';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const passwordHash = password => { const salt = randomBytes(16).toString('hex'); return `scrypt:131072:8:1:${salt}:${scryptSync(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024}).toString('hex')}`; };
const checkPassword = (password, saved) => { const parts=saved.split(':'),modern=parts[0]==='scrypt',salt=modern?parts[4]:parts[0],key=modern?parts[5]:parts[1];const actual=scryptSync(password,salt,64,{N:modern?Number(parts[1]):32768,r:modern?Number(parts[2]):8,p:modern?Number(parts[3]):1,maxmem:256*1024*1024});return timingSafeEqual(actual,Buffer.from(key,'hex')); };
const publicUser = u => u && ({id:u.id,loginName:u.login_name,displayName:u.display_name,role:u.role,status:u.status});

export function createBackend({dataDir = process.env.OM_DATA_DIR || resolve('data'), secureCookies = process.env.OM_SECURE_COOKIES === 'true',settings:environment = process.env,onSettingsChange=()=>{},validateManifest,externalIdentity} = {}) {
    dataDir = resolve(dataDir); mkdirSync(dataDir,{recursive:true,mode:0o700});mkdirSync(join(dataDir,'assets'),{recursive:true,mode:0o700});
    if(process.platform!=='win32')chmodSync(dataDir,0o700);
    const savedConfiguration=join(dataDir,'private-config.json');if(existsSync(savedConfiguration))Object.assign(environment,JSON.parse(readFileSync(savedConfiguration,'utf8')));
    const filename = join(dataDir,'library.sqlite');
    let db = new DatabaseSync(filename);
    if(process.platform!=='win32')chmodSync(filename,0o600);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        // Preserve a consistent pre-migration copy, including the managed assets separately in full backups.
        const schemaVersion = db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version;
        if (schemaVersion < 1) copyFileSync(filename,`${filename}.before-v1`);
    }
    db.exec(readFileSync(fileURLToPath(new URL('./schema.sql',import.meta.url)),'utf8'));
    db.exec("UPDATE processing_jobs SET status='interrupted',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='running'");
    const get = (sql,...args) => db.prepare(sql).get(...args);
    const all = (sql,...args) => db.prepare(sql).all(...args);
    const run = (sql,...args) => db.prepare(sql).run(...args);
    const atomic = fn => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } };
    const audit = (user,action,target) => run('INSERT INTO audit_events(actor_id,action,target_id,created_at) VALUES(?,?,?,?)',user?.id || null,action,target || null,now());
    const userFor = req => {
        if(externalIdentity) {
            const identity=externalIdentity(req); if(!identity)return null;
            const id='om_'+identity.id, login='om_'+identity.id;
            run("INSERT INTO users VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,status='active'",id,login,identity.displayName,'external-auth-disabled',identity.role,'active',now());
            return get('SELECT * FROM users WHERE id=?',id);
        }
        const token = /(?:^|;\s*)om_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        if (!token) return null;
        const session = get('SELECT s.*,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen>? AND u.status=\'active\'',hash(token),Date.now(),Date.now()-24*60*60*1000);
        if (!session) return null;
        run('UPDATE sessions SET last_seen=? WHERE token_hash=?',Date.now(),hash(token)); return session;
    };
    const requireUser = req => { const u=userFor(req); if(!u) fail(401,'Sign in to continue.'); return u; };
    const admin = u => { if(u.role!=='administrator') fail(403,'Administrator access required.'); };
    const access = (u,id,prepare=false) => {
        const b=get('SELECT * FROM books WHERE id=? AND deleted_at IS NULL',id); if(!b) fail(404,'Book not found.');
        if(u.role==='administrator') return b;
        const grant=get('SELECT level FROM book_access WHERE book_id=? AND user_id=?',id,u.id);
        if(!grant || (prepare && (grant.level!=='prepare' || u.role==='reader'))) fail(403,'Access to this book has not been granted.'); return b;
    };
    const edition = (u,id,mode='preparation',requested) => {
        const b=access(u,id,mode!=='read');
        const e=mode==='read' ? get("SELECT * FROM book_editions WHERE id=? AND book_id=? AND status IN ('published','superseded')",requested||b.published_edition_id,id) : get("SELECT * FROM book_editions WHERE book_id=? AND status IN ('draft','abandoned')",id);
        if(!e) { if(mode==='read') fail(409,'This book has no published edition.'); return get('SELECT * FROM book_editions WHERE id=?',b.published_edition_id); }
        return e;
    };
    const settings = eid => all('SELECT payload FROM edition_settings WHERE edition_id=?',eid).map(r=>JSON.parse(r.payload));
    const snapshot = (u,id,mode,requested) => {
        const e=edition(u,id,mode,requested); if(!e) fail(404,'Edition not found.');
        const prefs=get('SELECT * FROM reader_preferences WHERE user_id=? AND edition_id=?',u.id,e.id);
        const progress=new Map(all('SELECT page_id,is_read FROM reading_progress WHERE user_id=? AND edition_id=?',u.id,e.id).map(r=>[r.page_id,!!r.is_read]));
        const ss=settings(e.id).filter(s=>!['prefs','publication'].includes(s.id));
        const info=ss.find(s=>s.id==='book');if(info)info.value.title=get('SELECT title FROM books WHERE id=?',id).title;
        ss.push({id:'publication',value:{status:['published','superseded'].includes(e.status)?'published':'draft',publishedAt:e.published_at || undefined}});
        if(prefs) ss.push({id:'prefs',value:JSON.parse(prefs.payload)});
        return {editionId:e.id,revision:e.revision,personalRevision:prefs?.revision || 0,stores:{
            pages:all('SELECT payload FROM pages WHERE edition_id=? ORDER BY position',e.id).map(r=>({...JSON.parse(r.payload),read:progress.get(JSON.parse(r.payload).id)||false})),
            sources:all('SELECT a.payload FROM source_assets a JOIN edition_sources s ON s.source_id=a.id WHERE a.book_id=? AND s.edition_id=?',id,e.id).map(r=>JSON.parse(r.payload)),
            annotations:all('SELECT payload FROM annotations WHERE user_id=? AND edition_id=?',u.id,e.id).map(r=>JSON.parse(r.payload)),
            bookmarks:all('SELECT payload FROM bookmarks WHERE user_id=? AND edition_id=?',u.id,e.id).map(r=>JSON.parse(r.payload)),settings:ss}};
    };
    const catalog = (u,b) => {
        const grant=get('SELECT level FROM book_access WHERE book_id=? AND user_id=?',b.id,u.id);
        const canPrepare=u.role==='administrator'||(u.role==='preparer'&&grant?.level==='prepare');
        const draft=canPrepare && get("SELECT * FROM book_editions WHERE book_id=? AND status IN ('draft','abandoned')",b.id);
        const e=draft || get('SELECT * FROM book_editions WHERE id=?',b.published_edition_id); if(!e) return null;
        const ss=settings(e.id), info=ss.find(s=>s.id==='book')?.value || {};
        const pages=all('SELECT payload FROM pages WHERE edition_id=?',e.id).map(r=>JSON.parse(r.payload));
        const prefs=get('SELECT payload FROM reader_preferences WHERE user_id=? AND edition_id=?',u.id,e.id);
        const p=prefs ? JSON.parse(prefs.payload) : {};
        return {id:b.id,database:`om-book-data-${b.id}`,title:b.title,subtitle:info.subtitle || '',author:info.author || '',year:info.year || '',status:draft?'draft':'published',publishedAvailable:!!b.published_edition_id,canPrepare,abandoned:e.status==='abandoned',createdAt:b.created_at,updatedAt:b.created_at,publishedAt:e.published_at || undefined,pageCount:pages.length,searchableCount:pages.filter(p=>p.text?.trim()).length,approvedCount:pages.filter(p=>p.reviewed&&p.review?.textVersion===p.textVersion&&p.review?.cropVersion===p.cropVersion&&!p.ocrError).length,readCount:get('SELECT count(*) AS n FROM reading_progress WHERE user_id=? AND edition_id=? AND is_read=1',u.id,e.id).n,bookmarkCount:get('SELECT count(*) AS n FROM bookmarks WHERE user_id=? AND edition_id=?',u.id,e.id).n,annotationCount:get('SELECT count(*) AS n FROM annotations WHERE user_id=? AND edition_id=?',u.id,e.id).n,lastPageTitle:pages.find(page=>page.id===p.pageId)?.title || ''};
    };
    const cloneEdition = (u,b,e) => {
        const id=randomUUID(),number=get('SELECT max(edition_number) AS n FROM book_editions WHERE book_id=?',b.id).n+1;
        run("INSERT INTO book_editions(id,book_id,edition_number,status) VALUES(?,?,?,'draft')",id,b.id,number);
        for(const table of ['pages','edition_settings']) {
            if(table==='pages') run('INSERT INTO pages SELECT ?,id,source_id,position,payload FROM pages WHERE edition_id=?',id,e.id);
            else run('INSERT INTO edition_settings SELECT ?,id,payload FROM edition_settings WHERE edition_id=?',id,e.id);
        }
        run('INSERT INTO edition_sources SELECT ?,source_id FROM edition_sources WHERE edition_id=?',id,e.id);
        run('INSERT INTO page_text_versions SELECT ?,page_id,revision,text,source_kind,words_json,created_by,created_at FROM page_text_versions WHERE edition_id=?',id,e.id);
        run('INSERT INTO page_reviews SELECT ?,page_id,text_version,crop_version,reviewer_id,payload,created_at FROM page_reviews WHERE edition_id=?',id,e.id);
        run('INSERT INTO page_search SELECT ?,id,json_extract(payload,\'$.text\') FROM pages WHERE edition_id=?',id,id);
        audit(u,'edition.create',b.id); return get('SELECT * FROM book_editions WHERE id=?',id);
    };
    const json = (res,status,value) => { if(res.writableEnded)return; res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value)); };
    const body = async (req,limit=45*1024*1024) => { if(req.body!==undefined){if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON required.');if(Buffer.byteLength(JSON.stringify(req.body))>limit)fail(413,'Request too large.');return req.body;} const chunks=[]; let n=0; for await(const chunk of req) { n+=chunk.length;if(n>limit)fail(413,'Request too large.');chunks.push(chunk); } const buf=Buffer.concat(chunks); if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON required.'); try{return JSON.parse(buf.toString());}catch{fail(400,'Invalid JSON.');} };
    const loginAttempts=new Map();
    async function middleware(req,res,next) {
        const url=new URL(req.url,'http://localhost'), path=url.pathname;
        if(!path.startsWith('/api/')) return next();
        try {
            if(!['GET','HEAD'].includes(req.method)) {
                let valid=false; try { const origin=new URL(req.headers.origin);valid=origin.host===req.headers.host&&['http:','https:'].includes(origin.protocol); }catch{}
                if(!valid || req.headers['x-om-reader']!=='1')fail(403,'Requests must come from this application.');
            }
            if(externalIdentity && (['/api/auth/setup','/api/auth/login','/api/auth/logout','/api/admin/restore'].includes(path) || (path.startsWith('/api/admin/users') && !['GET','HEAD'].includes(req.method))))fail(403,'Manage website accounts through Orthodox Metrics.');
            if(path==='/api/auth/status'&&req.method==='GET') return json(res,200,{setupRequired:externalIdentity?false:!get('SELECT id FROM users LIMIT 1'),user:publicUser(userFor(req))});
            if(['/api/auth/setup','/api/auth/login'].includes(path)&&req.method==='POST') {
                const ip=req.socket.remoteAddress || 'local', attempt=loginAttempts.get(ip)||{since:Date.now(),count:0};
                if(Date.now()-attempt.since>60000){attempt.since=Date.now();attempt.count=0;}loginAttempts.set(ip,attempt);
                if(++attempt.count>10)fail(429,'Too many sign-in attempts. Wait one minute.');
                const p=await body(req,8192);
                if(typeof p.password!=='string'||p.password.length>256||typeof p.loginName!=='string')fail(400,'Enter a username and password.');
                let u;
                if(path.endsWith('/setup')) {
                    if(p.password.length<12||!/^[-a-zA-Z0-9_.]{1,64}$/.test(p.loginName))fail(400,'Use a valid username and a password of at least 12 characters.');
                    u=atomic(()=>{if(get('SELECT id FROM users LIMIT 1'))fail(409,'Administrator already created.');const id=randomUUID();run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id,p.loginName,p.displayName?.trim()||p.loginName,passwordHash(p.password),'administrator','active',now());return get('SELECT * FROM users WHERE id=?',id);});
                } else { u=get('SELECT * FROM users WHERE login_name=?',p.loginName);const dummy='0'.repeat(32)+':'+ '0'.repeat(128); const valid=checkPassword(p.password,u?.password_hash||dummy); if(!valid||u?.status!=='active')fail(401,'Incorrect username or password.'); }
                const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),u.id,Date.now()+7*24*60*60*1000,Date.now());
                res.setHeader('Set-Cookie',`om_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookies?'; Secure':''}`);
                audit(u,'account.signin');return json(res,200,{user:publicUser(u)});
            }
            const u=requireUser(req);
            if(path==='/api/admin/ocr'&&req.method==='PUT'){
                admin(u);const p=await body(req,8192),provider=p.provider||(p.key?'llamaparse':undefined);
                if(!['llamaparse','google-vision','tesseract','none'].includes(provider))fail(400,'Select an OCR provider.');
                const privateConfig=join(dataDir,'private-config.json'),config=existsSync(privateConfig)?JSON.parse(readFileSync(privateConfig,'utf8')):{};
                const keyName=provider==='google-vision'?'GOOGLE_VISION_API_KEY':'LLAMA_CLOUD_API_KEY';
                if(p.key){if(typeof p.key!=='string'||p.key.length<10||p.key.length>2000||/[\r\n]/.test(p.key))fail(400,'Invalid API key.');config[keyName]=p.key;}
                if(['llamaparse','google-vision'].includes(provider)&&!(config[keyName]||environment[keyName]))fail(400,'Enter an API key for this provider.');
                config.OCR_PROVIDER=provider;config.LLAMA_PARSE_ENABLED=provider==='llamaparse'?'true':'false';
                const tmp=privateConfig+'.tmp';writeFileSync(tmp,JSON.stringify(config),{mode:0o600});renameSync(tmp,privateConfig);Object.assign(environment,config);onSettingsChange(config);audit(u,'ocr.configure');return json(res,200,{ok:true});
            }
            if(path==='/api/admin/backup'&&req.method==='GET') {
                admin(u);const tmp=join(dataDir,`backup-${randomUUID()}.sqlite`);
                db.prepare('VACUUM INTO ?').run(tmp);
                try {const zip=new JSZip();zip.file('library.sqlite',readFileSync(tmp));for(const f of readdirSync(join(dataDir,'assets')))if(/^[a-f0-9]{64}\.scan$/.test(f))zip.file(`assets/${f}`,readFileSync(join(dataDir,'assets',f)));zip.file('backup.json',JSON.stringify({format:'om-installation',version:1,createdAt:now()}));const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});res.writeHead(200,{'Content-Type':'application/zip','Cache-Control':'no-store','Content-Disposition':'attachment; filename="om-library-backup.zip"'});res.end(bytes);audit(u,'installation.backup');return;} finally{unlinkSync(tmp);}
            }
            if(path==='/api/admin/restore'&&req.method==='POST') {
                admin(u);if(req.headers['content-type']!=='application/zip')fail(415,'An installation backup ZIP is required.');
                const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024*1024)fail(413,'Backup exceeds 1 GiB.');chunks.push(chunk);}
                let zip;try{zip=await JSZip.loadAsync(Buffer.concat(chunks),{checkCRC32:true});}catch{fail(400,'Invalid backup ZIP.');}
                if(!zip.file('backup.json')||!zip.file('library.sqlite'))fail(400,'Not an installation backup.');
                const marker=JSON.parse(await zip.file('backup.json').async('string'));if(marker.format!=='om-installation'||marker.version!==1)fail(400,'Unsupported backup format.');
                const staged=join(dataDir,`restore-${randomUUID()}.sqlite`);writeFileSync(staged,await zip.file('library.sqlite').async('nodebuffer'),{mode:0o600});
                let candidate;try{
                    candidate=new DatabaseSync(staged);if(candidate.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||candidate.prepare('PRAGMA foreign_key_check').all().length)fail(400,'The backup database failed integrity checks.');
                    if(candidate.prepare('SELECT max(version) AS version FROM schema_migrations').get().version!==1)fail(400,'Unsupported backup schema.');
                    if(!candidate.prepare("SELECT id FROM users WHERE role='administrator' AND status='active' LIMIT 1").get())fail(400,'Backup has no active administrator.');
                    for(const a of candidate.prepare('SELECT DISTINCT storage_key,sha256 FROM source_assets').all()) {
                        if(!/^[a-f0-9]{64}\.scan$/.test(a.storage_key)||!zip.file(`assets/${a.storage_key}`))fail(400,'Backup is missing a source scan.');
                        const bytes=await zip.file(`assets/${a.storage_key}`).async('nodebuffer');if(hash(bytes)!==a.sha256)fail(400,'Source checksum failed.');
                        if(!existsSync(join(dataDir,'assets',a.storage_key)))writeFileSync(join(dataDir,'assets',a.storage_key),bytes,{mode:0o600});
                    }
                    candidate.exec('DELETE FROM sessions');candidate.close();candidate=null;
                    // Validate the full restore before replacing anything. Keep a pre-restore database; immutable files remain on disk.
                    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();const previous=`${filename}.before-restore-${Date.now()}`;renameSync(filename,previous);
                    try{renameSync(staged,filename);}catch(error){renameSync(previous,filename);throw error;}
                    db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
                    res.setHeader('Set-Cookie','om_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});
                }finally{candidate?.close();if(existsSync(staged))unlinkSync(staged);}
            }
            if(path==='/api/migrate/start'&&req.method==='POST') {
                admin(u);const p=await body(req,45*1024*1024);if(typeof p.origin!=='string'||typeof p.database!=='string'||p.origin.length>1000||p.database.length>200)fail(400,'Invalid migration.');let m;try{m=validateManifest(p.manifest);}catch(e){fail(400,e.message);}
                const migrationId=hash(`${p.origin}\n${p.database}`);
                const result=atomic(()=>{const batch=get('SELECT * FROM import_batches WHERE id=?',migrationId);if(batch)return {id:batch.book_id,completed:batch.status==='completed'};const id=randomUUID(),eid=randomUUID();run('INSERT INTO books VALUES(?,?,?,?,?,NULL)',id,m.book.title,u.id,null,now());run("INSERT INTO book_editions(id,book_id,edition_number,status) VALUES(?,?,1,'draft')",eid,id);run('INSERT INTO book_access VALUES(?,?,?,?,?)',id,u.id,'prepare',u.id,now());run('INSERT INTO edition_settings VALUES(?,?,?)',eid,'book',JSON.stringify({id:'book',value:m.book}));run('INSERT INTO import_batches VALUES(?,?,?,?,?,NULL)',migrationId,id,u.id,'uploading',now());return {id,completed:false};});return json(res,200,result);
            }
            if(path==='/api/migrate'&&req.method==='POST') {
                admin(u);const p=await body(req,250*1024*1024);
                if(typeof p.origin!=='string'||typeof p.database!=='string'||p.origin.length>1000||p.database.length>200||(p.sources!==undefined&&!Array.isArray(p.sources)))fail(400,'Invalid migration.');
                if(!validateManifest)fail(503,'Migration validator unavailable.');
                let m;try{m=validateManifest(p.manifest);}catch(e){fail(400,e.message);}
                const migrationId=hash(`${p.origin}\n${p.database}`);
                if(get("SELECT id FROM import_batches WHERE id=? AND status='completed'",migrationId))return json(res,200,{imported:false});
                const pendingBatch=get("SELECT * FROM import_batches WHERE id=? AND status='uploading'",migrationId);
                const assets=[];
                for(const s of m.sources){const existing=pendingBatch&&get('SELECT * FROM source_assets WHERE book_id=? AND id=?',pendingBatch.book_id,s.id);if(existing){assets.push({metadata:s,sha:existing.sha256,key:existing.storage_key,size:existing.byte_size});continue;}const raw=p.sources?.find(item=>item.id===s.id);if(!raw||typeof raw.bytes!=='string')fail(400,'Migration is missing an original scan.');const bytes=Buffer.from(raw.bytes,'base64');if(!bytes.length||bytes.length>45*1024*1024)fail(400,'Invalid source size.');const sha=hash(bytes),key=`${sha}.scan`;if(!existsSync(join(dataDir,'assets',key)))writeFileSync(join(dataDir,'assets',key),bytes,{mode:0o600});assets.push({metadata:s,sha,key,size:bytes.length});}
                const id=atomic(()=>{
                    if(get("SELECT id FROM import_batches WHERE id=? AND status='completed'",migrationId))return null;
                    const id=pendingBatch?.book_id||randomUUID(),eid=pendingBatch?get("SELECT id FROM book_editions WHERE book_id=? AND status='draft'",id)?.id:randomUUID();if(!eid)fail(409,'Migration draft was changed.');
                    if(pendingBatch){run('UPDATE books SET title=?,published_edition_id=? WHERE id=?',m.book.title,m.publication?.status==='published'?eid:null,id);run('UPDATE book_editions SET status=?,published_at=?,revision=revision+1 WHERE id=?',m.publication?.status==='published'?'published':p.abandoned?'abandoned':'draft',m.publication?.publishedAt||null,eid);for(const t of ['pages','edition_sources','edition_settings','page_text_versions','page_reviews'])run(`DELETE FROM ${t} WHERE edition_id=?`,eid);run('DELETE FROM page_search WHERE edition_id=?',eid);for(const t of ['annotations','bookmarks','reader_preferences','reading_progress'])run(`DELETE FROM ${t} WHERE edition_id=? AND user_id=?`,eid,u.id);run("UPDATE import_batches SET status='completed',finished_at=? WHERE id=?",now(),migrationId);}
                    else{run('INSERT INTO books VALUES(?,?,?,?,?,NULL)',id,m.book.title,u.id,m.publication?.status==='published'?eid:null,now());run('INSERT INTO book_editions(id,book_id,edition_number,status,published_at) VALUES(?,?,1,?,?)',eid,id,m.publication?.status==='published'?'published':p.abandoned?'abandoned':'draft',m.publication?.publishedAt||null);run('INSERT INTO book_access VALUES(?,?,?,?,?)',id,u.id,'prepare',u.id,now());run('INSERT INTO import_batches VALUES(?,?,?,?,?,?)',migrationId,id,u.id,'completed',now(),now());}
                    for(const a of assets){run('INSERT OR IGNORE INTO source_assets VALUES(?,?,?,?,?,?,?)',id,a.metadata.id,a.key,a.sha,a.metadata.mime,a.size,JSON.stringify(a.metadata));run('INSERT INTO edition_sources VALUES(?,?)',eid,a.metadata.id);}
                    for(const page of m.pages){const {read,...content}=page;run('INSERT INTO pages VALUES(?,?,?,?,?)',eid,page.id,page.sourceId,page.order,JSON.stringify(content));run('INSERT INTO reading_progress VALUES(?,?,?,?)',u.id,eid,page.id,read?1:0);run('INSERT INTO page_text_versions VALUES(?,?,?,?,?,?,?,?)',eid,page.id,page.textVersion,page.text,page.textSource,JSON.stringify(page.words),u.id,now());run('INSERT INTO page_search VALUES(?,?,?)',eid,page.id,page.text);if(page.review)run('INSERT INTO page_reviews VALUES(?,?,?,?,?,?,?)',eid,page.id,page.textVersion,page.cropVersion,u.id,JSON.stringify(page.review),now());}
                    for(const table of ['annotations','bookmarks'])for(const item of m[table])run(`INSERT INTO ${table} VALUES(?,?,?,?,?)`,u.id,id,eid,item.id,JSON.stringify(item));
                    run('INSERT INTO reader_preferences VALUES(?,?,?,0)',u.id,eid,JSON.stringify(m.prefs));for(const s of [{id:'book',value:m.book},{id:'initialized',value:true},{id:'migration-v04',value:{at:now()}}])run('INSERT INTO edition_settings VALUES(?,?,?)',eid,s.id,JSON.stringify(s));audit(u,'book.migrate',id);return id;
                });return json(res,201,{imported:!!id,id});
            }
            if(path==='/api/auth/logout'&&req.method==='POST'){const token=/(?:^|;\s*)om_session=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1];if(token)run('DELETE FROM sessions WHERE token_hash=?',hash(token));res.setHeader('Set-Cookie','om_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
            if(path==='/api/admin/users') {
                admin(u);
                if(req.method==='GET')return json(res,200,all('SELECT * FROM users ORDER BY login_name').map(publicUser));
                if(req.method==='POST'){const p=await body(req,8192);if(!/^[-a-zA-Z0-9_.]{1,64}$/.test(p.loginName)||typeof p.password!=='string'||p.password.length<12||p.password.length>256||!['administrator','preparer','reader'].includes(p.role))fail(400,'Provide username, role and a password of 12–256 characters.');const id=randomUUID();if(get('SELECT id FROM users WHERE login_name=?',p.loginName))fail(409,'Username already exists.');run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id,p.loginName,p.displayName?.trim()||p.loginName,passwordHash(p.password),p.role,'active',now());audit(u,'account.create',id);return json(res,201,publicUser(get('SELECT * FROM users WHERE id=?',id)));}
            }
            const userMatch=/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)$/.exec(path);
            if(userMatch&&req.method==='PATCH'){admin(u);const p=await body(req,8192),target=get('SELECT * FROM users WHERE id=?',userMatch[1]);if(!target)fail(404,'Account not found.');if(target.id===u.id && (p.status==='disabled'||(p.role&&p.role!=='administrator')))fail(400,'You cannot disable or demote your own administrator account.');if(p.role&&!['administrator','preparer','reader'].includes(p.role))fail(400,'Invalid role.');if(p.status&&!['active','disabled'].includes(p.status))fail(400,'Invalid status.');if(p.password!==undefined&&(typeof p.password!=='string'||p.password.length<12||p.password.length>256))fail(400,'Use a password of 12–256 characters.');atomic(()=>{run('UPDATE users SET role=?,status=?,password_hash=? WHERE id=?',p.role||target.role,p.status||target.status,p.password?passwordHash(p.password):target.password_hash,target.id);run('DELETE FROM sessions WHERE user_id=?',target.id);audit(u,'account.update',target.id);});return json(res,200,{ok:true});}
            if(path==='/api/books') {
                if(req.method==='GET'){const rows=u.role==='administrator'?all('SELECT * FROM books WHERE deleted_at IS NULL'):all('SELECT b.* FROM books b JOIN book_access a ON a.book_id=b.id WHERE a.user_id=? AND b.deleted_at IS NULL',u.id);return json(res,200,rows.map(b=>catalog(u,b)).filter(Boolean));}
                if(req.method==='POST'){if(u.role==='reader')fail(403,'Preparation access required.');const p=await body(req,8192);if(typeof p.title!=='string'||!p.title.trim()||p.title.length>1000)fail(400,'Enter a book title.');const b=atomic(()=>{const id=randomUUID(),eid=randomUUID();run('INSERT INTO books VALUES(?,?,?,?,?,NULL)',id,p.title.trim(),u.id,null,now());run("INSERT INTO book_editions(id,book_id,edition_number,status) VALUES(?,?,1,'draft')",eid,id);run('INSERT INTO book_access VALUES(?,?,?,?,?)',id,u.id,'prepare',u.id,now());for(const s of [{id:'book',value:{title:p.title.trim(),subtitle:'',year:'',calendar:'As printed in this edition'}},{id:'initialized',value:true}])run('INSERT INTO edition_settings VALUES(?,?,?)',eid,s.id,JSON.stringify(s));audit(u,'book.create',id);return get('SELECT * FROM books WHERE id=?',id);});return json(res,201,catalog(u,b));}
            }
            const match=/^\/api\/books\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/.exec(path);
            if(match) {
                const [,id,action='']=match;
                if(action==='access'){admin(u);access(u,id);if(req.method==='GET')return json(res,200,all('SELECT a.*,u.login_name FROM book_access a JOIN users u ON u.id=a.user_id WHERE a.book_id=?',id));const p=await body(req,8192);if(!get('SELECT id FROM users WHERE id=?',p.userId))fail(404,'Account not found.');if(req.method==='DELETE'){run('DELETE FROM book_access WHERE book_id=? AND user_id=?',id,p.userId);audit(u,'access.revoke',id);}else if(req.method==='PUT'){if(!['read','prepare'].includes(p.level))fail(400,'Invalid permission.');run('INSERT INTO book_access VALUES(?,?,?,?,?) ON CONFLICT(book_id,user_id) DO UPDATE SET level=excluded.level,granted_by=excluded.granted_by,granted_at=excluded.granted_at',id,p.userId,p.level,u.id,now());audit(u,'access.grant',id);}else fail(405,'Method not allowed.');return json(res,200,{ok:true});}
                if(action==='editions'&&req.method==='GET'){const b=access(u,id);return json(res,200,all("SELECT id,edition_number AS number,published_at AS publishedAt FROM book_editions WHERE book_id=? AND status IN ('published','superseded') ORDER BY edition_number DESC",id).map(e=>({...e,current:e.id===b.published_edition_id,notes:get('SELECT count(*) AS n FROM annotations WHERE user_id=? AND edition_id=?',u.id,e.id).n})));}
                if(action==='snapshot'&&req.method==='GET')return json(res,200,snapshot(u,id,url.searchParams.get('mode')||'preparation',url.searchParams.get('edition')));
                if(!action&&req.method==='PATCH'){access(u,id,true);const p=await body(req,8192);atomic(()=>{if(p.title!==undefined){if(typeof p.title!=='string'||!p.title.trim()||p.title.length>1000)fail(400,'Invalid title.');const b=get('SELECT title FROM books WHERE id=?',id);if(p.expectedTitle!==undefined&&b.title!==p.expectedTitle)fail(409,'The title changed. Reload and try again.');run('UPDATE books SET title=? WHERE id=?',p.title.trim(),id);}if(p.abandoned!==undefined){run("UPDATE book_editions SET status=?,revision=revision+1 WHERE book_id=? AND status IN ('draft','abandoned')",p.abandoned?'abandoned':'draft',id);}audit(u,'book.update',id);});return json(res,200,{ok:true});}
                if(!action&&req.method==='DELETE'){const b=access(u,id,true);if(b.published_edition_id)fail(409,'Published books cannot be purged.');run('UPDATE books SET deleted_at=? WHERE id=?',now(),id);audit(u,'book.purge',id);return json(res,200,{ok:true});}
                if(action==='reopen'&&req.method==='POST'){const b=access(u,id,true);atomic(()=>{if(get("SELECT id FROM book_editions WHERE book_id=? AND status IN ('draft','abandoned')",id))return;const e=get('SELECT * FROM book_editions WHERE id=?',b.published_edition_id);if(!e)fail(409,'No published edition to reopen.');cloneEdition(u,b,e);});return json(res,200,{ok:true});}
                if(action==='assets'&&req.method==='POST') {
                    access(u,id,true);const p=await body(req,64*1024*1024);
                    if(!safeId(p.id)||!['image/jpeg','image/png','image/webp'].includes(p.mime)||typeof p.bytes!=='string'||!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0||typeof p.name!=='string'||p.name.length>1000)fail(400,'Invalid scan.');
                    const bytes=Buffer.from(p.bytes,'base64');if(!bytes.length||bytes.length>45*1024*1024)fail(413,'Scan must be 1 byte to 45 MiB.');
                    const sha=hash(bytes),key=`${sha}.scan`,existing=get('SELECT sha256 FROM source_assets WHERE book_id=? AND id=?',id,p.id);if(existing&&existing.sha256!==sha)fail(409,'Original scans are immutable.');
                    if(!existsSync(join(dataDir,'assets',key))){const tmp=join(dataDir,'assets',`${randomUUID()}.tmp`);writeFileSync(tmp,bytes,{mode:0o600});renameSync(tmp,join(dataDir,'assets',key));}
                    const metadata={id:p.id,name:p.name,mime:p.mime,width:p.width,height:p.height};run('INSERT OR IGNORE INTO source_assets VALUES(?,?,?,?,?,?,?)',id,p.id,key,sha,p.mime,bytes.length,JSON.stringify(metadata));return json(res,201,metadata);
                }
                const asset=/^assets\/([a-zA-Z0-9_-]+)$/.exec(action);
                if(asset&&req.method==='GET'){const e=edition(u,id,url.searchParams.get('mode')||'read',url.searchParams.get('edition'));if(!get('SELECT source_id FROM edition_sources WHERE edition_id=? AND source_id=?',e.id,asset[1]))fail(404,'Scan not found in this edition.');const s=get('SELECT * FROM source_assets WHERE book_id=? AND id=?',id,asset[1]);if(!s)fail(404,'Original scan is missing.');res.writeHead(200,{'Content-Type':s.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(readFileSync(join(dataDir,'assets',s.storage_key)));return;}
                if(action==='commit'&&req.method==='POST') {
                    const p=await body(req),e=edition(u,id,p.mode,p.mode==='read'?p.editionId:undefined),b=access(u,id),canEdit=u.role==='administrator'||(u.role==='preparer'&&get('SELECT level FROM book_access WHERE book_id=? AND user_id=?',id,u.id)?.level==='prepare');
                    if(!Array.isArray(p.ops)||p.ops.length>15000)fail(400,'Invalid transaction.');
                    atomic(()=>{
                        const current=get('SELECT * FROM book_editions WHERE id=?',e.id),pref=get('SELECT revision,payload FROM reader_preferences WHERE user_id=? AND edition_id=?',u.id,e.id);
                        if((p.editionId&&p.editionId!==e.id)||current.revision!==p.revision || (pref?.revision||0)!==p.personalRevision)fail(409,'This book changed in another window. Reload before saving.');
                        let editorial=false,personal=false,publish=false;
                        for(const op of p.ops) {
                            if(!['pages','sources','settings','annotations','bookmarks'].includes(op.store)||!['put','delete','clear'].includes(op.kind))fail(400,'Invalid storage operation.');
                            if(op.kind!=='clear'&&!safeId(op.kind==='put'?op.value?.id:op.id))fail(400,'Invalid record ID.');
                            const v=op.value;
                            if(['annotations','bookmarks'].includes(op.store)) {
                                const t=op.store; personal=true;
                                if(op.kind==='put'){if(!safeId(v.pageId)||!get('SELECT id FROM pages WHERE edition_id=? AND id=?',e.id,v.pageId))fail(400,'Invalid page reference.');run(`INSERT INTO ${t} VALUES(?,?,?,?,?) ON CONFLICT(user_id,edition_id,id) DO UPDATE SET payload=excluded.payload`,u.id,id,e.id,v.id,JSON.stringify(v));}
                                else if(op.kind==='delete')run(`DELETE FROM ${t} WHERE user_id=? AND edition_id=? AND id=?`,u.id,e.id,op.id);else run(`DELETE FROM ${t} WHERE user_id=? AND edition_id=?`,u.id,e.id);
                                continue;
                            }
                            if(op.store==='settings'&&op.kind==='put'&&v.id==='prefs'){personal=true;run('INSERT INTO reader_preferences VALUES(?,?,?,0) ON CONFLICT(user_id,edition_id) DO UPDATE SET payload=excluded.payload',u.id,e.id,JSON.stringify(v.value));continue;}
                            if(op.store==='pages'&&op.kind==='put') {
                                const old=get('SELECT payload FROM pages WHERE edition_id=? AND id=?',e.id,v.id),oldPage=old&&JSON.parse(old.payload);
                                const {read,...content}=v;const oldContent=oldPage&&({...oldPage});if(oldContent)delete oldContent.read;
                                if(oldPage&&JSON.stringify(content)===JSON.stringify(oldContent)){personal=true;run('INSERT INTO reading_progress VALUES(?,?,?,?) ON CONFLICT(user_id,edition_id,page_id) DO UPDATE SET is_read=excluded.is_read',u.id,e.id,v.id,read?1:0);continue;}
                                if(!canEdit||!['draft','abandoned'].includes(e.status))fail(403,'Published content is immutable. Create a preparation edition to edit it.');
                                if(!safeId(v.sourceId)||!Number.isFinite(v.order)||typeof v.text!=='string'||v.text.length>2000000||!Number.isInteger(v.textVersion)||!Number.isInteger(v.cropVersion)||!v.crop||![v.crop.x,v.crop.y,v.crop.w,v.crop.h].every(Number.isFinite)||v.crop.x<0||v.crop.y<0||v.crop.w<=0||v.crop.h<=0||v.crop.x+v.crop.w>1.001||v.crop.y+v.crop.h>1.001||![0,90,180,270].includes(v.rotation)||!Array.isArray(v.words))fail(400,'Invalid page data.');
                                if(!get('SELECT id FROM source_assets WHERE book_id=? AND id=?',id,v.sourceId))fail(400,'Original scan must be uploaded before its pages.');
                                editorial=true;run('INSERT INTO pages VALUES(?,?,?,?,?) ON CONFLICT(edition_id,id) DO UPDATE SET source_id=excluded.source_id,position=excluded.position,payload=excluded.payload',e.id,v.id,v.sourceId,v.order,JSON.stringify(content));
                                const history=get('SELECT text FROM page_text_versions WHERE edition_id=? AND page_id=? AND revision=?',e.id,v.id,v.textVersion);
                                if(history&&history.text!==v.text)fail(409,'Text changes require a new text version.');
                                run('INSERT OR IGNORE INTO page_text_versions VALUES(?,?,?,?,?,?,?,?)',e.id,v.id,v.textVersion,v.text,v.textSource,JSON.stringify(v.words),u.id,now());
                                if(v.review&&JSON.stringify(v.review)!==JSON.stringify(oldPage?.review)) {if(v.review.textVersion!==v.textVersion||v.review.cropVersion!==v.cropVersion)fail(400,'Review must match the current text and crop.');run('INSERT INTO page_reviews VALUES(?,?,?,?,?,?,?)',e.id,v.id,v.textVersion,v.cropVersion,u.id,JSON.stringify(v.review),now());}
                                run('DELETE FROM page_search WHERE edition_id=? AND page_id=?',e.id,v.id);run('INSERT INTO page_search VALUES(?,?,?)',e.id,v.id,v.text);continue;
                            }
                            if(!canEdit||!['draft','abandoned'].includes(e.status))fail(403,'Preparation access to a draft is required.'); editorial=true;
                            if(op.store==='pages') {if(op.kind==='delete')run('DELETE FROM pages WHERE edition_id=? AND id=?',e.id,op.id);else run('DELETE FROM pages WHERE edition_id=?',e.id);run('DELETE FROM page_search WHERE edition_id=?',e.id);run('INSERT INTO page_search SELECT ?,id,json_extract(payload,\'$.text\') FROM pages WHERE edition_id=?',e.id,e.id);}
                            if(op.store==='sources'){if(op.kind==='put'){if(!get('SELECT id FROM source_assets WHERE book_id=? AND id=?',id,v.id))fail(400,'Original scan is missing.');run('INSERT OR IGNORE INTO edition_sources VALUES(?,?)',e.id,v.id);}else if(op.kind==='delete')run('DELETE FROM edition_sources WHERE edition_id=? AND source_id=?',e.id,op.id);else run('DELETE FROM edition_sources WHERE edition_id=?',e.id);}
                            if(op.store==='settings') {
                                if(op.kind==='put'&&v.id==='publication'){publish=v.value?.status==='published';continue;}
                                if(op.kind==='put'){if(v.id==='book'){if(typeof v.value?.title!=='string'||!v.value.title.trim()||v.value.title.length>1000)fail(400,'Invalid book title.');run('UPDATE books SET title=? WHERE id=?',v.value.title,id);}run('INSERT INTO edition_settings VALUES(?,?,?) ON CONFLICT(edition_id,id) DO UPDATE SET payload=excluded.payload',e.id,v.id,JSON.stringify(v));}
                                else if(op.kind==='delete')run('DELETE FROM edition_settings WHERE edition_id=? AND id=?',e.id,op.id);else run('DELETE FROM edition_settings WHERE edition_id=?',e.id);
                            }
                        }
                        if(get('SELECT p.id FROM pages p LEFT JOIN edition_sources s ON s.edition_id=p.edition_id AND s.source_id=p.source_id WHERE p.edition_id=? AND s.source_id IS NULL LIMIT 1',e.id))fail(400,'Every page must retain its original scan.');
                        if(publish){if(!get('SELECT id FROM pages WHERE edition_id=? LIMIT 1',e.id))fail(400,'Import pages before publishing.');if(b.published_edition_id)run("UPDATE book_editions SET status='superseded' WHERE id=?",b.published_edition_id);run("UPDATE book_editions SET status='published',published_at=? WHERE id=?",now(),e.id);run('UPDATE books SET published_edition_id=? WHERE id=?',e.id,id);audit(u,'edition.publish',id);}
                        if(editorial)run('UPDATE book_editions SET revision=revision+1 WHERE id=?',e.id);
                        if(personal){run("INSERT OR IGNORE INTO reader_preferences VALUES(?,?,'{}',0)",u.id,e.id);run('UPDATE reader_preferences SET revision=revision+1 WHERE user_id=? AND edition_id=?',u.id,e.id);}
                        if(editorial)audit(u,'edition.save',id);
                        if(p.ops.some(op=>op.store==='sources'&&op.kind==='put'))run('INSERT INTO import_batches VALUES(?,?,?,?,?,?)',randomUUID(),id,u.id,'completed',now(),now());
                    });return json(res,200,{ok:true});
                }
            }
            if(path.startsWith('/api/ocr/')||path.startsWith('/api/narration/')) {
                if(path==='/api/ocr/parse'){if(u.role==='reader')fail(403,'Preparation access required.');const id=req.headers['x-om-book'];if(typeof id!=='string')fail(400,'Book context required.');access(u,id,true);const job=randomUUID();run('INSERT INTO processing_jobs VALUES(?,?,?,?,?,?,NULL)',job,id,u.id,'llamaparse', 'running',now());res.once('finish',()=>{try{run('UPDATE processing_jobs SET status=?,finished_at=? WHERE id=?',res.statusCode<300?'completed':'failed',now(),job);}catch{}});res.once('close',()=>{if(!res.writableEnded){try{run('UPDATE processing_jobs SET status=?,finished_at=? WHERE id=?','cancelled',now(),job);}catch{}}});}
                return next();
            }
            fail(404,'Endpoint not found.');
        } catch(e) { json(res,e.status||500,{error:e.status?e.message:'The operation failed. Check the backend log.'});if(!e.status)console.error('Backend error:',e.message); }
    }
    return {middleware,close:()=>db.close(),dataDir,db,requireUser};
}
