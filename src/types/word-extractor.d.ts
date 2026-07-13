/**
 * word-extractor ships no types. It reads the OLE compound streams of a legacy
 * binary .doc — the format mammoth (docx-only) cannot touch — and this is the
 * whole surface we use.
 */
declare module 'word-extractor' {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
    getAnnotations(): string;
    getTextboxes(): string;
  }

  export default class WordExtractor {
    extract(source: Buffer | string): Promise<Document>;
  }
}
