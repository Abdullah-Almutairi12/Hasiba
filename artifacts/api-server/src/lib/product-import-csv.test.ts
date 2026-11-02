import { describe, expect, it } from "vitest";
import { parseImportFile } from "./product-import";

const parse = (csv: string) => parseImportFile("أصناف.csv", Buffer.from(csv).toString("base64"));

describe("CSV delimiter detection uses logical records, not quoted punctuation", () => {
  it.each([
    [",", ";", "الاسم; العربي; حسب; المورد"],
    [";", ",", "الاسم, العربي, حسب, المورد"],
  ])("reads the reported %s-delimited file despite quoted %s punctuation", async (sep, _, header) => {
    const result = await parse(`"${header}"${sep}name${sep}sku\nقهوة${sep}Coffee${sep}0001`);
    expect(result).toEqual({ headers: [header, "name", "sku"], rows: [["قهوة", "Coffee", "0001"]] });
  });
  it.each([",", ";"])("preserves escaped quotes and multiline fields with %s", async sep => {
    const other = sep === "," ? ";" : ",";
    for (const eol of ["\n", "\r\n", "\r"]) {
      const header = `الاسم${other} "حسب"${eol}المورد${other} العربي`;
      const result = await parse(`\uFEFF"${header.replace(/"/g, '""')}"${sep}sku${eol}"قهوة ""عربية""${eol}جديدة"${sep}0001${eol}`);
      expect(result.headers).toEqual([header, "sku"]);
      expect(result.rows).toEqual([[`قهوة "عربية"${eol}جديدة`, "0001"]]);
    }
  });
  it.each([
    'a,b\n"unclosed,c', 'a,b\n"closed"x,c', 'a,b\nbad"quote,c',
  ])("rejects malformed quoting: %s", async text => {
    await expect(parse(text)).rejects.toThrow(/اقتباس/);
  });
  it("rejects genuinely ambiguous two-dimensional parses instead of guessing", async () => {
    await expect(parse("a,b;c\nx,y;z")).rejects.toThrow(/ملتبس/);
  });
  it("keeps a single-column file deterministic when both parses are identical", async () => {
    expect(await parse('sku\n"0001"')).toEqual({ headers: ["sku"], rows: [["0001"]] });
  });
  it("rejects inconsistent logical record widths", async () => {
    await expect(parse('a,b\n"c",d,e')).rejects.toThrow();
  });
  it("keeps UTF8, cell, row, column and file bounds", async () => {
    await expect(parseImportFile("a.csv", Buffer.from([255]).toString("base64"))).rejects.toThrow();
    await expect(parse(`a,b\n"${"ع".repeat(129)}",c`)).rejects.toThrow();
    await expect(parse(Array.from({ length: 503 }, () => "a,b").join("\n"))).rejects.toThrow();
    await expect(parse(Array.from({ length: 2 }, () => Array.from({ length: 13 }, (_, i) => `c${i}`).join(",")).join("\n"))).rejects.toThrow();
    await expect(parse("a".repeat(262145))).rejects.toThrow();
  });
});
