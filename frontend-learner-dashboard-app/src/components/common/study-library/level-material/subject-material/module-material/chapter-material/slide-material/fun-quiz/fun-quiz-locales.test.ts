import { describe, expect, it } from "vitest";
import i18next from "i18next";
import en from "@/locales/en/funQuiz.json";
import fr from "@/locales/fr/funQuiz.json";
import hi from "@/locales/hi/funQuiz.json";
import ar from "@/locales/ar/funQuiz.json";

const make = async (lng: string, res: object) => {
  const i = i18next.createInstance();
  await i.init({ lng, resources: { [lng]: { funQuiz: res } }, ns: ["funQuiz"], defaultNS: "funQuiz", interpolation: { escapeValue: false } });
  return i;
};

describe("funQuiz result tiles", () => {
  it("agree with the count in French", async () => {
    const i = await make("fr", fr);
    expect(i.t("result.tileCorrect", { count: 1 })).toBe("Juste");
    expect(i.t("result.tileCorrect", { count: 4 })).toBe("Justes");
    expect(i.t("result.tileWrong", { count: 1 })).toBe("Fausse");
    expect(i.t("result.tileWrong", { count: 4 })).toBe("Fausses");
    expect(i.t("result.tilePartial", { count: 1 })).toBe("En partie juste");
    expect(i.t("result.tilePartial", { count: 2 })).toBe("En partie justes");
    expect(i.t("result.tileSkipped", { count: 3 })).toBe("Sans réponse");
  });

  it("read the same for any count where the label does not change", async () => {
    for (const [lng, res, word] of [
      ["en", en, "Correct"],
      ["hi", hi, "सही"],
      ["ar", ar, "صحيحة"],
    ] as const) {
      const i = await make(lng, res);
      for (const count of [0, 1, 2, 3, 11, 100]) expect(i.t("result.tileCorrect", { count })).toBe(word);
    }
  });

  it("have a label for every tile in every language", async () => {
    for (const [lng, res] of [["en", en], ["fr", fr], ["hi", hi], ["ar", ar]] as const) {
      const i = await make(lng, res);
      for (const key of ["tileCorrect", "tileWrong", "tilePartial", "tileSkipped"]) {
        for (const count of [0, 1, 2, 5, 11]) expect(i.t(`result.${key}`, { count })).not.toContain("result.");
      }
    }
  });
});

describe("funQuiz back button", () => {
  it("keeps the renamed course term in every language, with no fixed French article", async () => {
    for (const [lng, res] of [["en", en], ["fr", fr], ["hi", hi], ["ar", ar]] as const) {
      const i = await make(lng, res);
      expect(i.t("result.backToCourse", { course: "atelier" })).toContain("atelier");
    }
    // "au" / "du" / "le" would be wrong for a feminine or vowel-initial term (formation, atelier).
    expect((fr as { result: { backToCourse: string } }).result.backToCourse).not.toMatch(/\b(au|du|le|la|l')\s*\{\{course\}\}/i);
  });
});
