import type { Response } from "express";
import ExcelJS from "exceljs";
import { sendPrintPdf } from "./pdf/print-document";
import { getPrintCompany } from "./pdf/print-company";
export type Cell=string|number|null|undefined;
export interface RenderInput {slug:string;title:string;subtitle?:string|null;headers:string[];rows:Cell[][];companyId?:number}
export async function renderXlsx(res:Response,input:RenderInput):Promise<void>{
  const {slug,title,subtitle,headers,rows}=input;
  const wb=new ExcelJS.Workbook();wb.creator="حاسبة.AI";wb.created=new Date();
  const ws=wb.addWorksheet(title.slice(0,30),{views:[{rightToLeft:true}]});
  ws.mergeCells(1,1,1,headers.length);ws.getCell(1,1).value=title;
  ws.getCell(1,1).font={bold:true,size:16};ws.getCell(1,1).alignment={horizontal:"center"};
  if(subtitle){ws.mergeCells(2,1,2,headers.length);ws.getCell(2,1).value=subtitle;
    ws.getCell(2,1).font={size:10,color:{argb:"FF475569"}};ws.getCell(2,1).alignment={horizontal:"center"};}
  ws.addRow([]);const headerRow=ws.addRow(headers);headerRow.font={bold:true,color:{argb:"FFFFFFFF"}};
  headerRow.eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF2563EB"}};cell.alignment={horizontal:"center"};});
  rows.forEach(r=>ws.addRow(r));ws.columns.forEach(col=>{const colIdx=col.number;if(typeof colIdx!=="number")return;col.width=Math.max(14,...rows.map(r=>String(r[colIdx-1]??"").length+2));});
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",`attachment; filename="${slug}-${new Date().toISOString().slice(0,10)}.xlsx"`);
  await wb.xlsx.write(res);res.end();
}
export async function renderPdf(res:Response,input:RenderInput):Promise<void>{
  await sendPrintPdf(res,input.slug,{title:input.title,subtitle:input.subtitle,headers:input.headers,rows:input.rows,landscape:true,company:input.companyId?await getPrintCompany(input.companyId):undefined,notes:[`عدد السجلات: ${input.rows.length}`]});
}
