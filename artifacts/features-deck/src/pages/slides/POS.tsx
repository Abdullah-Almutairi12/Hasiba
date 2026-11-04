import { SlideFrame, Panel, Row, Note } from "../../components/deck";

export default function POS() {
  return (
    <SlideFrame page="05" kicker="الوحدة 02 — المنصّة الأساسية" title="نقطة البيع (POS)" lead="رحلة اختبار كاملة من الواجهات الأصلية على شركة اختبار مستقلة (V2): استلام، بيع نقدي، مرتجع واسترداد، ثم إقفال الصندوق.">
      <div className="grid grid-cols-[5fr_7fr] gap-[3.5vw] h-full">
        <div className="flex flex-col justify-between">
          <div>
            <div className="text-[1.5vw] font-semibold text-accent mb-[0.8vh]">النقد الختامي المطابق · وردية 33</div>
            <div dir="ltr" className="font-display font-bold text-[6vw] leading-none text-text text-right">117.00</div>
            <p dir="ltr" className="text-[1.6vw] text-muted mt-[1vh] mb-0 text-right">100 + 25.50 − 8.50 · diff 0.00</p>
          </div>
          <div>
            <div className="text-[1.5vw] font-semibold text-accent mb-[0.8vh]">كمية الصنف RSD2-000001</div>
            <div dir="ltr" className="font-display font-bold text-[3vw] leading-none text-text text-right">0 → 10 → 7 → 8</div>
            <p className="text-[1.6vw] text-muted mt-[1vh] mb-0">استلام 10 · بيع 3 · إرجاع وحدة صالحة للبيع</p>
          </div>
        </div>
        <div>
          <Panel label="إثبات فعلي · 4 نوفمبر 2026">
            <Row k="استلام المورد" v="GRN-2026-00001 · 66.00" />
            <Row k="فاتورة البيع النقدي" v="PINV-2026-00002 · 25.50" />
            <Row k="إشعار دائن (مرتجع)" v="CN-2026-00001 · 8.50" />
            <Row k="استرداد نقدي — سند #1" v="8.50" />
            <Row k="مخزون ختامي · تكلفة مبيعات صافية" v="52.80 · 13.20" />
            <Row k="ذمم المورد · العميل · قيود متوازنة" v="66.00 · 0.00 · 7" strong />
            <Note>مطابقة مستقلة 67/67 · بيانات اصطناعية، لا نقد أو دفع حقيقي.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
