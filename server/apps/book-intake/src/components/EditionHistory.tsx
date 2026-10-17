import { useState } from 'react';
import { api, bookId } from '../lib/backend';
import { getDatabaseName } from '../lib/db';
import type { Navigate } from '../workspaces/WorkspaceHeader';
import { Modal } from './Modal';
export function EditionHistory({navigate}:{navigate:Navigate}){
    const [editions,setEditions]=useState<{id:string;number:number;publishedAt:string;current:boolean;notes:number}[]|null>(null),[error,setError]=useState('');
    const id=bookId(getDatabaseName());
    return <><button className="text-button" onClick={()=>{void api<any[]>(`/api/books/${id}/editions`).then(setEditions).catch(e=>setError(String(e)));}}>Editions</button>{error&&<span role="alert">{error}</span>}{editions&&<Modal title="Published editions" onClose={()=>setEditions(null)}><p>Your notes and reading progress stay with the edition you read.</p>{editions.map(e=><div className="edition-history-row" key={e.id}><span>Edition {e.number}{e.current?' · Current':''}<br/><small>{e.publishedAt?new Date(e.publishedAt).toLocaleDateString():'Publication date unavailable'} · {e.notes} personal notes / highlights</small></span><button className="button secondary" onClick={()=>{setEditions(null);navigate(`/read/${id}/edition/${e.id}`);}}>Open edition</button></div>)}</Modal>}</>;
}
