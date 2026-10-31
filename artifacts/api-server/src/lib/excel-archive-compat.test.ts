import {createRequire} from "node:module";
import {mkdtemp,writeFile,mkdir,rm} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {PassThrough,Readable} from "node:stream";
import {describe,it,expect} from "vitest";
import ExcelJS from "exceljs";

const local=createRequire(import.meta.url);
const excel=createRequire(local.resolve("exceljs"));
const factoryPath=excel.resolve("archiver");
const factory=excel("archiver");
const JSZip=excel("jszip");
function metadata(entry:string):{name:string;version:string}{
  for(let dir=dirname(entry);;dir=dirname(dir)){
    try{const p=JSON.parse(readFileSync(join(dir,"package.json"),"utf8"));if(p.name)return p;}catch{}
    if(dirname(dir)===dir)throw new Error("Dependency metadata unavailable");
  }
}
describe("Excel archive installed-consumer compatibility",()=>{
  it("uses a patched matcher through the actual archive reader",()=>{
    const owner=createRequire(factoryPath);
    const engine=metadata(factoryPath).name==="@workspace/excel-archive-compat"?
      createRequire(owner.resolve("archiver")):owner;
    const reader=createRequire(engine.resolve("readdir-glob"));
    const [major,minor,patch]=metadata(reader.resolve("minimatch")).version.split(".").map(Number);
    expect(major>11||(major===11&&(minor>0||patch>=1))).toBe(true);
  });
  it("archives actual Arabic attachments without omissions through glob, directory, file and buffer",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"hasba-archive-"));
    try{
      await mkdir(join(dir,"فرع"));
      const files={"فاتورة.xlsx":"synthetic-xlsx","فرع/مرفق.txt":"محتوى المرفق",".hidden.txt":"hidden","فرع/تجاهل.txt":"excluded"};
      for(const [name,content] of Object.entries(files))await writeFile(join(dir,name),content);
      const archive=factory("zip",{zlib:{level:6}});
      const chunks:Buffer[]=[];
      const output=new PassThrough();
      const completed=new Promise<Buffer>((resolve,reject)=>{
        archive.on("error",reject);archive.on("warning",reject);output.on("error",reject);
        output.on("data",(b:Buffer)=>chunks.push(b));output.on("end",()=>resolve(Buffer.concat(chunks)));
      });
      archive.pipe(output);
      archive.glob("{*.xlsx,**/*.txt}",{cwd:dir,dot:true,ignore:["**/تجاهل.txt"]},{prefix:"selected"});
      archive.directory(join(dir,"فرع"),"all");
      archive.file(join(dir,"فاتورة.xlsx"),{name:"direct/فاتورة.xlsx"});
      archive.append(Buffer.from("محتوى ذاكرة"),{name:"buffer/ذاكرة.txt"});
      await archive.finalize();
      const zip=await JSZip.loadAsync(await completed);
      const expected:Record<string,string>={
        "selected/فاتورة.xlsx":"synthetic-xlsx","selected/فرع/مرفق.txt":"محتوى المرفق","selected/.hidden.txt":"hidden",
        "all/مرفق.txt":"محتوى المرفق","all/تجاهل.txt":"excluded","direct/فاتورة.xlsx":"synthetic-xlsx","buffer/ذاكرة.txt":"محتوى ذاكرة"};
      expect(Object.keys(zip.files).filter(n=>!zip.files[n].dir).sort()).toEqual(Object.keys(expected).sort());
      for(const [name,content] of Object.entries(expected))expect(await zip.file(name).async("string")).toBe(content);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  for(const streaming of [false,true])it(`preserves XLSX import/export including ${streaming?"streaming":"buffered"} output`,async()=>{
    const output=new PassThrough();const chunks:Buffer[]=[];
    const done=new Promise<Buffer>((resolve,reject)=>{output.on("data",(b:Buffer)=>chunks.push(b));output.on("end",()=>resolve(Buffer.concat(chunks)));output.on("error",reject);});
    const book=streaming?new ExcelJS.stream.xlsx.WorkbookWriter({stream:output,useStyles:true,useSharedStrings:true}):new ExcelJS.Workbook();
    const sheet=book.addWorksheet("البيانات",{views:[{rightToLeft:true}]});
    sheet.addRow(["مرجع","صافي","ضريبة","إجمالي","تاريخ"]);
    sheet.addRow(["مرجع عربي / ABC",100,14.67,{formula:"B2+C2",result:114.67},new Date("2026-10-31T00:00:00Z")]);
    sheet.getCell("E2").numFmt="yyyy-mm-dd";
    sheet.getCell("C2").numFmt="0.00";
    if(streaming)await (book as ExcelJS.stream.xlsx.WorkbookWriter).commit();
    else output.end(await (book as ExcelJS.Workbook).xlsx.writeBuffer());
    const bytes=await done;
    const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(Uint8Array.from(bytes).buffer);
    const read=loaded.getWorksheet("البيانات")!;
    expect(read.rowCount).toBe(2);expect(read.getCell("A2").value).toBe("مرجع عربي / ABC");
    expect(read.getCell("B2").value).toBe(100);expect(read.getCell("C2").value).toBe(14.67);
    expect(read.getCell("D2").value).toEqual({formula:"B2+C2",result:114.67});
    expect((read.getCell("E2").value as Date).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(read.views[0].rightToLeft).toBe(true);expect(read.getCell("C2").numFmt).toBe("0.00");
    const imported:unknown[][]=[];
    const reader=new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes),{sharedStrings:"cache",styles:"cache",worksheets:"emit"});
    for await(const worksheet of reader)for await(const row of worksheet)imported.push(row.values as unknown[]);
    expect(imported.length).toBe(2);
    expect(imported[1][1]).toBe("مرجع عربي / ABC");
    expect(imported[1][2]).toBe(100);
  });
});
