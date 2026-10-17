import { OCRSettings } from './OCRSettings';
import { useEffect, useState, type ReactNode } from 'react';
import { api, setAccount, currentAccount, enableServerStorage, type Account } from '../lib/backend';
import { catalogEvents, type CatalogBook } from '../lib/catalog';
import { Modal } from './Modal';
import { BrowserMigration } from './BrowserMigration';

export function AccountGate({children}:{children:ReactNode}) {
    const [account,setCurrent]=useState<Account|null>(null),[error,setError]=useState(''),[ocrSetup,setOCRSetup]=useState(false);
    useEffect(()=>{enableServerStorage();void api<any>('/api/auth/status').then(async status=>{setAccount(status.user);setCurrent(status.user);if(status.user?.role==='administrator'){const config=await api<any>('/api/ocr/config');setOCRSetup(!config.configured);}}).catch(e=>setError(String(e)));},[]);
    if(account&&ocrSetup)return <main className="account-screen"><section className="account-card"><span className="eyebrow">OCR SETUP</span><OCRSettings onDone={()=>setOCRSetup(false)}/></section></main>;
    if(account)return <>{children}</>;
    return <main className="account-screen"><section className="account-card"><h1>Church library</h1><p>{error||'Connecting with your Orthodox Metrics account…'}</p><a href="/apps/">Choose your church in OM Applications</a></section></main>;
}

export function AccountControls(){
    const [open,setOpen]=useState(false);
    if(!currentAccount)return null;
    return <><span className="account-name">{currentAccount.displayName}</span>{currentAccount.role==='administrator'&&<button className="text-button" onClick={()=>setOpen(true)}>Administration</button>}<button className="text-button" onClick={()=>{location.href='/portal';}}>Website portal</button>{open&&<Administration onClose={()=>setOpen(false)}/>}</>;
}
function Administration({onClose}:{onClose:()=>void}){
    const [users,setUsers]=useState<Account[]>([]),[books,setBooks]=useState<CatalogBook[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const [loginName,setLogin]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('reader'),[userId,setUserId]=useState(''),[bookId,setBookId]=useState(''),[level,setLevel]=useState('read');
    const [grants,setGrants]=useState<any[]>([]);
    const load=async()=>{const [u,b]=await Promise.all([api<Account[]>('/api/admin/users'),api<CatalogBook[]>('/api/books')]);setUsers(u);setBooks(b);};
    const task=async(job:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await job();await load();catalogEvents.dispatchEvent(new Event('change'));}catch(e){setError(String(e));}finally{setBusy(false);}};
    useEffect(()=>{void load().catch(e=>setError(String(e)));},[]);
    useEffect(()=>{if(bookId)void api<any[]>(`/api/books/${bookId}/access`).then(setGrants).catch(e=>setError(String(e)));else setGrants([]);},[bookId]);
    return <Modal title="Library administration" onClose={onClose} locked={busy}><div className="admin-sections"><section><h3>Accounts</h3><div className="account-list">{users.map(u=><div key={u.id}><span><strong>{u.displayName}</strong> · {u.loginName} · {u.role} · {u.status}</span></div>)}</div><p>Accounts and passwords are managed on the Orthodox Metrics website. Users appear here after opening this church library once.</p></section><section><h3>Book access</h3><p className="field-help">Readers receive access only to published editions. Preparers need a preparation grant to edit a book.</p><label>Book<select value={bookId} onChange={e=>setBookId(e.target.value)}><option value="">Select book</option>{books.map(b=><option value={b.id} key={b.id}>{b.title}</option>)}</select></label>{grants.map(g=><div key={g.user_id}>{g.login_name} · {g.level} <button className="text-button" disabled={busy} onClick={()=>void task(async()=>{await api(`/api/books/${bookId}/access`,{method:'DELETE',body:JSON.stringify({userId:g.user_id})});setGrants(await api(`/api/books/${bookId}/access`));})}>Revoke</button></div>)}<label>Account<select value={userId} onChange={e=>setUserId(e.target.value)}><option value="">Select account</option>{users.filter(u=>u.status==='active').map(u=><option value={u.id} key={u.id}>{u.loginName}</option>)}</select></label><label>Permission<select value={level} onChange={e=>setLevel(e.target.value)}><option value="read">Read published editions</option><option value="prepare">Read and prepare</option></select></label><button className="button secondary" disabled={busy||!bookId||!userId} onClick={()=>void task(async()=>{await api(`/api/books/${bookId}/access`,{method:'PUT',body:JSON.stringify({userId,level})});setGrants(await api(`/api/books/${bookId}/access`));})}>Grant access</button></section><section><OCRSettings/></section><section><h3>Full installation backup</h3><p className="field-help">Includes all accounts, private reading data and source scans. Store this backup privately.</p><button className="button secondary" disabled={busy} onClick={()=>void task(async()=>{const r=await fetch('/api/admin/backup');if(!r.ok)throw new Error('Backup failed.');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`om-library-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}>Download complete backup</button></section><BrowserMigration/></div>{error&&<p className="error-list" role="alert">{error}</p>}<div className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Close</button></div></Modal>;
}
