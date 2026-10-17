export type ViewMode = 'read' | 'scan' | 'compare';
export type ReadingLayout = 'single' | 'spread' | 'continuous';
export type NarrationPreset = 'us-female' | 'us-male' | 'uk-female' | 'uk-male';
export type Theme = 'paper' | 'light' | 'dark';
export type HighlightColor = 'gold' | 'green' | 'blue' | 'rose';
export interface Crop {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface WordBox extends Crop {
    start: number;
    end: number;
    text: string;
}
export interface PageReview {
    method: 'individual' | 'bulk';
    at: string;
    batchId?: string;
    textVersion: number;
    cropVersion: number;
}
export interface DateIndex {
    version: 4;
    key: string;
    status: 'resolved' | 'unverified' | 'unresolved' | 'undated' | 'conflict';
    source: 'manual' | 'metadata' | 'text-header' | 'layout-header' | 'header-ocr';
    evidence: string;
    textVersion: number;
    cropVersion: number;
    checkedAt?: string;
}
export interface BookPage {
    /** Explicit operator date override; even an empty override is respected. */
    manualDate?: string;
    /** Date evidence is independent of transcript approval and never fabricates dates. */
    dateIndex?: DateIndex;
    id: string;
    sourceId: string;
    sourceName: string;
    order: number;
    title: string;
    detail: string;
    dateKey: string;
    weekday: string;
    feast: string;
    fasting: string;
    readings: string;
    crop: Crop;
    rotation: 0 | 90 | 180 | 270;
    cropVersion: number;
    text: string;
    textVersion: number;
    textSource: 'none' | 'sample-transcription' | 'ocr' | 'manual';
    reviewed: boolean;
    /** Optional fields: existing version-1 libraries remain compatible. */
    review?: PageReview;
    ocrError?: string;
    confidence?: number;
    words: WordBox[];
    read: boolean;
    createdAt: string;
}
export interface SourceAsset {
    id: string;
    name: string;
    mime: string;
    width: number;
    height: number;
    blob: Blob;
}
export interface TextAnchor {
    start: number;
    end: number;
    quote: string;
    prefix: string;
    suffix: string;
    detached?: boolean;
}
export interface Annotation {
    id: string;
    pageId: string;
    kind: 'text' | 'region' | 'note';
    color: HighlightColor;
    note: string;
    createdAt: string;
    anchor?: TextAnchor;
    rect?: Crop;
    cropVersion?: number;
}
export interface Bookmark {
    id: string;
    pageId: string;
    createdAt: string;
}
export interface PublicationState {
    status: 'draft' | 'published';
    publishedAt?: string;
    acceptedExceptions?: number;
}
export interface BookInfo {
    author?: string;
    coverPageId?: string;
    title: string;
    subtitle: string;
    year: string;
    calendar: string;
}
export interface Preferences {
    pageId: string;
    /** Preparation source view; independent of the reader's layout. */
    view: ViewMode;
    readingLayout?: ReadingLayout;
    autoMarkRead?: boolean;
    autoOpenToday?: boolean;
    narrationEngine?: 'browser' | 'azure';
    narrationPreset?: NarrationPreset;
    narrationVoiceURI?: string;
    narrationRate?: number;
    narrationFollow?: boolean;
    narrationCloudConsent?: boolean;
    theme: Theme;
    fontSize: number;
}
export interface LibraryState {
    publication?: PublicationState;
    pages: BookPage[];
    annotations: Annotation[];
    bookmarks: Bookmark[];
    book: BookInfo;
    prefs: Preferences;
}
export interface BookManifest extends LibraryState {
    format: 'om-book';
    version: 1;
    sources: Omit<SourceAsset, 'blob'>[];
    kind: 'backup' | 'publication';
}
export interface SelectionAnchor extends TextAnchor {
    pageId: string;
}
