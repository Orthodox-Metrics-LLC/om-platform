import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

globalThis.window = globalThis;
globalThis.BroadcastChannel = undefined;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'om-collection-'));
let checks = 0;
const check = (condition, label) => { assert(condition, label); checks++; };
try {
    await fs.writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
    for (const name of ['backend','collection','catalog','db','dateMaintenance','dates','text','review','publication','storageInspection']) {
        const source = await fs.readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
        const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
            .replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, a, b, c) => a + b + '.js' + c);
        await fs.writeFile(path.join(temp, name + '.js'), output);
    }
    const load = name => import(pathToFileURL(path.join(temp, name + '.js')));
    const cat = await load('catalog'), db = await load('db'), collection = await load('collection');
    await cat.ensureCatalog();
    check((await cat.listBooks()).length === 0, 'fresh collection must not contain a generated demo draft');
    const first = await cat.createBook('Imported prayer book');
    check(collection.collectionSummary(await cat.listBooks()).saved.length === 1, 'new draft must count as a saved book before publication');
    const fixture = JSON.parse(await fs.readFile(new URL('../tests/fixtures/sample-book.json', import.meta.url)));
    const pages = fixture.pages.map((p, i) => ({ ...p, id: 'imported-' + i, textSource: 'ocr' }));
    const sources = fixture.sources.map(s => ({ ...s, blob: new Blob(['retained scan bytes'], { type: s.mime }) }));
    const annotation = { id:'retained-note',pageId:pages[0].id,kind:'note',color:'gold',note:'Keep my note',createdAt:new Date().toISOString() };
    await db.replaceLibrary({ ...fixture, book: { ...fixture.book, title:first.title }, pages, annotations:[annotation], bookmarks:[], publication:{status:'draft'} }, sources, first.database);
    await cat.syncCatalogBook(first.id, await db.readLibrary(first.database));
    const before = await db.readLibrary(first.database);
    const inspection = await load('storageInspection');
    const databaseNames = await indexedDB.databases();
    const inspected = await inspection.inspectBookStorage();
    check(inspected.find(entry => entry.name === first.database)?.pages === 4, 'storage check must report actual imported page count');
    check(inspected.find(entry => entry.name === first.database)?.sources === sources.length, 'storage check must count original source scans');
    assert.deepEqual(await indexedDB.databases(), databaseNames); checks++;
    assert.deepEqual(await db.readLibrary(first.database), before); checks++;
    await cat.abandonBook(first.id);
    await cat.ensureCatalog(); // Same reconciliation that runs after refresh.
    let rows = await cat.listBooks(), summary = collection.collectionSummary(rows);
    check(summary.saved.length === 1 && summary.abandoned.length === 1 && summary.drafts.length === 0, 'refresh must retain abandoned book in saved count');
    check(collection.collectionBooks(rows, 'all')[0].id === first.id, 'abandoned book must remain in default library list');
    check(collection.collectionBooks(rows, 'abandoned').length === 1, 'abandoned filter must expose resumable book');
    assert.deepEqual(await db.readLibrary(first.database), before); checks++;
    const retainedSource = (await db.getAll('sources', first.database))[0];
    check(await retainedSource.blob.text() === 'retained scan bytes', 'abandon and refresh must preserve source bytes');
    await cat.abandonBook(first.id, false);
    await cat.ensureCatalog();
    summary = collection.collectionSummary(await cat.listBooks());
    check(summary.drafts.length === 1 && summary.abandoned.length === 0, 'resumption must survive refresh');
    const second = await cat.createBook('Second imported book');
    await cat.abandonBook(first.id); await cat.abandonBook(second.id); await cat.ensureCatalog();
    rows = await cat.listBooks();
    check(collection.collectionBooks(rows, 'all').length === 2, 'abandoning both books must not empty the library');
    check(collection.collectionBooks(rows, 'draft').length === 0, 'active draft filter must exclude abandoned preparations');
    check(collection.collectionBooks(rows, 'all', 'prayer').length === 1, 'saved abandoned books must remain searchable');
    await cat.abandonBook(second.id, false);
    await db.commit(['settings'], tx => tx.objectStore('settings').put({id:'publication',value:{status:'published',publishedAt:new Date().toISOString()}}), second.database);
    await cat.syncCatalogBook(second.id, await db.readLibrary(second.database));
    rows = await cat.listBooks();
    check(collection.collectionBooks(rows, 'published').length === 1, 'ready-to-read filter must show only published books');
    const sample = {...rows[0],id:'demo',sample:true,pageCount:4};
    check(collection.collectionSummary([...rows,sample]).saved.length === 2, 'sample must not increase saved count');
    check(collection.collectionBooks([...rows,sample], 'all').length === 2, 'sample must not appear among user books');
    check(collection.collectionBooks([...rows,sample], 'sample')[0].id === 'demo', 'existing sample must remain accessible explicitly');
    check(collection.collectionBooks([{...rows[0],purged:true}], 'all').length === 0, 'purged books must stay hidden');
    console.log(`PASS ${checks} collection, import, abandon/resume, refresh and sample isolation checks`);
} finally { await fs.rm(temp, {recursive:true,force:true}); }
