import type { CatalogBook } from './catalog';

export type CollectionFilter = 'all' | 'draft' | 'published' | 'abandoned' | 'sample';

/** Demo content and purged tombstones are not part of the user's saved collection. */
export function collectionSummary(books: CatalogBook[]) {
    const saved = books.filter(book => !book.purged && !book.sample);
    return {
        saved,
        published: saved.filter(book => book.status === 'published' || book.publishedAvailable),
        drafts: saved.filter(book => book.status === 'draft' && !book.abandoned),
        abandoned: saved.filter(book => book.status === 'draft' && book.abandoned),
        pageCount: saved.reduce((count, book) => count + book.pageCount, 0)
    };
}

export function collectionBooks(books: CatalogBook[], filter: CollectionFilter, query = '', sort = 'recent') {
    const search = query.toLocaleLowerCase().trim();
    return books.filter(book => !book.purged && (filter === 'sample' ? book.sample : !book.sample) &&
        (filter === 'all' || filter === 'sample' || filter === 'abandoned' && book.abandoned && book.status === 'draft' ||
            filter === 'draft' && book.status === 'draft' && !book.abandoned || filter === 'published' && (book.status === 'published' || book.publishedAvailable)) &&
        (!search || `${book.title} ${book.subtitle} ${book.author} ${book.year}`.toLocaleLowerCase().includes(search)))
        .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'published' ?
            (b.publishedAt || '').localeCompare(a.publishedAt || '') :
            (b.lastOpenedAt || b.updatedAt).localeCompare(a.lastOpenedAt || a.updatedAt));
}
