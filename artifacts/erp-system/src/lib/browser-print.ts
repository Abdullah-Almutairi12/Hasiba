export async function printWhenFontsReady():Promise<void>{
  try{
    await Promise.all([document.fonts.load("12px PrintTajawal"),document.fonts.load("700 12px PrintTajawal")]);
    await document.fonts.ready;
    if(!document.fonts.check("12px PrintTajawal")||!document.fonts.check("700 12px PrintTajawal"))throw new Error("FONT_MISSING");
    window.print();
  }catch{window.alert("تعذر تحميل خطوط الطباعة المحلية. لم تبدأ الطباعة؛ أعد المحاولة. المرجع: PRINT_FONT_FAILED");}
}
