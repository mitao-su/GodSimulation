const CJK_CHARACTER =
  /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu;

export function createArchiveMemoryFullTextDocument(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(CJK_CHARACTER, " $1 ")
    .replace(/\s+/gu, " ")
    .trim();
}
