/* Real local importer UI. All document work goes through the isolated desktop bridge. */
(() => {
  'use strict';
  const api = window.omImporter;
  const state = { page:'overview', source:null, config:null, package:null, busy:false, error:'', notice:'', pageIndex:0, search:'', dirty:false, modal:null, jsonDraft:null, jsonNote:'', jsonActor:(api.actorName || 'Signed-in user'), flagFilter:'open', selectedFlags:[], decision:null, sqlPlan:null, connection:null, importReview:null, importResult:null };
  const types = ['string','integer','number','boolean','date','partial_date','json'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => {
    if (value === null) return '—';
    if (typeof value === 'object' && value.precision && Number.isInteger(value.year)) {
      const year=String(value.year).padStart(4,'0');
      if (value.precision==='year') return year;
      const month=String(value.month).padStart(2,'0');
      return value.precision==='month' ? `${year}-${month}` : `${year}-${month}-${String(value.day).padStart(2,'0')}`;
    }
    if (typeof value === 'object' && value.type && Object.hasOwn(value,'parameters')) return value.type==='fixed' ? `${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')} annually` : value.text || 'Unresolved date';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  const button = (text,action,variant='secondary',disabled=false) => `<button type="button" class="btn ${variant}" data-action="${action}" ${disabled || state.busy ? 'disabled' : ''}>${text}</button>`;
  const badge = (text,tone='neutral') => `<span class="badge ${tone}">${esc(text)}</span>`;
  const blockers = () => state.package?.issues.filter(i => i.severity==='error' && i.status==='open').length || 0;
  const heading = (title,description,actions='') => `<div class="page-head"><div><div class="eyebrow">CHURCH WORKSPACE</div><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`;
  function overview() {
    return heading('Import your documents','Create editable, versioned JSON from an XLSX or parish DOCX document.',button('Select document','choose','primary')+' '+button('Open JSON package','open')) +
      `<div class="grid grid-three mb-24">${[['Source','Select an Excel workbook or parish announcements document.'],['Configure','Choose field names, labels, types and source mappings.'],['Review and save','Edit real records and save a validated JSON revision.']].map(([title,copy]) => `<section class="surface pad"><h2>${title}</h2><p class="card-caption">${copy}</p></section>`).join('')}</div>
      <section class="surface pad"><h2>Extraction first</h2><p>Source files remain unchanged. Cemetery source conditions are accepted as written. Parish ambiguities remain flagged for review, and movable feast rules stay as rules.</p><p class="card-caption">Extraction and database import are separate steps. Approved cemetery and parish packages can be imported after connection, review and confirmation.</p>${state.package ? button('Review current package','review','primary') : ''}</section>`;
  }
  function configuration() {
    const cfg=state.config;
    if (!cfg) return heading('Configure import','Select a document to discover its fields.',button('Select document','choose','primary'));
    const currentSelection=cfg.selection;
    const columns=state.source?.columns || [];
    const worksheets=state.source?.worksheets || [];
    const parish=cfg.profile==='parish_announcements_v1';
    const paths=state.source?.extracted_fields || (parish ? Object.keys(state.package?.records[0]?.extracted || {}).concat(['recurrence.type','recurrence.text','recurrence.month','recurrence.day']) : []);
    const mappingOptions=source => {
      const current=source.column ? 'column:'+source.column : source.header ? 'header:'+source.header : 'path:'+source.path;
      const available=paths.map(p=>({value:'path:'+p,label:p})).concat(columns.map(c => ({value:'column:'+c.column,label:c.column+' · '+(c.header || 'Unnamed column')})));
      for (const c of columns) if (c.header) available.push({value:'header:'+c.header,label:'Header · '+c.header});
      if (!available.some(v => v.value===current)) available.unshift({value:current,label:current});
      return available.map(v => `<option value="${esc(v.value)}" ${v.value===current?'selected':''}>${esc(v.label)}</option>`).join('');
    };
    return heading('Configure fields','Each import defines its own fields and source mappings.',button(state.package?'Apply mapping to JSON':'Extract document','extract','primary')) +
      `<section class="surface pad mb-24"><div class="form-row"><div class="field"><label for="resource-name">Resource name</label><input id="resource-name" value="${esc(cfg.resource_name || state.package?.resource.name)}" /></div>
      ${parish ? `<div class="field"><label>Document preset</label><p>Parish announcements · all months and population groups</p><small class="card-caption">${state.source ? state.source.paragraph_count+' paragraphs · '+state.source.table_count+' Word tables' : 'Mappings use the saved extraction; the original DOCX is not required.'}</small></div></div><p class="card-caption">Choose extracted field paths below. Recurrence rules remain structured JSON; no movable feast date is calculated.</p><div class="actions">${state.package && state.source ? button('Extract source again','reextract') : ''}</div>` : `<div class="field"><label for="sheet-select">Worksheet</label><select id="sheet-select" ${!state.source?'disabled':''}>${worksheets.length ? worksheets.map(s => `<option ${s.name===currentSelection.sheet?'selected':''}>${esc(s.name)}</option>`).join('') : `<option>${esc(currentSelection.sheet || 'Preset')}</option>`}</select></div>
      <div class="field"><label for="header-row">Header row</label><input type="number" min="1" id="header-row" value="${currentSelection.header_row || 1}" ${!state.source?'disabled':''} /></div></div><div class="actions">${button('Refresh source columns','inspect','secondary',!state.source)}${state.package && state.source ? button('Extract source again','reextract') : ''}</div>`}
      <p class="card-caption">${state.package ? 'Applying mappings uses the current JSON extraction. Previous edits remain in mapping history; changed source selection requires extraction again.' : 'New imports preserve original source values and text, including fields omitted from the output.'}</p></section>
      <section class="surface"><div class="table-top"><h2>Field definitions</h2>${button('Add field','add-field')}</div><div class="table-wrap"><table class="data-table mapping-table"><thead><tr><th>Field name</th><th>Display label</th><th>Data type</th><th>Source mapping</th><th>Nullable</th><th>Date format</th><th></th></tr></thead><tbody>
      ${cfg.fields.map((f,i) => `<tr data-field-row="${i}"><td><input aria-label="Field name ${i+1}" data-setting="name" value="${esc(f.name)}" /></td><td><input aria-label="Display label ${i+1}" data-setting="label" value="${esc(f.label || f.name)}" /></td><td><select aria-label="Data type ${i+1}" data-setting="type">${types.map(t=>`<option ${f.type===t?'selected':''}>${t}</option>`).join('')}</select></td><td><select aria-label="Source mapping ${i+1}" data-setting="source">${mappingOptions(f.source)}</select></td><td><input aria-label="Nullable ${i+1}" data-setting="nullable" type="checkbox" ${f.nullable!==false?'checked':''} /></td><td><input aria-label="Date format ${i+1}" data-setting="format" value="${esc(f.format || '')}" placeholder="Optional" /></td><td><button class="btn ghost small" data-action="remove-field" data-index="${i}" aria-label="Remove field ${i+1}" ${state.busy?'disabled':''}>Remove</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
  }
  function packageSummary() {
    const p=state.package;
    return `<div class="summary-strip">${badge(p.records.length+' records','info')}${badge('Schema '+p.schema_version)}${badge('Revision '+p.revision)}${badge(p.review_status,p.review_status==='approved'?'success':'neutral')}${badge(blockers()+' blockers',blockers()?'warning':'success')}${badge(state.dirty?'Unsaved changes':'Saved package',state.dirty?'warning':'neutral')}</div>`;
  }
  function review() {
    const p=state.package;
    if (!p) return heading('Review records','Extract a document or open an existing JSON package.',button('Select document','choose','primary'));
    const location = r => r.source_location.paragraph !== undefined ? 'Paragraph '+r.source_location.paragraph : 'Row '+r.source_location.row;
    const rows=p.records.filter(r => !state.search || JSON.stringify(r.normalized).toLowerCase().includes(state.search.toLowerCase()));
    const pages=Math.max(1,Math.ceil(rows.length/25));state.pageIndex=Math.min(state.pageIndex,pages-1);
    const visible=rows.slice(state.pageIndex*25,(state.pageIndex+1)*25);
    return heading('Review records',esc(p.source.filename)+' · Original evidence is retained for every record.',button('Configure fields','configure')+' '+button('Save JSON revision','save','primary')+' '+button('Approve JSON package','approve-dialog','secondary',blockers()>0 || p.review_status==='approved')) + packageSummary() +
      `<section class="surface"><div class="table-top"><div class="field"><label for="record-search">Search records</label><input id="record-search" value="${esc(state.search)}" placeholder="Search any normalized value" /></div><span class="card-caption">${rows.length} matching records</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Source location</th>${p.resource.columns.map(f => `<th>${esc(f.label || f.name)}</th>`).join('')}<th>Action</th></tr></thead><tbody>
      ${visible.map(r => `<tr><td>${esc(location(r))}</td>${p.resource.columns.map(f => `<td title="${esc(fmt(r.normalized[f.name]))}">${esc(fmt(r.normalized[f.name]))}</td>`).join('')}<td><button class="btn secondary small" data-action="edit" data-id="${r.id}" ${state.busy?'disabled':''}>Edit</button></td></tr>`).join('') || `<tr><td colspan="${p.resource.columns.length+2}">No matching records.</td></tr>`}
      </tbody></table></div><div class="table-bottom"><span>Page ${state.pageIndex+1} of ${pages}</span><div class="actions">${button('Previous','previous','secondary',state.pageIndex===0)}${button('Next','next','secondary',state.pageIndex===pages-1)}</div></div></section>
      <section class="surface pad mt-24"><h2>Validation findings</h2><p>${p.issues.length} flags retained · ${blockers()} open blockers. Review each flag or make an explicit batch decision.</p>${button('Review validation flags','flags','primary')}</section>`;
  }
  function flagsPage() {
    const p=state.package;
    if(!p)return heading('Validation flags','Extract or open a JSON package first.');
    const visible=p.issues.filter(i=>state.flagFilter==='all'||i.status===state.flagFilter);
    const selected=state.selectedFlags.filter(id=>p.issues.some(i=>i.id===id));
    return heading('Validation flags','Accept a source condition as written, resolve a flag after review, or reopen a previous decision.',button('Save JSON revision','save')+' '+button('Approve JSON package','approve-dialog','primary',blockers()>0 || p.review_status==='approved'))+packageSummary()+
      `<section class="surface pad"><div class="form-row"><div class="field"><label for="flag-filter">Show flags</label><select id="flag-filter">${['open','accepted','resolved','all'].map(v=>`<option ${state.flagFilter===v?'selected':''}>${v}</option>`).join('')}</select></div><div><p>${visible.length} displayed · ${selected.length} selected</p>${button('Select displayed flags','select-flags')}${button('Clear selection','clear-flags')}</div></div><div class="actions">${button('Accept as written','accept-flags','secondary',!selected.length)}${button('Mark resolved','resolve-flags','secondary',!selected.length)}${button('Reopen','reopen-flags','secondary',!selected.length)}</div><p class="card-caption">Accept retains the source condition without changing values. Resolve records your conclusion after checking or correcting the data. A reviewer and explanation are required. Technical extraction and mapping errors cannot be accepted.</p>
      <div class="flag-list">${visible.map(i=>{const b=p.source_blocks.find(b=>b.id===i.block_id);return `<article class="flag-card"><div class="actions"><input type="checkbox" data-flag-id="${esc(i.id)}" aria-label="Select ${esc(i.id)}" ${selected.includes(i.id)?'checked':''} ${state.busy?'disabled':''} />${badge(i.severity,i.severity==='error'?'warning':'neutral')}${badge(i.status)}<strong>${esc(i.code)}</strong><small>${esc(i.id)}</small></div><p>${esc(i.message)}</p><small>${esc(i.block_id)}</small><details><summary>Source evidence</summary><pre class="source-evidence">${esc(typeof b?.raw==='string'?b.raw:JSON.stringify(b?.raw,null,2))}</pre></details></article>`}).join('')||'<p>No flags in this view.</p>'}</div></section>`;
  }
  function decisionDialog() {
    if(!state.decision)return '';
    const d=state.decision,approval=d.action==='approve';
    const titles={accept:'Accept source conditions',resolve:'Resolve validation flags',reopen:'Reopen validation flags',approve:'Approve JSON package'};
    return `<dialog id="decision-dialog" aria-labelledby="decision-title"><form id="decision-form"><div class="dialog-heading"><h2 id="decision-title">${titles[d.action]}</h2>${button('Cancel','cancel-decision')}</div><p>${approval ? `Approve all ${state.package.records.length} included records and the current mappings as your finalized JSON revision. This does not publish or create a database resource.` : `${d.ids.length} selected flag(s). The decision and your explanation will be retained with the JSON package.`}</p><div class="field"><label for="decision-actor">Reviewer</label><input id="decision-actor" readonly value="${esc(api.actorName || 'Signed-in user')}" readonly required /></div><div class="field"><label for="decision-note">Explanation</label><textarea id="decision-note" required></textarea></div>${approval?'<label class="null-toggle"><input type="checkbox" id="approval-confirm" required /> I reviewed all included records, field mappings and flag decisions.</label>':''}<div class="actions">${button(approval?'Approve finalized JSON':'Record decision','commit-decision','primary')}</div></form></dialog>`;
  }

  function jsonPage() {
    if (!state.package) return heading('JSON package','Extract or open a package first.',button('Open JSON package','open'));
    return heading('Real JSON package','Edit normalized record values here. Field definitions, source evidence and audit history are protected.',button('Save JSON revision','save','primary')+' '+button('Approve JSON package','approve-dialog','secondary',blockers()>0 || state.package.review_status==='approved'))+packageSummary()+
      `<section class="surface pad"><div class="form-row"><div class="field"><label for="json-actor">Reviewer</label><input id="json-actor" readonly value="${esc(state.jsonActor)}" /></div><div class="field"><label for="json-note">Correction note</label><input id="json-note" value="${esc(state.jsonNote)}" placeholder="Explain your changes" /></div></div>
      <div class="field"><label for="json-editor">Import package JSON</label><textarea id="json-editor" class="json-editor" spellcheck="false">${esc(state.jsonDraft ?? JSON.stringify(state.package,null,2))}</textarea></div><div class="actions">${button('Validate and apply JSON edits','apply-json','primary')}${button('Reset editor','reset-json')}</div><p class="card-caption">Editing mappings is available under Configure. Applying value edits creates an audited revision; it does not approve or publish the package.</p></section>`;
  }
  function activity() {
    const audits=[...(state.package?.audit || []).map(a=>({...a,action:'record correction'})),...(state.package?.review_history || [])].sort((a,b)=>a.revision-b.revision);
    return heading('Correction history','Corrections, flag decisions and approval changes are retained with their reviewer and explanation.')+`<section class="surface pad">${audits.length ? audits.slice().reverse().map(a => `<article class="audit-item"><h2>Revision ${a.revision} · ${esc(a.actor)}</h2><strong>${esc(a.action.replaceAll('_',' '))}</strong><p>${esc(a.note)}</p><small>${esc(a.at)}</small><div class="audit-values"><div><strong>Before</strong><pre>${esc(JSON.stringify(a.before,null,2))}</pre></div><div><strong>After</strong><pre>${esc(JSON.stringify(a.after,null,2))}</pre></div></div></article>`).join('') : '<p>No correction or review decisions yet.</p>'}</section>`;
  }
  function connectionPage() {
    const c=state.connection;
    if(!c)return heading('MariaDB connection','Load the local connection settings.',button('Load settings','load-connection','primary'));
    if(c.hosted)return heading('Website connection','Database access uses your signed-in account and selected church.')+'<section class="surface pad"><p>Choose a church in <a href="/apps/">OM Applications</a>. Import review and exact table confirmation are required before database writes.</p></section>';
    const s=c.settings,v=c.verification;
    return heading('MariaDB connection','Connect to your local server and verify access to the selected church database.')+
      `<section class="surface pad mb-24"><div class="form-row"><div class="field"><label for="db-host">Host</label><select id="db-host">${['localhost','127.0.0.1','::1'].map(h=>`<option ${h===s.host?'selected':''}>${h}</option>`).join('')}</select></div><div class="field"><label for="db-port">TCP port</label><input id="db-port" type="number" min="1" max="65535" value="${s.port}" /></div><div class="field"><label for="db-name">Database</label><input id="db-name" value="the selected church database" readonly /></div></div>
      <div class="form-row"><div class="field"><label for="db-user">MariaDB username</label><input id="db-user" value="${esc(s.user)}" autocomplete="off" placeholder="Your database account" /></div><div class="field"><label for="db-password">Password</label><input id="db-password" type="password" autocomplete="new-password" placeholder="${c.hasSessionPassword?'Retained in this app session':'Enter password (may be blank)'}" /></div></div>
      <label class="null-toggle"><input type="checkbox" id="db-keep-password" ${c.hasSessionPassword?'checked':''} ${c.hasSessionPassword?'':'disabled'} /> Use password retained in this app session</label>
      <div class="form-row"><div class="field"><label for="db-transport">Transport</label><select id="db-transport"><option value="tcp" ${s.transport==='tcp'?'selected':''}>TCP/IP</option><option value="socket" ${s.transport==='socket'?'selected':''}>Local Unix socket</option></select></div><div class="field"><label for="db-socket">Unix socket path (socket transport only)</label><input id="db-socket" value="${esc(s.socket)}" placeholder="/run/mysqld/mysqld.sock" /></div></div>
      <div class="actions">${button('Connect / test','test-connection','primary')}${button('Save connection settings','save-connection')}${button('Forget connection','forget-connection')}</div><p class="card-caption">Host, port, database, username and transport are saved locally. The password is kept only in memory until the app closes; it is never written to settings or JSON packages.</p></section>
      <section class="surface pad"><h2>${v?'Connection verified':'Not verified'}</h2>${v?`<div class="summary-strip">${badge(v.database,'success')}${badge(v.server_version,'info')}${badge('Read-only check')}</div><p>Account: ${esc(v.account)} · Database charset: ${esc(v.charset)} · Collation: ${esc(v.collation)}</p><p>${esc(v.message)}</p><small>${esc(v.verified_at)}</small>`:'<p>Enter credentials and choose Connect / test. Use a MariaDB account that has access to the selected church database.</p>'}<p class="card-caption">The test opens a short-lived read-only connection and closes it after verification. It does not create tables, insert data or execute the SQL preview. Database imports require a separate final review on the Database import screen.</p></section>`;
  }
  function collectConnection() {
    const password=document.getElementById('db-password').value;
    return {host:document.getElementById('db-host').value,port:Number(document.getElementById('db-port').value),database:'the selected church database',user:document.getElementById('db-user').value,password,
      transport:document.getElementById('db-transport').value,socket:document.getElementById('db-socket').value,keepPassword:document.getElementById('db-keep-password').checked && !password};
  }
  function sqlPage() {
    const p=state.package;
    const approved=p?.schema_version==='2.1.0' && p.review_status==='approved';
    if(!approved) return heading('MariaDB schema preview','Approve the current JSON revision before generating an offline SQL plan.')+`<section class="surface pad"><p>SQL preview does not use a database connection.</p>${p?button('Review package','review','primary'):button('Open JSON package','open','primary')}</section>`;
    const plan=state.sqlPlan;
    const actions=button('Generate SQL dry-run','generate-sql','primary')+' '+button('Export preview report','export-sql','secondary',!plan);
    if(!plan)return heading('MariaDB schema preview','Review proposed tables and field types without connecting to a database.',actions)+packageSummary()+`<section class="surface pad"><p>Generate a plan from this approved revision. Every approved row is checked locally; no SQL is executed.</p></section>`;
    return heading('MariaDB schema preview','Offline planning only. No database connection, table creation or data insertion.',actions)+packageSummary()+
      `<section class="surface pad mb-24"><h2>${esc(plan.target.table)}</h2><div class="summary-strip">${badge(plan.status,plan.counts.errors?'warning':'success')}${badge(plan.counts.bound_rows_checked+' rows checked','info')}${badge(plan.counts.rejected_rows+' rejected rows excluded')}${badge('0 statements executed')}${badge(plan.counts.errors+' compatibility errors',plan.counts.errors?'warning':'neutral')}</div><p>Destination schema: assigned later from trusted application context. ${esc(plan.target.engine)} · ${esc(plan.target.charset)}</p><p class="card-caption">Approved revision ${plan.package.revision} · fingerprint ${esc(plan.package.approval_sha256)}</p></section>
      <section class="surface mb-24"><div class="table-top"><h2>Proposed columns</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Column</th><th>Logical type</th><th>MariaDB type</th><th>Nullable</th><th>Role</th><th>Reason</th></tr></thead><tbody>${plan.columns.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.logical_type)}</td><td>${esc(c.sql_type)}</td><td>${c.nullable?'Yes':'No'}</td><td>${esc(c.role)}</td><td>${esc(c.reason)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="surface pad mb-24"><h2>CREATE TABLE preview</h2><pre class="sql-code">${esc(plan.ddl_sql)}</pre><h2>Parameterized INSERT</h2><pre class="sql-code">${esc(plan.insert_sql)}</pre><p class="card-caption">Values stay in parameter bindings. No document text is interpolated into SQL.</p><h2>Count verification template</h2><pre class="sql-code">${esc(plan.verification.sql)}</pre><p>Expected imported rows: ${plan.verification.expected_count}</p><details><summary>Parameter order and first ${plan.sample_bindings.length} example bindings</summary><pre class="sql-code">${esc(JSON.stringify({parameter_order:plan.parameter_order,samples:plan.sample_bindings},null,2))}</pre></details></section>
      <section class="surface pad"><h2>Offline findings and limits</h2>${plan.findings.length?plan.findings.map(i=>`<p class="${i.severity==='error'?'error-message':''}"><strong>${esc(i.code)}</strong> · ${esc(i.field)} · ${esc(i.message)}</p>`).join(''):'<p>No value compatibility errors were found in the offline checks.</p>'}<ul>${plan.limits.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></section>`;
  }
  function importPage() {
    const r=state.importReview,p=r?.plan;
    let html=heading('Import approved records','Create a new version table in the selected church database from an approved cemetery or parish JSON package.',
      button('Review database import','review-import','primary',!state.package));
    if(state.importResult){const x=state.importResult;html+='<section class="surface pad mb-24"><h2>Import completed</h2><p>'+esc(x.rows_imported)+' records verified and imported into '+esc(x.database)+'.'+esc(x.table)+'</p><p>Approved revision '+esc(x.revision)+' · '+esc(x.completed_at)+'</p><p>'+esc(x.receipt_warning||'A local import receipt was saved. The approved JSON package is unchanged.')+'</p></section>';}
    if(!p)return html+'<section class="surface pad"><p>Open an approved cemetery or parish package, then review the import here. Review checks the server and table availability without writing to the database.</p></section>';
    html+='<section class="surface pad mb-24"><h2>Final import review</h2><p>Resource: '+esc(p.resource_kind)+' records</p><p>Server: '+esc(r.server.server_version)+' · Account: '+esc(r.server.account)+'</p><p>Database: <strong>'+esc(p.target.schema)+'</strong><br>New table: <strong>'+esc(p.target.table)+'</strong></p><p>'+esc(p.counts.approved_rows)+' approved records to insert · '+esc(p.counts.rejected_rows)+' rejected records excluded · '+esc(p.counts.warnings)+' warnings</p><p>Source: '+esc(p.package.source_filename)+' · Approved revision '+esc(p.package.revision)+'</p><p class="card-caption">Approval fingerprint: '+esc(p.package.approval_sha256)+'</p><p>A staging table will be created, all values verified, then renamed to this destination. Existing tables are never replaced. Field definitions are saved for the resource viewer. Database DDL cannot be rolled back as a single transaction; interrupted imports may leave a staging table for inspection.</p></section>';
    html+='<section class="surface mb-24"><div class="table-top"><h2>Fields and MariaDB types</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Field</th><th>Type</th><th>Nullable</th><th>Role</th></tr></thead><tbody>'+p.columns.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.sql_type)+'</td><td>'+(c.nullable?'Yes':'No')+'</td><td>'+esc(c.role)+'</td></tr>').join('')+'</tbody></table></div></section>';
    html+='<section class="surface pad"><h2>Confirm database writes</h2><p>Type the destination table name, then continue to the final confirmation dialog. Review expires after ten minutes.</p><div class="field"><label for="import-table-confirm">Destination table name</label><input id="import-table-confirm" autocomplete="off"></div>'+button('Continue to confirmation','confirm-import','primary')+'<details><summary>Review findings and generated CREATE TABLE</summary><pre class="sql-code">'+esc(JSON.stringify(p.findings,null,2))+'</pre><pre class="sql-code">'+esc(p.ddl_sql)+'</pre></details></section>';
    return html;
  }
  const viewer={resources:[],selected:'',result:null,search:'',page:0,sort:[],editor:null};
  async function loadViewer(refresh=false){
    if(refresh || !viewer.resources.length){
      const result=await api.resource('resources');viewer.resources=result.resources;
      if(!viewer.resources.some(r=>r.table===viewer.selected)){viewer.selected=viewer.resources[0]?.table||'';viewer.page=0;viewer.sort=[];}
    }
    viewer.result=viewer.selected?await api.resource('browse',{table:viewer.selected,search:viewer.search,page:viewer.page,sort:viewer.sort}):null;
  }
  function viewerPage(){
    const r=viewer.result?.resource,rows=viewer.result?.rows||[];
    let html=heading('Resource viewer','Browse and maintain imported cemetery and parish records in the selected church database.',
      button('Refresh resources','rv-refresh')+' '+button('Add entry','rv-add','primary',!r));
    html+='<section class="surface pad mb-24 viewer-controls"><div class="form-row"><div class="field"><label for="rv-resource">Resource table</label><select id="rv-resource"><option value="">Select a resource</option>'+viewer.resources.map(x=>'<option value="'+esc(x.table)+'" '+(x.table===viewer.selected?'selected':'')+'>'+esc(x.name)+' · '+esc(x.table)+'</option>').join('')+'</select></div><div class="field"><label for="rv-search">Search field values</label><input id="rv-search" value="'+esc(viewer.search)+'" maxlength="250" placeholder="Name, plot, grave, feast…"></div></div><div class="actions">'+button('Search','rv-search','primary',!r)+button('Clear search','rv-clear','secondary',!r)+'</div></section>';
    if(!r)return html+'<section class="surface pad"><p>Refresh resources to use your website account and selected church. Imported cemetery and parish tables appear here. No approved JSON file is needed to browse the database.</p></section>';
    html+='<section class="surface pad mb-24 viewer-controls"><h2>'+esc(r.name)+'</h2><p>'+esc(r.kind)+' · '+esc(viewer.result.total)+' matching entries · Page '+(viewer.page+1)+' of '+Math.max(1,Math.ceil(viewer.result.total/viewer.result.page_size))+'</p><div class="actions">';
    for(const [role,label] of [['plot','Plot'],['grave','Grave'],['last_name','Last Name']]){
      if(r.sort_roles[role])html+='<button class="btn secondary" data-action="rv-role-sort" data-role="'+role+'">Sort by '+label+'</button>';
    }
    if(r.sort_roles.plot && r.sort_roles.grave && r.sort_roles.last_name)html+=button('Plot → Grave → Last Name','rv-compound');
    html+='</div><details><summary>More sort options</summary><div class="form-row"><div class="field"><label for="rv-sort-field">Sort field</label><select id="rv-sort-field">'+r.fields.map(f=>'<option value="'+esc(f.name)+'" '+(viewer.sort[0]?.field===f.name?'selected':'')+'>'+esc(f.label)+'</option>').join('')+'</select></div><div class="field"><label for="rv-sort-direction">Direction</label><select id="rv-sort-direction"><option value="asc">Ascending</option><option value="desc" '+(viewer.sort[0]?.direction==='desc'?'selected':'')+'>Descending</option></select></div></div>'+button('Apply sort','rv-apply-sort')+'</details><p class="card-caption">Click a field heading to reverse its sort. Plot and Grave use numeric-prefix sorting. Empty values sort last. '+(r.inferred_fields?'This older import uses field definitions inferred from its database columns.':'Field definitions and mappings come from the approved import.')+'</p></section>';
    html+='<section class="surface mb-24"><div class="table-wrap"><table class="data-table"><thead><tr><th>Entry</th><th>Origin</th>'+r.fields.map(f=>'<th><button class="btn secondary" data-action="rv-sort" data-field="'+esc(f.name)+'">'+esc(f.label)+(viewer.sort.find(x=>x.field===f.name)?.direction==='asc'?' ↑':viewer.sort.find(x=>x.field===f.name)?' ↓':'')+'</button></th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr><td><button class="btn secondary" data-action="rv-edit" data-row="'+row.row_id+'">View / edit #'+row.row_id+'</button></td><td>'+esc(row.origin)+'</td>'+r.fields.map(f=>'<td>'+esc(fmt(row.values[f.name]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><div class="actions pad">'+button('Previous page','rv-prev','secondary',viewer.page===0)+button('Next page','rv-next','secondary',(viewer.page+1)*viewer.result.page_size>=viewer.result.total)+'</div></section>';
    return html;
  }
  function viewerDialog(){
    const e=viewer.editor;if(!e)return '';const r=e.resource;
    return '<dialog id="rv-dialog" aria-labelledby="rv-title"><form id="rv-form"><div class="dialog-heading"><h2 id="rv-title">'+(e.row?'Entry #'+e.row.row_id:'Add '+esc(r.kind)+' entry')+'</h2>'+button('Cancel','rv-cancel')+'</div><p>Changes are saved to the database with an audit entry. Imported source evidence stays unchanged.</p><div class="edit-grid">'+r.fields.map(f=>{
      const value=e.values[f.name];let input;
      if(f.type==='boolean')input='<select data-rv-value="'+esc(f.name)+'"><option value="true" '+(value===true?'selected':'')+'>true</option><option value="false" '+(value===false?'selected':'')+'>false</option></select>';
      else if(['json','partial_date'].includes(f.type))input='<textarea data-rv-value="'+esc(f.name)+'" spellcheck="false">'+(value===null?'':esc(JSON.stringify(value,null,2)))+'</textarea>';
      else input='<input data-rv-value="'+esc(f.name)+'" value="'+(value===null?'':esc(value))+'">';
      return '<div class="field"><label>'+esc(f.label)+' · '+esc(f.type)+'</label>'+input+(f.nullable?'<label class="null-toggle"><input type="checkbox" data-rv-null="'+esc(f.name)+'" '+(value===null?'checked':'')+'> Store null</label>':'<small>Required</small>')+'</div>';
    }).join('')+'</div><div class="form-row"><div class="field"><label for="rv-actor">Reviewer</label><input id="rv-actor" readonly value="'+esc(e.actor)+'" required maxlength="128"></div><div class="field"><label for="rv-note">Reason for change</label><input id="rv-note" value="'+esc(e.note)+'" required maxlength="4000"></div></div><div id="rv-error" class="error-message" role="alert">'+esc(e.error||'')+'</div><div class="actions">'+button(e.row?'Save audited changes':'Add audited entry','rv-save','primary')+'</div>'+
      (e.row?'<details><summary>Original import evidence and provenance</summary><pre class="source-evidence">'+esc(JSON.stringify(e.row.provenance,null,2))+'</pre></details><h2>Entry audit history</h2><p class="card-caption">Latest 100 changes shown; the database retains the complete audit.</p>'+(e.audit.length?e.audit.map(a=>'<details><summary>'+esc(a.at)+' UTC · '+esc(a.action)+' · '+esc(a.actor)+' · '+esc(a.note)+'</summary><p>Database account: '+esc(a.db_account)+'</p><pre class="source-evidence">'+esc(JSON.stringify({before:a.before?.values||null,after:a.after.values},null,2))+'</pre></details>').join(''):'<p>No resource edits have been recorded. Original import provenance is shown above.</p>'):'')+'</form></dialog>';
  }
  async function openViewerRow(id){
    const detail=await api.resource('detail',{table:viewer.selected,row_id:id});
    viewer.editor={...detail,values:structuredClone(detail.row.values),actor:(api.actorName || 'Signed-in user'),note:'',requestId:crypto.randomUUID()};
  }

  function editDialog() {
    if (!state.modal) return '';
    const r=state.package.records.find(r => r.id===state.modal);
    return `<dialog id="record-dialog" aria-labelledby="record-dialog-title"><form id="record-form"><div class="dialog-heading"><h2 id="record-dialog-title">Edit ${r.source_location.paragraph !== undefined ? 'paragraph '+r.source_location.paragraph : 'source row '+r.source_location.row}</h2>${button('Cancel','cancel-edit')}</div><p>Change normalized values. Original source evidence remains unchanged.</p><div class="edit-grid">${state.package.configuration.fields.map(f => {
      const v=r.normalized[f.name];
      return `<div class="field"><label for="value-${f.name}">${esc(f.label)}</label>${f.type==='boolean' ? `<select id="value-${f.name}" data-value="${f.name}"><option value="true" ${v===true?'selected':''}>true</option><option value="false" ${v===false?'selected':''}>false</option></select>` : f.type==='json' || f.type==='partial_date' ? `<textarea id="value-${f.name}" data-value="${f.name}" spellcheck="false">${v===null?'':esc(JSON.stringify(v,null,2))}</textarea>` : `<input id="value-${f.name}" data-value="${f.name}" value="${v===null?'':esc(v)}" />`}<label class="null-toggle"><input type="checkbox" data-null="${f.name}" ${v===null?'checked':''} /> Store null</label><small class="card-caption">${esc(f.type)}</small></div>`;
    }).join('')}</div><div class="form-row"><div class="field"><label for="edit-actor">Reviewer</label><input id="edit-actor" value="${esc(api.actorName || 'Signed-in user')}" readonly required /></div><div class="field"><label for="edit-note">Correction note</label><input id="edit-note" required placeholder="Explain this correction" /></div></div>
      <div id="edit-error" class="error-message" role="alert"></div><div class="actions">${button('Apply correction','apply-correction','primary')}</div><details open><summary>Original source evidence</summary><pre class="source-evidence">${esc(typeof r.original==='string'?r.original:JSON.stringify(r.original,null,2))}</pre>${r.source_location.paragraph!==undefined ? `<p class="card-caption">Paragraph ${r.source_location.paragraph} · characters ${r.source_location.char_start}–${r.source_location.char_end} (zero-based)</p><pre class="source-evidence">${esc(state.package.source_blocks.find(b=>b.id===r.block_id)?.raw)}</pre>` : ''}</details></form></dialog>`;
  }
  function render() {
    const pages={overview,configure:configuration,review,flags:flagsPage,json:jsonPage,activity,sql:sqlPage,connection:connectionPage,import:importPage,resources:viewerPage};
    const nav=[['overview','Overview'],['configure','Configure'],['review','Records'],['flags','Flags'],['json','JSON package'],['sql','SQL preview'],['connection','Connection'],['import','Database import'],['resources','Resource viewer'],['activity','History']];
    document.getElementById('app').innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand-area"><div class="brand-mark">OM</div><div><div class="brand-name">Orthodox Metrics</div><div class="brand-caption">OM Importer</div></div></div><div class="workspace-tag"><div><a href="/apps/" style="color:#78deb4">← OM Applications</a><div class="workspace-title">${esc(api.workspaceName || 'Church import workspace')}</div><div class="workspace-desc">File → editable JSON</div></div></div><nav class="side-section side-nav">${nav.map(([id,label]) => `<button class="nav-link ${state.page===id?'active':''}" data-page="${id}" ${state.busy?'disabled':''}>${label}</button>`).join('')}</nav><div class="side-section">${button('Select document','choose','primary')}${button('Open JSON package','open')}</div><div class="side-footer">OM Importer 0.9.0<br/>Cemetery and parish imports</div></aside><main class="main"><header class="topbar"><span>Workspace / ${nav.find(([id])=>id===state.page)?.[1]}</span><div class="actions">${state.busy?badge('Processing…','info'):badge('Server engine','success')}${button('Switch theme','theme')}</div></header><div class="content desktop-content">${state.error?`<div class="error-message banner" role="alert">${esc(state.error)}</div>`:''}${state.notice?`<div class="notice-message banner" role="status">${esc(state.notice)}</div>`:''}${pages[state.page]()}<footer class="app-footer">Source files and JSON revisions · Cemetery and parish imports</footer></div></main></div>${editDialog()}${decisionDialog()}${viewerDialog()}`;
    if(viewer.editor){document.getElementById('rv-dialog').showModal();if(state.busy)document.querySelectorAll('#rv-form input,#rv-form textarea,#rv-form select').forEach(el=>el.disabled=true);}
    if(state.decision)document.getElementById('decision-dialog').showModal();
    if (state.modal) document.getElementById('record-dialog').showModal();
  }
  function collectConfig() {
    const cfg=structuredClone(state.config);
    cfg.resource_name=document.getElementById('resource-name').value;
    if (state.source && cfg.profile==='xlsx') cfg.selection={sheet:document.getElementById('sheet-select').value,header_row:Number(document.getElementById('header-row').value)};
    cfg.fields=[...document.querySelectorAll('[data-field-row]')].map(row => {
      const value=key=>row.querySelector(`[data-setting="${key}"]`).value;
      const source=value('source');const colon=source.indexOf(':');
      const f={name:value('name'),label:value('label'),type:value('type'),source:{[source.slice(0,colon)]:source.slice(colon+1)},nullable:row.querySelector('[data-setting="nullable"]').checked};
      if (value('format').trim()) f.format=value('format').trim();
      return f;
    });
    state.config=cfg;
    return cfg;
  }
  async function task(work) {
    if (state.busy) return;
    state.busy=true;state.error='';state.notice='';render();
    try { await work(); } catch (error) { state.error=error.message; }
    finally { state.busy=false;render(); }
  }
  function setPackage(p,dirty=true) { state.importReview=null;state.importResult=null;state.sqlPlan=null;state.jsonDraft=null;state.package=p;state.config=structuredClone(p.configuration || null);state.dirty=dirty;state.pageIndex=0;state.selectedFlags=[]; }
  document.addEventListener('click', async event => {
    const node=event.target.closest('[data-page],[data-action]');if (!node || state.busy) return;
    if(node.dataset.page==='resources')return task(async()=>{state.page='resources';await loadViewer(true);});
    if (node.dataset.page==='connection')return task(async()=>{state.connection=await api.getConnection();state.page='connection';});
    if (node.dataset.page) { if(state.page==='configure' && state.config) collectConfig();state.page=node.dataset.page;state.error='';render();return; }
    const action=node.dataset.action;
    if(action==='theme'){document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';return;}
    if(action==='choose') return task(async()=>{const result=await api.chooseSource();if(!result)return;state.source=result;state.config=result.configuration;state.package=null;state.importReview=null;state.importResult=null;state.sqlPlan=null;state.jsonDraft=null;state.dirty=false;state.page='configure';});
    if(action==='open') return task(async()=>{const result=await api.openPackage();if(!result)return;state.source=null;setPackage(result.package,result.migrated);state.page='review';if(result.migrated)state.notice='Version 1 package upgraded for configurable review. Save this new revision.';});
    if(action==='configure' || action==='review' || action==='flags'){state.page=action;render();return;}
    if(action==='inspect'){const cfg=collectConfig();return task(async()=>{const result=await api.inspect(cfg.selection);state.source=result;state.config=result.configuration;state.notice='Source columns refreshed. Review the suggested field definitions.';});}
    if(action==='extract' || action==='reextract'){const cfg=collectConfig();return task(async()=>{setPackage(state.package && action!=='reextract'?await api.configure(cfg):await api.extract(cfg));state.page='review';state.notice='Real JSON extracted and validated. Save a revision to retain it.';});}
    if(action==='add-field'){collectConfig();let name='new_field',i=1;while(state.config.fields.some(f=>f.name===name))name='new_field_'+(++i);state.config.fields.push({name,label:'New field',type:'string',source:structuredClone(state.config.fields[0]?.source || {column:'A'}),nullable:true});render();return;}
    if(action==='remove-field'){collectConfig();state.config.fields.splice(Number(node.dataset.index),1);render();return;}
    if(action==='rv-refresh')return task(()=>loadViewer(true));
    if(action==='rv-search' || action==='rv-clear'){viewer.search=action==='rv-clear'?'':document.querySelector('#rv-search').value;viewer.page=0;return task(()=>loadViewer());}
    if(action==='rv-prev' || action==='rv-next'){viewer.page+=action==='rv-next'?1:-1;return task(()=>loadViewer());}
    if(['rv-sort','rv-role-sort','rv-compound','rv-apply-sort'].includes(action)){
      const role=viewer.result.resource.sort_roles;
      if(action==='rv-compound')viewer.sort=['plot','grave','last_name'].map(k=>({field:role[k],direction:'asc'}));
      else if(action==='rv-apply-sort')viewer.sort=[{field:document.querySelector('#rv-sort-field').value,direction:document.querySelector('#rv-sort-direction').value}];
      else {const field=action==='rv-sort'?node.dataset.field:role[node.dataset.role];viewer.sort=[{field,direction:viewer.sort[0]?.field===field && viewer.sort[0].direction==='asc'?'desc':'asc'}];}
      viewer.page=0;return task(()=>loadViewer());
    }
    if(action==='rv-add'){const r=viewer.result.resource;viewer.editor={resource:r,row:null,audit:[],values:Object.fromEntries(r.fields.map(f=>[f.name,f.nullable?null:f.type==='string'?'':null])),actor:(api.actorName || 'Signed-in user'),note:'',requestId:crypto.randomUUID()};render();return;}
    if(action==='rv-edit')return task(()=>openViewerRow(Number(node.dataset.row)));
    if(action==='rv-cancel'){viewer.editor=null;render();return;}
    if(action==='rv-save'){
      const e=viewer.editor,form=document.querySelector('#rv-form');if(!form.reportValidity())return;
      try{
        e.actor=document.querySelector('#rv-actor').value;e.note=document.querySelector('#rv-note').value;e.error='';
        e.values=Object.fromEntries(e.resource.fields.map(f=>{const raw=form.querySelector('[data-rv-value="'+f.name+'"]').value;return [f.name,form.querySelector('[data-rv-null="'+f.name+'"]')?.checked?null:['string','date'].includes(f.type)?raw:JSON.parse(raw)];}));
      }catch(error){e.error=error.message;document.querySelector('#rv-error').textContent=error.message;return;}
      return task(async()=>{try{
        const saved=await api.resource('save',{table:e.resource.table,row_id:e.row?.row_id||null,values:e.values,actor:e.actor,note:e.note,request_id:e.requestId,fingerprint:e.row?.fingerprint});
        state.notice='Entry saved with an audit record.';viewer.editor=null;await loadViewer();await openViewerRow(saved.row.row_id);
      }catch(error){e.error=error.message;throw error;}});
    }
    if(action==='review-import')return task(async()=>{state.importReview=null;state.importResult=null;state.importReview=await api.reviewImport();state.notice='Read-only preflight passed. Review the fields and confirm before any database writes.';});
    if(action==='confirm-import'){const table=document.querySelector('#import-table-confirm').value,token=state.importReview.token;return task(async()=>{try{const result=await api.confirmImport(token,table);state.importResult=result;state.notice=result?'Database import completed and verified.':'Import canceled. No database writes were requested.';}finally{state.importReview=null;}});}
    if(action==='load-connection')return task(async()=>{state.connection=await api.getConnection();});
    if(action==='forget-connection'){state.importReview=null;viewer.resources=[];viewer.result=null;viewer.editor=null;return task(async()=>{state.connection=await api.forgetConnection();state.notice='Connection settings and session password cleared.';});}
    if(action==='test-connection' || action==='save-connection'){const settings=collectConnection();viewer.resources=[];viewer.result=null;viewer.editor=null;state.importReview=null;state.connection={...state.connection,settings:{...settings,password:undefined,keepPassword:undefined},verification:null};return task(async()=>{state.connection=action==='test-connection'?await api.testConnection(settings):await api.saveConnection(settings);state.notice=action==='test-connection'?'Connected successfully; read-only verification completed.':'Connection settings saved. Password retained for this app session only.';});}
    if(action==='generate-sql')return task(async()=>{state.sqlPlan=await api.sqlPreview();state.notice='Offline dry-run completed. No database was contacted.';});
    if(action==='export-sql')return task(async()=>{const result=await api.exportSqlPreview();if(result)state.notice='Saved offline preview report: '+result.filename;});
    if(action==='save')return task(async()=>{const result=await api.save();if(result){state.dirty=false;state.notice=`Saved ${result.filename} · revision ${result.revision}`;}});
    if(action==='select-flags'){state.selectedFlags=state.package.issues.filter(i=>state.flagFilter==='all'||i.status===state.flagFilter).map(i=>i.id);render();return;}
    if(action==='clear-flags'){state.selectedFlags=[];render();return;}
    if(['accept-flags','resolve-flags','reopen-flags'].includes(action)){state.decision={action:action.split('-')[0],ids:[...state.selectedFlags]};render();return;}
    if(action==='approve-dialog'){state.decision={action:'approve',ids:[]};render();return;}
    if(action==='cancel-decision'){state.decision=null;render();return;}
    if(action==='commit-decision'){
      if(!document.getElementById('decision-form').reportValidity())return;
      const d=state.decision,actor=document.getElementById('decision-actor').value,note=document.getElementById('decision-note').value;
      const confirmed=document.getElementById('approval-confirm')?.checked===true;
      state.decision=null;
      return task(async()=>{setPackage(d.action==='approve'?await api.approve(actor,note,confirmed):await api.decideFlags(d.ids,d.action,actor,note));state.notice=d.action==='approve'?'Finalized JSON approved. Save this approved revision; no database operation was performed.':'Flag decision recorded in review history.';});
    }
    if(action==='previous' || action==='next'){state.pageIndex+=action==='next'?1:-1;render();return;}
    if(action==='edit'){state.modal=node.dataset.id;render();return;}
    if(action==='cancel-edit'){state.modal=null;render();return;}
    if(action==='apply-correction'){
      const form=document.getElementById('record-form');if(!form.reportValidity())return;
      try {
        const changes={};
        for(const f of state.package.configuration.fields){const raw=form.querySelector(`[data-value="${f.name}"]`).value;changes[f.name]=form.querySelector(`[data-null="${f.name}"]`).checked?null: ['string','date'].includes(f.type)?raw:JSON.parse(raw);}
        const id=state.modal,actor=document.getElementById('edit-actor').value,note=document.getElementById('edit-note').value;
        state.modal=null;
        return task(async()=>{setPackage(await api.correct(id,changes,actor,note));state.notice='Correction validated and recorded in the audit history.';});
      }catch(error){document.getElementById('edit-error').textContent=error.message;}return;
    }
    if(action==='apply-json'){state.jsonDraft=document.getElementById('json-editor').value;const text=document.getElementById('json-editor').value,actor=document.getElementById('json-actor').value,note=document.getElementById('json-note').value;return task(async()=>{setPackage(await api.editJson(text,actor,note));state.notice='JSON changes validated and audited.';});}
    if(action==='reset-json'){state.jsonDraft=null;render();}
  });
  document.addEventListener('input',event=>{if(event.target.id==='json-editor')state.jsonDraft=event.target.value;if(event.target.id==='json-note')state.jsonNote=event.target.value;if(event.target.id==='json-actor')state.jsonActor=event.target.value;if(event.target.id==='record-search'){const pos=event.target.selectionStart;state.search=event.target.value;state.pageIndex=0;render();const search=document.getElementById('record-search');search.focus();search.setSelectionRange(pos,pos);}});
  document.addEventListener('change',event=>{if(event.target.id==='rv-resource'){viewer.selected=event.target.value;viewer.page=0;viewer.search='';viewer.sort=[];task(()=>loadViewer());return;}if(event.target.id==='flag-filter'){state.flagFilter=event.target.value;state.selectedFlags=[];render();}if(event.target.dataset.flagId){const id=event.target.dataset.flagId;state.selectedFlags=event.target.checked?[...state.selectedFlags,id]:state.selectedFlags.filter(v=>v!==id);render();}});
  document.addEventListener('keydown',event=>{if(event.target.id==='rv-search' && event.key==='Enter'){event.preventDefault();document.querySelector('[data-action=rv-search]').click();}});
  document.addEventListener('cancel',event=>{if(event.target.id==='rv-dialog'){event.preventDefault();viewer.editor=null;render();}if(event.target.id==='decision-dialog'){event.preventDefault();state.decision=null;render();}if(event.target.id==='record-dialog'){event.preventDefault();state.modal=null;render();}},true);
  render();
  api.getCurrent().then(result => {
    state.jsonActor=api.actorName;
    if (result.package) { setPackage(result.package,result.dirty);state.source=result.source;state.page='review'; }
    else if (result.source) { state.source=result.source;state.config=result.source.configuration;state.page='configure'; }
    state.importResult=result.lastImport||null;
    render();
  }).catch(error => {state.error=error.message;render();});
})();
