import type { Language } from "@saha/shared";
const sinhala = /\p{Script=Sinhala}/gu;
const tamil = /\p{Script=Tamil}/gu;
const siWords = new Set(
  "ayubowan kohomada oyala oyalage mata meka thiyenawada kiyada ganan ganna puluwanda denna ewanawada mokakda istuti sthuthi enawada karanna ona one nadda loku podi honda hari balanna".split(
    " ",
  ),
);
const taWords = new Set(
  "vanakkam enakku ungal unga irukka irukku evvalavu vilai venum vendum anuppa mudiyuma eppadi eppo nandri konjam theriyuma varuma seiyalaam sollunga porul".split(
    " ",
  ),
);
export function detectLanguage(
  text: string,
  previous: Language = "en",
): { language: Language; confidence: number; ambiguous: boolean } {
  const si = (text.match(sinhala) ?? []).length,
    ta = (text.match(tamil) ?? []).length;
  if (si || ta)
    return {
      language: si >= ta ? "si" : "ta",
      confidence: si && ta ? 0.65 : 0.98,
      ambiguous: !!(si && ta),
    };
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const s = words.filter((w) => siWords.has(w)).length,
    t = words.filter((w) => taWords.has(w)).length;
  if (s || t)
    return {
      language: s === t ? previous : s > t ? "singlish" : "tanglish",
      confidence: s === t ? 0.45 : Math.min(0.95, 0.65 + Math.max(s, t) * 0.1),
      ambiguous: s === t,
    };
  const brief = words.length <= 2 || !words.length;
  return {
    language: brief ? previous : "en",
    confidence: brief ? 0.5 : 0.8,
    ambiguous: brief,
  };
}
export function asksForHuman(text: string, triggers: string[]) {
  return (
    /\b(human|agent|staff|manager|representative|person|complaint)\b|මනුෂ්‍ය|සේවක|කෙනෙක්|மனித|ஊழிய|aal kitta|kenek ekka/i.test(
      text,
    ) || triggers.some((t) => text.toLowerCase().includes(t.toLowerCase()))
  );
}
